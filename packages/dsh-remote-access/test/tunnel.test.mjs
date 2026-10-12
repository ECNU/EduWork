/**
 * The Host half, against a real relay and a real device.
 *
 * The channel tests prove two handshakes agree. These prove the Host will not
 * carry a call it should not, which is a different claim and the one the issue
 * is actually about: an unauthorised device must be refused *before* anything is
 * dispatched. That is asserted by watching the dispatcher, not by reading the
 * reply — a reply that says "refused" while the call was already executed is the
 * failure this test exists to catch.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import { encodePublicKey, generateIdentity } from '../src/channel/crypto.js'
import { PeerHandshake } from '../src/channel/handshake.js'
import { decideEndpoint } from '../src/channel/operations.js'
import { DEVICE_STATUS } from '../src/registry.js'
import { PEER_PATH } from '../src/relay/protocol.js'
import { createRelay } from '../src/relay/relay.js'
import { createHostTunnel } from '../src/relay/tunnel.js'

const AGENT_GRANT = ['session:list', 'session:read', 'session:prompt', 'session:cancel', 'workspace:list', 'settings:read']
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Read a frame as text, whatever shape it arrived in.
 *
 * `event.data` is a `string` for text frames and an `ArrayBuffer` for binary
 * ones, and the queue holds them as received. Passing a string to
 * `TextDecoder.decode` does not throw — it converts to `"[object String]"` — so
 * a mixed queue fails later as a JSON parse error that looks like a silent
 * timeout. Normalising in one place is what keeps that from recurring.
 */
const frameText = (frame) => {
  if (typeof frame === 'string') return frame
  if (frame instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(frame))
  return new TextDecoder().decode(frame)
}

let relay
let relayUrl
let store

before(async () => {
  store = mkdtempSync(join(tmpdir(), 'eduwork-tunnel-'))
  relay = createRelay({ port: 0, storePath: join(store, 'hosts.json') })
  await new Promise((resolve) => relay.listen(resolve))
  relayUrl = `ws://127.0.0.1:${relay.server.address().port}`
})

after(async () => {
  await relay.close()
  rmSync(store, { recursive: true, force: true })
})

/**
 * A paired device: its own identity, and the record the Host would hold for it.
 *
 * The record carries the *public* halves only. That is the whole reason the
 * device can prove itself later without the Host storing anything worth stealing.
 */
async function pairedDevice(status = DEVICE_STATUS.TRUSTED) {
  const identity = await generateIdentity()
  const deviceId = `device-${Math.random().toString(36).slice(2, 10)}`
  return {
    identity,
    deviceId,
    record: {
      deviceId,
      publicKey: await encodePublicKey(identity.signing.publicKey),
      agreementKey: await encodePublicKey(identity.agreement.publicKey),
      status,
      surfaces: { agent: [...AGENT_GRANT], host: [] },
    },
  }
}

/**
 * Dial the relay as a device.
 *
 * One listener drains the socket into a queue, and `next()` pops from it, so
 * there is exactly one place a frame can be consumed. An earlier version let a
 * waiter and the backlog both hold frames, which loses one whenever they race.
 */
async function dialDevice(hostId) {
  const socket = new WebSocket(`${relayUrl}${PEER_PATH}?h=${hostId}`)
  // Same reason as in the tunnel: the spec default is `blob`, and a Blob wrapped
  // in a Uint8Array is silently zero-length rather than an error. A test that
  // leaves this unset reports a frame-format failure instead of its own bug.
  socket.binaryType = 'arraybuffer'
  const queue = []
  /** Relay control frames, kept so a test can assert what the relay told us. */
  const control = []
  const waiters = new Set()
  let relayRefusal
  let closed
  let markLinked
  const linked = new Promise((resolve) => {
    markLinked = resolve
  })

  // `linked` is the relay's, and it never enters the frame queue: it is the last
  // thing the relay says on its own behalf, and mixing it into the same stream
  // the handshake reads makes every later assertion depend on event-loop timing.
  // Everything the queue does carry is end-to-end.
  socket.addEventListener('message', (event) => {
    if (typeof event.data === 'string') {
      const message = JSON.parse(event.data)
      if (message.t === 'unavailable') relayRefusal = message.reason
      if (message.t === 'linked') {
        control.push(message)
        markLinked(message)
        return
      }
    }
    // The queue carries frames exactly as the socket delivered them; `frameText`
    // is what makes text and binary interchangeable at the read sites.
    const waiter = [...waiters][0]
    if (waiter === undefined) queue.push(event.data)
    else {
      waiters.delete(waiter)
      waiter.resolve(event.data)
    }
  })
  socket.addEventListener('close', (event) => {
    closed = { code: event.code, reason: event.reason }
    for (const waiter of [...waiters]) {
      waiters.delete(waiter)
      waiter.reject(new Error(`socket closed (${String(event.code)}) ${String(event.reason ?? '')}`))
    }
  })

  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve)
    socket.addEventListener('error', () => reject(new Error('device could not connect')))
  })
  // Waiting for the greeting here is what makes the rest deterministic: the
  // frames a test reads afterwards all belong to the hand-off and to data.
  await linked

  const next = (timeoutMs = 5000) => {
    if (queue.length > 0) return Promise.resolve(queue.shift())
    if (closed !== undefined) return Promise.reject(new Error(`socket closed (${String(closed.code)})`))
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject }
      const timer = setTimeout(() => {
        waiters.delete(waiter)
        reject(new Error(`no frame within ${String(timeoutMs)}ms (relay said ${String(relayRefusal ?? 'nothing')})`))
      }, timeoutMs)
      waiters.add({
        resolve: (frame) => {
          clearTimeout(timer)
          resolve(frame)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
    })
  }

  return { socket, next, control, get relayRefusal() { return relayRefusal } }
}

/**
 * Read the next frame that carries end-to-end payload, as bytes.
 *
 * Two JSON frames on this socket are not payload: the relay acknowledges the
 * device's READY with an unsigned `ready` of its own, and the Host's last
 * handshake message is a signed `ready` that arrives after the device has
 * already finished. Neither is part of the exchange the caller is reading, and a
 * device that fed either to the handshake would fail as a protocol mismatch.
 */
async function nextPayloadFrame(link) {
  for (;;) {
    const frame = await link.next()
    if (typeof frame !== 'string') return new Uint8Array(frame)
    if (JSON.parse(frame).t === 'ready') continue
    return frame
  }
}

/**
 * Complete the end-to-end handshake, or throw with the reason it did not.
 *
 * The relay's READY has to be sent by the device itself, and it has to come
 * after `linked`: the relay will not open the link until the device says it has
 * finished reading control frames, so a device that skips this waits forever for
 * a Host reply the relay is still holding. That is the failure this helper is
 * shaped to avoid, and it is a real ordering requirement rather than a test
 * convenience.
 */
async function proveDevice(link, { identity, deviceId }, hostId) {
  const handshake = new PeerHandshake({ identity, deviceId, hostId })
  const hello = await handshake.next(undefined)
  link.socket.send(JSON.stringify({ t: 'ready' }))
  link.socket.send(JSON.stringify(hello.send))
  const hostFrame = JSON.parse(await nextPayloadFrame(link))
  const prove = await handshake.next(hostFrame)
  // The device is finished here: verifying the Host's `host` message completes
  // its half, and `prove` is its last word. Asking it to consume one more frame
  // re-enters a machine that is already `done` and fails as a protocol mismatch,
  // even though the Host does go on to send its own `ready`.
  assert.equal(prove.done, true, 'the device finishes on the Host message')
  link.socket.send(JSON.stringify(prove.send))
  return { handshake, session: handshake.session }
}

/** One sealed call, and the sealed reply. */
async function rpc(link, session, message) {
  link.socket.send(await session.seal(new TextEncoder().encode(JSON.stringify(message))))
  // `nextPayloadFrame`, not `next`: the Host's handshake `ready` is still on its
  // way when the first call goes out, and feeding it to `open()` fails as a bad
  // frame version rather than as the ordering mistake it is. The frame is handed
  // over as received — `open()` takes the byte string, and re-wrapping it is what
  // turns a working read into a type error.
  return JSON.parse(frameText(await session.open(await nextPayloadFrame(link))))
}

const envelope = (method, rpcId = 'rpc-1') => ({ type: 'client-request', rpcId, method, payload: { args: {} } })

/** Start a Host and wait until the relay has it, so a device can attach. */
async function startHost({ hostId, devices, dispatch, log = () => {}, backoffMs }) {
  const identity = await generateIdentity()
  const tunnel = await createHostTunnel({
    url: relayUrl,
    hostId,
    identity,
    devices,
    decide: decideEndpoint,
    dispatch,
    log,
    ...(backoffMs === undefined ? {} : { backoffMs }),
  })
  await sleep(150)
  return tunnel
}

test('宿主主动连出并注册，随后已配对设备能完成端到端握手', async () => {
  const hostId = 'host-registers'
  const device = await pairedDevice()
  const devices = new Map([[device.deviceId, device.record]])
  const tunnel = await startHost({ hostId, devices, dispatch: async () => assert.fail('nothing should be dispatched') })

  assert.equal(tunnel.connected, true, 'the Host dials out; it must not be listening')
  const link = await dialDevice(hostId)
  // A device can only attach to a host the relay knows, so a completed handshake
  // is also the proof that the registration landed.
  await proveDevice(link, device, hostId)
  await sleep(80)
  assert.equal(tunnel.deviceId, device.deviceId)

  link.socket.close()
  tunnel.stop()
})

test('已确认设备的只读调用被放行，派发函数收到主机端点名', async () => {
  const hostId = 'host-allows'
  const device = await pairedDevice()
  const devices = new Map([[device.deviceId, device.record]])
  const seen = []
  const tunnel = await startHost({
    hostId,
    devices,
    dispatch: async ({ method, rpcId }) => {
      seen.push(method)
      return { type: 'server-response', rpcId, result: { ok: true, value: { sessions: ['a'] } } }
    },
  })
  const link = await dialDevice(hostId)
  const { session } = await proveDevice(link, device, hostId)
  await sleep(80)

  const reply = await rpc(link, session, envelope('session/list'))
  assert.deepEqual(reply.result, { ok: true, value: { sessions: ['a'] } })
  // The method reaches the dispatcher untouched, because the parameter names
  // differ per method upstream and this layer does not own that schema.
  assert.deepEqual(seen, ['session/list'])

  link.socket.close()
  tunnel.stop()
})

test('门禁之外的调用被拒，而且派发函数一次都没被调用', async () => {
  const hostId = 'host-refuses-operation'
  const device = await pairedDevice()
  const devices = new Map([[device.deviceId, device.record]])
  let dispatches = 0
  const tunnel = await startHost({
    hostId,
    devices,
    dispatch: async () => {
      dispatches += 1
      return { type: 'server-response', rpcId: 'x', result: { ok: true, value: {} } }
    },
  })
  const link = await dialDevice(hostId)
  const { session } = await proveDevice(link, device, hostId)
  await sleep(80)

  for (const method of ['workspace/delete', 'device/revoke', 'session/create', 'terminal/open', 'session/nope']) {
    const reply = await rpc(link, session, envelope(method, `rpc-${method}`))
    assert.equal(reply.result.ok, false, `${method} must be refused`)
    assert.equal(reply.result.error.code, 403, `${method} must be refused as forbidden`)
  }
  assert.equal(dispatches, 0, 'a refused call must never reach the dispatcher')

  link.socket.close()
  tunnel.stop()
})

test('未配对的设备在握手阶段就被挡住，拿不到会话', async () => {
  const hostId = 'host-unknown-device'
  const known = await pairedDevice()
  const stranger = await pairedDevice()
  const devices = new Map([[known.deviceId, known.record]])
  let dispatches = 0
  const tunnel = await startHost({
    hostId,
    devices,
    dispatch: async () => {
      dispatches += 1
      return { type: 'server-response', rpcId: 'x', result: { ok: true, value: {} } }
    },
  })

  // The stranger holds a real key pair and a real relay link; what it lacks is a
  // record on this Host. The Host answers nothing, so the handshake never
  // completes — the device either waits out its read or has the link closed
  // under it once the Host stops answering. Both mean the same thing here.
  const link = await dialDevice(hostId)
  await assert.rejects(proveDevice(link, stranger, hostId), /no frame|socket closed/u)
  assert.equal(dispatches, 0)
  await sleep(80)
  assert.equal(tunnel.deviceId, undefined, 'a refused device must not become the current one')

  link.socket.close()
  tunnel.stop()
})

test('设备被撤销后，同一个已建立的会话不再放行调用', async () => {
  const hostId = 'host-revoked-midway'
  const device = await pairedDevice()
  const devices = new Map([[device.deviceId, device.record]])
  let dispatches = 0
  const tunnel = await startHost({
    hostId,
    devices,
    dispatch: async ({ rpcId }) => {
      dispatches += 1
      return { type: 'server-response', rpcId, result: { ok: true, value: {} } }
    },
  })
  const link = await dialDevice(hostId)
  const { session } = await proveDevice(link, device, hostId)
  await sleep(80)
  await rpc(link, session, envelope('session/list', 'before'))
  assert.equal(dispatches, 1)

  // The device lookup is live, not a snapshot taken at handshake time. A revoked
  // device must be refused on the *next* call, which is what makes revocation an
  // action rather than a note.
  device.record.status = DEVICE_STATUS.REVOKED
  const refused = await rpc(link, session, envelope('session/list', 'after'))
  assert.equal(refused.result.ok, false)
  assert.equal(refused.result.error.code, 403)
  assert.equal(dispatches, 1, 'the revoked call must not reach the dispatcher')

  link.socket.close()
  tunnel.stop()
})

test('宿主被中继拒绝时停止重试，而不是空转', async () => {
  const hostId = 'host-denied'
  const first = await startHost({ hostId, devices: new Map(), dispatch: async () => ({}) })
  first.stop()
  await sleep(60)

  const lines = []
  const second = await createHostTunnel({
    url: relayUrl,
    hostId,
    identity: await generateIdentity(),
    devices: new Map(),
    decide: decideEndpoint,
    dispatch: async () => ({}),
    log: (line) => lines.push(line),
    backoffMs: [20],
  })
  await sleep(300)
  assert.ok(
    lines.some((line) => line.includes('refused this host id')),
    `expected a refusal to stop the retry loop, saw: ${JSON.stringify(lines)}`,
  )
  second.stop()
})

test('重放的帧不会被执行第二次，而是断开链路', async () => {
  const hostId = 'host-replay'
  const device = await pairedDevice()
  const devices = new Map([[device.deviceId, device.record]])
  const seen = []
  const tunnel = await startHost({
    hostId,
    devices,
    dispatch: async ({ rpcId }) => {
      seen.push(rpcId)
      return { type: 'server-response', rpcId, result: { ok: true, value: {} } }
    },
  })
  const link = await dialDevice(hostId)
  const { session } = await proveDevice(link, device, hostId)
  await sleep(80)

  // One sealed call, delivered twice. The bytes authenticate only once: the
  // second copy carries a sequence number the Host has already consumed, and a
  // frame that will not authenticate must not be executed as a second call.
  const sealed = await session.seal(new TextEncoder().encode(JSON.stringify(envelope('session/list', 'rpc-once'))))
  const closed = new Promise((resolve) => link.socket.addEventListener('close', resolve))
  link.socket.send(sealed)
  await sleep(80)
  assert.deepEqual(seen, ['rpc-once'], 'the first copy is a real call')

  link.socket.send(sealed)
  const outcome = await closed
  assert.ok(
    [1008, 1011].includes(outcome.code),
    `a replay must end the link, saw ${String(outcome.code)} ${String(outcome.reason ?? '')}`,
  )
  assert.deepEqual(seen, ['rpc-once'], 'the replayed bytes must not become a second call')

  tunnel.stop()
})
