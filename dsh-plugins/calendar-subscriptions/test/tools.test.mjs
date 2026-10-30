// Tools over the subscription service.
//
// These tests drive the registered tool definitions the way a session would:
// reads pass through, writes ask first (and do not without a session), and
// each execute reaches the service with the arguments the model supplied. The
// service's own behaviour — snapshots, failures, restarts — is covered by
// `subscriptions.test.mjs` against a real store; here it is a recording
// stand-in, so the assertions stay about the tool surface.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire, registerHooks } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const runtime = process.env.EDUWORK_TEST_RUNTIME
const require = runtime ? createRequire(join(runtime, 'package.json')) : undefined
const runtimeParent = runtime ? pathToFileURL(join(runtime, 'package.json')).href : undefined
const load = name => import(pathToFileURL(require.resolve(name)).href)

let hooks
function bindRuntime() {
  hooks ??= registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'zod' || specifier.startsWith('@deepseek-ai/')) return nextResolve(specifier, { ...context, parentURL: runtimeParent })
      return nextResolve(specifier, context)
    },
  })
}

let tools
async function loadTools() {
  bindRuntime()
  tools ??= await import('../lib/tools.js')
  return tools
}

test.after(() => hooks?.deregister())

/** A stand-in subscription service that records what the tools asked it to do. */
function service(overrides = {}) {
  const calls = []
  const feed = { id: 'abc123', label: '中国节假日', url: 'https://example.test/holidays.ics', format: 'ics', intervalHours: 24, enabled: true, lastSuccessAt: '2026-10-27T08:00:00.000Z' }
  return {
    calls,
    feeds: () => { calls.push({ method: 'feeds' }); return [feed] },
    addFeed: async input => { calls.push({ method: 'addFeed', input }); return { feed, refresh: { applied: 3, removed: 0, skipped: [], degraded: [] } } },
    updateFeed: async (id, patch) => { calls.push({ method: 'updateFeed', id, patch }); return { ...feed, ...patch } },
    removeFeed: async id => { calls.push({ method: 'removeFeed', id }); return { removed: id } },
    refresh: async id => { calls.push({ method: 'refresh', id }); return { applied: 2, removed: 1, skipped: [], degraded: [] } },
    refreshAll: async () => { calls.push({ method: 'refreshAll' }); return { abc123: { applied: 2, removed: 0, skipped: [], degraded: [] } } },
    ...overrides,
  }
}

/** A context that records what the plugin registers and how it gates calls. */
async function harness(serviceInstance, preset = 'standard') {
  const { apply } = await loadTools()
  const registered = []
  const handlers = []
  const ctx = {
    calendarSubscriptions: serviceInstance,
    permissionPresets: { current: () => preset },
    tools: { register: definition => { registered.push(definition) } },
    on: (name, handler) => { handlers.push({ name, handler }) },
  }
  apply(ctx)
  const gate = handlers.find(entry => entry.name === 'tools/pre-execute').handler
  const byName = name => registered.find(tool => tool.name === name)
  return { ctx, registered, gate, byName }
}

const agent = { session: 'session-1' }
const passThrough = () => 'passed'

test('registers five tools and gates writes the way the calendar tools do', { skip: !runtime }, async () => {
  const { registered, gate } = await harness(service())
  assert.deepEqual(registered.map(tool => tool.name), [
    'calendar_subscriptions',
    'calendar_subscribe',
    'calendar_update_subscription',
    'calendar_unsubscribe',
    'calendar_refresh_subscriptions',
  ])
  // Reads pass through untouched.
  assert.equal(await gate({ name: 'calendar_subscriptions', agent }, passThrough), 'passed')
  // Writes ask first on a standard session, with a bilingual reason.
  const decision = await gate({ name: 'calendar_subscribe', agent }, passThrough)
  assert.equal(decision.kind, 'ask')
  assert.equal(decision.reason, decision.displayReason.zh)
  assert.ok(decision.displayReason.en.length > 0)
  // Approvals disabled: the write proceeds.
  const full = await harness(service(), 'danger-full-access')
  assert.equal(await full.gate({ name: 'calendar_unsubscribe', agent }, passThrough), 'passed')
  // No session behind the call: the write is denied, not asked.
  assert.deepEqual(await gate({ name: 'calendar_refresh_subscriptions' }, passThrough), { kind: 'deny', reason: '日历订阅变更需要关联智能体会话' })
})

test('list reports the feeds as the service sees them', { skip: !runtime }, async () => {
  const { byName } = await harness(service())
  const output = await byName('calendar_subscriptions').execute({})
  assert.deepEqual(output.feeds, [{
    id: 'abc123', label: '中国节假日', url: 'https://example.test/holidays.ics', format: 'ics', intervalHours: 24, enabled: true,
    lastSuccessAt: '2026-10-27T08:00:00.000Z',
  }])
})

test('subscribe reaches the service and reports a failed first fetch without throwing', { skip: !runtime }, async () => {
  const failing = service({ addFeed: async input => {
    failing.calls.push({ method: 'addFeed', input })
    return { feed: { id: 'abc123', label: '节假日', url: input.url, intervalHours: 24, enabled: true }, refresh: { error: '订阅「节假日」刷新失败：HTTP 500' } }
  } })
  const { byName } = await harness(failing)
  const output = await byName('calendar_subscribe').execute({ url: 'https://example.test/holidays.ics', label: '节假日', intervalHours: 12 })
  assert.deepEqual(failing.calls[0].input, { url: 'https://example.test/holidays.ics', label: '节假日', intervalHours: 12 })
  assert.equal(output.error, '订阅「节假日」刷新失败：HTTP 500')
  assert.equal(output.feed.label, '节假日')
  const healthy = await harness(service())
  const ok = await healthy.byName('calendar_subscribe').execute({ url: 'https://example.test/holidays.ics' })
  assert.equal(ok.applied, 3)
  assert.equal(ok.error, undefined)
})

test('update and unsubscribe reach the service by id', { skip: !runtime }, async () => {
  const standIn = service()
  const { byName } = await harness(standIn)
  const updated = await byName('calendar_update_subscription').execute({ id: 'abc123', enabled: false })
  assert.equal(updated.feed.enabled, false)
  assert.deepEqual(standIn.calls.find(call => call.method === 'updateFeed'), { method: 'updateFeed', id: 'abc123', patch: { enabled: false } })
  const removed = await byName('calendar_unsubscribe').execute({ id: 'abc123' })
  assert.deepEqual(removed, { removed: 'abc123' })
})

test('refresh covers one feed and all enabled feeds, reporting failures inline', { skip: !runtime }, async () => {
  const standIn = service({
    refresh: async () => { throw new Error('订阅「中国节假日」刷新失败：HTTP 500') },
    refreshAll: async () => ({ abc123: { error: '订阅「中国节假日」刷新失败：请求超时' }, other: { applied: 4 } }),
  })
  const { byName } = await harness(standIn)
  const single = await byName('calendar_refresh_subscriptions').execute({ id: 'abc123' })
  assert.deepEqual(single, { results: [{ id: 'abc123', error: '订阅「中国节假日」刷新失败：HTTP 500' }] })
  const all = await byName('calendar_refresh_subscriptions').execute({})
  assert.deepEqual(all.results.find(row => row.id === 'abc123'), { id: 'abc123', error: '订阅「中国节假日」刷新失败：请求超时' })
  assert.deepEqual(all.results.find(row => row.id === 'other'), { id: 'other', applied: 4 })
})
