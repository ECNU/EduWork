import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const moduleURL = process.env.DSH_OIDC_PACKAGE_ROOT
  ? pathToFileURL(join(process.env.DSH_OIDC_PACKAGE_ROOT, 'lib/index.js')) : new URL('../src/host/index.js', import.meta.url)
const require = createRequire(moduleURL)
const { Context, Service } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')))
const { default: LlmRuntime } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')))
const { default: OidcAccountService } = await import(moduleURL)

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

async function fixture(t) {
  const records = new Map(), codes = new Map(), requests = [], opened = [], fibers = []
  const controls = { user: 'alice', streamGate: undefined, firstChunk: undefined, refreshGate: undefined }
  let base, serial = 0
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, base)
    const json = (body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString()
    if (url.pathname === '/discovery') return json({ contract_version: 1, issuer: base, resource: base,
      authorization_endpoint: base + '/authorize', token_endpoint: base + '/token',
      registration_endpoint: base + '/register', revocation_endpoint: base + '/revoke',
      response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], revocation_endpoint_auth_methods_supported: ['none'] })
    if (url.pathname === '/register') return json({ ...JSON.parse(body), client_id: 'synthetic-client' }, 201)
    if (url.pathname === '/authorize') {
      const code = String(++serial)
      codes.set(code, Object.fromEntries(url.searchParams))
      const target = new URL(url.searchParams.get('redirect_uri'))
      target.searchParams.set('state', url.searchParams.get('state')); target.searchParams.set('code', code)
      res.writeHead(302, { location: target.href }); res.end(); return
    }
    if (url.pathname === '/token') {
      const form = new URLSearchParams(body)
      if (form.get('grant_type') === 'authorization_code') {
        const code = codes.get(form.get('code'))
        if (!code || code.code_challenge !== createHash('sha256').update(form.get('code_verifier') || '').digest('base64url')) return json({ error: 'invalid_grant' }, 400)
      } else await controls.refreshGate?.promise
      return json({ access_token: 'synthetic-access-' + controls.user + '-' + (++serial), refresh_token: 'synthetic-refresh-' + serial,
        expires_in: 3600, token_type: 'Bearer', user_id: controls.user, team_id: null })
    }
    if (url.pathname === '/user/info') return json({ user_id: controls.user })
    if (url.pathname === '/v1/models') return json({ data: [{ id: 'synthetic-model' }] })
    if (url.pathname === '/revoke') return json({})
    if (url.pathname === '/v1/chat/completions') {
      requests.push({ authorization: req.headers.authorization })
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: 'synthetic-first' }, finish_reason: null }] }) + '\n\n')
      controls.firstChunk?.resolve()
      await controls.streamGate?.promise
      res.end('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: 'synthetic-late' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n')
      return
    }
    json({}, 404)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  base = 'http://127.0.0.1:' + server.address().port
  const ctx = new Context()
  class Credentials extends Service {
    constructor(ctx) { super(ctx, 'credentials') }
    async resolve(ref) { return records.has(ref) ? { value: records.get(ref) } : undefined }
    async set(ref, value) { records.set(ref, value) }
    async unset(ref) { records.delete(ref) }
  }
  class Browser extends Service {
    constructor(ctx) { super(ctx, 'desktopServices') }
    async openExternal(url) { opened.push(url) }
  }
  const profile = { schemaVersion: 'dsh-oidc/v1alpha1', id: 'gateway', displayName: 'Synthetic gateway',
    allowInsecureDevelopment: true, auth: { discoveryUrl: base + '/discovery' } }
  t.after(async () => {
    controls.streamGate?.resolve(); controls.refreshGate?.resolve()
    for (const fiber of fibers.reverse()) await fiber.dispose()
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
  })
  for (const [plugin, config] of [[Credentials], [LlmRuntime], [Browser], [OidcAccountService, { backend: 'desktop', profile, manageProductBrand: false }]]) fibers.push(await ctx.plugin(plugin, config))
  const login = async (user = controls.user) => {
    controls.user = user
    const attempt = await ctx.oidcAccounts.begin(profile.id)
    const redirect = await fetch(opened.at(-1), { redirect: 'manual' })
    assert.equal((await fetch(redirect.headers.get('location'))).status, 200)
    assert.equal((await ctx.oidcAccounts.loginStatus(attempt.loginID)).state, 'completed')
  }
  await login()
  return { ctx, controls, requests, login, base, backend: ctx.oidcAccounts.backend,
    options: { provider: profile.id, model: 'synthetic-model', messages: [] } }
}

test('DSH stops an active gateway stream on logout without forwarding buffered old content', async t => {
  const f = await fixture(t)
  f.controls.streamGate = deferred()
  const chunks = []
  for await (const chunk of f.ctx.llm.stream(f.options)) {
    chunks.push(chunk)
    if (chunk.type === 'text-delta') {
      await f.ctx.oidcAccounts.logout('gateway')
      f.controls.streamGate.resolve()
    }
  }
  assert.ok(JSON.stringify(chunks).includes('synthetic-first'))
  assert.ok(!JSON.stringify(chunks).includes('synthetic-late'))
  assert.ok(chunks.some(chunk => chunk.type === 'finish' && chunk.reason?.kind === 'error'))
  assert.equal(f.requests.length, 1, 'a partially consumed generation is never replayed')
  assert.equal(f.backend.gatewayCalls.size, 0)
})

test('DSH prepared call cannot resolve the new account credential after account replacement', async t => {
  const f = await fixture(t)
  const prepared = await f.ctx.llm.prepareCall({ provider: 'gateway', model: 'synthetic-model' })
  await f.login('bob')
  const stale = []
  for await (const chunk of prepared.stream({ ...prepared.config, messages: [] })) stale.push(chunk)
  assert.ok(stale.some(chunk => chunk.type === 'finish' && chunk.reason?.kind === 'error'))
  assert.equal(f.requests.length, 0, 'old prepared call must not send a request as Bob')
  const fresh = []
  for await (const chunk of f.ctx.llm.stream(f.options)) fresh.push(chunk)
  assert.ok(JSON.stringify(fresh).includes('synthetic-late'))
  assert.match(f.requests[0].authorization, /^Bearer synthetic-access-bob-/)
})

test('DSH stream ignores late output after another account logs in', async t => {
  const f = await fixture(t)
  f.controls.streamGate = deferred()
  const chunks = []
  for await (const chunk of f.ctx.llm.stream(f.options)) {
    chunks.push(chunk)
    if (chunk.type === 'text-delta') { await f.login('bob'); f.controls.streamGate.resolve() }
  }
  assert.ok(!JSON.stringify(chunks).includes('synthetic-late'))
  assert.equal(f.requests.length, 1)
  assert.match(f.requests[0].authorization, /^Bearer synthetic-access-alice-/)
})

test('same authorization refresh preserves an active stream and cleans up its call scope', async t => {
  const f = await fixture(t)
  f.controls.streamGate = deferred()
  const chunks = []
  for await (const chunk of f.ctx.llm.stream(f.options)) {
    chunks.push(chunk)
    if (chunk.type === 'text-delta' && !JSON.stringify(chunks).includes('synthetic-late')) {
      const profile = f.backend.profile('gateway')
      await f.backend.refresh(profile, await f.backend.loadSession(profile))
      f.controls.streamGate.resolve()
    }
  }
  assert.ok(JSON.stringify(chunks).includes('synthetic-late'))
  assert.ok(!chunks.some(chunk => chunk.reason?.kind === 'error'))
  assert.equal(f.requests.length, 1)
  assert.equal(f.backend.gatewayCalls.size, 0)
})

test('Host authorizedFetch drops unread response bytes after logout', async t => {
  const f = await fixture(t)
  f.controls.streamGate = deferred()
  const response = await f.ctx.oidcAccounts.authorizedFetch('gateway', f.base + '/v1/chat/completions', { method: 'POST', body: '{}' })
  assert.equal(response.status, 200)
  await f.ctx.oidcAccounts.logout('gateway')
  f.controls.streamGate.resolve()
  await assert.rejects(response.text(), { code: 'oidc_login_cancelled' })
  assert.equal(f.backend.gatewayCalls.size, 0)
})
