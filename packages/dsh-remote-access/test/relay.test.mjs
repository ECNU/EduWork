/**
 * The relay over real sockets.
 *
 * The channel tests prove two handshakes agree; these prove the bytes survive a
 * relay that is not allowed to understand them. Two kinds of assertion only
 * exist at this level: that the hand-rolled RFC 6455 server interoperates with a
 * real client, and that a device reaching a Host through the relay ends up with
 * the same session it would have had directly.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import { buildRelayTranscript, encodePublicKey, generateIdentity, randomNonce, signTranscript } from '../src/channel/crypto.js'
import { HostHandshake, PeerHandshake } from '../src/channel/handshake.js'
import { HOST_PATH, MESSAGE, PEER_PATH, RELAY_VERSION, UNAVAILABLE } from '../src/relay/protocol.js'
import { createRelay } from '../src/relay/relay.js'
import { buildHostRegistrationTranscript, verifyHostRegistration } from '../src/relay/registration.js'
import { wrapClientSocket } from '../src/relay/websocket.js'

let relay
let base
let store

before(async () => {
  store = mkdtempSync(join(tmpdir(), 'eduwork-relay-'))
  relay = createRelay({ port: 0, storePath: join(store, 'hosts.json') })
  await new Promise((resolve) => relay.listen(resolve))
  base = `ws://127.0.0.1:${relay.server.address().port}`
})

after(async () => {
  await relay.close()
  rmSync(store, { recursive: true, force: true })
})

/**
 * A socket that remembers what it received.
 *
 * `next()` resolves with the **parsed message**, not a wrapper around it, and
 * `entries` holds the raw frames for tests that care about text versus binary.
 * An earlier version had `next()` return an entry and a `json()` helper return
 * its payload, which reads the same at the call site and produced exactly the
 * double-unwrap bug it invites.
 */
async function open(path, origin = base) {
  const socket = new WebSocket(`${origin}${path}`)
  const connection = wrapClientSocket(socket)
  const entries = []
  const waiters = new Set()
  connection.on('error', (error) => {
    process.stderr.write(`relay.test: socket error on ${path}: ${error?.stack ?? error}\n`)
  })
  connection.on('message', (data, isText) => {
    try {
      const entry = { data, isText, message: isText ? JSON.parse(data) : undefined }
      entries.push(entry)
      for (const waiter of [...waiters]) waiter(entry)
    } catch (error) {
      process.stderr.write(`relay.test: message listener failed: ${error?.stack ?? error}\n`)
    }
  })
  connection.entries = entries
  connection.say = (message) => connection.send(JSON.stringify(message))
  /** Resolve with the first binary frame, searching the backlog first. */
  connection.nextBinary = (timeoutMs = 5000) => {
    const already = entries.find((entry) => entry.isText === false)
    if (already !== undefined) return Promise.resolve(already)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(waiter)
        reject(new Error(`timed out waiting for a binary frame; saw ${JSON.stringify(entries.map((e) => e.message?.t ?? '<binary>'))}`))
      }, timeoutMs)
      const waiter = (entry) => {
        if (entry.isText !== false) return
        clearTimeout(timer)
        waiters.delete(waiter)
        resolve(entry)
      }
      waiters.add(waiter)
    })
  }
  /**
   * Resolve with the first message matching `match`, searching the backlog first
   * so a frame that arrived while the test was busy is never missed. Pass a
   * string to match on `t`, or a predicate over the message.
   */
  connection.next = (match, timeoutMs = 5000) => {
    const predicate = typeof match === 'string' ? (m) => m?.t === match : match
    const already = entries.find((entry) => predicate(entry.message))
    if (already !== undefined) return Promise.resolve(already.message)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(waiter)
        reject(new Error(`timed out waiting for a frame; saw ${JSON.stringify(entries.map((e) => e.message?.t ?? '<binary>'))}`))
      }, timeoutMs)
      const waiter = (entry) => {
        if (!predicate(entry.message)) return
        clearTimeout(timer)
        waiters.delete(waiter)
        resolve(entry.message)
      }
      waiters.add(waiter)
    })
  }
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve)
    socket.addEventListener('error', () => reject(new Error(`could not connect to ${path}`)))
  })
  return connection
}

/** Take this side of a link past the relay's control phase. */
const sayReady = (connection) => connection.say({ t: MESSAGE.READY })

/**
 * Register a Host.
 *
 * The Host announces itself as forwarding only once it is told a device arrived:
 * Host readiness is per-device, not per-connection, because one Host socket
 * serves one device after another. So this deliberately does not say READY —
 * `linkedPair` does it after `peer-joined`.
 */
async function registerHost(hostId, identity, origin = base) {
  identity ??= await generateIdentity()
  const connection = await open(HOST_PATH, origin)
  const challenge = await connection.next('challenge')
  const publicKey = await encodePublicKey(identity.signing.publicKey)
  connection.say({
    t: 'register',
    v: RELAY_VERSION,
    hostId,
    publicKey,
    sig: await signTranscript(identity.signing.privateKey, buildRelayTranscript({ nonce: challenge.nonce, hostId, publicKey })),
  })
  const registered = await connection.next((m) => m?.t === 'registered' || m?.t === 'denied')
  return { connection, registered }
}

/** Register a Host, attach a device, and complete both control hand-offs. */
async function linkedPair(hostId, identity, origin = base) {
  identity ??= await generateIdentity()
  const host = await registerHost(hostId, identity, origin)
  const peer = await open(`${PEER_PATH}?h=${hostId}`, origin)
  const linked = await peer.next('linked')
  // `peer-joined` is withheld from a Host that is already forwarding, so this
  // await is also the assertion that a fresh Host is still in its control phase.
  await host.connection.next('peer-joined')
  sayReady(host.connection)
  sayReady(peer)
  return { host, peer, linked }
}

test('宿主注册后绑定 hostId，重复注册同一把密钥被接受', async () => {
  const identity = await generateIdentity()
  const first = await registerHost('host-repeat', identity)
  assert.equal(first.registered.t, 'registered')
  assert.equal(first.registered.hostId, 'host-repeat')

  // Keep the first socket open: the same key re-registering is exactly the
  // restart/reconnect path, and it must replace the stale connection.
  const second = await registerHost('host-repeat', identity)
  assert.equal(second.registered.t, 'registered', 'the same key must be allowed to reclaim its id')
  first.connection.close()
  second.connection.close()
})

test('同一 hostId 换一把密钥注册会被拒——防止 hostId 被抢占', async () => {
  const first = await registerHost('host-taken', await generateIdentity())
  assert.equal(first.registered.t, 'registered')
  first.connection.close()

  const second = await registerHost('host-taken', await generateIdentity())
  assert.equal(second.registered.t, 'denied')
  assert.equal(second.registered.reason, 'host-id-taken')
  second.connection.close()
})

test('中继注册 transcript 与宿主实现逐字节一致', async () => {
  const nonce = randomNonce()
  const hostId = 'host-transcript'
  const publicKey = await encodePublicKey((await generateIdentity()).signing.publicKey)
  assert.equal(
    Buffer.from(buildRelayTranscript({ nonce, hostId, publicKey })).toString('hex'),
    buildHostRegistrationTranscript({ nonce, hostId, publicKey }).toString('hex'),
  )
})

test('注册签名绑定 hostId 与公钥，不能挪用到另一个身份', async () => {
  const nonce = randomNonce()
  const hostId = 'host-bound-a'
  const identity = await generateIdentity()
  const publicKey = await encodePublicKey(identity.signing.publicKey)
  const sig = await signTranscript(identity.signing.privateKey, buildRelayTranscript({ nonce, hostId, publicKey }))

  assert.equal(verifyHostRegistration({ nonce, hostId, publicKey, sig }), true)
  assert.equal(
    verifyHostRegistration({ nonce, hostId: 'host-bound-b', publicKey, sig }),
    false,
    'the same proof must not claim a different host id',
  )
  assert.equal(
    verifyHostRegistration({ nonce, hostId, publicKey: await encodePublicKey((await generateIdentity()).signing.publicKey), sig }),
    false,
    'the same proof must not authorize a different key',
  )
})

test('首次注册签名无效时拒绝且不写入绑定', async () => {
  const hostId = 'host-bad-first'
  const identity = await generateIdentity()
  const publicKey = await encodePublicKey(identity.signing.publicKey)
  const connection = await open(HOST_PATH)
  const challenge = await connection.next('challenge')
  connection.say({
    t: 'register',
    v: RELAY_VERSION,
    hostId,
    publicKey,
    // A valid signature over a different challenge is still not a proof for
    // this registration.
    sig: await signTranscript(identity.signing.privateKey, buildRelayTranscript({
      nonce: randomNonce(),
      hostId,
      publicKey,
    })),
  })
  const denied = await connection.next('denied')
  assert.equal(denied.reason, 'bad-signature')
  assert.equal(relay.hosts.has(hostId), false, 'an unproven registration must not be stored')
  connection.close()

  const peer = await open(`${PEER_PATH}?h=${hostId}`)
  assert.equal((await peer.next('unavailable')).reason, UNAVAILABLE.UNKNOWN_HOST)
  peer.close()
})

test('已有绑定时，同公钥的无效签名不能顶掉在线宿主', async () => {
  const hostId = 'host-bad-replace'
  const identity = await generateIdentity()
  const publicKey = await encodePublicKey(identity.signing.publicKey)
  const first = await registerHost(hostId, identity)
  assert.equal(first.registered.t, 'registered')

  const challenger = await open(HOST_PATH)
  await challenger.next('challenge')
  challenger.say({
    t: 'register',
    v: RELAY_VERSION,
    hostId,
    publicKey,
    sig: await signTranscript(identity.signing.privateKey, buildRelayTranscript({
      nonce: randomNonce(),
      hostId,
      publicKey,
    })),
  })
  const denied = await challenger.next('denied')
  assert.equal(denied.reason, 'bad-signature')
  challenger.close()

  // The old connection must still be the one a device reaches. If the invalid
  // registration had replaced it, this link would time out or fail.
  const peer = await open(`${PEER_PATH}?h=${hostId}`)
  const linked = await peer.next('linked')
  assert.equal(linked.t, 'linked')
  await first.connection.next('peer-joined')
  peer.close()
  first.connection.close()
})

test('未注册的 hostId 会收到 unavailable 而不是静默挂起', async () => {
  const peer = await open(`${PEER_PATH}?h=nobody-home`)
  const message = await peer.next('unavailable')
  assert.equal(message.reason, UNAVAILABLE.UNKNOWN_HOST)
  peer.close()
})

test('宿主不在线时设备收到 host-offline', async () => {
  const host = await registerHost('host-offline-case')
  host.connection.close()
  await new Promise((resolve) => setTimeout(resolve, 60))

  const peer = await open(`${PEER_PATH}?h=host-offline-case`)
  const message = await peer.next('unavailable')
  assert.equal(message.reason, UNAVAILABLE.HOST_OFFLINE)
  peer.close()
})

test('中继原样转发两个方向的消息，包括二进制', async () => {
  const { host, peer } = await linkedPair('host-forward')

  peer.say({ t: 'hello', marker: 'from-peer' })
  host.connection.say({ t: 'host', marker: 'from-host' })
  const binary = Uint8Array.from([0, 1, 2, 250, 251, 252])
  peer.send(binary)

  const atHost = await host.connection.next((m) => m?.marker === 'from-peer')
  assert.equal(atHost.marker, 'from-peer')
  // The binary frame is what proves the relay does not assume text: a relay that
  // decoded every frame as UTF-8 would corrupt these bytes rather than drop them.
  const binaryAtHost = await host.connection.nextBinary()
  assert.deepEqual(new Uint8Array(binaryAtHost.data), binary)

  const atPeer = await peer.next((m) => m?.marker === 'from-host')
  assert.equal(atPeer.marker, 'from-host')

  peer.close()
  host.connection.close()
})

test('设备 READY 之前到达的宿主帧会被扣住，链路打开后按原序补发而非丢弃', async () => {
  const host = await registerHost('host-held')
  const peer = await open(`${PEER_PATH}?h=host-held`)
  await peer.next('linked')
  await host.connection.next('peer-joined')

  // The Host may answer `hello` the moment it hears a device exists, and the
  // relay parses the Host's socket and the device's socket independently: this
  // answer can land before the device's READY does. It is real traffic, so the
  // relay has to hold it. An earlier version dropped it, and the first handshake
  // round then died with both ends waiting.
  sayReady(host.connection)
  host.connection.say({ t: 'host', marker: 'early-1' })
  host.connection.say({ t: 'host', marker: 'early-2' })
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.deepEqual(peer.entries.map((entry) => entry.message?.t), ['linked'], 'nothing may reach the device before its READY opens the link')

  sayReady(peer)
  const first = await peer.next((m) => m?.marker === 'early-1')
  const second = await peer.next((m) => m?.marker === 'early-2')
  assert.equal(first.marker, 'early-1', 'held frames must be released in the order the Host sent them')
  assert.equal(second.marker, 'early-2')

  peer.close()
  host.connection.close()
})

test('设备断开会让宿主收到 peer-gone，宿主可以再接一个设备', async () => {
  const { host, peer } = await linkedPair('host-recycle')

  peer.close()
  await host.connection.next('peer-gone')

  const second = await open(`${PEER_PATH}?h=host-recycle`)
  const linked = await second.next('linked')
  assert.equal(linked.hostId, 'host-recycle')
  await host.connection.next('peer-joined')
  sayReady(host.connection)
  sayReady(second)
  second.close()
  host.connection.close()
})

test('一个宿主同时只接一个设备，第二个收到 host-busy', async () => {
  const { host, peer } = await linkedPair('host-busy-case')

  const second = await open(`${PEER_PATH}?h=host-busy-case`)
  const message = await second.next('unavailable')
  assert.equal(message.reason, UNAVAILABLE.HOST_BUSY)

  peer.close()
  second.close()
  host.connection.close()
})

test('设备在 READY 之前发的数据帧会被扣住，READY 一到就按原序补发', async () => {
  const host = await registerHost('host-phase')
  const peer = await open(`${PEER_PATH}?h=host-phase`)
  await peer.next('linked')
  await host.connection.next('peer-joined')
  sayReady(host.connection)

  // A real device sends `ready` and its first handshake frame back to back on
  // one socket, so the relay reads them in whichever order they arrive. Closing
  // the device for that race punishes it for something it cannot observe, and
  // dropping the frame loses the handshake — so it is held, like the Host's.
  peer.say({ t: 'hello', marker: 'before-ready' })
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.deepEqual(
    host.connection.entries.map((entry) => entry.message?.marker).filter(Boolean),
    [],
    'nothing may reach the Host before the device says READY',
  )

  sayReady(peer)
  const delivered = await host.connection.next((m) => m?.marker === 'before-ready')
  assert.equal(delivered.marker, 'before-ready')

  peer.close()
  host.connection.close()
})

test('两端都 READY 之后链路才放行，且数据帧不再需要控制帧让路', async () => {
  const { host, peer } = await linkedPair('host-sequence')

  peer.say({ t: 'hello', marker: 'after-ready' })
  const atHost = await host.connection.next((m) => m?.marker === 'after-ready')
  assert.equal(atHost.marker, 'after-ready')

  host.connection.say({ t: 'host', marker: 'answer' })
  const atPeer = await peer.next((m) => m?.marker === 'answer')
  assert.equal(atPeer.marker, 'answer')

  peer.close()
  host.connection.close()
})

test('宿主 ready 的守卫帧不会泄露给设备', async () => {
  const { host, peer } = await linkedPair('host-guard')

  peer.say({ t: 'hello', marker: 'first' })
  await host.connection.next((m) => m?.marker === 'first')
  // Give the relay time to deliver anything else it was holding.
  await new Promise((resolve) => setTimeout(resolve, 80))

  const typed = peer.entries.map((entry) => entry.message?.t).filter(Boolean)
  assert.deepEqual(typed, ['linked'], 'the device must never see a relay control frame once it is forwarding')

  peer.close()
  host.connection.close()
})

test('绑定关系落盘：重启后同一个 hostId 仍要求同一把密钥', async () => {
  const path = join(store, 'binding.json')

  /** Register on a fresh relay and return the outcome. */
  const claim = async (port, hostId, identity) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${HOST_PATH}`)
    const connection = wrapClientSocket(socket)
    const seen = []
    const waitFor = (predicate) => new Promise((resolve) => {
      const already = seen.find(predicate)
      if (already !== undefined) return resolve(already)
      const check = () => {
        const found = seen.find(predicate)
        if (found !== undefined) resolve(found)
        else setTimeout(check, 10)
      }
      check()
    })
    connection.on('message', (data, isText) => seen.push(isText ? JSON.parse(data) : null))
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve)
      socket.addEventListener('error', () => reject(new Error('connect failed')))
    })
    const challenge = await waitFor((m) => m?.t === 'challenge')
    assert.equal(challenge.t, 'challenge')
    const publicKey = await encodePublicKey(identity.signing.publicKey)
    // Not `connection.say`: this helper builds a bare wrapped socket, not the
    // queueing connection the rest of the file uses.
    connection.send(JSON.stringify({
      t: 'register',
      v: RELAY_VERSION,
      hostId,
      publicKey,
      sig: await signTranscript(identity.signing.privateKey, buildRelayTranscript({ nonce: challenge.nonce, hostId, publicKey })),
    }))
    const outcome = await waitFor((m) => m?.t === 'registered' || m?.t === 'denied')
    connection.close()
    return outcome
  }

  const first = createRelay({ port: 0, storePath: path })
  await new Promise((resolve) => first.listen(resolve))
  const port1 = first.server.address().port
  const boundKey = await generateIdentity()
  assert.equal((await claim(port1, 'persisted', boundKey)).t, 'registered')
  await first.close()

  const second = createRelay({ port: 0, storePath: path })
  await new Promise((resolve) => second.listen(resolve))
  const port2 = second.server.address().port
  assert.equal(
    (await claim(port2, 'persisted', await generateIdentity())).t,
    'denied',
    'a restart must not forget the binding',
  )
  assert.equal((await claim(port2, 'persisted', boundKey)).t, 'registered')
  await second.close()
})

test('端到端：设备经中继与宿主完成握手，加密 RPC 双向通过', async () => {
  const hostIdentity = await generateIdentity()
  const peerIdentity = await generateIdentity()
  const deviceId = 'device-through-relay'
  const hostId = 'host-e2e'
  const publicKey = await encodePublicKey(peerIdentity.signing.publicKey)
  const agreementKey = await encodePublicKey(peerIdentity.agreement.publicKey)
  const devices = new Map([[deviceId, { deviceId, publicKey, agreementKey, status: 'trusted' }]])

  const { host, peer } = await linkedPair(hostId, hostIdentity)

  const hostHandshake = new HostHandshake({
    identity: hostIdentity,
    hostId,
    resolveDevice: async (id) => devices.get(id),
  })
  const peerHandshake = new PeerHandshake({ identity: peerIdentity, deviceId, hostId })

  // The Host pumps every text frame it receives into the handshake and sends
  // whatever comes back. This is the whole client-side integration: the relay is
  // not mentioned anywhere in it.
  const hostDone = new Promise((resolve, reject) => {
    host.connection.on('message', async (data, isText) => {
      if (!isText) return
      try {
        const step = await hostHandshake.next(JSON.parse(data))
        if (step.send !== undefined) host.connection.say(step.send)
        if (step.done) resolve()
      } catch (error) {
        reject(error)
      }
    })
  })

  const hello = await peerHandshake.next(undefined)
  peer.say(hello.send)
  const hostReply = await peer.next('host')
  const prove = await peerHandshake.next(hostReply)
  peer.say(prove.send)
  await hostDone

  assert.equal(peerHandshake.sas, hostHandshake.sas, 'both sides must agree on the short code')

  // Device -> relay -> host.
  const request = new TextEncoder().encode(JSON.stringify({ method: 'session/list', payload: {} }))
  const receivedByHost = new Promise((resolve, reject) => {
    host.connection.on('message', async (data, isText) => {
      if (isText) return
      try {
        resolve(await hostHandshake.session.open(new Uint8Array(data)))
      } catch (error) {
        reject(error)
      }
    })
  })
  peer.send(await peerHandshake.session.seal(request))
  assert.deepEqual(await receivedByHost, request)

  // Host -> relay -> device.
  const replyBody = new TextEncoder().encode(JSON.stringify({ ok: true, sessions: [] }))
  const returnedToPeer = new Promise((resolve, reject) => {
    peer.on('message', async (data, isText) => {
      if (isText) return
      try {
        resolve(await peerHandshake.session.open(new Uint8Array(data)))
      } catch (error) {
        reject(error)
      }
    })
  })
  host.connection.send(await hostHandshake.session.seal(replyBody))
  assert.deepEqual(await returnedToPeer, replyBody)

  peer.close()
  host.connection.close()
})

test('中继原样转发，不改写也不解析它无权理解的内容', async () => {
  const { host, peer } = await linkedPair('host-opaque')

  const payload = {
    t: 'hello',
    v: 'eduwork-remote/2',
    deviceId: 'secret-device-name',
    nested: { a: [1, 2, 3] },
  }
  peer.say(payload)
  const atHost = await host.connection.next((m) => m?.t === 'hello')

  // The relay forwards rather than parses. What this asserts is the property the
  // relay is responsible for: the bytes arrive unchanged, so it had no
  // opportunity to rewrite a handshake field on the way through.
  assert.deepEqual(atHost, payload)

  peer.close()
  host.connection.close()
})
