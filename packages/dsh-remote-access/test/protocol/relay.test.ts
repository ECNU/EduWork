import assert from 'node:assert/strict'
import test from 'node:test'
import { base64url, randomBytes } from '../../src/protocol/bytes.ts'
import { hostIdOf, parseControl, relayBase, signRegistration, verifyRegistration } from '../../src/protocol/relay.ts'

const relay = 'https://example.edu/remote/'

test('a registration verifies only for its Host id, relay and nonce', async () => {
  const { publicKey, privateKey } = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']) as CryptoKeyPair
  const hostId = await hostIdOf(publicKey)
  const nonce = base64url(randomBytes(32))
  const sig = await signRegistration(privateKey, relay, nonce)
  assert.equal(await verifyRegistration(hostId, relay, nonce, sig), true)
  assert.equal(await verifyRegistration(hostId, relay, base64url(randomBytes(32)), sig), false, 'replayed against a new nonce')
  assert.equal(await verifyRegistration(hostId, 'https://other-relay.example/', nonce, sig), false, 'forwarded to another relay')
  assert.equal(await verifyRegistration(hostId, 'https://example.edu/other/', nonce, sig), false, 'forwarded to another relay on the same domain')
  const other = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair
  assert.equal(await verifyRegistration(await hostIdOf(other.publicKey), relay, nonce, sig), false, 'claimed another Host id')
  assert.equal(await verifyRegistration('short', relay, nonce, sig), false)
  assert.equal(await verifyRegistration(hostId, relay, nonce, 'bad signature'), false)
})

test('control messages are JSON objects with a string type', () => {
  assert.deepEqual(parseControl('{"t":"open"}'), { t: 'open' })
  for (const text of ['', 'null', '[]', '{"t":1}', '{}', 'not json']) assert.equal(parseControl(text), undefined, text)
})

test('a relay address becomes the base URL every part uses', () => {
  for (const [address, base] of [
    ['https://remote.example.edu', 'https://remote.example.edu/'],
    ['https://example.edu/eduwork-remote', 'https://example.edu/eduwork-remote/'],
    ['https://example.edu/eduwork-remote/', 'https://example.edu/eduwork-remote/'],
    ['http://127.0.0.1:8787', 'http://127.0.0.1:8787/'],
  ]) assert.equal(relayBase(address!), base, address)
  for (const address of ['', 'remote.example.edu', 'ftp://example.edu/', 'https://user:secret@example.edu/', 'https://example.edu/?key=x', 'https://example.edu/#x']) {
    assert.equal(relayBase(address), undefined, address)
  }
})
