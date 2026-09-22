import assert from 'node:assert/strict'
import test from 'node:test'
import { GatewayDesktopBackend, GatewayWebBackend } from '../src/host/gateway-backend.js'
import { normalizeEnterpriseProfile, enterpriseProviderConfig } from '../src/host/profile.js'
import { sessionRef } from '../src/host/oidc.js'
import { detectGatewayProtocol, liteLLMToken, readGatewayJSON } from '../src/host/litellm-protocol.js'

const base = 'https://gateway.example.org/prefix'
const rawProfile = () => ({ schemaVersion: 'dsh-oidc/v1alpha1', id: 'gateway', displayName: 'Test gateway', auth: { discoveryUrl: `${base}/discovery`, expectedIssuer: base } })
const metadata = () => ({ contract_version: 1, issuer: base, resource: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, registration_endpoint: `${base}/register`, revocation_endpoint: `${base}/revoke`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], revocation_endpoint_auth_methods_supported: ['none'] })
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

async function fixture(t) {
  const profile = normalizeEnterpriseProfile(rawProfile()), records = new Map(), calls = [], routes = []
  let now = Date.now(), counter = 0, authorization
  const controls = { user: 'alice', team: null, models: ['model-a'], refreshGate: undefined, refreshStatus: 200, modelsStatus: 200, revokeStatus: 200 }
  const ctx = { credentials: { resolve: async ref => records.has(ref) ? { value: records.get(ref) } : undefined, set: async (ref, value) => { records.set(ref, value) }, unset: async ref => { records.delete(ref) } }, logger: { warn() {} }, effect() {} }
  const fetcher = async (url, init = {}) => {
    calls.push({ url, ...init })
    assert.equal(init.redirect, 'error')
    if (url === `${base}/discovery`) return json(metadata())
    if (url === `${base}/register`) return json({ ...JSON.parse(init.body), client_id: 'registered-public-client' }, 201)
    if (url === `${base}/token`) {
      assert.equal(init.body.get('resource'), base)
      assert.equal(init.body.get('client_id'), 'registered-public-client')
      if (init.body.get('grant_type') === 'refresh_token') {
        await controls.refreshGate?.promise
        if (controls.refreshStatus !== 200) return json({ error: controls.refreshStatus === 400 ? 'invalid_grant' : 'unavailable' }, controls.refreshStatus)
      }
      counter++
      return json({ token_type: 'Bearer', access_token: `synthetic-access-${counter}`, refresh_token: `synthetic-refresh-${counter}`, expires_in: 3600, user_id: controls.user, team_id: controls.team })
    }
    if (url === `${base}/user/info`) return json({ user_id: controls.user, user_info: { user_alias: controls.user }, keys: ['NEVER-EXPOSE'], teams: ['NEVER-EXPOSE'] })
    if (url === `${base}/v1/models`) return json({ data: controls.models.map(id => ({ id })) }, controls.modelsStatus)
    if (url === `${base}/v1/chat/completions`) return json({ error: 'upstream failure' }, controls.modelsStatus)
    if (url === `${base}/revoke`) return json({}, controls.revokeStatus)
    throw new Error('Unexpected synthetic endpoint')
  }
  const backend = new GatewayDesktopBackend(ctx, new Map([[profile.id, profile]]), {}, { fetch: fetcher, now: () => now, updateProvider: next => { routes.push(enterpriseProviderConfig(new Map([[next.id, next]]))) }, openExternal: async url => { authorization = new URL(url) } })
  t.after(() => backend.dispose())
  const login = async () => {
    const attempt = await backend.begin(profile.id)
    const target = new URL(authorization.searchParams.get('redirect_uri'))
    target.searchParams.set('code', 'synthetic-code')
    target.searchParams.set('state', authorization.searchParams.get('state'))
    const response = await fetch(target)
    assert.equal(response.status, 200)
    assert.equal(backend.loginStatus(attempt.loginID).state, 'completed')
    return attempt
  }
  return { profile, backend, records, calls, routes, controls, login, get authorization() { return authorization }, advance: ms => { now += ms } }
}

test('gateway profile is opt-in, rejects mixed OIDC/key binding and unsafe endpoints', () => {
  const raw = rawProfile(), profile = normalizeEnterpriseProfile(raw)
  assert.equal(profile.oidc, undefined)
  assert.equal(profile.keyBinding, undefined)
  assert.deepEqual(enterpriseProviderConfig(new Map([[profile.id, profile]])).providers, {})
  for (const update of [{ oidc: {} }, { keyBinding: {} }, { auth: { discoveryUrl: 'http://untrusted.example.org/discovery' } }, { auth: { ...raw.auth, clientId: 'fixed-client' } }, { provider: { baseURL: 'https://other.example.org/v1' } }]) assert.throws(() => normalizeEnterpriseProfile({ ...raw, ...update }))
  assert.equal(normalizeEnterpriseProfile({ ...raw, allowInsecureDevelopment: true, auth: { discoveryUrl: 'http://127.0.0.1:14000/discovery' } }).auth.discoveryUrl, 'http://127.0.0.1:14000/discovery')
})

test('discovery detects complete contract, retains prefix, rejects ambiguity and untrusted targets', () => {
  const profile = normalizeEnterpriseProfile(rawProfile())
  assert.equal(detectGatewayProtocol(metadata(), profile).baseURL, `${base}/v1`)
  for (const change of [{ oidc_llm: {} }, { contract_version: 2 }, { contract_version: '1' }, { token_endpoint: 'https://other.example.org/token' }, { resource: 'https://gateway.example.org/other' }, { code_challenge_methods_supported: ['plain'] }, { registration_endpoint: undefined }, { issuer: 'https://other.example.org' }, { token_endpoint: `${base}/token?secret=1` }]) assert.throws(() => detectGatewayProtocol({ ...metadata(), ...change }, profile))
})

test('Desktop Host uses DCR actual loopback, state, PKCE, direct access and a whitelisted account', async t => {
  const f = await fixture(t)
  await f.login()
  assert.equal(f.authorization.searchParams.get('scope'), null)
  assert.equal(f.authorization.searchParams.get('nonce'), null)
  assert.equal(f.authorization.searchParams.get('resource'), base)
  assert.equal(f.authorization.searchParams.get('code_challenge_method'), 'S256')
  assert.deepEqual(JSON.parse(f.calls.find(call => call.url.endsWith('/register')).body).redirect_uris, [f.authorization.searchParams.get('redirect_uri')])
  assert.equal((await f.backend.status(f.profile.id)).userName, 'alice')
  assert.equal((await f.backend.resolveGatewayCredential(f.profile.id)).value, 'synthetic-access-1')
  assert.equal(f.records.size, 1, 'no API key copy in vault')
  assert.ok(!JSON.stringify(await f.backend.status(f.profile.id)).includes('NEVER-EXPOSE'))
  assert.equal(f.routes.at(-1).providers.gateway.models[0].id, 'model-a')
  assert.equal(f.routes.at(-1).providers.gateway.models[0].reasoning, false)
  assert.ok(!f.calls.some(call => /bootstrap|runtime-credential|key\//.test(call.url)))
})

test('concurrent agents refresh one rotated pair and persisted restart uses that pair', async t => {
  const f = await fixture(t)
  await f.login()
  f.advance(3550_000)
  const results = await Promise.all(Array.from({ length: 12 }, () => f.backend.resolveGatewayCredential(f.profile.id)))
  assert.ok(results.every(result => result.value === 'synthetic-access-2'))
  assert.equal(f.calls.filter(call => call.body?.get?.('grant_type') === 'refresh_token').length, 1)
  const saved = JSON.parse(f.records.get(sessionRef(f.profile)))
  assert.equal(saved.refreshToken, 'synthetic-refresh-2')
  const restarted = new GatewayDesktopBackend(f.backend.ctx, new Map([[f.profile.id, f.profile]]), {}, { fetch: f.backend.fetch, now: f.backend.now })
  t.after(() => restarted.dispose())
  assert.equal((await restarted.resolveGatewayCredential(f.profile.id)).value, 'synthetic-access-2')
})

test('logout during refresh cannot resurrect tokens or provider routes', async t => {
  const f = await fixture(t)
  await f.login()
  f.controls.refreshGate = deferred()
  f.advance(3550_000)
  const pending = f.backend.resolveGatewayCredential(f.profile.id)
  const refused = assert.rejects(pending, /account changed|Account changed|账户状态已改变/i)
  while (!f.calls.some(call => call.body?.get?.('grant_type') === 'refresh_token')) await new Promise(resolve => setImmediate(resolve))
  await f.backend.logout(f.profile.id)
  f.controls.refreshGate.resolve()
  await refused
  assert.equal(f.records.size, 0)
  assert.equal((await f.backend.status(f.profile.id)).state, 'signed_out')
  assert.deepEqual(f.routes.at(-1).providers, {})
  assert.equal(f.calls.filter(call => call.url.endsWith('/revoke')).length, 2)
})

test('new account never receives previous account model catalog after a catalog outage', async t => {
  const f = await fixture(t)
  await f.login()
  f.controls.user = 'bob'
  f.controls.modelsStatus = 503
  await f.login()
  assert.equal((await f.backend.status(f.profile.id)).userName, 'bob')
  assert.deepEqual(f.routes.at(-1).providers, {})
  assert.deepEqual((await f.backend.resources(f.profile.id)).issues, ['models_unavailable'])
})

test('refresh rejects changed user/team and terminal grants, outages retain valid access', async t => {
  const f = await fixture(t)
  await f.login()
  f.advance(3550_000)
  f.controls.refreshStatus = 503
  assert.equal((await f.backend.resolveGatewayCredential(f.profile.id)).value, 'synthetic-access-1')
  f.advance(60_000)
  await assert.rejects(f.backend.resolveGatewayCredential(f.profile.id), /503/)
  assert.equal(f.records.size, 1)
  f.controls.refreshStatus = 200
  f.controls.team = 'other-team'
  await assert.rejects(f.backend.resolveGatewayCredential(f.profile.id), /sign in again/)
  assert.equal(f.records.size, 0)
  assert.deepEqual(f.routes.at(-1).providers, {})
})

test('model generation 401/403/429/5xx is not automatically replayed and does not erase login', async t => {
  const f = await fixture(t)
  await f.login()
  for (const status of [401, 403, 429, 500]) {
    f.controls.modelsStatus = status
    const response = await f.backend.authorizedFetch(f.profile.id, `${base}/v1/chat/completions`, { method: 'POST', body: '{}' })
    assert.equal(response.status, status)
    assert.equal(f.records.size, 1)
  }
  assert.equal(f.calls.filter(call => call.url.endsWith('/chat/completions')).length, 4)
  assert.equal(f.calls.filter(call => call.url.endsWith('/token')).length, 1)
  for (const url of ['https://other.example.org/v1/models', `${base}/key/generate`, `${base}/v1/../key/info`]) await assert.rejects(f.backend.authorizedFetch(f.profile.id, url), /authorized resource/)
})

test('unknown team, malformed expiry and oversized/error responses cannot enter a session', async () => {
  const raw = { access_token: 'synthetic-a', refresh_token: 'synthetic-r', token_type: 'Bearer', expires_in: 10, user_id: 'a', team_id: null }
  assert.equal(liteLLMToken(raw, () => 0).expiresAt, 10, 'do not extend a short TTL')
  for (const change of [{ team_id: undefined }, { user_id: '' }, { expires_in: '3600' }, { expires_in: 0 }, { refresh_token: '' }]) assert.throws(() => liteLLMToken({ ...raw, ...change }, () => 0))
  await assert.rejects(readGatewayJSON(new Response('x'.repeat(1024 * 1024 + 1))), /could not be read/)
  await assert.rejects(readGatewayJSON(json({ error: 'secret-token-value', error_description: 'private' }, 400)), error => !error.message.includes('secret') && !error.message.includes('private'))
})

test('local Web callback completes native OAuth and rejects replayed state', async t => {
  const f = await fixture(t)
  const web = new GatewayWebBackend({ ...f.backend.ctx, webServer: { host: '127.0.0.1', port: 3080 } }, new Map([[f.profile.id, f.profile]]), {}, { fetch: f.backend.fetch, now: f.backend.now })
  const started = await web.begin(f.profile.id), authorization = new URL(started.authorizationURL)
  assert.equal(started.mode, 'redirect')
  const callback = new URL(authorization.searchParams.get('redirect_uri'))
  callback.searchParams.set('state', authorization.searchParams.get('state'))
  callback.searchParams.set('code', 'synthetic-code')
  let location
  const response = { writeHead: (_status, headers) => { location = headers.location }, end() {} }
  await web.callback({ url: callback.pathname + callback.search }, response)
  assert.equal(new URL(location).searchParams.get('dsh_oidc'), 'connected')
  await web.callback({ url: callback.pathname + callback.search }, response)
  assert.equal(new URL(location).searchParams.get('dsh_oidc'), 'oidc_callback_invalid')
  assert.equal(f.calls.filter(call => call.body?.get?.('grant_type') === 'authorization_code').length, 1)
})

test('changing discovery configuration cannot reuse saved authorization', async t => {
  const f = await fixture(t)
  await f.login()
  const changed = normalizeEnterpriseProfile({ ...rawProfile(), auth: { discoveryUrl: `${base}/different-discovery` } })
  const other = new GatewayDesktopBackend(f.backend.ctx, new Map([[changed.id, changed]]), {}, { fetch: async (url, init) => {
    assert.equal(url, changed.auth.discoveryUrl)
    assert.equal(init.headers.authorization, undefined)
    return json(metadata())
  } })
  t.after(() => other.dispose())
  assert.equal(await other.resolveGatewayCredential(changed.id), undefined)
  assert.equal((await other.status(changed.id)).state, 'signed_out')
})

test('remote revocation outage does not prevent local logout', async t => {
  const f = await fixture(t)
  await f.login()
  f.controls.revokeStatus = 503
  assert.equal((await f.backend.logout(f.profile.id)).state, 'signed_out')
  assert.equal(f.records.size, 0)
  assert.deepEqual(f.routes.at(-1).providers, {})
})

test('catalog 401 refreshes once; invalid_grant clears the authorization', async t => {
  const f = await fixture(t)
  await f.login()
  f.controls.modelsStatus = 401
  const response = await f.backend.authorizedFetch(f.profile.id, `${base}/v1/models`)
  assert.equal(response.status, 401)
  assert.equal(f.calls.filter(call => call.body?.get?.('grant_type') === 'refresh_token').length, 1)
  f.advance(3550_000)
  f.controls.refreshStatus = 400
  await assert.rejects(f.backend.resolveGatewayCredential(f.profile.id), /sign in again/)
  assert.equal(f.records.size, 0)
})

test('explicit service POST recovery refreshes once and reuses the buffered body', async t => {
  const f = await fixture(t)
  await f.login()
  const originalFetch = f.backend.fetch, requests = []
  const endpoint = `${base}/v1/activity`
  f.backend.fetch = async (url, init) => {
    if (url !== endpoint) return originalFetch(url, init)
    requests.push(init)
    return requests.length === 1 ? json({}, 401) : json({ status: 'Success' })
  }
  const body = JSON.stringify({ activity: { state: 'active' } })
  const response = await f.backend.authorizedFetch(f.profile.id, endpoint, { method: 'POST', body }, { retryUnauthorized: true })
  assert.equal(response.status, 200)
  await response.json()
  assert.equal(requests.length, 2)
  assert.deepEqual(requests.map(r => r.body), [body, body])
  assert.deepEqual(requests.map(r => r.headers.authorization), ['Bearer synthetic-access-1', 'Bearer synthetic-access-2'])
  assert.equal(f.calls.filter(call => call.body?.get?.('grant_type') === 'refresh_token').length, 1)
  assert.ok(requests.every(r => !('retryUnauthorized' in r)))
})

test('explicit service POST recovery is bounded and rejects non-replayable bodies', async t => {
  const f = await fixture(t)
  await f.login()
  const originalFetch = f.backend.fetch
  let requests = 0
  const endpoint = `${base}/v1/activity`
  f.backend.fetch = async (url, init) => {
    if (url !== endpoint) return originalFetch(url, init)
    requests++
    return json({}, 401)
  }
  const response = await f.backend.authorizedFetch(f.profile.id, endpoint, { method: 'POST', body: '{}' }, { retryUnauthorized: true })
  assert.equal(response.status, 401)
  await response.body.cancel()
  assert.equal(requests, 2)
  assert.equal(f.calls.filter(call => call.body?.get?.('grant_type') === 'refresh_token').length, 1)
  await assert.rejects(f.backend.authorizedFetch(f.profile.id, endpoint,
    { method: 'POST', body: new ReadableStream() }, { retryUnauthorized: true }), /buffered text/)
  assert.equal(requests, 2)
  f.controls.refreshStatus = 400
  await assert.rejects(f.backend.authorizedFetch(f.profile.id, endpoint,
    { method: 'POST', body: '{}' }, { retryUnauthorized: true }), { code: 'oidc_login_required' })
  assert.equal(requests, 3)
  assert.equal(f.records.size, 0)
})
