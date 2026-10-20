import assert from 'node:assert/strict'
import test from 'node:test'
import { base64url, randomBytes } from '../../src/protocol/bytes.ts'
import { hostIdOf, parseControl, signRegistration, verifyRegistration } from '../../src/protocol/relay.ts'

const origin = 'https://relay.example'

test('a registration verifies only for its Host id, relay origin and nonce', async () => {
  const { publicKey, privateKey } = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']) as CryptoKeyPair
  const hostId = await hostIdOf(publicKey)
  const nonce = base64url(randomBytes(32))
  const sig = await signRegistration(privateKey, origin, nonce)
  assert.equal(await verifyRegistration(hostId, origin, nonce, sig), true)
  assert.equal(await verifyRegistration(hostId, origin, base64url(randomBytes(32)), sig), false, 'replayed against a new nonce')
  assert.equal(await verifyRegistration(hostId, 'https://other-relay.example', nonce, sig), false, 'forwarded to another relay')
  const other = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair
  assert.equal(await verifyRegistration(await hostIdOf(other.publicKey), origin, nonce, sig), false, 'claimed another Host id')
  assert.equal(await verifyRegistration('short', origin, nonce, sig), false)
  assert.equal(await verifyRegistration(hostId, origin, nonce, 'bad signature'), false)
})

test('control messages are JSON objects with a string type', () => {
  assert.deepEqual(parseControl('{"t":"open"}'), { t: 'open' })
  for (const text of ['', 'null', '[]', '{"t":1}', '{}', 'not json']) assert.equal(parseControl(text), undefined, text)
})
