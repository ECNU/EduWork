import assert from 'node:assert/strict'
import test from 'node:test'
import { utf8 } from '../../src/protocol/bytes.ts'
import { generateKeyPair, initiate, prologue, respond } from '../../src/protocol/noise.ts'

const host = generateKeyPair()
const context = prologue('relay', 'host-id')

test('IK handshake pins the Host key and yields one shared transcript hash', () => {
  const device = initiate(host.publicKey, context)
  const { reply, session: hostSession } = respond(host, context, device.message)
  const deviceSession = device.finish(reply)
  assert.deepEqual(deviceSession.hash, hostSession.hash)
  assert.equal(deviceSession.hash.byteLength, 64)
  assert.deepEqual(hostSession.decrypt(deviceSession.encrypt(utf8('ping'))), utf8('ping'))
  assert.deepEqual(deviceSession.decrypt(hostSession.encrypt(utf8('pong'))), utf8('pong'))
})

test('a device holding the wrong Host key or prologue cannot complete the handshake', () => {
  const impostor = generateKeyPair()
  assert.throws(() => respond(host, context, initiate(impostor.publicKey, context).message))
  assert.throws(() => respond(host, context, initiate(host.publicKey, prologue('relay', 'other-host')).message))
  // A Host answering with a different static key fails on the device.
  const device = initiate(host.publicKey, context)
  const forged = respond(impostor, context, initiate(impostor.publicKey, context).message)
  assert.throws(() => device.finish(forged.reply))
})

test('transport messages cannot be replayed, reordered or altered', () => {
  const device = initiate(host.publicKey, context)
  const { reply, session: hostSession } = respond(host, context, device.message)
  const deviceSession = device.finish(reply)
  const first = deviceSession.encrypt(utf8('one')), second = deviceSession.encrypt(utf8('two'))
  assert.throws(() => hostSession.decrypt(second))
  hostSession.decrypt(first)
  assert.throws(() => hostSession.decrypt(first))
  const altered = new Uint8Array(second)
  altered[0]! ^= 1
  assert.throws(() => hostSession.decrypt(altered))
})

test('two connections to the same Host derive unrelated hashes', () => {
  const hashes = [0, 1].map(() => {
    const device = initiate(host.publicKey, context)
    return device.finish(respond(host, context, device.message).reply).hash
  })
  assert.notDeepEqual(hashes[0], hashes[1])
})
