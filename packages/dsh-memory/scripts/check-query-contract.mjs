import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { encodeSessionReferenceUri, formatSessionReferenceMention } from '../lib/core.js'

assert.ok(process.argv[2], 'Pass the isolated runtime directory containing node_modules')
const require = createRequire(path.join(path.resolve(process.argv[2]), 'package.json'))
const load = name => import(pathToFileURL(require.resolve(name)))
const { Context } = await load('@deepseek-ai/cordis')
const { default: SessionStore, SESSION_FORMAT_VERSION } = await load('@deepseek-ai/dsh-session')
const { default: Projections } = await load('@deepseek-ai/dsh-session-projection')
const { default: SqliteQuery } = await load('@deepseek-ai/dsh-session-query-sqlite')
const { extractSessionEventText } = await load('@deepseek-ai/dsh-session-query')
const { createUserMessage } = await load('@deepseek-ai/dsh-llm')
await mkdir('artifacts', { recursive: true })
const directory = await mkdtemp(path.resolve('artifacts/query-'))
const ctx = new Context()
const fibers = []
try {
  fibers.push(await ctx.plugin(SessionStore))
  fibers.push(await ctx.plugin(Projections))
  fibers.push(await ctx.plugin(SqliteQuery, { path: path.join(directory, 'synthetic-query.sqlite3'), openAt: 'first-search' }))
  const session = ctx.sessions.create('synthetic-history', { meta: { cwd: '/synthetic-project' } })
  const event = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Synthetic orchard preference: concise explanations.' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  session.append('session/title', { title: 'Synthetic history', messageSeqs: [], source: { kind: 'user' } })
  assert.equal(session.header.version, SESSION_FORMAT_VERSION)
  const signal = new AbortController().signal
  const page = await ctx.sessionQuery.searchSessions({
    query: 'orchard', sessionFilters: [{ kind: 'cwd', values: ['/synthetic-project'] }],
    eventFilters: [{ kind: 'surface', values: ['current'] }, { kind: 'type', values: ['user/message', 'assistant/message'] }], limit: 2,
  }, { signal })
  assert.equal(page.items.length, 1)
  const hit = page.items[0]
  assert.equal(String(hit.header.id), String(session.id))
  assert.equal(hit.bestMatch.seq, event.seq)
  assert.match(hit.bestMatch.snippet, /orchard/)
  const titles = await ctx.sessionQuery.readTitleSnapshots([hit.header.id], signal)
  assert.equal(titles[0].status, 'fulfilled')
  assert.equal(String(titles[0].sessionId), String(session.id))
  assert.equal(titles[0].value.title.title, 'Synthetic history')
  assert.equal((await ctx.sessionQuery.readTitle(hit.header.id, signal)).title, 'Synthetic history')
  const window = await ctx.sessionQuery.readEvent({ sessionId: hit.header.id, seq: hit.bestMatch.seq, before: 4, after: 6 }, signal)
  assert.ok(window.events.some(item => extractSessionEventText(item).includes('orchard')))
  assert.ok(window.startSeq <= event.seq && window.endSeq >= event.seq)
  const uri = encodeSessionReferenceUri(String(session.id))
  assert.equal(JSON.parse(Buffer.from(uri.slice('dsh-session:'.length), 'base64url').toString('utf8')), String(session.id))
  assert.ok(formatSessionReferenceMention(String(session.id), 'Synthetic history').includes(uri))
  let persistedQuery = false
  if (SESSION_FORMAT_VERSION >= 1) {
    const { default: Jsonl } = await load('@deepseek-ai/dsh-session-persistence-jsonl')
    const cold = new Context()
    fibers.push(await cold.plugin(SessionStore))
    fibers.push(await cold.plugin(Projections))
    fibers.push(await cold.plugin(Jsonl, { root: path.join(directory, 'synthetic-session-files') }))
    const handle = await cold.sessionPersistence.create(session.header)
    try { await handle.append(session.snapshotEvents()); await handle.flush() } finally { await handle.close() }
    fibers.push(await cold.plugin(SqliteQuery, { path: path.join(directory, 'persisted-query.sqlite3'), openAt: 'first-search' }))
    const coldPage = await cold.sessionQuery.searchSessions({ query: 'orchard', limit: 2 }, { signal })
    assert.equal(String(coldPage.items[0].header.id), String(session.id))
    assert.equal(coldPage.items[0].header.version, SESSION_FORMAT_VERSION)
    const coldWindow = await cold.sessionQuery.readEvent({ sessionId: session.id, seq: event.seq, before: 4, after: 6 }, signal)
    assert.ok(coldWindow.events.some(item => extractSessionEventText(item).includes('orchard')))
    assert.equal((await cold.sessionQuery.readTitle(session.id, signal)).title, 'Synthetic history')
    persistedQuery = true
  }
  const result = { passed: true, dsh: require('@deepseek-ai/dsh-session-query/package.json').version, sessionFormat: SESSION_FORMAT_VERSION, queryAndEventWindow: true, titleSnapshots: true, sessionCitationPreserved: true, persistedQuery, data: 'synthetic only' }
  await writeFile(path.join(directory, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ ...result, evidenceDirectory: directory }))
} finally {
  for (const fiber of fibers.reverse()) await fiber.dispose()
}
