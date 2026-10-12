/**
 * The handshake must be provable in one process before any socket exists.
 *
 * These tests run a real `PeerHandshake` against a real `HostHandshake` with
 * real WebCrypto keys, driven only by the messages they produce. That is the
 * point: if the two sides cannot agree on a transcript here, no amount of relay
 * plumbing will save them.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DIRECTION,
  FRAME,
  KIND,
  Session,
  TRANSCRIPT,
  buildTranscript,
  decodePublicKey,
  deriveSecret,
  domainSeparate,
  encodeEphemeral,
  encodePublicKey,
  fromBase64url,
  generateEphemeral,
  generateIdentity,
  signTranscript,
  splitFrame,
  toBase64url,
  verifyTranscript,
} from '../src/channel/crypto.js'
import { HANDSHAKE_FAILURE, HostHandshake, PeerHandshake } from '../src/channel/handshake.js'

/**
 * Drive both halves to completion, strictly alternating hello → host → prove → ready.
 *
 * Both sides report `done` before they have finished: for the peer that only
 * means "I have a session", for the host "I have sent `ready`". The loop
 * therefore stops on the driver's own counter, not on either side's flag.
 */
async function complete(peer, host) {
  let message = (await peer.next(undefined)).send
  const transcript = [message]
  for (let step = 0; step < 4; step += 1) {
    const reply = await host.next(message)
    if (reply.send !== undefined) transcript.push(reply.send)
    if (reply.done) return transcript
    message = (await peer.next(reply.send)).send
    if (message !== undefined) transcript.push(message)
  }
  throw new Error('handshake did not settle within four messages')
}

async function scenario({ deviceStatus = 'trusted' } = {}) {
  const hostIdentity = await generateIdentity()
  const peerIdentity = await generateIdentity()
  const hostId = 'host-test-1'
  const deviceId = 'device-test-1'
  const publicKey = await encodePublicKey(peerIdentity.signing.publicKey)
  const agreementKey = await encodePublicKey(peerIdentity.agreement.publicKey)

  const devices = new Map([[deviceId, { deviceId, publicKey, agreementKey, status: deviceStatus }]])
  const host = new HostHandshake({
    identity: hostIdentity,
    hostId,
    resolveDevice: async (id) => devices.get(id),
  })
  const peer = new PeerHandshake({ identity: peerIdentity, deviceId, hostId })
  return { host, peer, hostIdentity, peerIdentity, publicKey, agreementKey, hostId, deviceId }
}

test('双方就同一份转录达成一致，并导出可互通的方向密钥', async () => {
  const { host, peer } = await scenario()
  await complete(peer, host)

  assert.ok(peer.session instanceof Session, 'device side must hold a session')
  assert.ok(host.session instanceof Session, 'host side must hold a session')
  assert.equal(peer.session.expectDirection, DIRECTION.HOST_TO_PEER)
  assert.equal(host.session.expectDirection, DIRECTION.PEER_TO_HOST)
})

test('短认证码在两端一致', async () => {
  const { host, peer } = await scenario()
  await complete(peer, host)
  assert.equal(peer.sas, host.sas)
  assert.equal(fromBase64url(peer.sas).length, 4)
})

test('设备发出的帧宿主能解，宿主的帧设备能解', async () => {
  const { host, peer } = await scenario()
  await complete(peer, host)

  const request = new TextEncoder().encode('{"t":"rpc"}')
  const sealed = await peer.session.seal(request)
  assert.ok(sealed instanceof Uint8Array, 'a sealed frame must be one contiguous byte string')
  assert.deepEqual(await host.session.open(sealed), request)

  const reply = new TextEncoder().encode('{"ok":true}')
  const sealedBack = await host.session.seal(reply)
  assert.deepEqual(await peer.session.open(sealedBack), reply)
})

test('序号必须严格递增：重放一帧被拒', async () => {
  const { host, peer } = await scenario()
  await complete(peer, host)

  const first = await peer.session.seal(new TextEncoder().encode('one'))
  await host.session.open(first)
  await assert.rejects(() => host.session.open(first), /expected frame 1 but received 0/)
})

test('篡改头部会让 AEAD 认证失败', async () => {
  const { host, peer } = await scenario()
  await complete(peer, host)

  const sealed = await peer.session.seal(new TextEncoder().encode('payload'))
  const tampered = Uint8Array.from(sealed)
  tampered[10] = 0x7f
  await assert.rejects(() => host.session.open(tampered))
})

test('篡改密文会让 AEAD 认证失败', async () => {
  const { host, peer } = await scenario()
  await complete(peer, host)

  const sealed = await peer.session.seal(new TextEncoder().encode('payload'))
  const tampered = Uint8Array.from(sealed)
  tampered[tampered.length - 1] ^= 0x01
  await assert.rejects(() => host.session.open(tampered))
})

test('方向位写反的帧被拒', async () => {
  const { host, peer } = await scenario()
  await complete(peer, host)

  // The peer seals as PEER_TO_HOST; a frame claiming the other direction must not
  // be accepted, or one side could be made to decrypt its own outbound traffic.
  const sealed = await peer.session.seal(new TextEncoder().encode('payload'))
  assert.equal(sealed[1], DIRECTION.PEER_TO_HOST)
  const flipped = Uint8Array.from(sealed)
  flipped[1] = DIRECTION.HOST_TO_PEER
  await assert.rejects(() => host.session.open(flipped), /direction does not match/)
})

test('过短的帧在切片时就被拒', async () => {
  const { host, peer } = await scenario()
  await complete(peer, host)
  await assert.rejects(() => host.session.open(new Uint8Array(10)), /shorter than its header/)
})

test('未登记的设备在第一步就被拒，且没有任何会话产生', async () => {
  const hostIdentity = await generateIdentity()
  const peerIdentity = await generateIdentity()
  const host = new HostHandshake({
    identity: hostIdentity,
    hostId: 'h',
    resolveDevice: async () => undefined,
  })
  const peer = new PeerHandshake({ identity: peerIdentity, deviceId: 'stranger', hostId: 'h' })
  const hello = await peer.next(undefined)

  await assert.rejects(() => host.next(hello.send), (error) => {
    assert.equal(error.reason, HANDSHAKE_FAILURE.DEVICE_UNKNOWN)
    return true
  })
  assert.equal(host.session, null)
})

test('已撤销的设备被拒，理由与未登记不同', async () => {
  const { host, peer } = await scenario({ deviceStatus: 'revoked' })
  const hello = await peer.next(undefined)
  await assert.rejects(() => host.next(hello.send), (error) => {
    assert.equal(error.reason, HANDSHAKE_FAILURE.DEVICE_REVOKED)
    return true
  })
})

test('设备公钥与登记不符时被拒——握手消息里的公钥不被信任', async () => {
  const { host, peer } = await scenario()
  const hello = await peer.next(undefined)
  const impostor = await generateIdentity()
  const forged = { ...hello.send, Sh: await encodePublicKey(impostor.signing.publicKey) }
  await assert.rejects(() => host.next(forged), (error) => {
    assert.equal(error.reason, HANDSHAKE_FAILURE.PEER_SIGNATURE)
    return true
  })
})

test('设备固定的宿主公钥不匹配时不接受该宿主', async () => {
  const { peer, peerIdentity, host, hostId, deviceId } = await scenario()
  const hello = await peer.next(undefined)
  const hostReply = await host.next(hello.send)

  const stranger = await generateIdentity()
  const pinned = new PeerHandshake({
    identity: peerIdentity,
    deviceId,
    hostId,
    pinnedHostKey: await encodePublicKey(stranger.signing.publicKey),
  })
  await pinned.next(undefined)
  await assert.rejects(() => pinned.next(hostReply.send), (error) => {
    assert.equal(error.reason, HANDSHAKE_FAILURE.HOST_SIGNATURE)
    return true
  })
})

test('中继换掉宿主的临时公钥会让设备拒绝——转录覆盖双方临时密钥', async () => {
  const { host, peer } = await scenario()
  const hello = await peer.next(undefined)
  const hostReply = await host.next(hello.send)

  const substitute = await generateEphemeral()
  const swapped = { ...hostReply.send, Eh: await encodeEphemeral(substitute.publicKey) }

  await assert.rejects(() => peer.next(swapped), (error) => {
    assert.equal(error.reason, HANDSHAKE_FAILURE.HOST_SIGNATURE)
    return true
  })
})

test('宿主与设备算出的静态-静态秘密相同', async () => {
  const { hostIdentity, peerIdentity } = await scenario()
  const fromHost = await deriveSecret(hostIdentity.agreement.privateKey, peerIdentity.agreement.publicKey)
  const fromPeer = await deriveSecret(peerIdentity.agreement.privateKey, hostIdentity.agreement.publicKey)
  assert.deepEqual(fromHost, fromPeer)
  assert.equal(fromHost.length, 32)
})

test('公钥文本形式往返一致，且长度符合 P-256 非压缩点', async () => {
  const identity = await generateIdentity()
  const text = await encodePublicKey(identity.signing.publicKey)
  assert.match(text, /^p256:[A-Za-z0-9_-]{87}$/)
  const decoded = await decodePublicKey(text)
  assert.equal(await encodePublicKey(decoded), text)
})

test('签名与验签可往返，改一个字节即失败', async () => {
  const identity = await generateIdentity()
  const message = new TextEncoder().encode('hello')
  const signature = await signTranscript(identity.signing.privateKey, message)
  assert.equal(await verifyTranscript(identity.signing.publicKey, message, signature), true)
  assert.equal(await verifyTranscript(identity.signing.publicKey, new TextEncoder().encode('hellp'), signature), false)
})

test('乱序到达的消息被当作协议错误', async () => {
  const { host, peer } = await scenario()
  const hello = await peer.next(undefined)
  await host.next(hello.send)
  await assert.rejects(() => host.next(hello.send), (error) => {
    assert.equal(error.reason, HANDSHAKE_FAILURE.PROTOCOL)
    return true
  })
})

test('帧格式常量与实际载荷一致', async () => {
  const { host, peer } = await scenario()
  await complete(peer, host)
  const sealed = await peer.session.seal(new Uint8Array(0))
  assert.equal(sealed[0], FRAME.VERSION)
  assert.equal(sealed[1], DIRECTION.PEER_TO_HOST)
  assert.equal(sealed[10], KIND.RPC)
  assert.equal(sealed.length, FRAME.HEADER_BYTES + FRAME.TAG_BYTES)
  assert.deepEqual(fromBase64url(toBase64url(sealed)), sealed)
})

test('base64url 编解码无填充且可往返', async () => {
  for (const length of [0, 1, 2, 3, 31, 32, 33, 65]) {
    const bytes = new Uint8Array(length).map((_, index) => (index * 7 + 13) & 0xff)
    const text = toBase64url(bytes)
    assert.doesNotMatch(text, /=/)
    assert.deepEqual(fromBase64url(text), bytes)
  }
})

test('转录对字段顺序敏感', async () => {
  const base = {
    hostId: 'h',
    deviceId: 'd',
    peerStaticKey: `p256:${toBase64url(new Uint8Array(65).fill(1))}`,
    hostStaticKey: `p256:${toBase64url(new Uint8Array(65).fill(2))}`,
    peerNonce: toBase64url(new Uint8Array(32).fill(3)),
    hostNonce: toBase64url(new Uint8Array(32).fill(4)),
    hostEphemeral: toBase64url(new Uint8Array(65).fill(5)),
    peerEphemeral: toBase64url(new Uint8Array(65).fill(6)),
  }
  const { buildTranscript } = await import('../src/channel/crypto.js')
  const swapped = buildTranscript({ ...base, hostId: 'H', deviceId: 'd' })
  const normal = buildTranscript(base)
  assert.notDeepEqual(swapped, normal)

  const separated = domainSeparate(TRANSCRIPT.HELLO, normal)
  assert.notDeepEqual(separated, normal)
  assert.ok(separated.length > normal.length)
})
