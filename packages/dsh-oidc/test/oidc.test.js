import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { WebOidcBackend, sessionRef } from '../src/host/oidc.js'
import { normalizeEnterpriseProfile } from '../src/host/profile.js'
import { resourcesResult, configurationResult } from '../src/host/typert-schemas.js'
import { publicProfile, enterpriseProviderConfig } from '../src/host/profile.js'

const raw = JSON.parse(await readFile(new URL('../examples/identity-only.example.json', import.meta.url), 'utf8'))
const profile = normalizeEnterpriseProfile(raw)

test('configuration RPC uses the same closed target schema on Host and Client', async () => {
  const { TYPERT } = await import('../src/host/typert.host.js')
  const { TYPERT_REMOTE } = await import('../src/host/typert.remote-client.js')
  const host = TYPERT.invocations.find(item => item.method === 'openConfiguration')
  const client = TYPERT_REMOTE.descriptors.find(item => item.method === 'openConfiguration')
  assert.equal(host.parameters[0].codec.schema, client.parameters[0].codec.schema)
  assert.equal(host.result.schema, client.result.schema)
  for (const target of ['config', 'examples']) assert.equal(host.parameters[0].codec.schema.parse(target), target)
  for (const target of ['C:/config/eduwork.jsonc', '../config', 'https://example.com', { target: 'config' }]) {
    assert.equal(host.parameters[0].codec.schema.safeParse(target).success, false)
  }
  host.result.schema.parse({ opened: true })
  assert.equal(host.result.schema.safeParse({ opened: false }).success, false)
})

test('identity-only OIDC completes login and logout without touching personal model credentials', async () => {
  const identityProfile = profile
  const provider = providerFetch()
  const state = harness(provider.fetch)
  state.backend.profiles = new Map([[identityProfile.id, identityProfile]])
  state.secrets.set('PERSONAL_API_KEY', 'personal-test-key')
  const authorization = new URL((await state.backend.begin(identityProfile.id)).authorizationURL)
  provider.setNonce(authorization.searchParams.get('nonce'))
  const response = callbackResponse()
  await state.route().handler({ url: `/oauth/callback?code=x&state=${authorization.searchParams.get('state')}` }, response)
  assert.match(response.headers.location, /dsh_oidc=connected/)
  assert.equal((await state.backend.status(identityProfile.id)).state, 'connected')
  assert.deepEqual(enterpriseProviderConfig(new Map([[identityProfile.id, identityProfile]])), { providers: {} })
  configurationResult.schema.parse({ schemaVersion: 'dsh-oidc/v1alpha1', uiMode: 'standard', profiles: [publicProfile(identityProfile)] })
  const resources = await state.backend.resources(identityProfile.id)
  resourcesResult.schema.parse(resources)
  assert.equal(Object.hasOwn(resources, 'quota'), false)
  await state.backend.logout(identityProfile.id)
  assert.equal(state.secrets.get('PERSONAL_API_KEY'), 'personal-test-key')
  assert.ok(!provider.calls.some(call => /bootstrap|runtime-credential|\/quota|\/models/.test(call.target)))
})

test('concurrent host requests share one rotating refresh operation', async () => {
  let refreshes = 0
  const state = harness(async () => { refreshes++; return Response.json({ access_token: 'renewed', refresh_token: 'rotated', token_type: 'Bearer', expires_in: 3600 }) })
  state.backend.discovery.set(profile.id, { tokenEndpoint: `${profile.oidc.issuer}/token` })
  const session = { issuer: profile.oidc.issuer, clientId: profile.oidc.clientId, accessToken: 'old', refreshToken: 'initial-refresh', expiresAt: 1, identity: { sub: 'user-1' } }
  await state.backend.saveSession(profile, session)
  const values = await Promise.all([state.backend.refresh(profile, session), state.backend.refresh(profile, session)])
  assert.equal(values[0].accessToken, 'renewed')
  assert.equal(values[1].refreshToken, 'rotated')
  assert.equal(refreshes, 1)
  await state.backend.refresh(profile, session)
  assert.equal(refreshes, 1, 'a late request must reuse the saved refreshed token')
})

function harness(fetch, config = {}) {
  const secrets = new Map()
  let route
  const ctx = {
    credentials: {
      async resolve(ref) { return secrets.has(ref) ? { value: secrets.get(ref) } : undefined },
      async set(ref, value) { secrets.set(ref, value) },
      async unset(ref) { secrets.delete(ref) },
    },
    webServer: {
      host: '127.0.0.1', port: 3080,
      register(value) { route = value; return () => { route = undefined } },
    },
    effect(install) { return install() },
    logger: { warn() {}, error() {} },
  }
  return { ctx, secrets, route: () => route, backend: new WebOidcBackend(ctx, new Map([[profile.id, profile]]), config, { fetch }) }
}

function jwt(privateKey, claims, headerClaims = {}) {
  const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const header = encoded({ alg: 'RS256', kid: 'acceptance-key', ...headerClaims })
  const body = encoded(claims)
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${body}`), privateKey).toString('base64url')
  return `${header}.${body}.${signature}`
}

function callbackResponse() {
  return {
    status: 0, headers: {}, ended: false,
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end() { this.ended = true },
  }
}

function providerFetch(options = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = publicKey.export({ format: 'jwk' })
  const calls = []
  let currentNonce = ''
  let subject = options.subject ?? 'user-1'
  const fetch = async (url, init = {}) => {
    const target = String(url)
    calls.push({ target, init })
    if (target.endsWith('/.well-known/openid-configuration')) return Response.json({
      issuer: profile.oidc.issuer,
      authorization_endpoint: 'https://authorize.example.net/oauth/authorize?tenant=example',
      token_endpoint: 'https://tokens.example.net/oauth/token',
      userinfo_endpoint: 'https://userinfo.example.net/oauth/userinfo',
      jwks_uri: 'https://keys.example.net/oauth/jwks.json',
      revocation_endpoint: 'https://tokens.example.net/oauth/revoke',
      code_challenge_methods_supported: ['S256'], id_token_signing_alg_values_supported: ['RS256'],
      authorization_response_iss_parameter_supported: options.requireIssuer === true,
    })
    if (target.startsWith('https://tokens.example.net/oauth/token')) {
      const accessToken = 'access-token'
      const atHash = createHash('sha256').update(accessToken).digest().subarray(0, 16).toString('base64url')
      return Response.json({
        access_token: accessToken, refresh_token: 'refresh-token', token_type: 'Bearer', expires_in: 3600,
        id_token: jwt(privateKey, {
          iss: profile.oidc.issuer, aud: options.audience ?? profile.oidc.clientId,
          ...(options.azp === undefined ? {} : { azp: options.azp }), sub: subject, nonce: currentNonce, at_hash: atHash,
          iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      })
    }
    if (target === 'https://keys.example.net/oauth/jwks.json') return Response.json({ keys: [{ ...jwk, kid: 'acceptance-key', use: 'sig', alg: 'RS256' }] })
    if (target === 'https://userinfo.example.net/oauth/userinfo') return Response.json({ sub: options.userInfoSubject ?? subject, name: options.name })
    if (target.endsWith('/oauth/revoke')) return new Response('', { status: 200 })
    throw new Error(`unexpected fetch ${target}`)
  }
  return { calls, fetch, setNonce(value) { currentNonce = value } }
}

test('explicit development HTTP Discovery stays on the exact allowlisted origin', async () => {
  const developmentProfile = normalizeEnterpriseProfile({
    ...raw,
    allowInsecureDevelopment: true,
    insecureDevelopmentOrigin: 'http://192.0.2.10',
    oidc: { ...raw.oidc, issuer: 'http://192.0.2.10' },
  })
  const ctx = {
    credentials: {},
    webServer: { host: '127.0.0.1', port: 3080, register() { return () => {} } },
    effect(install) { return install() },
    logger: { warn() {} },
  }
  const metadata = endpointOrigin => ({
    issuer: developmentProfile.oidc.issuer,
    authorization_endpoint: `${endpointOrigin}/oauth/authorize`,
    token_endpoint: `${endpointOrigin}/oauth/token`,
    userinfo_endpoint: `${endpointOrigin}/oauth/userinfo`,
    jwks_uri: `${endpointOrigin}/oauth/jwks`,
    code_challenge_methods_supported: ['S256'],
    id_token_signing_alg_values_supported: ['RS256'],
  })
  const allowed = new WebOidcBackend(ctx, new Map([[developmentProfile.id, developmentProfile]]), {}, {
    fetch: async () => Response.json(metadata('http://192.0.2.10')),
  })
  const begin = await allowed.begin(developmentProfile.id)
  assert.equal(new URL(begin.authorizationURL).origin, 'http://192.0.2.10')

  const rejected = new WebOidcBackend(ctx, new Map([[developmentProfile.id, developmentProfile]]), {}, {
    fetch: async () => Response.json(metadata('http://192.0.2.11')),
  })
  await assert.rejects(() => rejected.begin(developmentProfile.id), /exact development HTTP origin/)
})

test('multi-audience ID Tokens require azp to identify this client', async () => {
  const provider = providerFetch({ audience: [profile.oidc.clientId, 'other-client'], azp: 'other-client' })
  const state = harness(provider.fetch)
  const begin = await state.backend.begin(profile.id)
  const authorization = new URL(begin.authorizationURL)
  provider.setNonce(authorization.searchParams.get('nonce'))
  const response = callbackResponse()
  await state.route().handler({ url: `/oauth/callback?code=x&state=${authorization.searchParams.get('state')}` }, response)
  assert.match(response.headers.location, /oidc_id_token_invalid/)
  assert.equal(state.secrets.size, 0)
})

test('UserInfo subject must match the ID Token subject', async () => {
  const provider = providerFetch({ userInfoSubject: 'attacker' })
  const state = harness(provider.fetch)
  const begin = await state.backend.begin(profile.id)
  const authorization = new URL(begin.authorizationURL)
  provider.setNonce(authorization.searchParams.get('nonce'))
  const response = callbackResponse()
  await state.route().handler({ url: `/oauth/callback?code=x&state=${authorization.searchParams.get('state')}` }, response)
  assert.match(response.headers.location, /oidc_userinfo_invalid/)
  assert.equal(state.secrets.size, 0)
})

test('standard UserInfo name is preferred and management-plane subject data cannot overwrite it', async () => {
  const provider = providerFetch({ name: 'Alice Example' })
  const state = harness(provider.fetch)
  const begin = await state.backend.begin(profile.id)
  const authorization = new URL(begin.authorizationURL)
  provider.setNonce(authorization.searchParams.get('nonce'))
  const response = callbackResponse()
  await state.route().handler({ url: `/oauth/callback?code=x&state=${authorization.searchParams.get('state')}` }, response)
  const session = JSON.parse(state.secrets.get(sessionRef(profile)))
  assert.equal(session.identity.name, 'Alice Example')
  assert.notEqual(session.identity.sub, 'management-subject-must-not-overwrite-oidc')
})

test('callback rejects duplicate security parameters', async () => {
  const provider = providerFetch()
  const state = harness(provider.fetch)
  const begin = await state.backend.begin(profile.id)
  const authorization = new URL(begin.authorizationURL)
  provider.setNonce(authorization.searchParams.get('nonce'))
  const stateValue = authorization.searchParams.get('state')
  const response = callbackResponse()
  await state.route().handler({ url: `/oauth/callback?code=a&code=b&state=${stateValue}` }, response)
  assert.match(response.headers.location, /oidc_callback_invalid/)
})

test('Web callback is fixed to the IPv4 loopback origin and return URLs are fail-closed', () => {
  const ctx = { credentials: {}, webServer: { host: '0.0.0.0', port: 3080 }, effect() {}, logger: { warn() {} } }
  assert.throws(() => new WebOidcBackend(ctx, new Map([[profile.id, profile]]), {}, { fetch: async () => {} }), /exactly 127\.0\.0\.1/)
  const local = { ...ctx, webServer: { host: '127.0.0.1', port: 3080 } }
  assert.throws(() => new WebOidcBackend(local, new Map([[profile.id, profile]]), { publicBaseURL: 'https://dsh.example.edu' }, { fetch: async () => {} }), /does not accept publicBaseURL/)
  assert.throws(() => new WebOidcBackend(local, new Map([[profile.id, profile]]), { returnPath: 'https://evil.example/' }, { fetch: async () => {} }), /same-origin absolute path/)
  assert.throws(() => new WebOidcBackend({ ...ctx, webServer: { host: '127.0.0.1', port: 0 } }, new Map([[profile.id, profile]]), {}, { fetch: async () => {} }), /valid DSH WebServer port/)
})

test('Web management projects the trusted Enterprise Profile as a read-only provider card', async () => {
  const state = harness(providerFetch().fetch)
  const management = await state.backend.management()
  assert.equal(management.schemaVersion, 'dsh-oidc/management/v1alpha1')
  assert.equal(management.mode, 'profile')
  assert.deepEqual(management.capabilities, { manageProfiles: false, manageModels: false, restart: false })
  assert.equal(management.profiles[0].providerID, '')
  assert.equal(management.profiles[0].runtime.modelSource, 'none')
  assert.deepEqual(management.profiles[0].runtime.models, [])
  assert.throws(() => state.backend.configure(profile.id), error => error.code === 'oidc_management_unsupported')
})


for (const suffix of ['', '&iss=', '&iss=https://wrong.example', '&iss=https://id.example.edu&iss=https://id.example.edu']) {
  test('identity callback checks required issuer before exchanging the code: ' + suffix, async () => {
    const provider = providerFetch({ requireIssuer: true }), state = harness(provider.fetch)
    const auth = new URL((await state.backend.begin(profile.id)).authorizationURL)
    const response = callbackResponse()
    await state.route().handler({ url: '/oauth/callback?code=x&state=' + auth.searchParams.get('state') + suffix }, response)
    assert.match(response.headers.location, /oidc_callback_invalid/)
    assert.ok(!provider.calls.some(call => call.target.startsWith('https://tokens.example.net/oauth/token')))
  })
}
