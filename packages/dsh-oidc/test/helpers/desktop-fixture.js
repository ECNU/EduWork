import { createServer } from 'node:http'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { DesktopOidcBackend } from '../../src/host/desktop-oidc.js'
import { normalizeEnterpriseProfile } from '../../src/host/profile.js'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' }
const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const closed = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections() })

export async function fixture(t, options = {}) {
  const records = new Map([['PERSONAL_API_KEY', '<PERSONAL_KEY>']])
  const effects = []
  const events = []
  const opened = []
  const warnings = []
  const codes = new Map()
  const requests = []
  let tokenCalls = 0
  let credentialReady = false
  let origin
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, origin)
    requests.push({ path: url.pathname, method: req.method })
    const json = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)) }
    if (url.pathname === '/.well-known/openid-configuration') return json({ issuer: origin,
      authorization_endpoint: options.authorizationEndpoint ?? `${origin}/authorize`, token_endpoint: `${origin}/token`,
      userinfo_endpoint: `${origin}/userinfo`, jwks_uri: `${origin}/jwks`, code_challenge_methods_supported: ['S256'],
    })
    if (url.pathname === '/authorize') {
      const code = String(codes.size + 1)
      codes.set(code, Object.fromEntries(url.searchParams))
      const target = new URL(url.searchParams.get('redirect_uri'))
      target.searchParams.set('state', url.searchParams.get('state')); target.searchParams.set('code', code)
      target.searchParams.set('iss', origin)
      res.writeHead(302, { location: target.toString() }); res.end(); return
    }
    if (url.pathname === '/token') {
      tokenCalls++
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const body = new URLSearchParams(Buffer.concat(chunks).toString())
      const authorize = codes.get(body.get('code'))
      const challenge = createHash('sha256').update(body.get('code_verifier')).digest('base64url')
      if (!authorize || authorize.code_challenge !== challenge || body.get('redirect_uri') !== authorize.redirect_uri) return json({ error: 'invalid_grant' }, 400)
      await options.beforeToken?.()
      const header = encoded({ alg: 'RS256', kid: 'test-key' })
      const payload = encoded({ iss: origin, aud: 'desktop-test', sub: 'synthetic-user',
        nonce: options.wrongNonce ? 'wrong-nonce' : authorize.nonce,
        iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600,
      })
      const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url')
      return json({ access_token: '<ACCESS_TOKEN>', token_type: 'Bearer', expires_in: 3600, id_token: `${header}.${payload}.${signature}` })
    }
    if (url.pathname === '/jwks') return json({ keys: [jwk] })
    if (url.pathname === '/userinfo') return json({ sub: 'synthetic-user', name: 'Synthetic user' })
    if (options.resources && url.pathname === '/management/bootstrap') return json({ protocol_version: 'worker.user-center.v1', provider: { id: 'fixture-ai' },
      runtime_credential: { status: credentialReady ? 'active' : 'missing', provisioning: { allowed: true } } })
    if (options.resources && url.pathname.startsWith('/management/runtime-credential/')) {
      if (req.headers.authorization !== 'Bearer <ACCESS_TOKEN>') return json({ error: 'unauthorized' }, 401)
      credentialReady = true
      return json({ provider_id: 'fixture-ai', status: 'active', api_key: 'fixture-managed-key' })
    }
    if (options.resources && url.pathname.startsWith('/v1/')) {
      if (req.headers.authorization !== 'Bearer fixture-managed-key') return json({ error: 'unauthorized' }, 401)
      if (url.pathname === '/v1/models') return json({ data: [{ id: 'fixture-model', name: 'Fixture model' }] })
      if (url.pathname === '/v1/quota') { await options.beforeQuota?.(); return json(options.quota ?? { provider_id: 'fixture-ai', unit: 'credits', windows: [{ type: 'fixed_168h', limit: 100, used: 10, remaining: 90 }] }) }
      if (url.pathname === '/v1/chat/completions') {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.end('data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"fixture-ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
        return
      }
    }
    res.writeHead(404); res.end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => closed(server))
  origin = `http://127.0.0.1:${server.address().port}`
  const rawProfile = { schemaVersion: 'dsh-oidc/v1alpha1', id: 'desktop-test', displayName: 'Example organization', brand: options.brand ?? {}, allowInsecureDevelopment: true,
    oidc: { issuer: origin, clientId: 'desktop-test', scopes: ['openid', 'profile'] },
    ...(options.resources ? { keyBinding: { type: 'eduwork-resources-v1', baseURL: `${origin}/management` },
      provider: { id: 'fixture-ai', adapter: 'openai-compatible', baseURL: `${origin}/v1`, modelSource: 'discovery' } } : {}),
  }
  const profile = normalizeEnterpriseProfile(rawProfile)
  const ctx = {
    credentials: {
      resolve: async ref => records.has(ref) ? { value: records.get(ref) } : undefined,
      set: async (ref, value) => { await options.beforeStore?.(); records.set(ref, value) },
      unset: async ref => { records.delete(ref) },
    },
    effect: install => { effects.push(install()) }, logger: { warn: (...args) => warnings.push(args) },
  }
  const openExternal = options.openExternal ?? (async url => { opened.push(url) })
  const backend = new DesktopOidcBackend(ctx, new Map([[profile.id, profile]]), options.config, { openExternal, accountChanged: status => events.push(status) })
  t.after(() => backend.dispose())
  return { ctx, backend, profile, rawProfile, records, events, opened, warnings, origin, effects, requests, tokenCalls: () => tokenCalls,
    async authorization() { const begin = await backend.begin(profile.id); const auth = await fetch(opened.at(-1), { redirect: 'manual' }); return { begin, callback: auth.headers.get('location') } },
  }
}
