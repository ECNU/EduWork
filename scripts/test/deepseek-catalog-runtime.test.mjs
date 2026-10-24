import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'

const runtime = process.env.EDUWORK_TEST_RUNTIME
test('published API-key provider discovers official models while preserving custom endpoints, catalogs and keyless startup', { skip: !runtime }, async t => {
  const require = createRequire(join(runtime, 'package.json'))
  const load = name => import(pathToFileURL(require.resolve(name)).href)
  const { Context } = await load('@deepseek-ai/cordis')
  const { default: LlmRuntime } = await load('@deepseek-ai/dsh-llm')
  const ApiKey = await load('@deepseek-ai/dsh-llm-deepseek-api-key')
  const previousKey = process.env.DEEPSEEK_API_KEY, previousFetch = globalThis.fetch
  const requests = [], contexts = []
  t.after(async () => {
    for (const ctx of contexts) await ctx.fiber.dispose()
    globalThis.fetch = previousFetch
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = previousKey
  })
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)
    assert.equal(request.url, 'https://api.deepseek.com/models', 'No inference or unrelated network request is allowed')
    assert.equal(request.headers.get('x-api-key'), 'synthetic-catalog-key')
    requests.push(request.url)
    return new Response(JSON.stringify({ object: 'list', data: [{ id: 'synthetic-listed', name: 'Synthetic model',
      context_window: 1_048_576, input_modalities: ['text'], output_modalities: ['text'],
      api_capabilities: { anthropic_messages: {} }, client_requirements: { 'deepseek-harness': { min_version: '0.0.1' } } }] }), { headers: { 'content-type': 'application/json' } })
  }
  async function list(config, key = 'synthetic-catalog-key') {
    process.env.DEEPSEEK_API_KEY = key
    const ctx = new Context(); contexts.push(ctx)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(ApiKey, config)
    return (await ctx.llm.listModels('deepseek-official')).map(model => model.id)
  }
  assert.deepEqual(await list({}), ['synthetic-listed'])
  assert.equal(requests.length, 1)
  assert.deepEqual(await list({ models: [{ id: 'institution-custom', name: 'Custom' }] }), ['institution-custom'])
  assert.deepEqual(await list({ baseURL: 'https://institution.example.invalid/anthropic' }), ['deepseek-flash', 'deepseek-v4-pro'])
  assert.deepEqual(await list({}, ''), [])
  assert.equal(requests.length, 1, 'Custom or unconfigured routes must not query the official catalog')
})
