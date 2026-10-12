import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { createRequire, registerHooks } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { providerSettings, searchWithAvailableProvider } from '../lib/search-policy.js'

const runtime = process.env.EDUWORK_TEST_RUNTIME
test('pinned DSH volatile settings, live updates and official HTTP search work together', { skip: !runtime }, async t => {
  const require = createRequire(join(runtime, 'package.json'))
  const load = name => import(pathToFileURL(require.resolve(name)).href)
  const { Context } = await load('@deepseek-ai/cordis')
  const { Config } = await load('@deepseek-ai/dsh-web-search-deepseek')
  const { WebRuntime } = await load('@deepseek-ai/dsh-web')
  const hook = registerHooks({ resolve(name, context, next) {
    return name.startsWith('@deepseek-ai/') || name === 'playwright-core'
      ? next(name, { ...context, parentURL: pathToFileURL(join(runtime, 'package.json')).href })
      : next(name, context)
  } })
  let auto
  try { auto = await import('../lib/search-auto.js') }
  finally { hook.deregister() }

  const received = []
  let status = 200
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    received.push({ url: request.url, headers: request.headers, body: JSON.parse(Buffer.concat(chunks)) })
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(status === 200 ? { content: [{ type: 'web_search_tool_result', content: [
      { type: 'web_search_result', title: 'Fixture result', url: 'https://example.org/result' },
    ] }] } : { error: { message: 'fixture rate limit' } }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const ctx = new Context()
  const fibers = [], cleanups = []
  t.after(async () => {
    for (const dispose of cleanups.reverse()) await dispose()
    for (const fiber of fibers.reverse()) await fiber.dispose()
  })
  fibers.push(await ctx.plugin(WebRuntime, { searchProvider: 'eduwork-search' }))
  const initial = {
    apiKey: 'literal-fixture-key', baseURL: `http://127.0.0.1:${server.address().port}/first`,
    model: 'fixture-first', apiVersion: '2023-06-01', maxTokens: 100, maxUses: 2,
  }
  const fiber = await ctx.plugin({ name: 'search-config-fixture', Config, apply() {} }, initial)
  fibers.push(fiber)
  const row = { options: { id: 'web-search-deepseek', config: { apiKey: 'stale-key' } }, fiber }
  let rows = [row]
  const editor = { entries: () => rows }
  const credentialRefs = []
  let updateDuringCredential
  auto.apply({
    web: ctx.web, effect: factory => { const dispose = factory(); cleanups.push(dispose); return dispose },
    get(name) {
      if (name === 'configEditor') return editor
      if (name === 'credentials') return { resolve: async ref => {
        credentialRefs.push(ref)
        await updateDuringCredential?.()
        return { value: 'resolved-fixture-key' }
      } }
    },
  })
  assert.equal(typeof fiber.config.apiKey.get, 'function', 'use the real upstream volatile schema')
  const snapshot = providerSettings(editor, 'web-search-deepseek')
  assert.deepEqual(snapshot, { ...initial, apiKeyEnv: 'DEEPSEEK_API_KEY' })
  const first = await ctx.web.search({ query: 'fixture query' })
  assert.equal(first.sources[0].url, 'https://example.org/result')
  assert.equal(received[0].url, '/first/messages')
  assert.equal(received[0].headers['x-api-key'], initial.apiKey)
  assert.equal(received[0].body.model, initial.model)
  assert.equal(received[0].body.max_tokens, 100)
  assert.equal(received[0].body.tools[0].max_uses, 2)
  assert.deepEqual(credentialRefs, [])

  const changed = { ...initial, apiKey: undefined, apiKeyEnv: 'FIXTURE_SEARCH_KEY', model: 'fixture-second', maxTokens: 200, maxUses: 3 }
  fiber.update(changed)
  await fiber.await()
  updateDuringCredential = async () => {
    fiber.update({ ...changed, model: 'fixture-next-request' })
    await fiber.await()
  }
  await ctx.web.search({ query: 'updated fixture' })
  assert.equal(received[1].headers['x-api-key'], 'resolved-fixture-key')
  assert.equal(received[1].body.model, 'fixture-second', 'credential resolution cannot change an in-flight snapshot')
  assert.equal(received[1].body.max_tokens, 200)
  assert.equal(received[1].body.tools[0].max_uses, 3)
  assert.deepEqual(credentialRefs, ['FIXTURE_SEARCH_KEY'])
  assert.equal(snapshot.model, 'fixture-first', 'earlier snapshots stay detached')
  updateDuringCredential = undefined
  await ctx.web.search({ query: 'next fixture' })
  assert.equal(received[2].body.model, 'fixture-next-request')
  status = 429
  await assert.rejects(ctx.web.search({ query: 'rate limited fixture' }), /429/)
  assert.equal(received.length, 4, 'do not retry a failed keyed request through the browser')

  // Even with an ambient key, removing or disabling the provider selects the browser.
  for (const inactive of [[], [{ options: row.options, fiber: { state: 3 } }]]) {
    rows = inactive
    assert.equal(await searchWithAvailableProvider({
      request: { query: 'fallback' }, settings: () => providerSettings(editor, 'web-search-deepseek'),
      resolveCredential: () => assert.fail('inactive provider must not resolve ambient credentials'),
      deepseek: () => assert.fail('inactive provider must not be dispatched'),
      browser: { search: async () => 'browser fixture' },
    }), 'browser fixture')
  }
})
