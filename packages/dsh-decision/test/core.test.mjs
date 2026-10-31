import test from 'node:test'
import assert from 'node:assert/strict'
import { decisionBody, requestDecision, resolveDecisionConfig, validateDecisionResult } from '../lib/core.js'

const rawConfig = { enabled: true, baseURL: 'https://decision.example.org/v1', model: 'fixture-model' }
const config = resolveDecisionConfig(rawConfig)
export const args = { state: { text: '校园卡丢失' }, questions: {
  route: { type: 'choice', instructions: 'Which service?', criteria: { card: '校园卡', network: '网络' } },
  claim: { type: 'noul', instructions: '网络是否故障？' },
  relevance: { type: 'score', instructions: '相关程度', criteria: ['无关', '部分相关', '高度相关'] },
} }
export const response = { model: 'synthetic-d3', answers: {
  route: { type: 'choice', choice: 'card', confidence: 0.8, probabilities: { card: 0.8, network: 0.2 } },
  claim: { type: 'noul', noul: 0, confidence: 1, probabilities: { yes: 0, no: 1 } },
  relevance: { type: 'score', score: 1.75, legend: { 0: '无关', 1: '部分相关', 2: '高度相关' } },
}, gateway: { requested_model: 'fixture-model', confidence_semantics: 'maximum_class_probability' } }

test('text and structured state preserve probabilities and fractional scores', () => {
  for (const state of ['材料', '', { text: '材料' }, [1, 2]]) {
    assert.deepEqual(JSON.parse(decisionBody({ ...args, state }, config)), { model: 'fixture-model', ...args, state })
  }
  assert.equal(validateDecisionResult(response, args.questions, config.model), response)
  const zero = structuredClone(response); zero.answers.relevance.score = 0
  assert.equal(validateDecisionResult(zero, args.questions, config.model).answers.relevance.score, 0)
})

test('configuration only permits fixed HTTPS or loopback, and explicit personal-key mode', () => {
  for (const baseURL of ['http://example.org/v1', 'https://user:pass@example.org/v1', 'https://example.org/v1?key=x', 'file:///tmp/a', 'https://example.org/v1#token']) assert.throws(() => resolveDecisionConfig({ ...rawConfig, baseURL }))
  assert.equal(resolveDecisionConfig({ ...rawConfig, baseURL: 'http://127.0.0.1:1234/v1/' }).baseURL, 'http://127.0.0.1:1234/v1')
  assert.equal(resolveDecisionConfig({ ...rawConfig, authMode: 'api-key' }).oidcProfileId, '')
  assert.throws(() => resolveDecisionConfig({ ...rawConfig, requestTimeoutMs: 0 }))
})

test('unsupported StartLux fields, malformed criteria and oversized input fail before fetch', async () => {
  const bad = [
    { ...args, model: 'other' }, { ...args, instructions: 'ignored upstream' }, { ...args, think_mode: 'always' },
    { ...args, state: null }, { ...args, state: false }, { ...args, state: NaN }, { ...args, state: 'a'.repeat(256 * 1024 + 1) },
    { ...args, questions: {} }, { ...args, questions: Array(2).fill({}) },
    { ...args, questions: { a: { type: 'bool', instructions: 'True?' } } },
    { ...args, questions: { a: { type: 'choice', instructions: 'Route?', criteria: {} } } },
    { ...args, questions: { a: { type: 'score', instructions: 'Score?', criteria: ['one'] } } },
    { ...args, questions: { a: { ...args.questions.route, allow_none: true } } },
    { ...args, questions: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [i, args.questions.claim])) },
  ]
  for (const value of bad) await assert.rejects(requestDecision({ config, args: value, fetchImpl: () => assert.fail('no network for malformed input') }))
})

test('inline images only, with bounded payload', () => {
  assert.equal(JSON.parse(decisionBody({ ...args, images: ['data:image/png;base64,aGVsbG8='] }, { ...config, imageInput: 'data-uri' })).images.length, 1)
  assert.throws(() => decisionBody({ ...args, images: ['data:image/png;base64,YQ=='] }, config), /not enabled/)
  for (const images of [['https://example.org/pic.png'], ['C:/secret.png'], ['data:text/html;base64,YQ=='], Array(9).fill('data:image/png;base64,YQ==')]) assert.throws(() => decisionBody({ ...args, images }, { ...config, imageInput: 'data-uri' }))
})

test('structured criteria, omitted instructions, abstention and service-specific limits are supported', () => {
  const value = { state: ['one', 'two'], questions: {
    choice: { type: 'choice', criteria: { a: null, b: { means: ['alternative'] } } },
    claim: { type: 'noul', criteria: { true: { description: 'positive' }, false: null } },
    score: { type: 'score', instructions: { rubric: 'given' }, criteria: [null, { level: 'high' }] },
  } }
  assert.deepEqual(JSON.parse(decisionBody(value, config)), { model: config.model, ...value })
  const absent = structuredClone(response); absent.answers.route.choice = null
  assert.equal(validateDecisionResult(absent, args.questions, config.model).answers.route.choice, null)
  const many = { ...args, questions: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [i, args.questions.claim])) }
  assert.throws(() => decisionBody(many, config), /question IDs/)
  assert.doesNotThrow(() => decisionBody(many, { ...config, maxQuestions: 64 }))
  assert.throws(() => decisionBody({ ...args, questions: { a: { type: 'noul', criteria: { yes: 'yes' } } } }, config), /true and false/)
})

test('fixed endpoint, redirect rejection and no POST retries for all expected failures', async () => {
  for (const status of [400, 401, 403, 422, 429, 502, 504]) {
    let calls = 0
    await assert.rejects(requestDecision({ config, args, fetchImpl: async (url, init) => {
      calls++; assert.equal(url, 'https://decision.example.org/v1/systemone')
      assert.equal(init.redirect, 'error'); assert.equal(init.method, 'POST')
      assert.equal(new Headers(init.headers).has('authorization'), false)
      return Response.json({ token: 'DO_NOT_ECHO', data: args }, { status })
    } }), error => error.message.includes(`HTTP ${status}`) && !error.message.includes('DO_NOT_ECHO'))
    assert.equal(calls, 1)
  }
})

test('success preserves probabilities, score, and actual response metadata', async () => {
  const value = await requestDecision({ config, args, fetchImpl: async () => Response.json(response) })
  assert.deepEqual(value, response)
})

test('invalid JSON, missing questions, false booleans and mismatched model are rejected', async () => {
  for (const modify of [
    value => { delete value.answers.claim }, value => { value.answers.claim.noul = false },
    value => { value.answers.route.choice = 'not-a-label' }, value => { value.answers.relevance.score = 10 },
    value => { value.answers.route.confidence = 1.1 }, value => { value.gateway.requested_model = 'other' },
  ]) { const value = structuredClone(response); modify(value); assert.throws(() => validateDecisionResult(value, args.questions, config.model)) }
  await assert.rejects(requestDecision({ config, args, fetchImpl: async () => new Response('<html>error</html>') }), /invalid JSON/)
})

test('streamed response is bounded even without content-length; aborted call sends nothing', async () => {
  await assert.rejects(requestDecision({ config, args, fetchImpl: async () => new Response('x'.repeat(512 * 1024 + 1)) }), /size limit/)
  await assert.rejects(requestDecision({ config, args, fetchImpl: () => assert.fail('aborted'), signal: AbortSignal.abort() }))
})
