import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire, registerHooks } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { installConcurrency } from '../../../dsh-plugins/request-concurrency/lib/index.js'

const runtime = process.env.EDUWORK_SIDE_CHAT_RUNTIME
const options = { skip: !runtime, timeout: 20_000 }
const runtimeRequire = runtime ? createRequire(join(runtime, 'package.json')) : undefined
const sourceRoot = new URL('../src/', import.meta.url).href
// Test the working-tree service while sharing the real Runtime's dependency
// identities. Never substitute the side-chat package installed in that cache.
const runtimeHooks = runtimeRequire && registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(sourceRoot) && specifier.startsWith('@deepseek-ai/')) {
      return nextResolve(pathToFileURL(runtimeRequire.resolve(specifier)).href, context)
    }
    return nextResolve(specifier, context)
  },
})
after(() => runtimeHooks?.deregister())

async function fixture() {
  const load = name => import(pathToFileURL(runtimeRequire.resolve(name)).href)
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
  const { SideChatService } = await import('../src/service.js')
  const service = new SideChatService(ctx)
  return {
    ctx, service, source, sourceHandle, selected, createUserMessage, createMessage, LlmAdapter,
    assemble: agent => ctx.systemPrompt.assemble(assembleContextFor(agent)),
    close: async () => { await service.dispose(); await ctx.fiber.dispose() },
  }
}

test('real Runtime creates a seeded side chat with inherited history and seedLength', options, async t => {
  const f = await fixture(); t.after(f.close)
  const owner = 'a'.repeat(32)
  const opened = await f.service.open({ owner, sourceSessionId: f.source.id, atSeq: f.selected.seq })
  assert.ok(opened.seedLength > 0, 'seedLength must be reported')
  const side = f.ctx.agents.get(opened.sessionId)
  assert.equal(side.session.header.parentSession, f.source.id)
  const events = side.session.snapshotEvents()
  assert.ok(events.length >= opened.seedLength, 'seeded session contains inherited events')
  const serialized = JSON.stringify(events)
  assert.ok(serialized.includes('SOURCE_REFERENCE'))
  assert.equal(serialized.includes('SOURCE_FUTURE'), false, 'events after the boundary must not appear')
  const prompt = await f.assemble(side)
  assert.ok(prompt.contexts.some(context => context.text.includes('Only new requests')))
  await f.service.close({ owner, sessionId: opened.sessionId })
  assert.equal(f.ctx.agents.get(opened.sessionId), undefined)
  assert.equal(f.ctx.sessions.get(opened.sessionId), undefined)
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

test('real AgentLoop sends source history and new side question to a scripted adapter', options, async t => {
  const f = await fixture(); t.after(f.close)
  const requests = []
  class Adapter extends f.LlmAdapter {
    resolveModel(provider, model) { return Promise.resolve({ provider, id: model, name: model }) }
    async *stream(request) { requests.push(request); yield* responseChunks('SCRIPTED_SIDE_REPLY') }
  }
  f.ctx.llm.registerAdapter(['side-fixture'], new Adapter())
  const opened = await f.service.open({ owner: 'e'.repeat(32), sourceSessionId: f.source.id, atSeq: f.selected.seq })
  const side = f.ctx.agents.get(opened.sessionId)
  assert.equal(requests.length, 0, 'opening must not replay the selected request')
  await f.sourceHandle.dispose()
  f.ctx.sessionQuery.observeSession = () => { throw new Error('Source must never be reread by an open side chat') }
  side.followup(f.createUserMessage({ content: [{ type: 'text', text: 'CURRENT_SIDE_QUESTION' }], source: { kind: 'user' } }))
  await side.whenIdle()
  assert.equal(requests.length, 1)
  const serialized = JSON.stringify(requests[0].messages)
  assert.ok(serialized.includes('SOURCE_REFERENCE'))
  assert.ok(serialized.includes('CURRENT_SIDE_QUESTION'))
  assert.ok(!serialized.includes('SOURCE_FUTURE'))
  assert.ok(JSON.stringify(side.session.snapshotEvents()).includes('SCRIPTED_SIDE_REPLY'))
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
})

test('real Runtime retains inactive side chats until explicit close, regardless of elapsed time', options, async t => {
  const f = await fixture(); t.after(f.close)
  const owner = 'b'.repeat(32)
  const opened = await f.service.open({ owner, sourceSessionId: f.source.id, atSeq: f.selected.seq })
  assert.deepEqual(await f.service.open({ owner, sourceSessionId: f.source.id, atSeq: f.selected.seq }), opened)
  await assert.rejects(f.service.open({ owner, sourceSessionId: f.source.id, atSeq: 3 }), /Close the existing/)
  const agent = f.ctx.agents.get(opened.sessionId)
  const events = agent.session.snapshotEvents()
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  t.mock.timers.tick(7 * 24 * 60 * 60 * 1000)
  await f.service.retryCleanup()
  assert.equal(f.ctx.agents.get(opened.sessionId), agent)
  assert.deepEqual(agent.session.snapshotEvents(), events)
  assert.deepEqual(f.service.heartbeat({ owner, sessionId: opened.sessionId }), opened)
  assert.equal(f.service.entries.get(owner).closing, false)
  assert.notEqual(f.ctx.agents.get(f.source.id), undefined)
  await f.service.close({ owner, sessionId: opened.sessionId })
  assert.equal(f.ctx.agents.get(opened.sessionId), undefined)
  assert.throws(() => f.service.heartbeat({ owner, sessionId: opened.sessionId }), /has ended/)
})

test('an unfinished source turn provides a frozen user-message boundary', options, async t => {
  const f = await fixture(); t.after(f.close)
  let sideRequest
  class Adapter extends f.LlmAdapter {
    resolveModel(provider, model) { return Promise.resolve({ provider, id: model, name: model }) }
    async *stream(request) {
      sideRequest = request
      yield* responseChunks('LIVE_SIDE_ANSWER')
    }
  }
  f.ctx.llm.registerAdapter(['side-fixture'], new Adapter())
  f.source.append('turn/start', { turn: 3 })
  const boundary = f.source.append('user/message', f.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'LIVE_SOURCE_REQUEST' }] }), { surfaceOp: 'append' })
  const owner = 'j'.repeat(32)
  const opened = await f.service.open({ owner, sourceSessionId: f.source.id, atSeq: boundary.seq })
  const side = f.ctx.agents.get(opened.sessionId)
  f.source.append('assistant/message', f.createMessage({ role: 'assistant', content: [{ type: 'text', text: 'SOURCE_FINISHED_LATER' }] }), { surfaceOp: 'append' })
  f.source.append('turn/end', { turn: 3, reason: { kind: 'completed' } })
  side.followup(f.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'LIVE_SIDE_QUESTION about selected LIVE_PARTIAL' }] }))
  await side.whenIdle()
  assert.ok(JSON.stringify(side.session.snapshotEvents()).includes('LIVE_SIDE_ANSWER'))
  assert.ok(JSON.stringify(sideRequest.messages).includes('LIVE_SOURCE_REQUEST'))
  assert.equal(JSON.stringify(sideRequest.messages).includes('SOURCE_FINISHED_LATER'), false)
  await f.service.close({ owner })
  assert.ok(JSON.stringify(f.source.snapshotEvents()).includes('SOURCE_FINISHED_LATER'))
})

test('side chats share the Host model queue and a cancelled waiter never calls the model', options, async t => {
  const f = await fixture()
  let releaseRoot, rootEntered, sawA, sawB, active = 0, peak = 0
  const rootStarted = new Promise(resolve => { rootEntered = resolve })
  const rootGate = new Promise(resolve => { releaseRoot = resolve })
  const queuedA = new Promise(resolve => { sawA = resolve })
  const queuedB = new Promise(resolve => { sawB = resolve })
  t.after(async () => { releaseRoot(); await f.close() })
  installConcurrency(f.ctx, 1)
  f.ctx.on('llm/stream', async function*(request, next) {
    const body = JSON.stringify(request.messages)
    if (body.includes('QUEUED_SIDE_A')) sawA()
    if (body.includes('QUEUED_SIDE_B')) sawB()
    yield* next()
  }, true)
  const entered = []
  class Adapter extends f.LlmAdapter {
    resolveModel(provider, model) { return Promise.resolve({ provider, id: model, name: model }) }
    async *stream(request) {
      const kind = request.testID === 'root' ? 'root' : JSON.stringify(request.messages).includes('QUEUED_SIDE_B') ? 'b' : 'a'
      entered.push(kind); active++; peak = Math.max(peak, active)
      try {
        if (kind === 'root') { rootEntered(); await rootGate }
        yield* responseChunks('QUEUE_REPLY')
      } finally { active-- }
    }
  }
  f.ctx.llm.registerAdapter(['side-fixture'], new Adapter())
  const root = (async () => {
    for await (const chunk of f.ctx.llm.stream({ provider: 'side-fixture', model: 'fixture', messages: [], sessionId: f.source.id, testID: 'root' })) { /* consume */ }
  })()
  await rootStarted
  const a = await f.service.open({ owner: 'q'.repeat(32), sourceSessionId: f.source.id, atSeq: f.selected.seq })
  const b = await f.service.open({ owner: 'r'.repeat(32), sourceSessionId: f.source.id, atSeq: f.selected.seq })
  const aAgent = f.ctx.agents.get(a.sessionId)
  aAgent.followup(f.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'QUEUED_SIDE_A' }] }))
  await queuedA
  f.ctx.agents.get(b.sessionId).followup(f.createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'QUEUED_SIDE_B' }] }))
  await queuedB
  assert.deepEqual(entered, ['root'], 'side requests must wait while the root occupies the only model slot')
  await f.service.close({ owner: 'r'.repeat(32), sessionId: b.sessionId })
  releaseRoot()
  await Promise.all([root, aAgent.whenIdle()])
  assert.deepEqual(entered, ['root', 'a'])
  assert.equal(peak, 1)
  assert.ok(JSON.stringify(aAgent.session.snapshotEvents()).includes('QUEUE_REPLY'))
})

test('the Host can retain more than eight independently owned side chats', options, async t => {
  const f = await fixture(); t.after(f.close)
  const opened = await Promise.all(Array.from({ length: 10 }, (_, index) => f.service.open({
    owner: String(index).padStart(32, 'k'), sourceSessionId: f.source.id, atSeq: f.selected.seq,
  })))
  assert.equal(new Set(opened.map(chat => chat.sessionId)).size, 10)
  await f.service.close({ owner: String(0).padStart(32, 'k'), sessionId: opened[0].sessionId })
  for (const chat of opened.slice(1)) assert.ok(f.ctx.agents.get(chat.sessionId))
  assert.equal(f.service.entries.size, 9)
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
  await f.service.retryCleanup()
  assert.equal(f.service.entries.size, 0)
  assert.equal(f.ctx.agents.get(opened.sessionId), undefined)
})
