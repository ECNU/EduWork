import assert from 'node:assert/strict'
import test from 'node:test'
import { deviceAuth, formatPairingLink, generateDeviceKey, newInvite, pairingCode, parsePairingLink, verifyAuth } from '../../src/protocol/auth.ts'
import { base64url, randomBytes } from '../../src/protocol/bytes.ts'

const hash = randomBytes(64)

test('the device key cannot be exported', async () => {
  const device = await generateDeviceKey()
  assert.equal(device.privateKey.extractable, false)
  await assert.rejects(crypto.subtle.exportKey('pkcs8', device.privateKey))
})

test('auth proves the device key for exactly this connection', async () => {
  const device = await generateDeviceKey()
  const frame = await deviceAuth(device, hash)
  assert.deepEqual(await verifyAuth(frame, hash), frame)
  assert.equal(await verifyAuth(frame, randomBytes(64)), undefined, 'replayed on another connection')
  const other = await deviceAuth(await generateDeviceKey(), hash)
  assert.equal(await verifyAuth({ ...frame, key: other.key }, hash), undefined, 'claimed another device key')
  assert.equal(await verifyAuth({ ...frame, sig: 'not base64!' }, hash), undefined)
  assert.equal(await verifyAuth({ ...frame, key: 42 }, hash), undefined)
})

test('first pairing carries the invite and a bounded device name', async () => {
  const device = await generateDeviceKey()
  const invite = newInvite()
  const frame = await deviceAuth(device, hash, { invite, name: 'iPhone' })
  assert.deepEqual(await verifyAuth(frame, hash), frame)
  assert.equal(await verifyAuth({ ...frame, name: 'x'.repeat(65) }, hash), undefined)
})

test('both ends derive the same six-digit pairing code from the handshake hash', async () => {
  const code = await pairingCode(hash)
  assert.match(code, /^\d{6}$/)
  assert.equal(await pairingCode(new Uint8Array(hash)), code)
  assert.notEqual(await pairingCode(randomBytes(64)), code)
})

test('pairing links keep the Host key and invite in the fragment', () => {
  const link = { hostId: base64url(randomBytes(32)), hostKey: randomBytes(32), invite: newInvite() }
  const url = new URL(formatPairingLink('https://relay.example/remote/', link))
  assert.equal(url.origin + url.pathname, 'https://relay.example/remote/')
  assert.deepEqual(parsePairingLink(url.hash), link)
  for (const broken of ['', '#a.b.c', `#${link.hostId}.${base64url(link.hostKey)}`, `${url.hash}.extra`, url.hash.replace(/.$/, '+')]) {
    assert.equal(parsePairingLink(broken), undefined, broken)
  }
})
