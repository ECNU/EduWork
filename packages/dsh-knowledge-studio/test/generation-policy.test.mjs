import assert from 'node:assert/strict'
import test from 'node:test'
import { generateText } from '../lib/generation.js'

function context({ config, info = { defaultMaxTokens: 65536 }, stream } = {}) {
  const requests = []
  return { requests, agentDefaultModel: { currentSelection: () => ({ provider: 'fixture', model: 'model' }) }, agents: { get: () => ({ session: { requestHeader: () => ({ config }) } }) }, llm: {
    resolveModelInfo: async () => info,
    stream: async function* (request) {
      requests.push(request)
      if (stream) yield* stream(request)
      else { yield { type: 'text-delta', index: 0, text: '完整内容' }; yield { type: 'finish', reason: { kind: 'stop' } } }
    },
  } }
}

test('Studio defers output budget to exact-route defaults instead of capping at 12000', async () => {
  for (const maximum of [32768, 65536, 131072, 393216]) {
    const ctx = context({ info: { defaultMaxTokens: maximum, context: { contextWindow: 1048576 } } })
    const result = await generateText(ctx, { prompt: '生成报告', sessionId: 'fixture' })
    assert.equal(Object.hasOwn(ctx.requests[0], 'maxTokens'), false)
    assert.equal(result.generation.maxTokens, maximum)
    assert.equal(result.generation.budgetSource, 'model-default')
  }
})

test('conversation effort and explicit cap survive, while unsupported historical efforts do not', async () => {
  const config = { provider: 'fixture', model: 'model', reasoningEffort: 'max', maxTokens: 48000 }
  const ctx = context({ config, info: { defaultMaxTokens: 65536, reasoning: { efforts: [{ id: 'low' }, { id: 'high' }, { id: 'max' }], defaultEffort: 'high' } } })
  await generateText(ctx, { prompt: '报告', sessionId: 'fixture', boundedReasoning: true })
  assert.equal(ctx.requests[0].reasoningEffort, 'max')
  assert.equal(ctx.requests[0].maxTokens, 48000)
  const plus = context({ config: { provider: 'fixture', model: 'model', reasoningEffort: 'xhigh' } })
  await generateText(plus, { prompt: '报告', sessionId: 'fixture' })
  assert.equal(Object.hasOwn(plus.requests[0], 'reasoningEffort'), false)
  const unknown = context({ info: {} })
  await generateText(unknown, { prompt: '报告' })
  assert.equal(Object.hasOwn(unknown.requests[0], 'maxTokens'), false)
})

test('truncation exposes recoverable visible text and budget, excluding reasoning blocks', async () => {
  const ctx = context({ stream: async function* () {
    yield { type: 'reasoning-delta', index: 0, text: 'private reasoning' }
    yield { type: 'text-delta', index: 1, text: '{"title":"未完成报告"' }
    yield { type: 'finish', reason: { kind: 'max-tokens' } }
  } })
  await assert.rejects(generateText(ctx, { prompt: '报告' }), error => {
    assert.equal(error.code, 'STUDIO_OUTPUT_LIMIT')
    assert.equal(error.partialText, '{"title":"未完成报告"')
    assert.equal(error.generation.maxTokens, 65536)
    assert.doesNotMatch(error.message, /缩小资料/)
    return true
  })
})

test('active streaming can exceed the idle interval and user cancellation still aborts', async () => {
  const ctx = context({ stream: async function* () {
    for (let i = 0; i < 6; i++) { await new Promise(resolve => setTimeout(resolve, 60)); yield { type: 'text-delta', index: 0, text: '段落' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } })
  assert.equal((await generateText(ctx, { prompt: '报告', idleTimeoutMs: 250 })).text, '段落'.repeat(6))
  const controller = new AbortController()
  controller.abort(new Error('用户取消'))
  await assert.rejects(generateText(ctx, { prompt: '报告', signal: controller.signal }), /用户取消/)
})

test('idle streams abort and an unterminated stream is never accepted as completed', async () => {
  const stalled = context({ stream: async function* ({ signal }) {
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  } })
  await assert.rejects(generateText(stalled, { prompt: '报告', idleTimeoutMs: 20 }), /长时间没有返回/)
  const partial = context({ stream: async function* () { yield { type: 'text-delta', index: 0, text: '不完整' } } })
  await assert.rejects(generateText(partial, { prompt: '报告' }), error => {
    assert.match(error.message, /没有返回完成标记/)
    assert.equal(error.partialText, '不完整')
    return true
  })
})

test('empty stop is distinct from a consumed output limit and diagnostics never persist reasoning text', async () => {
  for (const reasoning of [false, true]) {
    const usage = { inputTokens: 25, outputTokens: reasoning ? 50 : 0 }
    const ctx = context({ info: { defaultMaxTokens: 393216 }, stream: async function* () {
      if (reasoning) yield { type: 'reasoning-delta', index: 0, text: 'PRIVATE_REASONS_NEVER_PERSIST' }
      yield { type: 'usage', usage }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } })
    await assert.rejects(generateText(ctx, { prompt: '生成' }), error => {
      assert.equal(error.code, 'STUDIO_EMPTY_OUTPUT'); assert.equal(error.generation.finishKind, 'stop')
      assert.equal(error.generation.hasReasoning, reasoning); assert.equal(error.generation.maxTokens, 393216)
      assert.deepEqual(error.generation.usage, usage)
      assert.doesNotMatch(error.message, /393216|maxTokens|达到.*上限/)
      assert.doesNotMatch(JSON.stringify(error), /PRIVATE_REASONS_NEVER_PERSIST/)
      return true
    })
  }
})
