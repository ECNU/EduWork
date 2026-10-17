/**
 * The whole path over a real handshake.
 *
 * `stream-link.test.mjs` runs the carrier over a pair of `Session`s built from fixed
 * bytes, which is the right way to test framing but proves nothing about where those
 * sessions came from. This file removes the last stub: two real handshakes run to
 * completion — the device's `PeerHandshake` against the host's `HostHandshake`, with
 * generated P-256 identities and a device resolved from a registry — and the
 * sessions they negotiate are what carries the calls and the streams.
 *
 * So nothing between the two ends is substituted. A device that sends a call is
 * sealed with a key derived from an ephemeral ECDH exchange over a transcript both
 * sides signed, and the host opens it with the mirror key. If the transcript order,
 * the direction, the key derivation or the sequence handling were wrong, this file
 * would fail rather than the framing tests.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { encodePublicKey, generateIdentity } from '../src/channel/crypto.js'
import { HostHandshake, PeerHandshake } from '../src/channel/handshake.js'
import { RemoteChannel } from '../src/stream/channel.js'
import { DeviceLink } from '../src/stream/link.js'
import { RemoteError, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'

/** The Gateway's failure mapper, transcribed from `rpcFailure`. */
const toWireFailure = error => {
  const remote = remoteErrorOf(error)
  if (remote !== undefined) {
    return { code: remote.code, message: remote.message, details: remote.details }
  }
  return {
    code: 'gateway/internal',
    message: error instanceof Error ? error.message : String(error),
    details: {},
  }
}

/**
 * Drive both halves to completion.
 *
 * Strictly alternating hello → host → prove → ready, stopping on the driver's own
 * counter rather than on either side's `done`: both halves report `done` before they
 * have finished, and the existing handshake tests already record why.
 */
async function complete(peer, host) {
  let message = (await peer.next(undefined)).send
  for (let step = 0; step < 4; step += 1) {
    const reply = await host.next(message)
    if (reply.done) return
    message = (await peer.next(reply.send)).send
  }
  throw new Error('handshake did not settle within four messages')
}

/**
 * Run a real handshake, then wire the carrier over the sessions it produced.
 *
 * The registry entry is what the host authenticates the device against, so the
 * exchange exercises the signature check as well as the key agreement: a device
 * whose recorded public key did not match what it signed with would be refused
 * before any of this file's assertions ran.
 */
async function connected({
  deviceStatus = 'trusted',
  dispatchRpc = async () => ({ ok: true, value: null }),
  open = async () => (async function* () { })(),
} = {}) {
  const hostIdentity = await generateIdentity()
  const peerIdentity = await generateIdentity()
  const hostId = 'host-handshake-1'
  const deviceId = 'device-handshake-1'

  const registry = new Map([[deviceId, {
    deviceId,
    publicKey: await encodePublicKey(peerIdentity.signing.publicKey),
    agreementKey: await encodePublicKey(peerIdentity.agreement.publicKey),
    status: deviceStatus,
  }]])

  const hostHandshake = new HostHandshake({
    identity: hostIdentity,
    hostId,
    resolveDevice: async id => registry.get(id),
  })
  const peerHandshake = new PeerHandshake({ identity: peerIdentity, deviceId, hostId })
  await complete(peerHandshake, hostHandshake)

  assert.ok(peerHandshake.session, 'the device should hold a session after the handshake')
  assert.ok(hostHandshake.session, 'the host should hold a session after the handshake')

  const { session: deviceSession } = peerHandshake
  const { session: hostSession } = hostHandshake

  let link
  const hostChannel = new RemoteChannel({
    dispatchRpc,
    open,
    failure: toWireFailure,
    send: async text => {
      await link.receive(await hostSession.seal(new TextEncoder().encode(text)))
    },
    peer: { marker: 'operator' },
  })
  link = new DeviceLink({
    session: deviceSession,
    send: async frame => {
      await hostChannel.receive(new TextDecoder().decode(await hostSession.open(frame)))
    },
  })

  return { link, hostChannel, peerHandshake, hostHandshake, hostId, deviceId }
}

async function until(predicate, label, { timeoutMs = 2_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = predicate()
    if (value) return value
    if (Date.now() > deadline) assert.fail(`${label}: timed out`)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

describe('握手产出的会话就是载体的密钥来源', () => {
  it('两端就同一份短认证码达成一致', async () => {
    const { peerHandshake, hostHandshake } = await connected()
    // The operator compares these by eye during pairing, so a mismatch here means
    // the confirmation step is confirming nothing.
    assert.equal(peerHandshake.sas, hostHandshake.sas)
    assert.match(peerHandshake.sas, /^[A-Za-z0-9_-]{6,}$/u)
  })

  it('一元调用经握手协商的密钥往返', async () => {
    const { link } = await connected({
      dispatchRpc: async method => ({ ok: true, value: { method } }),
    })
    const result = await link.rpc.call('/api', 'session/list', { args: [] }, undefined)
    assert.deepEqual(result, { ok: true, value: { method: 'session/list' } })
  })

  it('宿主端 RemoteError 的码穿过协商密钥到达设备', async () => {
    const { link } = await connected({
      dispatchRpc: async () => ({
        ok: false,
        error: new RemoteError('gateway/arguments-invalid', 'bad args', { field: 'args' }),
      }),
    })
    const result = await link.rpc.call('/api', 'session/prompt', { args: [1] }, undefined)
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'gateway/arguments-invalid')
    assert.deepEqual(result.error.details, { field: 'args' })
  })

  it('多个并发调用在真实密钥下各自拿到答案', async () => {
    // Sequence numbers are the reason this matters: the negotiated session is one
    // counter, so concurrent calls are exactly the case where a lost ordering
    // guarantee shows up as a refused frame.
    const { link } = await connected({
      dispatchRpc: async (method, payload) => ({ ok: true, value: { method, args: payload.args } }),
    })
    const answers = await Promise.all([
      link.rpc.call('/api', 'session/list', { args: [1] }, undefined),
      link.rpc.call('/api', 'session/page', { args: [2] }, undefined),
      link.rpc.call('/api', 'settings/describe', { args: [3] }, undefined),
    ])
    assert.deepEqual(answers.map(a => a.value.method).sort(), ['session/list', 'session/page', 'settings/describe'])
    assert.deepEqual(answers.map(a => a.value.args), [[1], [2], [3]])
  })

  it('逻辑流经握手协商的密钥往返', async () => {
    const ready = { type: 'ready', clientId: 'c1', host: { home: '/home/host' } }
    const { link } = await connected({
      open: async (endpoint, payload, uplink, peer, signal) => (async function* () {
        yield ready
        await new Promise(resolve => {
          if (signal.aborted) resolve()
          else signal.addEventListener('abort', resolve, { once: true })
        })
      })(),
    })

    const stream = link.rpc.open('/api', '$events', { args: {} }, undefined, undefined)
    const iterator = stream[Symbol.asyncIterator]()
    const first = await iterator.next()
    assert.deepEqual(first.value, ready)
    link.close()
  })

  it('上行与半关闭经握手协商的密钥到达宿主方法', async () => {
    const seen = []
    const { link } = await connected({
      open: async (endpoint, payload, uplink, peer, signal) => {
        void (async () => {
          for await (const item of uplink) seen.push(item)
          seen.push('ENDED')
        })()
        return (async function* () {
          await new Promise(resolve => {
            if (signal.aborted) resolve()
            else signal.addEventListener('abort', resolve, { once: true })
          })
        })()
      },
    })

    const uplink = (async function* () { yield { hello: 'host' } })()
    const stream = link.rpc.open('/api', 'demo/stream', { args: [] }, undefined, uplink)
    const reading = stream[Symbol.asyncIterator]().next()
    await until(() => seen.length >= 2, 'the uplink item and its end')
    assert.deepEqual(seen, [{ hello: 'host' }, 'ENDED'])
    link.close()
    await reading.catch(() => undefined)
  })

  it('WebSocket 隧道经握手协商的密钥双向工作', async () => {
    // The path the official mux client would take, end to end over negotiated keys:
    // a frame written to the socket is sealed, dispatched on the host, and the answer
    // comes back through the same session to the socket that asked for it.
    const opened = []
    const { link } = await connected({
      open: async (endpoint, payload, uplink, peer, signal) => {
        opened.push({ endpoint, payload })
        return (async function* () {
          yield { type: 'ready', clientId: 'c1', host: { home: '/home/host' } }
          await new Promise(resolve => {
            if (signal.aborted) resolve()
            else signal.addEventListener('abort', resolve, { once: true })
          })
        })()
      },
    })

    const Linked = link.webSocketClass()
    const socket = new Linked('https://remote.invalid/api/remote.mux')
    const messages = []
    socket.addEventListener('message', event => messages.push(JSON.parse(event.data)))
    await until(() => socket.readyState === Linked.OPEN, 'the socket to open')

    socket.send(JSON.stringify({ type: 'open', streamId: 's1', endpoint: '$events', payload: { args: {} } }))
    const first = await until(() => messages[0], 'the ready frame')
    assert.equal(first.type, 'item')
    assert.equal(first.streamId, 's1')
    assert.deepEqual(first.value, { type: 'ready', clientId: 'c1', host: { home: '/home/host' } })
    assert.deepEqual(opened, [{ endpoint: '$events', payload: { args: {} } }])

    socket.close()
    link.close()
  })
})

describe('配对决定谁可以走到这一步', () => {
  it('登记表里没有的设备无法完成握手', async () => {
    // The status is what the host authenticates against, so an unknown device never
    // reaches a session — and therefore never reaches a single frame of this carrier.
    const hostIdentity = await generateIdentity()
    const peerIdentity = await generateIdentity()
    const host = new HostHandshake({
      identity: hostIdentity,
      hostId: 'host-handshake-2',
      resolveDevice: async () => undefined,
    })
    const peer = new PeerHandshake({
      identity: peerIdentity,
      deviceId: 'device-unknown',
      hostId: 'host-handshake-2',
    })

    await assert.rejects(async () => { await complete(peer, host) }, /./u)
    assert.equal(peer.session, null, 'an unpaired device must not hold a session')
  })

  it('被撤销的设备无法完成握手', async () => {
    await assert.rejects(
      async () => { await connected({ deviceStatus: 'revoked' }) },
      /./u,
    )
  })
})
