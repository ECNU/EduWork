import assert from 'node:assert/strict'
import test from 'node:test'
import { callNativeBridge } from '../lib/client.js'
import { nativeRecordRef, normalizeCredentialRecord } from '../lib/records.js'

test('native bridge client keeps token in the authorization header', async () => {
  let observed
  const result = await callNativeBridge(
    { baseURL: 'http://127.0.0.1:1234', token: 'private-token' },
    'resolve',
    { ref: 'TEST_API_KEY' },
    async (url, init) => {
      observed = { url, init }
      return new Response(JSON.stringify({ configured: true, source: 'vault', value: 'secret' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  )
  assert.equal(result.value, 'secret')
  assert.equal(observed.init.headers.authorization, 'Bearer private-token')
  assert.equal(observed.init.body, '{"ref":"TEST_API_KEY"}')
})

test('native errors do not expose response bodies', async () => {
  await assert.rejects(
    callNativeBridge(
      { baseURL: 'http://127.0.0.1:1234', token: 'private-token' },
      'set',
      { ref: 'TEST_API_KEY', value: 'secret' },
      async () => new Response('secret-bearing backend detail', { status: 500 }),
    ),
    error => !String(error).includes('secret-bearing'),
  )
})

test('credential records map to stable native-vault references', () => {
  const first = nativeRecordRef('client-connection/browser-session')
  const second = nativeRecordRef('client-connection/browser-session')
  assert.equal(first, second)
  assert.match(first, /^DSH_CREDENTIAL_RECORD_[A-F0-9]{64}$/)
  assert.throws(() => nativeRecordRef('Client Connection/browser session'))
})

test('credential records preserve grants and validate api-key environments', () => {
  assert.deepEqual(
    normalizeCredentialRecord('client-connection/browser-session', {
      kind: 'grant',
      payload: { version: 1, secret: 'opaque' },
    }),
    { kind: 'grant', payload: { version: 1, secret: 'opaque' } },
  )
  assert.deepEqual(
    normalizeCredentialRecord('llm-pi-ai/campus', {
      kind: 'api-key',
      key: 'secret',
      env: { AWS_PROFILE: 'campus' },
    }),
    { kind: 'api-key', key: 'secret', env: { AWS_PROFILE: 'campus' } },
  )
  assert.throws(() => normalizeCredentialRecord('llm-pi-ai/campus', {
    kind: 'api-key',
    env: { 'not valid': 'value' },
  }))
})
