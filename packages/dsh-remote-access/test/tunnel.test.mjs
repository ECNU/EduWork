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
import { LiveConnections } from '../src/connections.js'
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
    const control = JSON.parse(frame)
    // `peer-gone` is the relay telling the device its Host refused it; it is a
    // control message, not handshake traffic. Skipping it is what lets the device
    // observe the close that follows instead of failing the parse.
    if (control.t === 'ready' || control.t === 'peer-gone') continue
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

/** Wait for a condition the relay delivers asynchronously, or fail. */
async function until(predicate, label, { timeoutMs = 3_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (predicate()) return
    if (Date.now() > deadline) assert.fail(`${label}: timed out`)
    await sleep(10)
  }
}

/** Start a Host and wait until the relay has it, so a device can attach. */
async function startHost({ hostId, devices, dispatch, openStream, connections, log = () => {}, backoffMs }) {
  const identity = await generateIdentity()
  const tunnel = await createHostTunnel({
    url: relayUrl,
    hostId,
    identity,
    devices,
    decide: decideEndpoint,
    dispatch,
    // Passed through only when a test supplies one: the option is optional, and a
    // deployment that serves no streams should get the default that refuses them.
    ...(openStream === undefined ? {} : { openStream }),
    ...(connections === undefined ? {} : { connections }),
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
    // A string code with the HTTP status kept as a detail. The device decodes with
    // `parseConnectionResponse`, which refuses a numeric `code` and a missing
    // `details` — so a refusal in the old shape arrived as a transport error rather
    // than as the refusal it was.
    assert.equal(reply.result.error.code, 'remote-access/operation-refused', `${method} must be refused as forbidden`)
    assert.deepEqual(reply.result.error.details, { status: 403 })
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
  assert.equal(refused.result.error.code, 'remote-access/revoked')
  assert.deepEqual(refused.result.error.details, { status: 403 })
  assert.equal(dispatches, 1, 'the revoked call must not reach the dispatcher')

  link.socket.close()
  tunnel.stop()
})

test('撤销立即关闭设备的活动连接，而不是等它下一次调用', async () => {
  const hostId = 'host-revoke-closes'
  const device = await pairedDevice()
  const devices = new Map([[device.deviceId, device.record]])
  const connections = new LiveConnections()
  const tunnel = await startHost({
    hostId,
    devices,
    connections,
    dispatch: async ({ rpcId }) => ({ type: 'server-response', rpcId, result: { ok: true, value: {} } }),
  })
  const link = await dialDevice(hostId)
  await proveDevice(link, device, hostId)
  await sleep(80)
  assert.equal(connections.count(device.deviceId), 1, 'an established session is tracked per device')

  // Revocation closes the socket now. Waiting for the device's next request would
  // let an open stream keep receiving events after access was withdrawn.
  device.record.status = DEVICE_STATUS.REVOKED
  assert.equal(connections.closeAll(device.deviceId), 1)

  for (let attempt = 0; attempt < 100 && link.socket.readyState !== 3; attempt += 1) await sleep(20)
  assert.equal(link.socket.readyState, 3, 'the device must observe a closed socket, not only a refused call')
  assert.equal(connections.count(device.deviceId), 0)

  tunnel.stop()
})

test('设备断开后宿主保持中继连接，下一台设备可直接接入', async () => {
  const hostId = 'host-peer-gone'
  const device = await pairedDevice()
  const devices = new Map([[device.deviceId, device.record]])
  const logs = []
  const tunnel = await startHost({
    hostId,
    devices,
    log: line => logs.push(line),
    dispatch: async ({ rpcId }) => ({ type: 'server-response', rpcId, result: { ok: true, value: {} } }),
  })
  const first = await dialDevice(hostId)
  await proveDevice(first, device, hostId)
  await sleep(80)
  assert.equal(tunnel.connected, true)

  // The device leaves. The relay says `peer-gone`; a Host that treats that text
  // frame as sealed traffic drops its whole relay link and reconnects, interrupting
  // whatever else it serves. It has to stay registered instead.
  first.socket.close()
  await sleep(300)
  assert.equal(tunnel.connected, true, 'the relay link must survive a device disconnect')
  assert.equal(logs.some(line => /dropping the link/.test(line)), false)
  assert.equal(logs.some(line => /relay closed the connection/.test(line)), false,
    'the host must not close its own relay socket when a device leaves')

  // And the next device attaches to the same link without a reconnect.
  const second = await dialDevice(hostId)
  const { session } = await proveDevice(second, device, hostId)
  const reply = await rpc(second, session, envelope('session/list', 'after-peer-gone'))
  assert.equal(reply.result.ok, true)
  second.socket.close()
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

test('逻辑流穿过中继：ready 帧下行，上行项到达宿主方法', async () => {
  // The stream half of the carrier, over the real relay. Before this the tunnel only
  // recognised `client-request` frames, so a logical stream was answered as a
  // malformed request and the device saw a refusal for something it never asked for.
  const hostId = 'host-streams'
  const device = await pairedDevice()
  const devices = new Map([[device.deviceId, device.record]])
  const seen = []
  const opened = []
  let uplinkFailure
  const tunnel = await startHost({
    hostId,
    devices,
    dispatch: async () => assert.fail('a stream open must not reach the unary dispatcher'),
    openStream: async (endpoint, payload, uplink, peer, signal) => {
      opened.push({ endpoint, payload })
      // The uplink ends one of two ways: the client half-closes, or the carrier goes
      // away and the inbox is failed. Only the first is what this test is about, so the
      // second is recorded on its own rather than appended to `seen` — and it is caught,
      // because a reader whose only fate is to be failed by a teardown must not turn
      // that teardown into an unhandled rejection. That rejection was previously
      // attributed to whichever test happened to be running when the socket closed,
      // which made this test fail about one run in three with a message about the relay
      // link instead of about streams.
      const drained = (async () => {
        try {
          for await (const item of uplink) seen.push(item)
          seen.push('ENDED')
        } catch (error) {
          uplinkFailure ??= String(error?.message ?? error)
        }
      })()
      return (async function* () {
        yield { type: 'ready', clientId: 'c1', host: { home: '/home/host' } }
        await new Promise(resolve => {
          if (signal.aborted) resolve()
          else signal.addEventListener('abort', resolve, { once: true })
        })
        // Join the reader before this generator is collected, so a test that finishes
        // while the carrier is closing cannot leave the rejection dangling.
        await drained
      })()
    },
  })
  const link = await dialDevice(hostId)
  const { session } = await proveDevice(link, device, hostId)
  await sleep(80)

  // The frame vocabulary is the Gateway's, and `$events` is opened with an empty args
  // object because that is what the Gateway's own remote-event stream declares.
  link.socket.send(await session.seal(new TextEncoder().encode(JSON.stringify({
    type: 'open', streamId: 's1', endpoint: '$events', payload: { args: {} },
  }))))
  const first = JSON.parse(frameText(await session.open(await nextPayloadFrame(link))))
  assert.equal(first.type, 'item')
  assert.equal(first.streamId, 's1')
  assert.deepEqual(first.value, { type: 'ready', clientId: 'c1', host: { home: '/home/host' } })
  assert.deepEqual(opened, [{ endpoint: '$events', payload: { args: {} } }])

  link.socket.send(await session.seal(new TextEncoder().encode(JSON.stringify({
    type: 'item', streamId: 's1', value: { hello: 'host' },
  }))))
  link.socket.send(await session.seal(new TextEncoder().encode(JSON.stringify({
    type: 'end', streamId: 's1',
  }))))
  await until(() => seen.length >= 2, 'the uplink item and its half-close')
  assert.deepEqual(seen, [{ hello: 'host' }, 'ENDED'])
  // The half-close above is what should have ended this uplink, not the carrier
  // failing underneath it. Without this the catch around the reader would happily
  // absorb a real transport fault and the test would pass for the wrong reason.
  assert.equal(uplinkFailure, undefined, 'the uplink ended by half-close, not by a transport failure')

  link.socket.close()
  tunnel.stop()
})

test('连续发出 open 与 item：顺序必须保住，不能因为解密慢而丢项', async () => {
  // A regression test for a real intermittent failure, written so that it fails
  // deterministically rather than one run in three.
  //
  // Inbound frames have to be decrypted before they can be routed, and decryption is
  // asynchronous. When every message was handled in its own floating task, an `item`
  // could finish decrypting before the `open` that created its stream, find no stream
  // to join, and be dropped — the Host method then waited for a value the device had
  // already sent. The fix serialises the routing in the tunnel.
  //
  // The distinguishing detail is that nothing here waits for a reply before sending
  // the next frame: open, item and end leave in one burst, so they are in flight
  // together and only arrival order can save them.
  const hostId = 'host-stream-order'
  const device = await pairedDevice()
  const devices = new Map([[device.deviceId, device.record]])
  const seen = []
  let finished
  const done = new Promise((resolve) => {
    finished = resolve
  })
  const tunnel = await startHost({
    hostId,
    devices,
    dispatch: async () => assert.fail('a stream open must not reach the unary dispatcher'),
    openStream: async (endpoint, payload, uplink) => {
      void (async () => {
        try {
          for await (const item of uplink) seen.push(item)
          seen.push('ENDED')
        } catch (error) {
          seen.push(`FAILED ${String(error?.message ?? error)}`)
        } finally {
          finished()
        }
      })()
      return (async function* () {
        yield { type: 'ready', clientId: 'c-order', host: { home: '/home/host' } }
        await new Promise(() => {})
      })()
    },
  })
  const link = await dialDevice(hostId)
  const { session } = await proveDevice(link, device, hostId)
  await sleep(80)

  // Sealed one after another, sent without waiting for any reply in between. Several
  // items rather than one, because what makes the defect likely is the number of
  // decryptions in flight at once: with a single item the misordering only sometimes
  // happens, and a regression test that only sometimes fails is a coin flip rather
  // than a guard.
  const items = [1, 2, 3, 4, 5, 6]
  for (const frame of [
    { type: 'open', streamId: 's-order', endpoint: '$events', payload: { args: {} } },
    ...items.map(n => ({ type: 'item', streamId: 's-order', value: { n } })),
    { type: 'end', streamId: 's-order' },
  ]) {
    link.socket.send(await session.seal(new TextEncoder().encode(JSON.stringify(frame))))
  }

  await Promise.race([
    done,
    sleep(3_000).then(() => assert.fail('the uplink never ended: an item was dropped as unroutable')),
  ])
  // Every item arrived, in order, and the half-close came last. A dropped `item`
  // shows up as a missing element; a reordered pair as the wrong sequence.
  assert.deepEqual(seen, [...items.map(n => ({ n })), 'ENDED'])

  link.socket.close()
  tunnel.stop()
})

test('流端点上的操作围栏同样生效', async () => {
  // The gate is asked per endpoint, and it is asked for a stream open too. Otherwise
  // the fence would cover every unary call and no stream, which is the half of the
  // surface that carries live data.
  const hostId = 'host-stream-fence'
  const device = await pairedDevice()
  const devices = new Map([[device.deviceId, device.record]])
  const tunnel = await startHost({
    hostId,
    devices,
    dispatch: async () => assert.fail('nothing should be dispatched'),
    openStream: async () => assert.fail('a refused stream must not reach the dispatcher'),
  })
  const link = await dialDevice(hostId)
  const { session } = await proveDevice(link, device, hostId)
  await sleep(80)

  // `terminal/open` is outside the operation table, so the fence refuses it.
  link.socket.send(await session.seal(new TextEncoder().encode(JSON.stringify({
    type: 'open', streamId: 's1', endpoint: 'terminal/open', payload: { args: {} },
  }))))
  const frame = JSON.parse(frameText(await session.open(await nextPayloadFrame(link))))
  assert.equal(frame.type, 'error')
  assert.equal(frame.streamId, 's1')
  assert.equal(frame.error.code, 'remote-access/operation-refused')
  assert.deepEqual(frame.error.details, { status: 403 })

  link.socket.close()
  tunnel.stop()
})
