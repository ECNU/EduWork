import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
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

async function fixture(t, draft = false) {
  const records = new Map(), codes = new Map(), requests = [], activity = [], opened = [], fibers = []
  const controls = { user: 'alice', streamGate: undefined, firstChunk: undefined, refreshGate: undefined }
  let base, serial = 0, grantedScopes
  const pair = draft ? generateKeyPairSync('rsa', { modulusLength: 2048 }) : undefined
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, base)
    const json = (body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString()
    if (url.pathname === '/discovery' && draft) return json({
      issuer: base, authorization_endpoint: base + '/authorize', token_endpoint: base + '/token',
      revocation_endpoint: base + '/revoke', userinfo_endpoint: base + '/userinfo', jwks_uri: base + '/jwks',
      response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], revocation_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['openid', 'profile', 'offline_access', 'llm:models:read', 'llm:invoke'],
      subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
      oidc_llm: { version: '0.1', resource: base, api_base: base + '/v1', identity_modes_supported: ['oauth', 'oidc'], client_registration_methods_supported: ['static'] },
    })
    if (url.pathname === '/jwks' && draft) return json({ keys: [{ ...pair.publicKey.export({ format: 'jwk' }), kid: 'synthetic', alg: 'RS256', use: 'sig' }] })
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
      let code
      if (form.get('grant_type') === 'authorization_code') {
        code = codes.get(form.get('code'))
        if (!code || code.code_challenge !== createHash('sha256').update(form.get('code_verifier') || '').digest('base64url')) return json({ error: 'invalid_grant' }, 400)
        grantedScopes = code.scope
      } else await controls.refreshGate?.promise
      if (draft) {
        const token = { access_token: 'synthetic-access-' + controls.user + '-' + (++serial), refresh_token: 'synthetic-refresh-' + serial,
          expires_in: 3600, token_type: 'Bearer', scope: grantedScopes }
        if (code) {
          const now = Math.floor(Date.now() / 1000)
          const payload = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'synthetic' })).toString('base64url') + '.'
            + Buffer.from(JSON.stringify({ iss: base, aud: 'synthetic-client', sub: controls.user, nonce: code.nonce, iat: now, exp: now + 3600 })).toString('base64url')
          token.id_token = payload + '.' + sign('RSA-SHA256', Buffer.from(payload), pair.privateKey).toString('base64url')
        }
        return json(token)
      }
      return json({ access_token: 'synthetic-access-' + controls.user + '-' + (++serial), refresh_token: 'synthetic-refresh-' + serial,
        expires_in: 3600, token_type: 'Bearer', user_id: controls.user, team_id: null })
    }
    if (url.pathname === '/user/info') return json({ user_id: controls.user })
    if (url.pathname === '/userinfo' && draft) return json({ sub: controls.user })
    if (url.pathname === '/v1/models') return json({ data: [{ id: 'synthetic-model' }] })
    if (url.pathname === '/revoke') return json({})
    if (url.pathname === '/v1/user/active') {
      activity.push({ authorization: req.headers.authorization, body })
      return json({ status: activity.length === 1 ? 'Unauthorized' : 'Success' }, activity.length === 1 ? 401 : 200)
    }
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
    allowInsecureDevelopment: true, auth: { discoveryUrl: base + '/discovery',
      ...(draft ? { experimentalOidcLlm: true, identityMode: 'oidc', clientId: 'synthetic-client' } : {}) } }
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
  return { ctx, controls, requests, activity, login, base, backend: ctx.oidcAccounts.backend,
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

for (const draft of [false, true]) test(`DSH ${draft ? 'OIDC draft' : 'LiteLLM'} lets an accepted stream finish past token expiry and refreshes the next request`, async t => {
  const f = await fixture(t, draft)
  const profile = f.backend.profile('gateway')
  const before = await f.backend.loadSession(profile)
  f.controls.streamGate = deferred()
  const output = []
  for await (const chunk of f.ctx.llm.stream(f.options)) {
    output.push(chunk)
    if (chunk.type === 'text-delta') {
      f.backend.now = () => (before.expiresAt + 1) * 1000
      f.controls.streamGate.resolve()
    }
  }
  assert.ok(JSON.stringify(output).includes('synthetic-late'))
  assert.ok(!output.some(chunk => chunk.reason?.kind === 'error'))
  assert.equal(f.requests.length, 1, 'an accepted stream is neither cancelled nor replayed on local expiry')
  const next = []
  for await (const chunk of f.ctx.llm.stream(f.options)) next.push(chunk)
  assert.ok(JSON.stringify(next).includes('synthetic-late'))
  assert.ok(!next.some(chunk => chunk.reason?.kind === 'error'))
  assert.equal(f.requests.length, 2)
  assert.notEqual(f.requests[0].authorization, f.requests[1].authorization)
})

for (const draft of [false, true]) test(`DSH ${draft ? 'OIDC draft' : 'LiteLLM'} refreshes a near-expiry token before a prepared model request`, async t => {
  const f = await fixture(t, draft)
  const prepared = await f.ctx.llm.prepareCall(f.options)
  const profile = f.backend.profile('gateway')
  const before = await f.backend.loadSession(profile)
  f.backend.now = () => (before.expiresAt - 1200) * 1000
  const output = []
  for await (const chunk of prepared.stream({ ...prepared.config, messages: [] })) output.push(chunk)
  const after = await f.backend.loadSession(profile)
  assert.notEqual(after.accessToken, before.accessToken)
  assert.notEqual(after.refreshToken, before.refreshToken)
  assert.equal(after.contextID, before.contextID)
  assert.equal(f.requests.length, 1)
  assert.equal(f.requests[0].authorization, `Bearer ${after.accessToken}`)
  assert.ok(JSON.stringify(output).includes('synthetic-late'))
  assert.ok(!output.some(chunk => chunk.reason?.kind === 'error'))
})

test('Host account service forwards explicit POST recovery without exposing credentials', async t => {
  const f = await fixture(t, true)
  const response = await f.ctx.oidcAccounts.authorizedFetch('gateway', f.base + '/v1/user/active', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"activity":{"state":"active"}}',
  }, { retryUnauthorized: true })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).status, 'Success')
  assert.equal(f.activity.length, 2)
  assert.equal(f.activity[0].body, f.activity[1].body)
  assert.notEqual(f.activity[0].authorization, f.activity[1].authorization)
  assert.equal((await f.ctx.oidcAccounts.status('gateway')).state, 'connected')
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

test('actual DSH OIDC draft provider reuses Access Token refresh and rejects a prepared call after account switch', async t => {
  const f = await fixture(t, true)
  const prepared = await f.ctx.llm.prepareCall(f.options)
  const profile = f.backend.profile('gateway')
  await f.backend.refresh(profile, await f.backend.loadSession(profile))
  const output = []
  for await (const chunk of prepared.stream({ ...prepared.config, messages: [] })) output.push(chunk)
  assert.ok(output.some(chunk => chunk.type === 'text-delta'))
  assert.ok(!output.some(chunk => chunk.reason?.kind === 'error'))
  assert.match(f.requests[0].authorization, /^Bearer synthetic-access-alice-/)
  const beforeSwitch = await f.ctx.llm.prepareCall(f.options)
  await f.login('bob')
  const stale = []
  for await (const chunk of beforeSwitch.stream({ ...beforeSwitch.config, messages: [] })) stale.push(chunk)
  assert.ok(stale.some(chunk => chunk.reason?.kind === 'error'))
  assert.equal(f.requests.length, 1)
})

test('actual DSH OIDC draft stream drops late output after logout', async t => {
  const f = await fixture(t, true)
  f.controls.streamGate = deferred()
  const output = []
  for await (const chunk of f.ctx.llm.stream(f.options)) {
    output.push(chunk)
    if (chunk.type === 'text-delta') { await f.ctx.oidcAccounts.logout('gateway'); f.controls.streamGate.resolve() }
  }
  assert.ok(JSON.stringify(output).includes('synthetic-first'))
  assert.ok(!JSON.stringify(output).includes('synthetic-late'))
  assert.equal(f.backend.gatewayCalls.size, 0)
})
