import assert from 'node:assert/strict'
import test from 'node:test'
import { signIn } from '../src/client/login-flow.js'
import { TYPERT } from '../src/host/typert.host.js'
import { TYPERT_REMOTE } from '../src/host/typert.remote-client.js'

test('optional consent uses the existing external login polling and cancellation without a normal login', async () => {
  const seen = [], status = { profileID: 'example', state: 'connected', credentialReady: true }
  const service = {
    begin() { throw Error('Optional consent must not silently fall back to regular login') },
    async beginAuthorization(...args) { seen.push(args); return { mode: 'external', loginID: 'consent', expiresAt: new Date(Date.now() + 1000).toISOString() } },
    async loginStatus() { return { state: 'completed', status } },
    async status() { return status },
    async cancelLogin(id) { seen.push(id) },
  }
  assert.deepEqual(await signIn(service, 'example', { scopes: ['feature.read'] }), status)
  const controller = new AbortController(); controller.abort()
  assert.deepEqual(await signIn(service, 'example', { scopes: ['feature.read'], signal: controller.signal }), status)
  assert.deepEqual(seen, [['example', ['feature.read']], ['example', ['feature.read']], 'consent'])
})

test('both RPC faces validate optional scopes and project only non-secret authorization state', () => {
  for (const descriptors of [TYPERT.invocations, TYPERT_REMOTE.descriptors]) {
    const begin = descriptors.find(item => item.method === 'beginAuthorization')
    const scopes = begin.parameters[1].codec.create()
    assert.deepEqual(scopes.parse(['feature.read']), ['feature.read'])
    for (const value of [[], ['a', 'a'], ['a b'], { scopes: ['a'] }, ['x'.repeat(129)]]) assert.equal(scopes.safeParse(value).success, false)
    const result = descriptors.find(item => item.method === 'authorization').result.create()
    const state = { profileID: 'example', supported: true, required: ['openid'], optional: ['feature.read'], available: [], granted: ['openid'] }
    assert.deepEqual(result.parse(state), state)
    assert.equal(result.safeParse({ ...state, accessToken: 'synthetic-secret' }).success, false)
  }
})
