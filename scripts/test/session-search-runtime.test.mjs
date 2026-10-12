import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire, registerHooks } from 'node:module'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { patchSessionSearchRuntime, patchSessionSearchSource, sessionSearchPatch } from '../patch-session-search-runtime.mjs'

const runtime = process.env.EDUWORK_TEST_RUNTIME
test('unqualified source is rejected before mutation', () => {
  assert.throws(() => patchSessionSearchSource(Buffer.from('unreviewed Runtime')), /input changed/)
})

test('packaged search retains consistency while live sessions flush', { skip: !runtime }, async t => {
  const require = createRequire(join(runtime, 'package.json'))
  const load = name => import(pathToFileURL(require.resolve('@deepseek-ai/' + name)).href)
  const { Context } = await load('cordis')
  const { default: SessionStore, SESSION_FORMAT_VERSION } = await load('dsh-session')
  const { default: Projection } = await load('dsh-session-projection')
  const { default: Persistence } = await load('dsh-session-persistence')
  const { default: OriginalQuery } = await load('dsh-session-query-sqlite')
  const { createUserMessage } = await load('dsh-llm')
  const temporary = await mkdtemp(join(tmpdir(), 'eduwork-search-backport-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const modules = join(temporary, 'node_modules')
  const packageRoot = join(modules, sessionSearchPatch.package)
  await mkdir(join(packageRoot, 'lib'), { recursive: true })
  const originalPath = require.resolve(sessionSearchPatch.package)
  const original = await readFile(originalPath)
  await writeFile(join(packageRoot, 'package.json'), await readFile(join(dirname(originalPath), '../package.json')))
  await writeFile(join(packageRoot, sessionSearchPatch.file), original)
  const receipt = await patchSessionSearchRuntime(modules)
  assert.equal(receipt.afterSHA256, createHash('sha256').update(await readFile(join(packageRoot, sessionSearchPatch.file))).digest('hex'))
  assert.deepEqual(await readFile(originalPath), original, 'verified npm input is untouched')
  await assert.rejects(patchSessionSearchRuntime(modules), /input changed/, 'do not patch twice')
  const imports = new Map([...original.toString('utf8').matchAll(/from "(@deepseek-ai\/[^"]+)"/g)]
    .map(([, name]) => [name, pathToFileURL(require.resolve(name)).href]))
  const hook = registerHooks({ resolve(name, context, next) {
    return imports.has(name)
      ? { url: imports.get(name), shortCircuit: true } : next(name, context)
  } })
  let Query
  try { Query = (await import(pathToFileURL(join(packageRoot, sessionSearchPatch.file)).href)).default }
  finally { hook.deregister() }
  const header = id => ({ version: SESSION_FORMAT_VERSION, id, createdAt: 1, isSeeded: false })
  const message = text => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
  const events = text => [{ type: 'user/message', seq: 0, time: 1, data: message(text), surfaceOp: 'append' }]

  async function fixture(engine, mode, within = false) {
    const rows = new Map([
      ['cold', { header: header('cold'), events: events('historical needle'), revision: 1 }],
      ['live', { header: header('live'), events: events('obsolete durable text'), revision: 1 }],
    ])
    let lists = 0, reads = 0, liveReads = 0, detach, live
    class FixturePersistence extends Persistence {
      async flush() {}
      async list() {
        lists++
        const result = [...rows.values()].map(row => ({ header: structuredClone(row.header), revision: String(row.revision) }))
        if (mode === 'flush') rows.get('live').revision++
        if (mode === 'cold-churn') rows.get('cold').revision++
        if (mode === 'header-churn') rows.get('live').header.cwd = '/workspace-' + lists
        if (mode === 'delete' && lists === 1) rows.delete('live')
        if (mode === 'detach' && lists === 1) {
          rows.get('live').events = events('latest durable needle')
          rows.get('live').revision++
          detach()
        }
        return result
      }
      async open(id) {
        const row = rows.get(id)
        return { header: structuredClone(row.header), inheritedEventCount: 0,
          async read() { reads++; if (id === 'live') liveReads++; return { eventState: 'detached', events: structuredClone(row.events) } },
          async close() {} }
      }
    }
    const ctx = new Context()
    const fibers = [await ctx.plugin(SessionStore), await ctx.plugin(Projection),
      await ctx.plugin(FixturePersistence), await ctx.plugin(engine, { path: ':memory:', openAt: 'first-search' })]
    live = ctx.sessions.prepare('live', { seed: events('current live needle'), meta: { createdAt: 1 } })
    detach = ctx.sessions.enter(live)
    try {
      const request = { query: 'needle', ...(within ? { sessionId: 'cold' } : {}) }
      const page = await ctx.sessionQuery[within ? 'searchEvents' : 'searchSessions'](request)
      return { page, lists, reads, liveReads }
    } finally { detach(); await ctx.sessionQuery.close(); for (const fiber of fibers.reverse()) await fiber.dispose() }
  }
  await t.test('original package reproduces the failure', async () => {
    await assert.rejects(fixture(OriginalQuery, 'flush'), { code: 'SESSION_QUERY_PERSISTENCE_FAILED' })
  })
  for (const within of [false, true]) await t.test(within ? 'within-session search' : 'cross-session search', async () => {
    const result = await fixture(Query, 'flush', within)
    assert.equal(result.page.items.length, within ? 1 : 2)
    assert.equal(result.lists, 2)
    assert.equal(result.reads, 1)
    assert.equal(result.liveReads, 0)
  })
  for (const mode of ['cold-churn', 'header-churn']) await t.test(mode + ' still fails safely', async () => {
    await assert.rejects(fixture(Query, mode), { code: 'SESSION_QUERY_PERSISTENCE_FAILED' })
  })
  await t.test('durable deletion is reconciled', async () => {
    const result = await fixture(Query, 'delete')
    assert.equal(result.lists, 4)
    assert.equal(result.page.items.find(row => row.header.id === 'live').persisted, false)
  })
  await t.test('detaching owner falls back to latest durable content', async () => {
    const result = await fixture(Query, 'detach')
    assert.equal(result.lists, 4)
    assert.equal(result.liveReads, 1)
    assert.equal(result.page.items.find(row => row.header.id === 'live').live, false)
  })
})
