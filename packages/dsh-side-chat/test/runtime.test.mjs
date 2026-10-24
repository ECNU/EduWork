import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const runtime = process.env.EDUWORK_SIDE_CHAT_RUNTIME
const options = { skip: !runtime, timeout: 20_000 }

async function fixture() {
  const require = createRequire(join(runtime, 'package.json'))
  const load = name => import(pathToFileURL(require.resolve(name)).href)
  const { Context } = await load('@deepseek-ai/cordis')
  const { createUserMessage, createMessage, LlmAdapter } = await load('@deepseek-ai/dsh-llm')
  const { assembleContextFor } = await load('@deepseek-ai/dsh-agent')
  const ctx = new Context()
  const home = await mkdtemp(join(tmpdir(), 'eduwork-side-chat-runtime-'))
  for (const name of ['@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-session-projection', '@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-agent']) {
    const module = await load(name)
    await ctx.plugin(module.default ?? module)
  }
  for (const [name, config] of [
    ['@deepseek-ai/dsh-session-persistence-jsonl', { root: join(home, 'sessions') }],
    ['@deepseek-ai/dsh-session-query-sqlite', { path: join(home, 'search.sqlite') }],
    ['@deepseek-ai/dsh-agent-loop', { agents: [] }],
  ]) { const module = await load(name); await ctx.plugin(module.default ?? module, config) }
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'side-fixture', model: 'fixture' }) })
  const sourceHandle = await ctx.agents.create({ sessionId: 'fixture-source', meta: { cwd: home } })
  const source = sourceHandle.agent.session
  source.append('turn/start', { turn: 1 })
  const selected = source.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'SOURCE_REFERENCE' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  source.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  source.append('turn/start', { turn: 2 })
  source.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'SOURCE_FUTURE' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  source.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
  let now = 1000
  const { SideChatService } = await load('@eduwork/dsh-side-chat')
  const service = new SideChatService(ctx, { now: () => now, leaseMs: 100 })
  return {
    ctx, service, source, sourceHandle, selected, createUserMessage, createMessage, LlmAdapter,
    assemble: agent => ctx.systemPrompt.assemble(assembleContextFor(agent)),
    advance: ms => { now += ms },
    close: async () => { await service.dispose(); await ctx.fiber.dispose() },
  }
}

test('real Runtime keeps a precise, usable side snapshot outside disk, lists and search', options, async t => {
  const f = await fixture(); t.after(f.close)
  const owner = 'a'.repeat(32)
  const opened = await f.service.open({ owner, sourceSessionId: f.source.id, atSeq: f.selected.seq })
  const side = f.ctx.agents.get(opened.sessionId)
  assert.equal(side.session.header.ephemeral, true)
  assert.equal(side.session.header.origin, undefined)
  assert.equal(side.session.header.parentSession, f.source.id)
  assert.deepEqual(side.session.snapshotEvents(), [], 'a side chat starts with no inherited records')
  assert.deepEqual(side.session.deriveMessages(), [])
  assert.equal(JSON.stringify(side.session.snapshotEvents()).includes('SOURCE_FUTURE'), false)
  side.session.append('turn/start', { turn: 3 })
  side.session.append('user/message', f.createUserMessage({ content: [{ type: 'text', text: 'SIDE_PRIVATE_NEEDLE' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  side.session.append('turn/end', { turn: 3, reason: { kind: 'completed' } })
  await f.ctx.sessionPersistence.flush()
  assert.equal(await f.ctx.sessionPersistence.stat(opened.sessionId), undefined)
  assert.equal((await f.ctx.sessionQuery.listSessions()).some(row => row.id === opened.sessionId || row.header?.id === opened.sessionId), false)
  assert.equal((await f.ctx.sessionQuery.searchSessions({ query: 'SIDE_PRIVATE_NEEDLE' })).items.length, 0)
  const prompt = await f.assemble(side)
  assert.equal(prompt.contexts.some(context => context.text.includes('Only new requests')), true)
  await assert.rejects(f.ctx.sessionPersistence.create(side.session.header), /cannot enter durable/)
  await f.service.close({ owner, sessionId: opened.sessionId })
  assert.equal(f.ctx.agents.get(opened.sessionId), undefined)
  assert.equal(f.ctx.sessions.get(opened.sessionId), undefined)
  assert.equal(await f.ctx.sessionPersistence.stat(opened.sessionId), undefined)
  assert.equal(JSON.stringify(f.source.snapshotEvents()).includes('SIDE_PRIVATE_NEEDLE'), false)
})

function responseChunks(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

test('real AgentLoop sends the reference boundary and new side question to a scripted adapter', options, async t => {
  const f = await fixture(); t.after(f.close)
  const requests = []
  class Adapter extends f.LlmAdapter {
    resolveModel(provider, model) { return Promise.resolve({ provider, id: model, name: model }) }
    async *stream(request) { requests.push(request); yield* responseChunks('SCRIPTED_SIDE_REPLY') }
  }
  f.ctx.llm.registerAdapter(['side-fixture'], new Adapter())
  const opened = await f.service.open({ owner: 'e'.repeat(32), sourceSessionId: f.source.id, atSeq: f.selected.seq })
  const side = f.ctx.agents.get(opened.sessionId)
  assert.deepEqual(side.session.snapshotEvents(), [])
  assert.equal(requests.length, 0, 'opening must not replay the selected request')
  await f.sourceHandle.dispose()
  f.ctx.sessionQuery.observeSession = () => { throw new Error('Source must never be reread by an open side chat') }
  side.followup(f.createUserMessage({ content: [{ type: 'text', text: 'CURRENT_SIDE_QUESTION' }], source: { kind: 'user' } }))
  await side.whenIdle()
  assert.equal(requests.length, 1)
  const serialized = JSON.stringify(requests[0].messages)
  assert.ok(serialized.includes('SOURCE_REFERENCE'))
  assert.ok(serialized.includes('CURRENT_SIDE_QUESTION'))
  assert.ok(serialized.includes('Only new requests submitted in this side conversation'))
  assert.ok(!serialized.includes('SOURCE_FUTURE'))
  assert.ok(JSON.stringify(side.session.snapshotEvents()).includes('SCRIPTED_SIDE_REPLY'))
  assert.equal(side.session.snapshotEvents()[0].seq, 0)
  assert.ok(!JSON.stringify(side.session.snapshotEvents()).includes('SOURCE_REFERENCE'), 'reference context stays outside side records')
  assert.equal(await f.ctx.sessionPersistence.stat(opened.sessionId), undefined)
})

test('hidden reference closes incomplete historical tool calls without replay or transcript import', options, async t => {
  const f = await fixture(); t.after(f.close)
  const requests = []
  let executions = 0
  f.ctx.tools.register({ name: 'reference_fixture', description: 'Synthetic historical tool', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async () => { executions++; return 'must not execute historical work' },
  })
  f.source.append('turn/start', { turn: 3 })
  f.source.append('step/start', { turn: 3, step: 1 })
  const selected = f.source.append('assistant/message', { turn: 3, step: 1, stream: [],
    message: f.createMessage({ role: 'assistant', source: { kind: 'model', provider: 'side-fixture', model: 'fixture' },
      content: [{ type: 'tool-call', id: 'synthetic-historical-call', name: 'reference_fixture', arguments: '{}' }] }),
  }, { surfaceOp: 'append' })
  class Adapter extends f.LlmAdapter {
    resolveModel(provider, model) { return Promise.resolve({ provider, id: model, name: model }) }
    async *stream(request) { requests.push(request); yield* responseChunks('HISTORY_INSPECTED') }
  }
  f.ctx.llm.registerAdapter(['side-fixture'], new Adapter())
  const opened = await f.service.open({ owner: 'i'.repeat(32), sourceSessionId: f.source.id, atSeq: selected.seq })
  const side = f.ctx.agents.get(opened.sessionId)
  assert.deepEqual(side.session.snapshotEvents(), [])
  side.followup(f.createUserMessage({ content: [{ type: 'text', text: 'Explain the historical call without running it.' }], source: { kind: 'user' } }))
  await side.whenIdle()
  assert.equal(requests.length, 1)
  const history = requests[0].messages
  assert.ok(history.some(message => message.role === 'assistant' && message.content.some(block => block.type === 'tool-call' && block.id === 'synthetic-historical-call')))
  assert.ok(history.some(message => message.role === 'tool' && message.toolCallId === 'synthetic-historical-call' && message.isError === true))
  assert.equal(executions, 0)
  assert.ok(!JSON.stringify(side.session.snapshotEvents()).includes('synthetic-historical-call'))
})

test('closing a streaming side Agent cancels its model request while a normal Agent completes', options, async t => {
  const f = await fixture(); t.after(f.close)
  let began
  const streaming = new Promise(resolve => { began = resolve })
  let sideSignal
  class Adapter extends f.LlmAdapter {
    resolveModel(provider, model) { return Promise.resolve({ provider, id: model, name: model }) }
    async *stream(request) {
      if (JSON.stringify(request.messages).includes('HANG_SIDE_REQUEST')) {
        sideSignal = request.signal
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'SIDE_STREAM_PARTIAL' }
        began()
        await new Promise((_, reject) => {
          if (request.signal.aborted) reject(request.signal.reason)
          else request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true })
        })
      } else yield* responseChunks('MAIN_COMPLETED_INDEPENDENTLY')
    }
  }
  f.ctx.llm.registerAdapter(['side-fixture'], new Adapter())
  const owner = 'f'.repeat(32)
  const opened = await f.service.open({ owner, sourceSessionId: f.source.id, atSeq: f.selected.seq })
  const side = f.ctx.agents.get(opened.sessionId)
  side.followup(f.createUserMessage({ content: [{ type: 'text', text: 'HANG_SIDE_REQUEST' }], source: { kind: 'user' } }))
  await streaming
  const main = await f.ctx.agents.create({ sessionId: 'parallel-normal', agentOptions: { provider: 'side-fixture', model: 'fixture' } })
  main.agent.followup(f.createUserMessage({ content: [{ type: 'text', text: 'MAIN_NEW_REQUEST' }], source: { kind: 'user' } }))
  await main.agent.whenIdle()
  assert.ok(JSON.stringify(main.agent.session.snapshotEvents()).includes('MAIN_COMPLETED_INDEPENDENTLY'))
  assert.equal(sideSignal.aborted, false)
  await f.service.close({ owner })
  assert.equal(sideSignal.aborted, true)
  assert.equal(f.ctx.agents.get(opened.sessionId), undefined)
  assert.equal(main.agent.status, 'idle')
  await f.ctx.sessionPersistence.flush()
  assert.ok(await f.ctx.sessionPersistence.stat(main.agent.session.id), 'ordinary chats must retain durable history')
})

test('side policy denies background tools without changing normal Agent policy', options, async t => {
  const f = await fixture(); t.after(f.close)
  let executions = 0
  f.ctx.tools.register({ name: 'schedule_fixture', description: 'Synthetic background tool', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async () => { executions++; return 'scheduled' },
  })
  const opened = await f.service.open({ owner: 'g'.repeat(32), sourceSessionId: f.source.id, atSeq: f.selected.seq })
  const invoke = agent => f.ctx.tools.execute({ name: 'schedule_fixture', callId: 'synthetic-call', arguments: {}, agent, signal: new AbortController().signal })
  const denied = await invoke(f.ctx.agents.get(opened.sessionId))
  assert.equal(denied.isError, true)
  assert.equal(executions, 0)
  assert.match(JSON.stringify(denied), /long-lived background/)
  const normal = await invoke(f.ctx.agents.get(f.source.id))
  assert.equal(normal.isError, false)
  assert.equal(executions, 1)
})

test('closing during source observation cannot leave a late temporary Agent', options, async t => {
  const f = await fixture(); t.after(f.close)
  const observe = f.ctx.sessionQuery.observeSession.bind(f.ctx.sessionQuery)
  let resume
  const gate = new Promise(resolve => { resume = resolve })
  f.ctx.sessionQuery.observeSession = async id => { await gate; return observe(id) }
  const owner = 'h'.repeat(32)
  const pending = f.service.open({ owner, sourceSessionId: f.source.id, atSeq: f.selected.seq })
  const rejected = assert.rejects(pending, /closed/)
  const closing = f.service.close({ owner })
  resume()
  await Promise.all([rejected, closing])
  assert.equal(f.service.entries.size, 0)
  assert.deepEqual(f.ctx.sessions.list().map(session => session.id), [f.source.id])
})

test('real Runtime lease expiry disposes its owning Agent and preserves source', options, async t => {
  const f = await fixture(); t.after(f.close)
  const owner = 'b'.repeat(32)
  const opened = await f.service.open({ owner, sourceSessionId: f.source.id, atSeq: f.selected.seq })
  assert.deepEqual(await f.service.open({ owner, sourceSessionId: f.source.id, atSeq: f.selected.seq }), opened)
  await assert.rejects(f.service.open({ owner, sourceSessionId: f.source.id, atSeq: 3 }), /Close the existing/)
  f.advance(101)
  await f.service.expire()
  assert.equal(f.ctx.agents.get(opened.sessionId), undefined)
  assert.notEqual(f.ctx.agents.get(f.source.id), undefined)
  assert.throws(() => f.service.heartbeat({ owner, sessionId: opened.sessionId }), /has ended/)
})

test('real Runtime cleanup failure retains a retryable tombstone', options, async t => {
  const f = await fixture(); t.after(f.close)
  const owner = 'c'.repeat(32)
  const opened = await f.service.open({ owner, sourceSessionId: f.source.id, atSeq: f.selected.seq })
  const entry = f.service.entries.get(owner)
  const dispose = entry.handle.dispose.bind(entry.handle)
  let first = true
  entry.handle.dispose = () => { if (first) { first = false; return Promise.reject(new Error('INJECTED_CLEANUP_FAILURE')) } return dispose() }
  await assert.rejects(f.service.close({ owner }), /INJECTED_CLEANUP_FAILURE/)
  assert.equal(entry.closing, true)
  assert.throws(() => f.service.heartbeat({ owner, sessionId: opened.sessionId }), /has ended/)
  await f.service.expire()
  assert.equal(f.service.entries.size, 0)
  assert.equal(f.ctx.agents.get(opened.sessionId), undefined)
})
