// A new synthetic session written only through released Session/JSONL APIs.
// Its tool events are UI fixtures, not claimed as a real model/tool execution.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
const [productArg, homeArg, evidenceArg] = process.argv.slice(2)
assert.ok(productArg && homeArg && evidenceArg)
const product = resolve(productArg), home = resolve(homeArg), evidence = resolve(evidenceArg)
const fixtureFile = join(evidence, 'fixture.json')
const fixture = JSON.parse(await readFile(fixtureFile, 'utf8'))
const shell = fixture.title.match(/(electron|wails|web)$/)?.[1]
assert.ok(shell)
assert.equal(resolve(fixture.workspace), join(evidence, `preview-workspace-${shell}`))
assert.equal(fixture.filesReady, true)
assert.ok(!fixture.toolFixture, 'Do not overwrite an existing session fixture')
const require = createRequire(join(product, 'd/package.json'))
const load = name => import(pathToFileURL(require.resolve(name)))
const { Context } = await load('@deepseek-ai/cordis')
const { default: Sessions } = await load('@deepseek-ai/dsh-session')
const { default: Jsonl } = await load('@deepseek-ai/dsh-session-persistence-jsonl')
const { createUserMessage, createAssistantMessage, createToolResultMessage, AssistantStreamAccumulator } = await load('@deepseek-ai/dsh-llm')
const ctx = new Context()
const files = fixture.files || ['preview-report.docx', 'preview-table.xlsx', 'preview-slides.pptx', 'preview-audio.wav', 'preview-video.mp4']
const sessionId = `session-desktop-preview-fixture-${randomUUID()}`
const title = fixture.uniqueTitle || `Synthetic preview cards · ${shell}`
try {
  await ctx.plugin(Sessions)
  await ctx.plugin(Jsonl, { root: join(home, 'sessions'), compression: 'zstd' })
  const session = ctx.sessions.create(sessionId, { meta: { cwd: fixture.workspace, agentPreset: 'standard' } })
  session.append('session/title', { title, messageSeqs: [], source: { kind: 'user' } })
  session.append('turn/start', { turn: 1 }); session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Synthetic desktop preview acceptance. These tool records are fixture data, not a real model execution.' }] }), { surfaceOp: 'append' })
  for (const [index, file] of files.entries()) {
    const callId = `synthetic-publish-${index}`
    session.append('tool/call', { turn: 1, step: 1, callId, name: 'present', arguments: JSON.stringify({ files: [{ path: file }] }) })
    session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId, isError: false, content: [{ type: 'text', text: 'Synthetic successful file publication fixture.' }] }), meta: { relativePath: file } }, { surfaceOp: 'append' })
    session.append('deliverables/presented', { turn: 1, callId, files: [{ path: file }] })
  }
  const text = 'Synthetic fixture files for actual desktop preview and download validation:\n' + files.map(file => `[${file}](${file})`).join('\n')
  const stream = new AssistantStreamAccumulator()
  for (const chunk of [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text }, { type: 'block-end', index: 0, block: { type: 'text', text } }, { type: 'finish', reason: { kind: 'stop' } }]) stream.push({ time: Date.now(), chunk })
  session.append('assistant/message', { turn: 1, step: 1, message: createAssistantMessage({ source: { provider: 'synthetic-fixture', model: 'not-a-model-call' }, content: [{ type: 'text', text }] }), stream: stream.snapshot() }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 }); session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const handle = await ctx.sessionPersistence.create(session.header)
  try { await handle.append(session.snapshotEvents()); await handle.flush() } finally { await handle.close() }
  fixture.linkSessionId = fixture.sessionId
  Object.assign(fixture, { sessionId, title, toolFixture: true, uploadVerified: false, eventCount: session.snapshotEvents().length })
  await writeFile(fixtureFile, JSON.stringify(fixture, null, 2) + '\n')
  console.log(JSON.stringify({ synthetic: true, sessionId, eventCount: session.snapshotEvents().length }))
} finally { await ctx.fiber.dispose() }
