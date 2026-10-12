/**
 * The relay, driven over a real socket by a real Host and a real device.
 *
 * `relay.test.mjs` drives the relay's internals. This drives it the way a phone and
 * a desktop actually do: two WebSocket clients, a genuine `HostHandshake`, a
 * genuine `PeerHandshake`, and genuine sealed frames in both directions. A relay
 * that dropped, reordered or mangled a frame between the two would pass every
 * in-process test and fail here.
 *
 * It is also the only test that pins the whole wire contract at once —
 * challenge/register, `linked`, `peer-joined`, the READY hand-off on both sides,
 * and then transparency. Each has a unit test; none of them prove they fit
 * together.
 *
 * Identities are generated per run and the relay is given a temporary directory, so
 * nothing here reads or writes anything real.
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'

import { buildRelayTranscript, encodePublicKey, generateIdentity, signTranscript } from '../src/channel/crypto.js'
import { HostHandshake, PeerHandshake } from '../src/channel/handshake.js'
import { RELAY_VERSION } from '../src/relay/protocol.js'
import { createRelay } from '../src/relay/relay.js'
import { DEVICE_STATUS } from '../src/registry.js'

let relay
let base
let workspace

before(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'eduwork-relay-e2e-'))
  const webRoot = join(workspace, 'web')
  const frontendRoot = join(workspace, 'frontend')
  await mkdir(webRoot, { recursive: true })
  await mkdir(frontendRoot, { recursive: true })
  await writeFile(join(webRoot, 'bootstrap.js'), '/* synthetic */\n', 'utf8')
  await writeFile(join(frontendRoot, 'index.html'), '<!doctype html><html><head></head><body></body></html>\n', 'utf8')

  relay = createRelay({
    host: '127.0.0.1',
    port: 0,
    storePath: join(workspace, 'hosts.json'),
    webRoot,
    frontendRoot,
  })
  await new Promise(resolve => relay.listen(resolve))
  base = `ws://127.0.0.1:${String(relay.server.address().port)}`
})

after(async () => {
  await relay?.close()
  if (workspace !== undefined) await rm(workspace, { recursive: true, force: true })
})

/**
 * A socket with a queue, so a frame that arrives before anything waits for it is
 * not lost. Control frames and sealed frames are kept apart: the relay sends its
 * own `ready` in among the handshake, and a test that mixed the two would be
 * testing its own bookkeeping.
 */
function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    // Before any listener: the default is `blob`, and a Blob reaching a frame
    // parser produces a zero-length array rather than an error.
    socket.binaryType = 'arraybuffer'
    const text = []
    const binary = []
    const waiters = []

    socket.addEventListener('message', (event) => {
      const isText = typeof event.data === 'string'
      const value = isText ? JSON.parse(event.data) : new Uint8Array(event.data)
      const waiter = waiters.shift()
      if (waiter !== undefined) waiter({ isText, value })
      else (isText ? text : binary).push(value)
    })
    socket.addEventListener('error', () => reject(new Error(`could not connect to ${url}`)))
    socket.addEventListener('open', () => {
      resolve({
        socket,
        send: value => socket.send(value),
        sendJson: value => socket.send(JSON.stringify(value)),
        next(timeoutMs = 5000) {
          if (text.length > 0) return Promise.resolve({ isText: true, value: text.shift() })
          if (binary.length > 0) return Promise.resolve({ isText: false, value: binary.shift() })
          return new Promise((nextResolve, nextReject) => {
            const entry = (frame) => { clearTimeout(timer); nextResolve(frame) }
            const timer = setTimeout(() => {
              const index = waiters.indexOf(entry)
              if (index >= 0) waiters.splice(index, 1)
              nextReject(new Error(`timed out waiting for a frame from ${url}`))
            }, timeoutMs)
            waiters.push(entry)
          })
        },
        async nextText(match, timeoutMs = 5000) {
          const deadline = Date.now() + timeoutMs
          for (;;) {
            const frame = await this.next(Math.max(1, deadline - Date.now()))
            if (frame.isText && (match === undefined || match(frame.value))) return frame.value
          }
        },
        async nextBinary(timeoutMs = 5000) {
          const deadline = Date.now() + timeoutMs
          for (;;) {
            const frame = await this.next(Math.max(1, deadline - Date.now()))
            if (!frame.isText) return frame.value
          }
        },
      })
    })
  })
}

async function registerHost(hostId, identity) {
  const host = await connect(`${base}/host`)
  const challenge = await host.nextText(message => message.t === 'challenge')
  host.sendJson({
    t: 'register',
    v: RELAY_VERSION,
    hostId,
    publicKey: await encodePublicKey(identity.signing.publicKey),
    sig: await signTranscript(identity.signing.privateKey, buildRelayTranscript(challenge.nonce)),
  })
  const answer = await host.nextText(message => message.t === 'registered' || message.t === 'denied')
  return { host, answer }
}

/** A paired Host and device, over the live relay, with the handshake complete. */
async function linkedPair() {
  const hostIdentity = await generateIdentity()
  const deviceIdentity = await generateIdentity()
  const hostId = `e2e-host-${Math.random().toString(36).slice(2, 10)}`
  const deviceId = `e2e-device-${Math.random().toString(36).slice(2, 10)}`
  const device = {
    deviceId,
    name: 'synthetic device',
    status: DEVICE_STATUS.TRUSTED,
    publicKey: await encodePublicKey(deviceIdentity.signing.publicKey),
    agreementKey: await encodePublicKey(deviceIdentity.agreement.publicKey),
  }

  const { host, answer } = await registerHost(hostId, hostIdentity)
  assert.equal(answer.t, 'registered', JSON.stringify(answer))

  const peer = await connect(`${base}/peer?h=${encodeURIComponent(hostId)}`)
  const linked = await peer.nextText(message => message.t === 'linked' || message.t === 'unavailable')
  assert.equal(linked.t, 'linked', JSON.stringify(linked))
  assert.equal((await host.nextText(message => message.t === 'peer-joined')).t, 'peer-joined')

  // Both sides hand off the control channel before the relay forwards anything.
  // The Host goes first, as `src/relay/tunnel.js` does when it sees `peer-joined`.
  host.sendJson({ t: 'ready' })
  peer.sendJson({ t: 'ready' })

  const peerHandshake = new PeerHandshake({ identity: deviceIdentity, deviceId, hostId })
  const hostHandshake = new HostHandshake({
    identity: hostIdentity,
    hostId,
    resolveDevice: id => (id === deviceId ? device : undefined),
  })

  peer.sendJson((await peerHandshake.next(undefined)).send)
  host.sendJson((await hostHandshake.next(await host.nextText(message => message.t === 'hello'))).send)
  const deviceStep = await peerHandshake.next(await peer.nextText(message => message.t === 'host'))
  peer.sendJson(deviceStep.send)
  const hostStep = await hostHandshake.next(await host.nextText(message => message.t === 'prove'))
  host.sendJson(hostStep.send)

  return { host, peer, hostId, deviceId, hostHandshake, peerHandshake, deviceStep, hostStep }
}

function closePair(pair) {
  pair.peer.socket.close()
  pair.host.socket.close()
}

test('宿主注册、设备接入、两端完成握手，短认证字符串一致', async () => {
  const pair = await linkedPair()
  try {
    assert.equal(pair.deviceStep.done, true, 'the device must consider the handshake finished')
    assert.equal(pair.hostStep.done, true, 'the host must consider the handshake finished')
    assert.equal(pair.hostHandshake.deviceId, pair.deviceId)
    // Both ends derive this from bytes the relay carried but cannot read, so equal
    // strings mean both derived the same keys from the same transcript.
    assert.equal(pair.peerHandshake.sas, pair.hostHandshake.sas)
    assert.equal(typeof pair.peerHandshake.sas, 'string')
  } finally {
    closePair(pair)
  }
})

test('密封帧双向穿过中继，且中继看不到内容', async () => {
  const pair = await linkedPair()
  const utf8 = new TextEncoder()
  try {
    const call = JSON.stringify({ type: 'client-request', rpcId: 'e2e-1', method: 'session/list', payload: { args: { _request: {} } } })
    pair.peer.send(await pair.peerHandshake.session.seal(utf8.encode(call)))
    const arrived = await pair.host.nextBinary()
    assert.equal(new TextDecoder().decode(await pair.hostHandshake.session.open(arrived)), call)

    // The relay's view of that frame. The method it is carrying must not be
    // recoverable from it — the end-to-end claim, checked rather than asserted in a
    // comment.
    const onTheWire = new TextDecoder('latin1').decode(arrived)
    assert.equal(onTheWire.includes('session/list'), false)
    assert.equal(onTheWire.includes('client-request'), false)

    const reply = JSON.stringify({ type: 'server-response', rpcId: 'e2e-1', result: { ok: true, value: { sessions: ['a', 'b'] } } })
    pair.host.send(await pair.hostHandshake.session.seal(utf8.encode(reply)))
    const replyArrived = await pair.peer.nextBinary()
    assert.equal(new TextDecoder().decode(await pair.peerHandshake.session.open(replyArrived)), reply)
  } finally {
    closePair(pair)
  }
})

test('大帧完整穿过，不被消息上限截断', async () => {
  const pair = await linkedPair()
  try {
    // Chunking and length bugs only appear at a boundary, and a session reply can
    // legitimately be large.
    const big = JSON.stringify({ type: 'server-response', rpcId: 'e2e-big', result: { ok: true, value: 'x'.repeat(400_000) } })
    pair.host.send(await pair.hostHandshake.session.seal(new TextEncoder().encode(big)))
    const arrived = await pair.peer.nextBinary(15_000)
    assert.equal(new TextDecoder().decode(await pair.peerHandshake.session.open(arrived)), big)
    // Larger on the wire than the plaintext by the frame overhead, not smaller.
    assert.equal(arrived.length > big.length, true)
  } finally {
    closePair(pair)
  }
})

test('重放同一段密文会被拒，因为序号已经推进', async () => {
  const pair = await linkedPair()
  try {
    const call = JSON.stringify({ type: 'client-request', rpcId: 'e2e-replay', method: 'session/list', payload: {} })
    const frame = await pair.peerHandshake.session.seal(new TextEncoder().encode(call))
    pair.peer.send(frame)
    const first = await pair.host.nextBinary()
    assert.equal(new TextDecoder().decode(await pair.hostHandshake.session.open(first)), call)

    // The relay is not asked to prevent this and cannot prevent it; the channel
    // does, because the sequence is part of the nonce.
    await assert.rejects(pair.hostHandshake.session.open(first), /expected frame/u)
  } finally {
    closePair(pair)
  }
})

test('设备在宿主 READY 之前发的帧被扣住，READY 一到就补发', async () => {
  const hostIdentity = await generateIdentity()
  const hostId = `e2e-order-${Math.random().toString(36).slice(2, 10)}`

  const { host, answer } = await registerHost(hostId, hostIdentity)
  assert.equal(answer.t, 'registered')
  // Deliberately no READY from the Host yet: its frames must be held.

  const peer = await connect(`${base}/peer?h=${encodeURIComponent(hostId)}`)
  try {
    await peer.nextText(message => message.t === 'linked')
    await host.nextText(message => message.t === 'peer-joined')
    peer.sendJson({ t: 'ready' })
    const marker = new TextEncoder().encode('held-until-ready')
    peer.send(marker)

    // Nothing may reach the Host while it has not handed off its control channel.
    await assert.rejects(host.nextBinary(250), /timed out/u)

    host.sendJson({ t: 'ready' })
    const arrived = await host.nextBinary()
    assert.deepEqual(Array.from(arrived), Array.from(marker), 'the held frame must arrive intact and in order')
  } finally {
    peer.socket.close()
    host.socket.close()
  }
})

test('未知 hostId 的设备收到 unavailable，而不是被接到别处', async () => {
  const peer = await connect(`${base}/peer?h=${encodeURIComponent('no-such-host-anywhere')}`)
  try {
    const answer = await peer.nextText(message => message.t === 'linked' || message.t === 'unavailable')
    assert.equal(answer.t, 'unavailable')
    assert.equal(answer.reason, 'unknown-host')
  } finally {
    peer.socket.close()
  }
})

test('同一个 hostId 换一把钥匙注册会被拒', async () => {
  const hostIdentity = await generateIdentity()
  const hostId = `e2e-bound-${Math.random().toString(36).slice(2, 10)}`

  const first = await registerHost(hostId, hostIdentity)
  assert.equal(first.answer.t, 'registered')
  first.host.socket.close()

  // A second claim on the same id with a different key. The relay cannot check the
  // signature — it has no crypto — but it does bind the id to the first key it saw,
  // which is what stops anyone else taking a host id already in use.
  const impostor = await generateIdentity()
  const second = await registerHost(hostId, impostor)
  assert.equal(second.answer.t, 'denied')
  assert.equal(second.answer.reason, 'host-id-taken')
  second.host.socket.close()
})
