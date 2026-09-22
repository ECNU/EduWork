import assert from 'node:assert/strict'
import test from 'node:test'
import { generateKeyPairSync, sign, createHash } from 'node:crypto'
import { GatewayDesktopBackend, GatewayWebBackend } from '../src/host/gateway-backend.js'
import { normalizeEnterpriseProfile } from '../src/host/profile.js'
import { detectGatewayProtocol } from '../src/host/gateway-protocol.js'
import { oidcLlmIdentity, oidcLlmToken } from '../src/host/oidc-llm-protocol.js'

const base = 'https://models.example.org'
const profileRaw = mode => ({ schemaVersion: 'dsh-oidc/v1alpha1', id: 'draft', displayName: 'Synthetic draft',
  auth: { discoveryUrl: base + '/.well-known/openid-configuration', expectedIssuer: base, experimentalOidcLlm: true, clientId: 'public-client', identityMode: mode ?? 'oidc' } })
const metadata = () => ({ issuer: base, authorization_endpoint: base + '/authorize', token_endpoint: base + '/token',
  revocation_endpoint: base + '/revoke', userinfo_endpoint: base + '/userinfo', jwks_uri: base + '/jwks',
  response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'],
  revocation_endpoint_auth_methods_supported: ['none'], authorization_response_iss_parameter_supported: true,
  scopes_supported: ['openid', 'profile', 'offline_access', 'llm:profile', 'llm:models:read', 'llm:invoke'],
  subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'],
  oidc_llm: { version: '0.1', resource: base, api_base: base + '/open/api/v1', identity_modes_supported: ['oauth', 'oidc'], client_registration_methods_supported: ['static'] } })
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
const key = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'synthetic-key', alg: 'RS256', use: 'sig' }
const jwt = claims => {
  const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: key.kid })).toString('base64url')
  const payload = head + '.' + Buffer.from(JSON.stringify(claims)).toString('base64url')
  return payload + '.' + sign('RSA-SHA256', Buffer.from(payload), pair.privateKey).toString('base64url')
}

async function fixture(t, mode = 'oidc', metadataChanges = {}) {
  const profile = normalizeEnterpriseProfile(profileRaw(mode)), records = new Map(), calls = []
  const controls = { user: 'alice', omitID: false, refreshID: false, claim: {}, omitIssuer: false, scope: undefined, quotaGate: undefined }
  let authorization, callbackResult, serial = 0
  const ctx = { credentials: { resolve: async ref => records.has(ref) ? { value: records.get(ref) } : undefined,
    set: async (ref, value) => { records.set(ref, value) }, unset: async ref => { records.delete(ref) } }, logger: { warn() {} }, effect() {} }
  const backend = new GatewayDesktopBackend(ctx, new Map([[profile.id, profile]]), {}, {
    openExternal: async url => { authorization = new URL(url) },
    fetch: async (url, init = {}) => {
      calls.push({ url, ...init })
      assert.equal(init.redirect, 'error')
      if (url.endsWith('/.well-known/openid-configuration')) return json({ ...metadata(), ...metadataChanges })
      if (url === base + '/jwks') return json({ keys: [key] })
      if (url === base + '/token') {
        assert.equal(init.body.get('client_id'), 'public-client')
        assert.equal(init.body.get('resource'), base)
        const refresh = init.body.get('grant_type') === 'refresh_token'
        if (!refresh) {
          assert.equal(init.body.get('redirect_uri'), authorization.searchParams.get('redirect_uri'))
          assert.equal(createHash('sha256').update(init.body.get('code_verifier')).digest('base64url'), authorization.searchParams.get('code_challenge'))
        }
        const access = 'synthetic-access-' + (++serial), now = Math.floor(Date.now() / 1000)
        const raw = { access_token: access, refresh_token: 'synthetic-refresh-' + serial, token_type: 'Bearer', expires_in: 1800,
          scope: controls.scope ?? authorization.searchParams.get('scope') }
        if (mode === 'oidc' && !controls.omitID && (!refresh || controls.refreshID)) {
          raw.id_token = jwt({ iss: base, aud: 'public-client', sub: 'alice', exp: now + 1800, iat: now,
            ...(!refresh ? { nonce: authorization.searchParams.get('nonce') } : {}),
            at_hash: createHash('sha256').update(access).digest().subarray(0, 16).toString('base64url'), ...controls.claim })
        }
        return json(raw)
      }
      if (url === base + '/userinfo') return json({ sub: controls.user, preferred_username: 'Synthetic user', private_extra: 'DO-NOT-PROJECT' })
      if (url === base + '/open/api/v1/models') return json({ object: 'list', data: [{ id: 'model-a', object: 'model' }] })
      if (url === base + '/open/api/v1/quota') { await controls.quotaGate; return json({ remaining: 1 }) }
      if (url === base + '/revoke') { assert.equal(init.body.get('token_type_hint'), 'refresh_token'); return new Response('', { status: 200 }) }
      throw new Error('unexpected synthetic route')
    },
  })
  t.after(() => backend.dispose())
  const login = async (changeCallback = callback => {}) => {
    const started = await backend.begin(profile.id)
    const callback = new URL(authorization.searchParams.get('redirect_uri'))
    callback.searchParams.set('code', 'synthetic-code')
    callback.searchParams.set('state', authorization.searchParams.get('state'))
    if (!controls.omitIssuer) callback.searchParams.set('iss', base)
    changeCallback(callback)
    const response = await fetch(callback, { headers: { 'accept-language': 'zh-CN' } })
    callbackResult = { status: response.status, html: await response.text(), headers: response.headers }
    return backend.loginStatus(started.loginID)
  }
  return { profile, backend, records, calls, controls, login, get authorization() { return authorization }, get callbackResult() { return callbackResult } }
}

test('OIDC draft service POST recovers a 401 with a rotated Access Token', async t => {
  const f = await fixture(t)
  await f.login()
  const fetcher = f.backend.fetch, requests = []
  const endpoint = base + '/open/api/v1/user/active'
  f.backend.fetch = async (url, init) => {
    if (url !== endpoint) return fetcher(url, init)
    requests.push(init)
    return json({ status: requests.length === 1 ? 'Unauthorized' : 'Success' }, requests.length === 1 ? 401 : 200)
  }
  const response = await f.backend.authorizedFetch(f.profile.id, endpoint, { method: 'POST', body: '{}' }, { retryUnauthorized: true })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).status, 'Success')
  assert.equal(requests.length, 2)
  assert.notEqual(requests[0].headers.authorization, requests[1].headers.authorization)
  assert.equal(f.calls.filter(call => call.body?.get?.('grant_type') === 'refresh_token').length, 1)
})

test('draft discovery requires explicit mode, static registration, complete contract and trust pins', () => {
  const profile = normalizeEnterpriseProfile(profileRaw())
  assert.equal(detectGatewayProtocol(metadata(), profile).baseURL, base + '/open/api/v1')
  const disabled = normalizeEnterpriseProfile({ ...profileRaw(), auth: { discoveryUrl: profile.auth.discoveryUrl } })
  assert.throws(() => detectGatewayProtocol(metadata(), disabled), /opt-in/)
  assert.throws(() => detectGatewayProtocol({ contract_version: 1 }, profile), /fall back/)
  for (const change of [
    { contract_version: 1 }, { issuer: base + '/wrong' }, { userinfo_endpoint: 'https://other.example.org/info' },
    { jwks_uri: undefined }, { id_token_signing_alg_values_supported: ['none'] }, { scopes_supported: ['openid'] },
    { oidc_llm: { ...metadata().oidc_llm, version: '0.2' } },
    { oidc_llm: { ...metadata().oidc_llm, identity_modes_supported: ['oauth'] } },
  ]) assert.throws(() => detectGatewayProtocol({ ...metadata(), ...change }, profile))
  const raw = profileRaw(); delete raw.auth.identityMode
  assert.throws(() => normalizeEnterpriseProfile(raw), /explicitly/)
})

test('HTTP opt-in applies to discovered endpoints while issuer and resource checks remain', () => {
  const raw = JSON.parse(JSON.stringify(profileRaw()).replaceAll(base, 'http://192.0.2.10'))
  assert.throws(() => normalizeEnterpriseProfile(raw))
  Object.assign(raw, { allowInsecureDevelopment: true })
  const profile = normalizeEnterpriseProfile(raw)
  const meta = JSON.parse(JSON.stringify(metadata()).replaceAll(base, 'http://192.0.2.10'))
  assert.equal(detectGatewayProtocol(meta, profile).issuer, 'http://192.0.2.10')
  assert.equal(detectGatewayProtocol({ ...meta, token_endpoint: 'http://192.0.2.11/token' }, profile).tokenEndpoint, 'http://192.0.2.11/token')
  assert.throws(() => detectGatewayProtocol({ ...meta, userinfo_endpoint: 'http://192.0.2.11/userinfo' }, profile))
  delete raw.auth.expectedIssuer
  assert.equal(detectGatewayProtocol(meta, normalizeEnterpriseProfile(raw)).issuer, meta.issuer)
  raw.auth = { discoveryUrl: 'http://192.0.2.10/discovery' }
  assert.equal(normalizeEnterpriseProfile(raw).auth.discoveryUrl, raw.auth.discoveryUrl)
})

test('OIDC draft uses shared PKCE callback, verifier, ID validation and Access Token resources without Key Binding', async t => {
  const f = await fixture(t)
  assert.equal((await f.login()).state, 'completed')
  assert.ok(f.authorization.searchParams.get('nonce'))
  assert.equal(f.authorization.searchParams.get('prompt'), 'consent')
  assert.equal((await f.backend.status('draft')).userName, 'Synthetic user')
  assert.equal((await f.backend.modelResourceFetch('draft', '/quota')).status, 200)
  assert.equal(f.records.size, 1)
  assert.ok(!f.calls.some(call => /register|bootstrap|runtime-credential/.test(call.url)))
  assert.ok(f.calls.filter(call => /\/userinfo$|\/models$|\/quota$/.test(call.url)).every(call => call.headers.authorization.startsWith('Bearer synthetic-access-')))
  assert.ok(!JSON.stringify(await f.backend.status('draft')).includes('DO-NOT-PROJECT'))
  await f.backend.logout('draft')
  assert.equal(f.records.size, 0)
})

test('OAuth-only draft is explicit and uses standard UserInfo claims without claiming ID Token validation', async t => {
  const f = await fixture(t, 'oauth')
  assert.equal((await f.login()).state, 'completed')
  assert.equal(f.authorization.searchParams.get('nonce'), null)
  assert.ok(!f.authorization.searchParams.get('scope').includes('openid'))
  assert.ok(f.authorization.searchParams.get('scope').includes('llm:profile'))
  assert.ok(!f.calls.some(call => call.url.endsWith('/jwks')))
  assert.equal(oidcLlmIdentity({ sub: 'Case-Sensitive' }).sub, 'Case-Sensitive')
  assert.equal(oidcLlmIdentity({ sub: 'x' }).name, '已登录')
})

for (const [name, update] of [
  ['missing ID Token', { omitID: true }], ['wrong nonce', { claim: { nonce: 'wrong' } }],
  ['wrong audience', { claim: { aud: 'other' } }], ['wrong authorized party', { claim: { azp: 'other' } }],
  ['UserInfo subject mismatch', { user: 'bob' }],
]) test('OIDC draft refuses ' + name + ' without OAuth fallback', async t => {
  const f = await fixture(t); Object.assign(f.controls, update)
  assert.equal((await f.login()).state, 'failed')
  assert.equal(f.records.size, 0)
  assert.ok(!f.calls.some(call => call.url.endsWith('/models')))
})

for (const [name, change, expected] of [
  ['missing', url => url.searchParams.delete('iss'), 'gateway_callback_issuer_missing'],
  ['empty', url => url.searchParams.set('iss', ''), 'gateway_callback_issuer_invalid'],
  ['mismatched', url => url.searchParams.set('iss', 'https://wrong.example.org'), 'gateway_callback_issuer_invalid'],
  ['repeated', url => url.searchParams.append('iss', base), 'gateway_callback_issuer_invalid'],
  ['missing in an error response', url => { url.searchParams.delete('code'); url.searchParams.delete('iss'); url.searchParams.set('error', 'access_denied') }, 'gateway_callback_issuer_missing'],
]) test('callback reports ' + name + ' issuer before token exchange and delivers a safe failure page', async t => {
  const f = await fixture(t)
  const result = await f.login(change)
  assert.equal(result.state, 'failed')
  assert.equal(result.errorCode, expected)
  assert.equal(f.records.size, 0)
  assert.ok(!f.calls.some(call => call.url === base + '/token'))
  assert.equal(f.callbackResult.status, 400)
  assert.equal(f.callbackResult.headers.get('cache-control'), 'no-store')
  assert.match(f.callbackResult.html, /联系管理员/)
  for (const secret of ['synthetic-code', f.authorization.searchParams.get('state'), 'https://wrong.example.org']) assert.equal(f.callbackResult.html.includes(secret), false)
  await assert.rejects(fetch(f.authorization.searchParams.get('redirect_uri'), { signal: AbortSignal.timeout(1000) }))
})

test('issuer requirements follow metadata, with every supplied issuer still validated', async t => {
  const f = await fixture(t, 'oauth', { authorization_response_iss_parameter_supported: false })
  f.controls.omitIssuer = true
  assert.equal((await f.login()).state, 'completed')
  await f.backend.logout(f.profile.id)
  const tokenCalls = f.calls.filter(call => call.url === base + '/token').length
  assert.equal((await f.login(url => url.searchParams.set('iss', 'https://wrong.example.org'))).errorCode, 'gateway_callback_issuer_invalid')
  assert.equal(f.calls.filter(call => call.url === base + '/token').length, tokenCalls)
})

test('Web callback exposes the same safe issuer diagnostic without exchanging a code', async t => {
  const f = await fixture(t)
  const web = new GatewayWebBackend({ ...f.backend.ctx, webServer: { host: '127.0.0.1', port: 3080 } },
    new Map([[f.profile.id, f.profile]]), {}, { fetch: f.backend.fetch })
  const started = await web.begin(f.profile.id), authorization = new URL(started.authorizationURL)
  const callback = new URL(authorization.searchParams.get('redirect_uri'))
  callback.searchParams.set('state', authorization.searchParams.get('state'))
  callback.searchParams.set('code', 'synthetic-code')
  let location
  await web.callback({ url: callback.pathname + callback.search }, {
    writeHead: (_status, headers) => { location = headers.location }, end() {},
  })
  assert.equal(new URL(location).searchParams.get('dsh_oidc'), 'gateway_callback_issuer_missing')
  assert.ok(!f.calls.some(call => call.url === base + '/token'))
  assert.equal(f.records.size, 0)
})

test('draft refresh is single-flight, accepts optional refreshed ID Token and persists one rotated pair', async t => {
  const f = await fixture(t)
  await f.login()
  let saved = await f.backend.loadSession(f.profile)
  const first = await Promise.all(Array.from({ length: 12 }, () => f.backend.refresh(f.profile, saved)))
  assert.equal(new Set(first.map(s => s.refreshToken)).size, 1)
  assert.equal(f.calls.filter(c => c.body?.get?.('grant_type') === 'refresh_token').length, 1)
  f.controls.refreshID = true
  saved = await f.backend.refresh(f.profile, first[0])
  assert.equal(saved.identity.sub, 'alice', 'refresh may omit nonce')
  f.controls.claim = { nonce: 'wrong' }
  await assert.rejects(f.backend.refresh(f.profile, saved), /sign in again/)
  assert.equal(f.records.size, 0)
})

test('draft token scopes are explicit, never expanded, and checked after rotation', async t => {
  const f = await fixture(t)
  await f.login()
  f.controls.scope = f.authorization.searchParams.get('scope') + ' admin'
  await assert.rejects(f.backend.refresh(f.profile, await f.backend.loadSession(f.profile)), /sign in again/)
  assert.equal(f.records.size, 0)
  assert.ok(f.calls.some(c => c.url.endsWith('/revoke')))
  const descriptor = detectGatewayProtocol(metadata(), f.profile)
  assert.throws(() => oidcLlmToken({ access_token: 'a', refresh_token: 'r', token_type: 'Bearer', expires_in: 1, scope: 'openid' }, descriptor, Date.now), /scopes/)
})

test('refreshed OIDC ID Token cannot expand the original audience', async t => {
  const f = await fixture(t)
  await f.login()
  f.controls.refreshID = true
  f.controls.claim = { aud: ['public-client', 'another-client'], azp: 'public-client' }
  await assert.rejects(f.backend.refresh(f.profile, await f.backend.loadSession(f.profile)), /sign in again/)
  assert.equal(f.records.size, 0)
})

test('resource extension reads reject traversal and discard late quota after logout', async t => {
  const f = await fixture(t)
  await f.login()
  for (const path of ['//other.example.org', '/../admin', '/%2e%2e/admin', '/quota?user=bob']) await assert.rejects(f.backend.modelResourceFetch('draft', path))
  await assert.rejects(f.backend.modelResourceFetch('draft', '/quota', { method: 'POST' }))
  let release
  f.controls.quotaGate = new Promise(resolve => { release = resolve })
  const pending = f.backend.modelResourceFetch('draft', '/quota')
  const rejected = assert.rejects(pending)
  while (!f.calls.some(c => c.url.endsWith('/quota'))) await new Promise(resolve => setImmediate(resolve))
  await f.backend.logout('draft')
  release()
  await rejected
})
