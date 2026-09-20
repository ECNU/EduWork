import assert from 'node:assert/strict'
import { request } from 'node:http'
import test from 'node:test'
import { DesktopOidcBackend } from '../src/host/desktop-oidc.js'
import { fixture } from './helpers/desktop-fixture.js'
import { beginResult, loginResult } from '../src/host/typert-schemas.js'
import { signIn } from '../src/client/login-flow.js'

async function assertClosed(url) {
  await assert.rejects(fetch(url, { signal: AbortSignal.timeout(1000) }))
}

test('desktop temporary HTTP callback validates PKCE and stores only through host credentials', async t => {
  const f = await fixture(t)
  assert.equal(f.backend.attempts.size, 0)
  const { begin, callback } = await f.authorization()
  assert.equal(begin.mode, 'external')
  assert.equal(beginResult.schema.safeParse(begin).success, true)
  assert.equal(JSON.stringify(begin).includes('authorizationURL'), false)
  assert.equal(JSON.stringify(begin).includes(new URL(f.opened[0]).searchParams.get('state')), false)
  assert.equal((await fetch(callback)).status, 200)
  const result = f.backend.loginStatus(begin.loginID)
  assert.equal(result.state, 'completed')
  assert.equal(result.status.state, 'connected')
  assert.equal(loginResult.schema.safeParse(result).success, true)
  assert.equal(JSON.stringify(result).includes('<ACCESS_TOKEN>'), false)
  assert.equal(f.records.has('DSH_OIDC_DESKTOP_TEST_SESSION'), true)
  assert.equal(f.tokenCalls(), 1)
  await assertClosed(callback)
  await f.backend.logout(f.profile.id)
  assert.deepEqual([...f.records.keys()], ['PERSONAL_API_KEY'])
})

test('invalid Host, foreign Origin, method, URL and state do not consume a valid attempt', async t => {
  const f = await fixture(t)
  const { begin, callback } = await f.authorization()
  const wrong = new URL(callback); wrong.searchParams.set('state', 'wrong')
  const duplicate = new URL(callback); duplicate.searchParams.append('state', duplicate.searchParams.get('state'))
  for (const [url, init] of [[wrong], [duplicate], [callback, { headers: { origin: 'https://untrusted.example' } }],
    [callback, { method: 'POST' }], [new URL('/other', callback)]]) {
    assert.equal((await fetch(url, init)).status, 400)
  }
  const wrongHostStatus = await new Promise((resolve, reject) => {
    const req = request(callback, { headers: { host: 'untrusted.example' } }, response => { response.resume(); resolve(response.statusCode) })
    req.once('error', reject); req.end()
  })
  assert.equal(wrongHostStatus, 400)
  assert.equal(f.backend.loginStatus(begin.loginID).state, 'pending')
  assert.equal(f.tokenCalls(), 0)
  assert.equal((await fetch(callback)).status, 200)
})

test('wrong ID-token nonce fails without persisting a session or exposing server details', async t => {
  const f = await fixture(t, { wrongNonce: true })
  const { begin, callback } = await f.authorization()
  const response = await fetch(callback)
  assert.equal(response.status, 400)
  assert.equal(f.backend.loginStatus(begin.loginID).state, 'failed')
  assert.equal(f.backend.loginStatus(begin.loginID).errorCode, 'oidc_id_token_invalid')
  assert.deepEqual([...f.records.keys()], ['PERSONAL_API_KEY'])
  assert.equal(JSON.stringify(f.warnings).includes('<ACCESS_TOKEN>'), false)
  await assertClosed(callback)
})

test('cancellation, expiry, logout and disposal close temporary ports', async t => {
  const f = await fixture(t, { config: { flowTimeoutMs: 1000 } })
  for (const operation of ['cancel', 'expire', 'logout', 'dispose']) {
    const { begin, callback } = await f.authorization()
    if (operation === 'cancel') await f.backend.cancelLogin(begin.loginID)
    if (operation === 'expire') await new Promise(resolve => setTimeout(resolve, 1050))
    if (operation === 'logout') await f.backend.logout(f.profile.id)
    if (operation === 'dispose') await f.backend.dispose()
    assert.equal(f.backend.loginStatus(begin.loginID).state, operation === 'expire' ? 'expired' : 'cancelled')
    await assertClosed(callback)
  }
  assert.equal(f.backend.flows.size, 0)
  assert.deepEqual([...f.records.keys()], ['PERSONAL_API_KEY'])
})

test('cancel during token exchange cannot resurrect a login', async t => {
  let release
  let reached
  const tokenPending = new Promise(resolve => { reached = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const f = await fixture(t, { beforeToken: async () => { reached(); await gate } })
  const { begin, callback } = await f.authorization()
  const response = fetch(callback).catch(() => {})
  await tokenPending
  const cancellation = f.backend.cancelLogin(begin.loginID)
  release()
  await cancellation; await response
  assert.equal(f.backend.loginStatus(begin.loginID).state, 'cancelled')
  assert.deepEqual([...f.records.keys()], ['PERSONAL_API_KEY'])
  await assertClosed(callback)
})

test('cancel during an asynchronous vault write restores previous credentials', async t => {
  let release
  let reached
  const storing = new Promise(resolve => { reached = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const f = await fixture(t, { beforeStore: async () => { reached(); await gate } })
  const { begin, callback } = await f.authorization()
  const response = fetch(callback).catch(() => {})
  await storing
  const cancellation = f.backend.cancelLogin(begin.loginID)
  release()
  await cancellation; await response
  assert.deepEqual([...f.records.keys()], ['PERSONAL_API_KEY'])
  assert.equal(f.events.length, 0)
})

test('rejects unsafe discovery and configured callback host without opening a browser', async t => {
  const f = await fixture(t, { authorizationEndpoint: 'http://untrusted.example/authorize' })
  await assert.rejects(f.backend.begin(f.profile.id), { code: 'oidc_discovery_invalid' })
  assert.equal(f.opened.length, 0)
  assert.equal(f.backend.attempts.size, 0)
  assert.throws(() => new DesktopOidcBackend(f.ctx, new Map(), { host: '0.0.0.0' }), /unsupported/)
})

test('browser open failure is sanitized and releases its callback listener', async t => {
  let authorization
  const f = await fixture(t, { openExternal: async url => { authorization = url; throw new Error('unsafe URL details') } })
  await assert.rejects(f.backend.begin(f.profile.id), { code: 'oidc_browser_unavailable', message: 'The sign-in browser could not be opened' })
  await assertClosed(new URL(authorization).searchParams.get('redirect_uri'))
})

test('desktop client waits for safe results, supports cancellation and leaves the renderer in place', async () => {
  const begin = { mode: 'external', loginID: 'opaque-id', expiresAt: new Date(Date.now() + 5000).toISOString() }
  const status = { profileID: 'example', state: 'connected' }
  let calls = 0; let cancelled = 0; let navigated = false
  const service = { begin: async () => begin, loginStatus: async () => ++calls === 1 ? { state: 'pending' } : { state: 'completed', status },
    cancelLogin: async () => { cancelled++ }, status: async () => ({ state: 'signed_out' }) }
  assert.equal(await signIn(service, 'example', { interval: 1, redirect: () => { navigated = true } }), status)
  assert.equal(navigated, false); assert.equal(cancelled, 0)
  const controller = new AbortController(); controller.abort()
  assert.deepEqual(await signIn(service, 'example', { signal: controller.signal }), { state: 'signed_out' })
  assert.equal(cancelled, 1)
})

test('desktop sign-in distinguishes issuer configuration failure from a retryable sign-in failure', async () => {
  for (const errorCode of ['gateway_callback_issuer_missing', 'gateway_callback_issuer_invalid', 'oidc_authorization_rejected']) {
    const service = {
      begin: async () => ({ mode: 'external', loginID: 'synthetic-login', expiresAt: new Date(Date.now() + 5000).toISOString() }),
      loginStatus: async () => ({ state: 'failed', errorCode }), cancelLogin: async () => {},
    }
    await assert.rejects(signIn(service, 'example'), error => {
      assert.equal(error.code, errorCode)
      assert.match(error.message, errorCode.startsWith('gateway_') ? /Contact your administrator/ : /Please try again/)
      return true
    })
  }
})
