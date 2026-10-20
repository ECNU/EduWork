import assert from 'node:assert/strict'
import test from 'node:test'
import { utf8 } from '../../src/protocol/bytes.ts'
import { Channel, ChannelClosed, MAX_BACKLOG, MAX_FRAME } from '../../src/protocol/channel.ts'
import { Close } from '../../src/protocol/close-codes.ts'
import { generateKeyPair } from '../../src/protocol/noise.ts'
import { channelPair, hostKeys as host, hostPrologue as context, socketPair } from '../harness.ts'

const deadline = () => AbortSignal.timeout(2000)

test('frames cross in order, including frames larger than one Noise message', async () => {
  const { device, host } = await channelPair()
  assert.deepEqual(device.hash, host.hash)
  const big = new Uint8Array(300_000).map((_, i) => i % 251)
  device.send({ t: 'a', n: 1 })
  device.send({ t: 'b' }, big)
  device.send({ t: 'c' })
  assert.deepEqual((await host.receive()).header, { t: 'a', n: 1 })
  const second = await host.receive()
  assert.equal(second.header.t, 'b')
  assert.deepEqual(second.body, big)
  assert.equal((await host.receive()).header.t, 'c')
  host.send({ t: 'reply' })
  assert.equal((await device.receive()).header.t, 'reply')
})

test('frames that arrived before a close are still read, then the close reason', async () => {
  const { device, host } = await channelPair()
  host.send({ t: 'rejected' })
  host.close(Close.forbidden, 'rejected')
  assert.equal((await device.receive()).header.t, 'rejected')
  await assert.rejects(device.receive(), (error: ChannelClosed) => error instanceof ChannelClosed && error.code === Close.forbidden)
  assert.ok(device.signal.aborted)
})

test('the wrong Host key fails the handshake on both ends', async () => {
  const [a, b] = socketPair()
  const impostor = generateKeyPair()
  const results = await Promise.allSettled([
    Channel.connect(a, impostor.publicKey, context, deadline()),
    Channel.accept(b, host, context, deadline()),
  ])
  assert.deepEqual(results.map(r => r.status), ['rejected', 'rejected'])
  assert.equal(b.closed?.code, Close.protocolError)
})

test('a handshake that never completes times out', async () => {
  const [, b] = socketPair()
  await assert.rejects(Channel.accept(b, host, context, AbortSignal.timeout(20)), ChannelClosed)
  assert.equal(b.closed?.code, Close.timeout)
})

test('an altered message or a stray text message closes the channel as a protocol error', async () => {
  const altered = await channelPair()
  altered.sockets[0].tamper = bytes => (bytes[bytes.length - 1]! ^= 1, bytes)
  altered.device.send({ t: 'x' })
  await assert.rejects(altered.host.receive(), (error: ChannelClosed) => error.code === Close.protocolError)

  const text = await channelPair()
  ;(text.sockets[0] as { send(data: string): void }).send('{"t":"open"}')
  await assert.rejects(text.host.receive(), (error: ChannelClosed) => error.code === Close.protocolError)
})

test('a peer that stops reading is cut off once the backlog limit is exceeded', async () => {
  const { device, host, sockets } = await channelPair()
  sockets[1].stalled = true
  const frame = new Uint8Array(MAX_FRAME - 64)
  for (let sent = 0; sent <= MAX_BACKLOG && !host.signal.aborted; sent += frame.byteLength) host.send({ t: 'bulk' }, frame)
  assert.equal((host.signal.reason as ChannelClosed).code, Close.overLimit)
  await assert.rejects(device.receive(), ChannelClosed)
})

test('oversized frames are refused before anything is sent', async () => {
  const { device } = await channelPair()
  assert.throws(() => device.send({ t: 'x' }, new Uint8Array(MAX_FRAME)), RangeError)
  device.send({ t: 'after' }, utf8('still usable'))
})

test('sending on a closed channel is a silent no-op', async () => {
  const { device } = await channelPair()
  device.close()
  device.send({ t: 'late' })
  await assert.rejects(device.drained(), ChannelClosed)
})
