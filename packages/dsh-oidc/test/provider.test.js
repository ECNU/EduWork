import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { ENTERPRISE_DEFAULT_RETRY_POLICY, resolveEnterpriseProfiles } from '../src/host/provider/core.js'
import { assertServiceableEnterpriseProviders, profilesFrom, resolveEnterpriseImageAccess } from '../src/host/provider/index.js'
import { TransformingEnterpriseAdapter, canonicalReasoningReplay } from '../src/host/provider/transform-adapter.js'

test('provider route uses bounded defaults and classic OpenAI-compatible roles', () => {
  const [profile] = resolveEnterpriseProfiles({ providers: { campus: {
    displayName: 'Campus AI', apiKeyEnv: 'CAMPUS_API_KEY', baseURL: 'https://ai.example.edu/v1',
    models: [{ id: 'campus-max', input: ['text'] }],
  } } })
  assert.equal(profile.models[0].compat.supportsDeveloperRole, false)
  assert.equal(profile.models[0].compat.thinkingFormat, 'deepseek')
  assert.deepEqual(ENTERPRISE_DEFAULT_RETRY_POLICY, { mode: 'normal', maxRetries: 2 })
})

test('provider compiles exact per-model reasoning capabilities and conservative defaults', () => {
  const config = reasoningConfig('https://ai.example.edu/v1')
  const [route] = resolveEnterpriseProfiles(config)
  const max = route.models.find(model => model.id === 'reasoner-a')
  const plus = route.models.find(model => model.id === 'reasoner-b')

  assert.deepEqual(max.thinkingLevelMap, {
    off: null, minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: 'max',
  })
  assert.deepEqual(plus.thinkingLevelMap, {
    off: null, minimal: null, low: 'low', medium: 'medium', high: null, xhigh: 'xhigh', max: null,
  })
  assert.deepEqual(route.modelPolicies.get('reasoner-a'), {
    reasoning: true, supportsReasoningEffort: true,
    reasoningEfforts: ['low', 'high', 'max'], defaultReasoningEffort: 'high', requiresReasoningContent: true,
  })
  assert.deepEqual(route.modelPolicies.get('reasoner-b'), {
    reasoning: true, supportsReasoningEffort: true,
    reasoningEfforts: ['low', 'medium', 'xhigh'], defaultReasoningEffort: 'medium', requiresReasoningContent: true,
  })
  assert.equal(Object.hasOwn(max.thinkingLevelMap, 'off'), true)
  assert.equal(max.thinkingLevelMap.off, null)
})

test('historical provider reasoning falls back to the nearest valid model effort, preferring lower ties', () => {
  const base = reasoningConfig('https://ai.example.edu/v1')
  delete base.providers.gateway.models[1].defaultReasoningEffort
  assert.equal(resolveEnterpriseProfiles(base)[0].modelPolicies.get('reasoner-b').defaultReasoningEffort, 'xhigh')
  base.providers.gateway.reasoning = 'high'
  assert.equal(resolveEnterpriseProfiles(base)[0].modelPolicies.get('reasoner-b').defaultReasoningEffort, 'medium')
  base.providers.gateway.models[1].defaultReasoningEffort = 'max'
  assert.throws(() => resolveEnterpriseProfiles(base), /must be one of the model's declared reasoningEfforts/)
})

test('settings validation rejects schema-shaped provider values that cannot be served', () => {
  assert.throws(() => assertServiceableEnterpriseProviders({ providers: { campus: {
    apiKeyEnv: 'CAMPUS_API_KEY', models: [{ id: 'campus-max' }],
  } } }), /baseURL must be a non-empty string/)
  assert.throws(() => assertServiceableEnterpriseProviders({ providers: { campus: {
    apiKeyEnv: 'CAMPUS_API_KEY', baseURL: 'https://ai.example.edu/v1', models: [],
  } } }), /models must not be empty/)
})

test('provider routes use the same explicit HTTP boolean', () => {
  const [loopback] = resolveEnterpriseProfiles({ providers: { campus: {
    displayName: 'Campus AI', apiKeyEnv: 'CAMPUS_API_KEY', baseURL: 'http://127.0.0.1:3100/v1', allowInsecureDevelopment: true,
    models: [{ id: 'campus-max', input: ['text'] }],
  } } })
  assert.equal(loopback.baseURL, 'http://127.0.0.1:3100/v1')

  assert.throws(() => resolveEnterpriseProfiles({ providers: { campus: {
    displayName: 'Campus AI', apiKeyEnv: 'CAMPUS_API_KEY', baseURL: 'http://192.0.2.10/v1',
    models: [{ id: 'campus-max', input: ['text'] }],
  } } }), /explicitly allowed development HTTP/)

  const [profile] = resolveEnterpriseProfiles({ providers: { campus: {
    displayName: 'Campus AI', apiKeyEnv: 'CAMPUS_API_KEY', baseURL: 'http://192.0.2.10/v1',
    allowInsecureDevelopment: true, insecureDevelopmentOrigin: 'http://192.0.2.10',
    models: [{ id: 'campus-max', input: ['text'] }],
  } } })
  assert.equal(profile.baseURL, 'http://192.0.2.10/v1')

  assert.doesNotThrow(() => resolveEnterpriseProfiles({ providers: { campus: {
    displayName: 'Campus AI', apiKeyEnv: 'CAMPUS_API_KEY', baseURL: 'http://192.0.2.11/v1',
    allowInsecureDevelopment: true, insecureDevelopmentOrigin: 'http://192.0.2.10',
    models: [{ id: 'campus-max', input: ['text'] }],
  } } }))
})

test('image attachment access uses the reviewed filesystem execution-world mapping', () => {
  const ctx = { get: name => name === 'fs' ? { processPathFromHostPath: path => `/workspace/${path.split(/[\\/]/).at(-1)}` } : undefined }
  const attachments = { imageHostPath: ref => ref.attachmentId === 'image-1' ? 'C:\\host\\normalized.webp' : undefined }
  assert.deepEqual(resolveEnterpriseImageAccess(ctx, attachments, { attachmentId: 'image-1' }), { readonlyPath: '/workspace/normalized.webp' })
  assert.equal(resolveEnterpriseImageAccess(ctx, attachments, { attachmentId: 'missing' }), undefined)
})

function harness(policy) {
  const streamed = []
  const inner = {
    imageRequestPricing: (provider, model) => ({ provider, model, currency: 'USD' }),
    resolveModel: async (provider, model) => ({ provider, id: model, inputModalities: ['text', 'image'], reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' } }),
    stream: async function * (options) { streamed.push(options); yield { type: 'finish', reason: { kind: 'stop' } } },
    async prepareCall(provider, model) { return { model: await this.resolveModel(provider, model), stream: options => this.stream(options) } },
  }
  const transforms = { capabilities: (_provider, _model, modalities) => modalities, apply: async options => options }
  return { adapter: new TransformingEnterpriseAdapter(inner, transforms, policy), streamed }
}

function reasoningConfig(baseURL) {
  return { providers: { gateway: {
    displayName: 'Gateway', apiKeyEnv: 'GATEWAY_API_KEY', baseURL, allowInsecureDevelopment: true,
    reasoning: 'max',
    models: [
      { id: 'reasoner-a', reasoningEfforts: { low: 'low', high: 'high', max: 'max' }, defaultReasoningEffort: 'high' },
      { id: 'reasoner-b', reasoningEfforts: { low: 'low', medium: 'medium', xhigh: 'xhigh' }, defaultReasoningEffort: 'medium' },
    ],
  } } }
}

function memoryAuth() {
  const stored = new Map()
  return {
    credentials: {
      read: id => Promise.resolve(stored.get(id)), list: () => Promise.resolve([]),
      async modify(id, mutate) { const next = await mutate(stored.get(id)); if (next === undefined) stored.delete(id); else stored.set(id, next); return next },
      delete: id => { stored.delete(id); return Promise.resolve() },
    },
    authContext: { env: () => Promise.resolve(undefined), fileExists: () => Promise.resolve(false) },
  }
}

async function captureServer(t) {
  const requests = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk.toString('utf8') })
    request.on('end', () => {
      requests.push(JSON.parse(body))
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end('data: {"choices":[{"delta":{"role":"assistant","content":"ok"},"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\ndata: [DONE]\n\n')
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const address = server.address()
  return { requests, baseURL: `http://127.0.0.1:${address.port}/v1` }
}

function reasoningReplay(signature, api = 'openai-completions') {
  return { role:'assistant', content:[{type:'reasoning',text:'完整思考内容。'},{type:'text',text:'Next.'}],
    source:{kind:'model',provider:'gateway',model:'reasoner-a',replayState:{
      response:{kind:'pi-ai',version:2,api,provider:'gateway',model:'reasoner-a',stopReason:'stop'},
      blocks:[{type:'reasoning',thinkingSignature:signature},{type:'text'}],
    }} }
}
test('canonical reasoning replay preserves immutable history and scopes aliases to the selected dialect',()=>{
  for(const signature of ['reasoning','reasoning_text','reasoning_content']) {
    const request={provider:'gateway',model:'reasoner-a',messages:[reasoningReplay(signature)]}, before=JSON.stringify(request)
    const normalized=canonicalReasoningReplay(request,{requiresReasoningContent:true})
    assert.equal(JSON.stringify(request),before)
    assert.equal(normalized.messages[0].content,request.messages[0].content)
    assert.equal(normalized.messages[0].source.replayState.blocks[0].thinkingSignature,'reasoning_content')
    assert.equal(canonicalReasoningReplay(request,{requiresReasoningContent:false}),request)
  }
  for(const message of [reasoningReplay('[{"type":"reasoning.encrypted","data":"synthetic"}]'), reasoningReplay('reasoning','anthropic-messages')]) {
    const request={provider:'gateway',model:'reasoner-a',messages:[message]}
    assert.equal(canonicalReasoningReplay(request,{requiresReasoningContent:true}),request)
  }
  const foreign={provider:'other',model:'reasoner-a',messages:[reasoningReplay('reasoning')]}
  assert.equal(canonicalReasoningReplay(foreign,{requiresReasoningContent:true}),foreign)
})
test('real pi-ai HTTP replay sends one nonempty canonical field and preserves legacy messages',async t=>{
  const server=await captureServer(t), profiles=profilesFrom(reasoningConfig(server.baseURL))
  const base=new PiAiAdapter({profiles:()=>profiles,auth:memoryAuth(),resolveApiKey:async()=>'test-key'})
  const transforms={capabilities:(_p,_m,modalities)=>modalities,apply:async options=>options}
  const adapter=new TransformingEnterpriseAdapter(base,transforms,(provider,model)=>profiles.get(provider).modelPolicies.get(model))
  for(const signature of ['reasoning','reasoning_text','reasoning_content']) {
    const options={provider:'gateway',model:'reasoner-a',messages:[{role:'user',content:[{type:'text',text:'hello'}]},reasoningReplay(signature)]}
    const original=JSON.stringify(options)
    for await(const chunk of adapter.stream(options)) { assert.notEqual(chunk.reason?.kind,'error') }
    const sent=server.requests.at(-1).messages.find(message=>message.role==='assistant')
    assert.equal(sent.reasoning_content,'完整思考内容。')
    assert.equal(Object.hasOwn(sent,'reasoning'),false)
    assert.equal(Object.hasOwn(sent,'reasoning_text'),false)
    assert.equal(JSON.stringify(options),original)
  }
  // An unwrapped upstream call demonstrates the conflicting pair, without a real gateway.
  for await(const _ of base.stream({provider:'gateway',model:'reasoner-a',reasoningEffort:'high',messages:[reasoningReplay('reasoning')]})) {}
  assert.equal(server.requests.at(-1).messages[0].reasoning,'完整思考内容。')
  assert.equal(server.requests.at(-1).messages[0].reasoning_content,'')
})

test('real pi-ai dispatch preserves every declared effort wire and rejects invalid efforts before HTTP', async t => {
  const server = await captureServer(t)
  const profiles = profilesFrom(reasoningConfig(server.baseURL))
  const base = new PiAiAdapter({
    profiles: () => profiles, auth: memoryAuth(), resolveApiKey: () => Promise.resolve('test-key'),
  })
  const transforms = { capabilities: (_provider, _model, modalities) => modalities, apply: async options => options }
  const adapter = new TransformingEnterpriseAdapter(base, transforms, (provider, model) => profiles.get(provider).modelPolicies.get(model))

  const first = await adapter.prepareCall('gateway', 'reasoner-a')
  const second = await adapter.prepareCall('gateway', 'reasoner-b')
  assert.deepEqual(first.model.reasoning, {
    efforts: ['low', 'high', 'max'].map(id => ({ id, name: id[0].toUpperCase() + id.slice(1) })), defaultEffort: 'high',
  })
  assert.deepEqual(second.model.reasoning, {
    efforts: ['low', 'medium', 'xhigh'].map(id => ({ id, name: id[0].toUpperCase() + id.slice(1) })), defaultEffort: 'medium',
  })

  for (const [model, efforts] of [['reasoner-a', ['low', 'high', 'max']], ['reasoner-b', ['low', 'medium', 'xhigh']]]) {
    for (const reasoningEffort of efforts) {
      for await (const _chunk of adapter.stream({ provider: 'gateway', model, messages: [], reasoningEffort })) {}
    }
  }
  assert.deepEqual(server.requests.map(request => request.reasoning_effort), ['low', 'high', 'max', 'low', 'medium', 'xhigh'])

  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['gateway'], adapter)
  const hostPrepared = await ctx.llm.prepareCall({ provider: 'gateway', model: 'reasoner-b', reasoningEffort: 'xhigh' })
  assert.equal(hostPrepared.config.reasoningEffort, 'xhigh')
  await assert.rejects(
    ctx.llm.prepareCall({ provider: 'gateway', model: 'reasoner-b', reasoningEffort: 'max' }),
    error => error?.code === 'UNSUPPORTED_REASONING_EFFORT',
  )
  assert.equal(server.requests.length, 6)

  await assert.rejects(async () => {
    for await (const _chunk of adapter.stream({ provider: 'gateway', model: 'reasoner-b', messages: [], reasoningEffort: 'max' })) {}
  }, error => error?.code === 'UNSUPPORTED_REASONING_EFFORT')
  assert.equal(server.requests.length, 6)

  for await (const _chunk of second.stream({ provider: 'gateway', model: 'reasoner-b', messages: [] })) {}
  assert.equal(server.requests.at(-1).reasoning_effort, 'medium')
})

test('thinking-only models replace unsupported user effort with the configured internal thinking default', async () => {
  const { adapter, streamed } = harness(() => ({ supportsReasoningEffort: false, internalThinkingEffort: 'high' }))
  const resolved = await adapter.resolveModel('campus', 'vision')
  assert.equal(resolved.reasoning, undefined)
  for await (const _chunk of adapter.stream({ provider: 'campus', model: 'vision', messages: [], reasoningEffort: 'xhigh' })) {}
  assert.equal(streamed[0].reasoningEffort, 'high')
})

test('real pi-ai wire preserves thinking-only defaults and removes historical user efforts', async t => {
  const server = await captureServer(t)
  const config = { providers: { gateway: {
    displayName: 'Gateway', apiKeyEnv: 'GATEWAY_API_KEY', baseURL: server.baseURL, allowInsecureDevelopment: true,
    reasoning: 'high',
    models: [
      { id: 'thinking-only', compat: { supportsReasoningEffort: false } },
      { id: 'thinking-exact', reasoningEfforts: { low: 'low', medium: 'medium', xhigh: 'xhigh' }, compat: { supportsReasoningEffort: false } },
      { id: 'plain', reasoning: false },
    ],
  } } }
  const profiles = profilesFrom(config)
  const base = new PiAiAdapter({ profiles: () => profiles, auth: memoryAuth(), resolveApiKey: () => Promise.resolve('test-key') })
  const transforms = { capabilities: (_provider, _model, modalities) => modalities, apply: async options => options }
  const adapter = new TransformingEnterpriseAdapter(base, transforms, (provider, model) => profiles.get(provider).modelPolicies.get(model))

  for (const model of ['thinking-only', 'thinking-exact']) {
    const prepared = await adapter.prepareCall('gateway', model)
    assert.equal(prepared.model.reasoning, undefined, 'the UI must not offer reasoning effort choices')
    for (const reasoningEffort of [undefined, 'medium', 'xhigh', 'off']) {
      for (const stream of [options => adapter.stream(options), options => prepared.stream(options)]) {
        for await (const _chunk of stream({ provider: 'gateway', model, messages: [], reasoningEffort })) {}
        assert.deepEqual(server.requests.at(-1).thinking, { type: 'enabled' }, `${model}: historical ${String(reasoningEffort)}`)
        assert.equal(Object.hasOwn(server.requests.at(-1), 'reasoning_effort'), false)
      }
    }
  }

  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['gateway'], adapter)
  for await (const _chunk of ctx.llm.stream({ provider: 'gateway', model: 'thinking-only', messages: [] })) {}
  assert.deepEqual(server.requests.at(-1).thinking, { type: 'enabled' })
  assert.equal(Object.hasOwn(server.requests.at(-1), 'reasoning_effort'), false)

  for await (const _chunk of adapter.stream({ provider: 'gateway', model: 'plain', messages: [], reasoningEffort: 'xhigh' })) {}
  assert.equal(Object.hasOwn(server.requests.at(-1), 'thinking'), false, 'non-reasoning models retain the native PiAi wire contract')
  assert.equal(Object.hasOwn(server.requests.at(-1), 'reasoning_effort'), false)

  config.providers.gateway.reasoning = 'off'
  const offProfiles = profilesFrom(config)
  const offBase = new PiAiAdapter({ profiles: () => offProfiles, auth: memoryAuth(), resolveApiKey: () => Promise.resolve('test-key') })
  const offAdapter = new TransformingEnterpriseAdapter(offBase, transforms, (provider, model) => offProfiles.get(provider).modelPolicies.get(model))
  for await (const _chunk of offAdapter.stream({ provider: 'gateway', model: 'thinking-only', messages: [], reasoningEffort: 'xhigh' })) {}
  assert.deepEqual(server.requests.at(-1).thinking, { type: 'disabled' }, 'the configured off default remains authoritative')
  assert.equal(Object.hasOwn(server.requests.at(-1), 'reasoning_effort'), false)
  assert.equal(server.requests.length, 19)
})

test('image request pricing is delegated to the wrapped DSH adapter', () => {
  const { adapter } = harness(() => ({}))
  assert.deepEqual(adapter.imageRequestPricing('campus', 'vision'), { provider: 'campus', model: 'vision', currency: 'USD' })
})

test('non-reasoning models force the adapter internal off level', async () => {
  const { adapter, streamed } = harness(() => ({ reasoning: false, supportsReasoningEffort: false }))
  for await (const _chunk of adapter.stream({ provider: 'campus', model: 'plain', messages: [], reasoningEffort: 'high' })) {}
  assert.equal(streamed[0].reasoningEffort, 'off')
})
