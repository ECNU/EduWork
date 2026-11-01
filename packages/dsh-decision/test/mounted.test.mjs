import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { apply, Config } from '../lib/index.js'
import { resolveDecisionConfig } from '../lib/core.js'

const args = { state: 'Duplicate subscription charge', questions: { route: { type: 'choice', instructions: 'Route?', criteria: { billing: 'Billing', other: 'Other' } } } }
const response = { answers: { route: { type: 'choice', choice: 'billing', confidence: 0.9 } }, gateway: { requested_model: 'fixture-model' } }
const config = { enabled: true, baseURL: 'https://service.example.org/v1', model: 'fixture-model', authMode: 'oidc', oidcProfileId: 'organization' }
function mount(account, overrides = {}, rawConfig = config) {
  const tools = new Map(), skills = new Map(), events = new Map(), dispose = []
  const ctx = { tools: { register(tool) { tools.set(tool.name, tool) } }, skills: { register(skill) { skills.set(skill.name, skill) } },
    credentials: { resolve() { assert.fail('must not read keys in OIDC mode') } },
    get: name => name === 'oidcAccounts' ? account : undefined,
    on(name, callback) { events.set(name, callback) }, effect(callback) { dispose.push(callback()) }, ...overrides }
  apply(ctx, rawConfig)
  return { tools, skills, events, dispose, call: (args, exec) => tools.get('decision_evaluate').execute(args, exec) }
}

test('native schema, tool and packaged skill register together; optional OIDC is Host-only', async () => {
  let calls = 0
  const mounted = mount({
    async modelAuthorization(id, url) { assert.equal(id, 'organization'); assert.equal(url, config.baseURL); return true },
    async authorizedFetch(id, url, init, options) {
      calls++; assert.equal(id, 'organization'); assert.equal(url, config.baseURL + '/systemone'); assert.equal(options, undefined)
      assert.equal(new Headers(init.headers).has('authorization'), false)
      assert.equal(JSON.parse(init.body).model, 'fixture-model'); return Response.json(response)
    },
  })
  assert.equal(mounted.tools.size, 1); assert.equal(mounted.skills.size, 1)
  assert.ok(mounted.skills.get('decision').content.includes('decision_evaluate'))
  const tool = mounted.tools.get('decision_evaluate')
  assert.equal(tool.parameters.properties.questions.additionalProperties, true)
  assert.equal(tool.parameters.properties.images, undefined)
  await assert.rejects(mounted.call({ ...args, questions: [] }), /questions/)
  assert.deepEqual(JSON.parse((await mounted.call(args)).reportJSON), response)
  assert.equal(calls, 1)
})

test('no endpoint, model, network, skill or tool is selected by default', () => {
  const mounted = mount(undefined, {}, {})
  assert.equal(mounted.tools.size, 0); assert.equal(mounted.skills.size, 0)
  assert.deepEqual(resolveDecisionConfig(), { enabled: false })
  assert.throws(() => mount(undefined, {}, { enabled: true }), /baseURL/)
})

test('missing organization login does not fall back to a personal key', async () => {
  await assert.rejects(mount({ modelAuthorization: async () => false }).call(args), /登录/)
  await assert.rejects(mount(undefined).call(args), /登录/)
})

test('logout, account changes and disposal suppress pending results', async () => {
  for (const trigger of [m => m.events.get('oidc/accounts-changed')({ profileID: 'organization', authorizationChanged: true }), m => m.dispose[0]()]) {
    let finish
    const mounted = mount({ modelAuthorization: async () => true, authorizedFetch: () => new Promise(resolve => { finish = resolve }) })
    const pending = mounted.call(args)
    await new Promise(resolve => setImmediate(resolve))
    trigger(mounted); finish(Response.json(response))
    await assert.rejects(pending, /account changed/)
  }
})

test('unrelated account events leave requests intact; cancellation prevents auth and network', async () => {
  const mounted = mount({ modelAuthorization: async () => true, async authorizedFetch(_id, _url, init) {
    mounted.events.get('oidc/accounts-changed')({ profileID: 'someone-else', authorizationChanged: true })
    assert.equal(init.signal.aborted, false); return Response.json(response)
  } })
  await mounted.call(args)
  let called = false
  await assert.rejects(mount({ modelAuthorization: async () => { called = true; return true } }).call(args, { signal: AbortSignal.abort() }))
  assert.equal(called, false)
})

test('API key and explicit no-auth modes work without OIDC; redirects never receive credentials', async t => {
  const seen = []
  const server = createServer((req, res) => {
    seen.push({ path: req.url, auth: req.headers.authorization })
    if (req.url.startsWith('/redirect/')) { res.writeHead(307, { location: '/unexpected' }); res.end(); return }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(response))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)) })
  const baseURL = `http://127.0.0.1:${server.address().port}/v1`
  for (const authMode of ['api-key', 'none']) {
    const mounted = mount(undefined, { get() { assert.fail('no OIDC lookup') }, credentials: { resolve: async ref => {
      assert.equal(authMode, 'api-key'); assert.equal(ref, 'SYSTEMONE_API_KEY'); return { value: 'SYNTHETIC_KEY' }
    } } }, { ...config, baseURL, authMode })
    const result = await mounted.call(args)
    assert.deepEqual(JSON.parse(result.reportJSON), response); assert.doesNotMatch(result.reportJSON, /SYNTHETIC_KEY/)
  }
  assert.equal(seen[0].auth, 'Bearer SYNTHETIC_KEY'); assert.equal(seen[1].auth, undefined)
  await assert.rejects(mount(undefined, { credentials: { resolve: async () => ({ value: 'SYNTHETIC_KEY' }) } }, { ...config, baseURL: baseURL.replace('/v1', '/redirect'), authMode: 'api-key' }).call(args))
  assert.equal(seen.length, 3)
})

test('native Cordis activation and disposal own the tool and actual DSH skill lifecycle', async () => {
  const { Context, Service } = await import('@deepseek-ai/cordis')
  const { default: Skills } = await import('@deepseek-ai/dsh-skill')
  const plugin = await import('../lib/index.js')
  const root = new Context(), tools = new Map(), fibers = []
  class Tools extends Service {
    constructor(ctx) { super(ctx, 'tools') }
    register(tool) { return this.ctx.effect(() => { tools.set(tool.name, tool); return () => tools.delete(tool.name) }) }
  }
  class Credentials extends Service { constructor(ctx) { super(ctx, 'credentials') } async resolve() { throw Error('not invoked') } }
  try {
    for (const service of [Tools, Credentials, Skills]) fibers.push(await root.plugin(service))
    const fiber = await root.plugin(plugin, { ...config, authMode: 'none' }); fibers.push(fiber)
    assert.equal(tools.has('decision_evaluate'), true)
    assert.ok(await root.skills.get('decision', { cwd: process.cwd() }))
    await fiber.dispose(); fibers.pop()
    assert.equal(tools.size, 0); assert.equal(await root.skills.get('decision', { cwd: process.cwd() }), undefined)
  } finally { for (const fiber of fibers.reverse()) await fiber.dispose() }
})

test('published bundle and native configuration keep one plugin ID and no institution defaults', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url)))
  assert.equal(manifest.name, '@eduwork/dsh-decision'); assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.match(patch, /id: decision/); assert.match(patch, /enabled: false/)
  assert.ok(Config)
  for (const path of ['../lib/index.js', '../lib/core.js', '../skills/decision/SKILL.md']) assert.doesNotMatch(await readFile(new URL(path, import.meta.url), 'utf8'), /ecnu|chatecnu|学校账号/i)
})
