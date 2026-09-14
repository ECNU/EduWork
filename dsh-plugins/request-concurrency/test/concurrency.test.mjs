import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire, registerHooks } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as concurrency from '../lib/index.js'
const { configuredRequestLimit, RequestSlots, SETTINGS_NAMESPACE } = concurrency
const runtime = process.env.EDUWORK_TEST_RUNTIME
const tick = () => new Promise(resolve => setImmediate(resolve))
async function waitFor(predicate) {
  for (let i = 0; i < 100 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.ok(predicate(), 'expected queue transition')
}

test('new totals and legacy child budgets preserve explicit limits, including 32 + 1', () => {
  assert.equal(configuredRequestLimit({}, {}), 3)
  assert.equal(configuredRequestLimit({maxParallelSubagents:2}, {}), 3)
  assert.equal(configuredRequestLimit({maxParallelSubagents:32}, {}), 33)
  assert.equal(configuredRequestLimit({maxConcurrentRequests:2,maxParallelSubagents:2}, {}), 2)
  assert.equal(configuredRequestLimit({}, {EDUWORK_MAX_PARALLEL_SUBAGENTS:'2'}), 3)
  assert.equal(configuredRequestLimit({}, {EDUWORK_MAX_CONCURRENT_REQUESTS:'2',EDUWORK_MAX_PARALLEL_SUBAGENTS:'2'}), 2)
  for (const value of [0, -1, 1.5, 65, '2', null]) assert.throws(() => configuredRequestLimit({maxConcurrentRequests:value}, {}))
})

test('queued cancellation and shutdown release capacity exactly once', async () => {
  const slots = new RequestSlots(1), release = await slots.acquire()
  const cancel = new AbortController(), waiting = slots.acquire(cancel.signal)
  cancel.abort(new Error('cancelled'))
  await assert.rejects(waiting, /cancelled/)
  assert.equal(slots.waiters.length, 0)
  release(); release(); assert.equal(slots.active, 0)
  const last = await slots.acquire(), closed = slots.acquire()
  slots.close(); await assert.rejects(closed, /关闭/)
  last(); assert.equal(slots.active, 0)
})

test('live decreases let active requests finish; increases drain waiting requests', async () => {
  const slots = new RequestSlots(2)
  const a = await slots.acquire(), b = await slots.acquire()
  slots.setLimit(1)
  let entered = false
  const queued = slots.acquire().then(release => { entered = true; return release })
  a(); await tick(); assert.equal(entered, false)
  b(); const release = await queued; assert.equal(entered, true)
  let extra = false
  const second = slots.acquire().then(done => { extra = true; return done })
  slots.setLimit(2); const done = await second; assert.equal(extra, true)
  assert.throws(() => slots.setLimit(0), /整数/)
  release(); done(); slots.close()
})

// Load the actual rc2 services and install the plugin through Cordis, so these
// checks cover the Host plugin scope and official settings persistence.
async function host(t, initial = {}, config = {maxConcurrentRequests:3}) {
  const req = createRequire(join(runtime, 'package.json'))
  const load = name => import(pathToFileURL(req.resolve(name)))
  const [{Context}, {default:Settings}, llm] = await Promise.all([
    load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-settings'), load('@deepseek-ai/dsh-llm'),
  ])
  let saved = structuredClone(initial)
  class MemorySettings extends Settings {
    writable = true
    async load() { return saved }
    async persist(ns, section) { saved = {...saved, [ns]:section}; this.publish(saved) }
  }
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  new llm.default(ctx)
  await ctx.plugin(MemorySettings)
  const hook = registerHooks({resolve(name, context, next) {
    return next(name, name === '@deepseek-ai/schemastery' ? {...context,parentURL:pathToFileURL(join(runtime,'package.json')).href} : context)
  }})
  try { await ctx.plugin(concurrency, config) } finally { hook.deregister() }
  return {ctx, llm, saved:() => saved}
}
const consume = async iterable => { const chunks = []; for await (const chunk of iterable) chunks.push(chunk); return chunks }

for (const [label, previous, expected] of [
  ['fresh default', {}, 3],
  ['old saved 1', {maxParallelSubagents:1}, 2],
  ['old saved 2', {maxParallelSubagents:2}, 3],
  ['old maximum 32', {maxParallelSubagents:32}, 33],
  ['explicit new total wins', {maxParallelSubagents:2,maxConcurrentRequests:1}, 1],
]) {
  test('official settings migration: ' + label, {skip:!runtime}, async t => {
    const {ctx,saved} = await host(t, {[SETTINGS_NAMESPACE]:previous, untouched:{flag:true}})
    assert.equal(ctx.settings.get(SETTINGS_NAMESPACE).maxConcurrentRequests, expected)
    assert.equal(saved()[SETTINGS_NAMESPACE].maxParallelSubagents, undefined)
    assert.deepEqual(saved().untouched, {flag:true})
    if (previous.maxParallelSubagents !== undefined) {
      const restarted = await host(t, saved(), {maxConcurrentRequests:9})
      assert.equal(restarted.ctx.settings.get(SETTINGS_NAMESPACE).maxConcurrentRequests, expected)
    }
  })
}

for (const limit of [1, 2, 3]) {
  test('official Host shares total ' + limit + ' across two roots, six children and auxiliary work', {skip:!runtime}, async t => {
    const {ctx,llm} = await host(t, {}, {maxConcurrentRequests:limit})
    let active = 0, peak = 0
    const entered = [], gates = new Map()
    class Adapter extends llm.LlmAdapter {
      async *stream(options) {
        active++; peak = Math.max(peak, active)
        assert.ok(active <= limit)
        try {
          await new Promise(resolve => { gates.set(options.testID, resolve); entered.push(options.testID) })
          yield {type:'text',text:'ok'}
        } finally { active-- }
      }
    }
    ctx.llm.registerAdapter(['fixture'], new Adapter())
    const ids = ['root-a','root-b','child-1','child-2','background-3','nested-4','workflow-5','child-6','compact']
    const runs = ids.map(testID => consume(ctx.llm.stream({provider:'fixture',model:'local',messages:[],testID,
      ...(testID === 'compact' ? {} : {sessionId:testID})})))
    await waitFor(() => entered.length === limit)
    assert.deepEqual(entered, ids.slice(0,limit))
    for (let i = 0; i < ids.length; i++) {
      await waitFor(() => gates.has(ids[i]))
      gates.get(ids[i])()
      await tick()
    }
    await Promise.all(runs)
    assert.deepEqual(entered, ids)
    assert.equal(peak, limit)
    assert.equal(active, 0)
  })
}

test('official settings changes affect shared slots live and survive restart', {skip:!runtime}, async t => {
  const {ctx,llm,saved} = await host(t, {[SETTINGS_NAMESPACE]:{maxConcurrentRequests:1}})
  const gates = [], entered = []
  class Adapter extends llm.LlmAdapter {
    async *stream(options) {
      await new Promise(resolve => { entered.push(options.sessionId); gates.push(resolve) })
      yield {type:'text',text:'ok'}
    }
  }
  ctx.llm.registerAdapter(['fixture'], new Adapter())
  const runs = ['root','child'].map(sessionId => consume(ctx.llm.stream({provider:'fixture',model:'local',messages:[],sessionId})))
  await waitFor(() => entered.length === 1)
  await ctx.settings.update(SETTINGS_NAMESPACE, {maxConcurrentRequests:2})
  await waitFor(() => entered.length === 2)
  assert.equal(saved()[SETTINGS_NAMESPACE].maxConcurrentRequests, 2)
  await assert.rejects(ctx.settings.update(SETTINGS_NAMESPACE, {maxConcurrentRequests:0}))
  gates.forEach(resolve => resolve()); await Promise.all(runs)
  const restarted = await host(t, saved())
  assert.equal(restarted.ctx.settings.get(SETTINGS_NAMESPACE).maxConcurrentRequests, 2)
})

test('limit 1 permits nested delegation after tool use and releases failed or abandoned streams', {skip:!runtime}, async t => {
  const {ctx,llm} = await host(t, {}, {maxConcurrentRequests:1})
  class Adapter extends llm.LlmAdapter {
    async *stream(options) {
      if (options.fail) throw Error('adapter failed')
      yield {type:'text',text:options.sessionId}
    }
  }
  ctx.llm.registerAdapter(['fixture'], new Adapter())
  const stream = (sessionId,extra={}) => ctx.llm.stream({provider:'fixture',model:'local',messages:[],sessionId,...extra})
  const completed = []
  async function agent(id, child) {
    await consume(stream(id))
    if (child) await agent(child)
    await consume(stream(id + '-continue'))
    completed.push(id)
  }
  await Promise.all([agent('root','nested'), agent('other-root')])
  assert.deepEqual(new Set(completed), new Set(['root','nested','other-root']))
  assert.equal((await consume(stream('failure',{fail:true}))).at(-1).reason.kind, 'error')
  const early = stream('early')[Symbol.asyncIterator]()
  await early.next(); await early.return()
  assert.equal((await consume(stream('after'))).some(chunk => chunk.type === 'text'), true)
})
