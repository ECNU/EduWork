import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import test from 'node:test'
import { Context, Service } from '@deepseek-ai/cordis'
import { WebServer } from '@deepseek-ai/dsh-host-webserver'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import OidcAccountService from '../src/host/index.js'

for (const protocolVersion of ['worker.user-center.v1', 'worker-user-center/v1', 'eduwork-resources/v1']) {
test(`real DSH Host + HTTP OIDC callback connects ${protocolVersion}, discovers models without any implicit quota request`, async t => {
  const credentials = new Map([['PERSONAL_API_KEY', 'personal-key']])
  class Credentials extends Service {
    constructor(ctx) { super(ctx, 'credentials') }
    resolve(ref) { return Promise.resolve(credentials.has(ref) ? { value: credentials.get(ref) } : undefined) }
    set(ref, value) { credentials.set(ref, value); return Promise.resolve() }
    unset(ref) { credentials.delete(ref); return Promise.resolve() }
  }
  const ctx = new Context()
  const accountEvents = []
  ctx.on('oidc/accounts-changed', value => accountEvents.push(value))
  const fibers = []
  t.after(async () => { for (const fiber of fibers.reverse()) await fiber.dispose() })
  fibers.push(await ctx.plugin(LlmRuntime))
  fibers.push(await ctx.plugin(Credentials))
  fibers.push(await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 }))
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = publicKey.export({ format: 'jwk' })
  let origin
  let nonce
  let runtimeActive = false
  let bootstrapVersion = protocolVersion
  let bootstrapProvider = 'local-ai'
  const requests = []
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, origin)
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString('utf8')
    requests.push({ path: url.pathname, auth: req.headers.authorization, body })
    const json = value => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)) }
    if (url.pathname === '/.well-known/openid-configuration') return json({
      issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`,
      userinfo_endpoint: `${origin}/userinfo`, jwks_uri: `${origin}/jwks`,
      code_challenge_methods_supported: ['S256'], id_token_signing_alg_values_supported: ['RS256'],
    })
    if (url.pathname === '/authorize') {
      nonce = url.searchParams.get('nonce')
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
      const target = new URL(url.searchParams.get('redirect_uri'))
      target.searchParams.set('code', 'test-code'); target.searchParams.set('state', url.searchParams.get('state'))
      res.writeHead(302, { location: target.toString() }); res.end(); return
    }
    if (url.pathname === '/token') {
      const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url')
      const header = encoded({ alg: 'RS256', kid: 'host-test' })
      const payload = encoded({ iss: origin, aud: 'local-public-client', sub: 'test-user', nonce,
        iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600,
        at_hash: createHash('sha256').update('access-token').digest().subarray(0, 16).toString('base64url'),
      })
      const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url')
      return json({ access_token: 'access-token', token_type: 'Bearer', expires_in: 3600, id_token: `${header}.${payload}.${signature}` })
    }
    if (url.pathname === '/jwks') return json({ keys: [{ ...jwk, kid: 'host-test', use: 'sig', alg: 'RS256' }] })
    if (url.pathname === '/userinfo') return json({ sub: 'test-user', name: 'Test user' })
    if (url.pathname === '/management/bootstrap') return json({ protocol_version: bootstrapVersion, provider: { id: bootstrapProvider }, capabilities: ['quota.read'], runtime_credential: { status: runtimeActive ? 'active' : 'missing', provisioning: { allowed: true } } })
    if (url.pathname.startsWith('/management/runtime-credential/')) { runtimeActive = true; return json({ provider_id: 'local-ai', api_key: 'managed-key', status: 'active' }) }
    if (url.pathname === '/v1/models') return json({ data: [{ id: 'local-chat-model' }] })
    if (url.pathname === '/v1/quota') return json({ provider_id: 'local-ai', unit: 'credits', windows: [{ type: 'fixed_168h', limit: 100, remaining: 90, used: 10 }] })
    if (url.pathname === '/v1/chat/completions') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.end('data: {"choices":[{"delta":{"role":"assistant","content":"host-ok"},"index":0,"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\ndata: [DONE]\n\n'); return
    }
    res.writeHead(404); res.end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  origin = `http://127.0.0.1:${server.address().port}`
  fibers.push(await ctx.plugin(OidcAccountService, { backend: 'web', profile: {
    schemaVersion: 'dsh-oidc/v1alpha1', id: 'local-org', displayName: 'Local organization', allowInsecureDevelopment: true,
    oidc: { issuer: origin, clientId: 'local-public-client', scopes: ['openid', 'profile'] },
    keyBinding: { type: 'eduwork-resources-v1', baseURL: `${origin}/management` },
    provider: { id: 'local-ai', adapter: 'openai-compatible', baseURL: `${origin}/v1`, modelSource: 'discovery' },
  } }))
  assert.deepEqual(ctx.llm.listProviders(), [])
  const begin = await ctx.oidcAccounts.begin('local-org')
  const authorization = await fetch(begin.authorizationURL, { redirect: 'manual' })
  const callback = await fetch(authorization.headers.get('location'), { redirect: 'manual' })
  assert.match(callback.headers.get('location'), /credential-required/)
  // An authenticated identity must survive incompatible resource responses, and
  // neither invalid response may create or resolve a model credential.
  bootstrapVersion = 'eduwork-resources/v999'
  await assert.rejects(ctx.oidcAccounts.reconcile('local-org', { allowProvision: true }), error =>
    error.code === 'oidc_binding_invalid' && error.message.includes('身份登录已完成') && error.message.includes('协议版本'))
  bootstrapVersion = protocolVersion
  bootstrapProvider = 'another-provider'
  await assert.rejects(ctx.oidcAccounts.reconcile('local-org', { allowProvision: true }), error =>
    error.code === 'oidc_binding_invalid' && error.message.includes('Provider ID'))
  assert.equal((await ctx.oidcAccounts.status('local-org')).state, 'authenticated')
  assert.equal(credentials.has('EDUWORK_API_KEY'), false)
  assert.equal(requests.some(row => row.path.startsWith('/management/runtime-credential/')), false)
  bootstrapProvider = 'local-ai'
  assert.equal((await ctx.oidcAccounts.reconcile('local-org', { allowProvision: true })).state, 'connected')
  assert.equal((await ctx.llm.listModels('local-ai'))[0].id, 'local-chat-model')
  assert.equal(Object.hasOwn(await ctx.oidcAccounts.resources('local-org'), 'quota'), false)
  assert.equal(requests.some(row => row.path === '/v1/quota'), false)
  for await (const chunk of ctx.llm.stream({ provider: 'local-ai', model: 'local-chat-model', messages: [] })) {}
  assert.equal(requests.find(row => row.path.endsWith('/chat/completions')).auth, 'Bearer managed-key')
  assert.ok(requests.filter(row => row.path.startsWith('/management')).every(row => row.auth === 'Bearer access-token'))
  assert.ok(requests.filter(row => row.path.startsWith('/v1/')).every(row => row.auth === 'Bearer managed-key'))
  assert.equal(JSON.stringify(await ctx.oidcAccounts.configuration()).includes('managed-key'), false)
  await ctx.oidcAccounts.logout('local-org')
  assert.equal(credentials.get('PERSONAL_API_KEY'), 'personal-key')
  assert.equal(credentials.has('EDUWORK_API_KEY'), false)
  assert.deepEqual(accountEvents.map(event => event.state), ['authenticated', 'connected', 'signed_out'])
  const modelRequests = requests.filter(row => row.path.endsWith('/chat/completions')).length
  const afterLogout = []
  for await (const chunk of ctx.llm.stream({ provider: 'local-ai', model: 'local-chat-model', messages: [] })) afterLogout.push(chunk)
  assert.ok(afterLogout.some(chunk => chunk.type === 'finish' && chunk.reason?.kind === 'error'), 'logged-out enterprise requests must fail')
  assert.equal(requests.filter(row => row.path.endsWith('/chat/completions')).length, modelRequests, 'no revoked local key may reach the gateway')
  assert.ok(accountEvents.every(event => event.profileID === 'local-org' && Object.keys(event).length === 2))
})
}
