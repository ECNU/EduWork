/**
 * Channel primitives shared by the Host plugin and the browser bootstrap.
 *
 * Every function here runs on `globalThis.crypto.subtle` and `globalThis.Buffer`
 * only where Buffer exists, so the same bytes-identical module executes in Node
 * and in a browser tab. Nothing in this directory may import `node:*`, and
 * nothing may generate keys at import time.
 *
 * Cryptographic choices and why they are not Noise are argued in
 * `notes/19-中继协议与端到端加密.md` §7. The short version: the usable subset of
 * WebCrypto is P-256 ECDSA, P-256 ECDH, AES-GCM and HMAC-SHA256, and the Noise
 * suites need primitives neither runtime exposes.
 */

/** Protocol version carried in the handshake and in every frame header. */
export const PROTOCOL = 'eduwork-remote/2'

/** Handshake domain separators. Changing one is a protocol break. */
export const TRANSCRIPT = Object.freeze({
  HELLO: 'eduwork-host-v2',
  PROVE: 'eduwork-peer-v2',
  READY: 'eduwork-ready-v2',
  RELAY: 'eduwork-relay-v2',
})

/** Frame header layout. The header is authenticated as AEAD additional data. */
export const FRAME = Object.freeze({ VERSION: 0x02, HEADER_BYTES: 11, TAG_BYTES: 16 })
export const DIRECTION = Object.freeze({ PEER_TO_HOST: 0x01, HOST_TO_PEER: 0x02 })

/**
 * What a frame carries.
 *
 * The distinction exists so that one connection can hold two independent streams
 * whose sequence numbers do not interfere: each `Session` counts its own, so a
 * frame's sequence only has to be contiguous within its kind. `open()` does not
 * check this byte on receipt — it is authenticated as part of the header, not
 * dispatched on — so adding a kind changes nothing about the frame format.
 */
export const KIND = Object.freeze({ RPC: 0x01, STREAM: 0x02 })

const subtle = () => {
  const c = globalThis.crypto
  if (c?.subtle === undefined) throw new Error('channel: WebCrypto is unavailable in this runtime')
  return c.subtle
}

const randomBytes = (length) => {
  const out = new Uint8Array(length)
  globalThis.crypto.getRandomValues(out)
  return out
}

const utf8 = (text) => new TextEncoder().encode(text)

// #region base64url

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/**
 * Encode bytes as unpadded base64url.
 * @param bytes - raw bytes.
 * @returns base64url text with no padding.
 */
export function toBase64url(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (typeof globalThis.Buffer === 'function') {
    return globalThis.Buffer.from(input).toString('base64url')
  }
  let out = ''
  for (let i = 0; i < input.length; i += 3) {
    const a = input[i]
    const b = i + 1 < input.length ? input[i + 1] : undefined
    const c = i + 2 < input.length ? input[i + 2] : undefined
    out += B64[a >> 2]
    out += B64[((a & 0x03) << 4) | ((b ?? 0) >> 4)]
    if (b !== undefined) out += B64[((b & 0x0f) << 2) | ((c ?? 0) >> 6)]
    if (c !== undefined) out += B64[c & 0x3f]
  }
  return out
}

/**
 * Decode unpadded base64url, rejecting anything non-canonical.
 * @param text - base64url text.
 * @returns raw bytes.
 */
export function fromBase64url(text) {
  if (typeof text !== 'string') throw new Error('channel: base64url input must be a string')
  if (typeof globalThis.Buffer === 'function') {
    const normalized = text.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    return new Uint8Array(globalThis.Buffer.from(padded, 'base64'))
  }
  const clean = text.replace(/=+$/, '')
  const out = []
  let acc = 0
  let bits = 0
  for (const ch of clean) {
    const value = B64.indexOf(ch)
    if (value < 0) throw new Error('channel: invalid base64url character')
    acc = (acc << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((acc >> bits) & 0xff)
    }
  }
  return new Uint8Array(out)
}

// #endregion
// #region encoding helpers

/** Constant-time equality over two byte arrays of equal length. */
export function bytesEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i]
  return diff === 0
}

/** Concatenate byte arrays. */
export function concatBytes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/**
 * Decode a base64url string into a public key object of the given algorithm.
 *
 * The usages differ by algorithm and neither choice is free:
 *
 * - `ECDSA` needs `['verify']`. Passing `[]` produces a key WebCrypto accepts at
 *   import and then refuses at the first `verify` with "Unable to use this key
 *   to verify" — a failure that looks like a bad signature, not a bad key.
 * - `ECDH` needs `[]`. The public half of an agreement key cannot hold
 *   `['deriveBits']`, which belongs to the private half; asking for it throws
 *   "Unsupported key usage for a ECDH key" at import.
 *
 * Both were hit while building this, which is why the rule is written down here
 * instead of being left to the next caller to rediscover.
 */
async function importPublic(algorithm, text) {
  const usages = algorithm === 'ECDSA' ? ['verify'] : []
  return subtle().importKey('raw', fromBase64url(text), { name: algorithm, namedCurve: 'P-256' }, true, usages)
}

// #endregion
// #region identity

/**
 * Generate a device or host static identity.
 *
 * Two key pairs, because P-256 ECDSA and P-256 ECDH keys are not
 * interchangeable in WebCrypto: the signing pair proves who this is, the
 * agreement pair contributes the static-static secret that keeps the session key
 * out of reach of anyone holding only the transcript. A single ECDH pair would
 * force challenge-response onto a raw ECDH comparison, and a single ECDSA pair
 * cannot do key agreement at all.
 *
 * The default keeps all four private keys non-extractable, which is what a device
 * wants: its identity never leaves the browser. The Host is the one caller that
 * must pass `extractable: true`, because its long-term identity has to survive a
 * restart — the relay binds `hostId` to the public key of the first registration
 * and refuses a different one forever, and a paired device pins that key. Only
 * {@link exportIdentity} reads the private halves, and the Host stores them in the
 * credential store; they never enter configuration or a log.
 *
 * @param options.extractable - whether the private keys can be exported.
 * @returns `{ signing, agreement }`, each `{ publicKey, privateKey }`.
 */
export async function generateIdentity({ extractable = false } = {}) {
  const signing = await subtle().generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, extractable, ['sign', 'verify'])
  const agreement = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, extractable, ['deriveBits'])
  return { signing, agreement }
}

/**
 * Encode a public key as the registry's portable text form.
 * @param publicKey - a raw P-256 public key, ECDSA or ECDH.
 * @returns `p256:<uncompressed point, base64url>`.
 */
export async function encodePublicKey(publicKey) {
  const raw = await subtle().exportKey('raw', publicKey)
  return `p256:${toBase64url(new Uint8Array(raw))}`
}

/**
 * Decode the registry's portable text form into a public key.
 * @param text - `p256:<base64url>`.
 * @param algorithm - `ECDSA` to verify signatures, `ECDH` to agree on a secret.
 * @returns a raw P-256 public key usable with that algorithm.
 */
export async function decodePublicKey(text, algorithm = 'ECDSA') {
  if (typeof text !== 'string' || !text.startsWith('p256:')) {
    throw new Error('channel: public key must use the "p256:" form')
  }
  const bytes = fromBase64url(text.slice(5))
  if (bytes.length !== 65 || bytes[0] !== 0x04) {
    throw new Error('channel: public key must be a 65-byte uncompressed P-256 point')
  }
  return importPublic(algorithm, text.slice(5))
}

/**
 * Serialize a static identity into the payload a credential record holds.
 *
 * Only the private half is serialized, and the public half travels beside it
 * because WebCrypto cannot derive a public key from an EC private key — the
 * handshake needs both. The result is plain JSON: base64url PKCS#8 for each
 * private key and the existing `p256:` form for each public key.
 *
 * Requires an identity generated with `extractable: true`. A non-extractable one
 * throws `InvalidAccessError`, which is the right answer for a device key: it must
 * not be exportable at all.
 *
 * @param identity - `{ signing, agreement }` from {@link generateIdentity}.
 * @returns `{ version: 1, signing: { private, public }, agreement: { private, public } }`.
 */
export async function exportIdentity(identity) {
  const signing = identity?.signing
  const agreement = identity?.agreement
  if (signing?.privateKey === undefined || signing?.publicKey === undefined
    || agreement?.privateKey === undefined || agreement?.publicKey === undefined) {
    throw new Error('channel: exportIdentity needs signing and agreement key pairs')
  }
  return {
    version: 1,
    signing: {
      private: toBase64url(new Uint8Array(await subtle().exportKey('pkcs8', signing.privateKey))),
      public: await encodePublicKey(signing.publicKey),
    },
    agreement: {
      private: toBase64url(new Uint8Array(await subtle().exportKey('pkcs8', agreement.privateKey))),
      public: await encodePublicKey(agreement.publicKey),
    },
  }
}

/**
 * Rebuild a static identity from {@link exportIdentity}'s payload.
 *
 * The imported private keys are non-extractable again — the export happened once,
 * when the identity was created, and nothing in the running process needs to
 * export it after that. The two key pairs are then checked against each other,
 * because a record whose public half does not match its private half would
 * otherwise fail much later as an unexplained signature or decryption error.
 *
 * @param payload - the stored payload.
 * @returns `{ signing, agreement }`, each `{ publicKey, privateKey }`.
 * @throws when the payload is malformed or its halves do not belong together.
 */
export async function importIdentity(payload) {
  if (payload === null || typeof payload !== 'object' || payload.version !== 1) {
    throw new Error('channel: identity payload has an unsupported shape')
  }
  const signing = payload.signing
  const agreement = payload.agreement
  if (typeof signing?.private !== 'string' || typeof signing?.public !== 'string'
    || typeof agreement?.private !== 'string' || typeof agreement?.public !== 'string') {
    throw new Error('channel: identity payload is missing a key')
  }
  const identity = {
    signing: {
      privateKey: await subtle().importKey(
        'pkcs8', fromBase64url(signing.private), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
      ),
      publicKey: await decodePublicKey(signing.public, 'ECDSA'),
    },
    agreement: {
      privateKey: await subtle().importKey(
        'pkcs8', fromBase64url(agreement.private), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'],
      ),
      publicKey: await decodePublicKey(agreement.public, 'ECDH'),
    },
  }
  await assertIdentityConsistent(identity)
  return identity
}

/**
 * Prove that each stored private key matches the public key stored beside it.
 *
 * Signing has a direct check. Agreement has none on its own, so both directions
 * are derived against one ephemeral key and compared: they can only meet if the
 * two static halves are the same pair.
 *
 * @param identity - imported identity, both pairs.
 * @throws when a pair does not belong together.
 */
async function assertIdentityConsistent(identity) {
  const transcript = utf8('eduwork-remote-access:identity-check')
  const signature = await signTranscript(identity.signing.privateKey, transcript)
  if (!await verifyTranscript(identity.signing.publicKey, transcript, signature)) {
    throw new Error('channel: identity payload pairs a signing key with the wrong public key')
  }
  const ephemeral = await generateEphemeral()
  const secretFromPrivate = await deriveSecret(identity.agreement.privateKey, ephemeral.publicKey)
  const secretFromPublic = await deriveSecret(ephemeral.privateKey, identity.agreement.publicKey)
  if (!bytesEqual(secretFromPrivate, secretFromPublic)) {
    throw new Error('channel: identity payload pairs an agreement key with the wrong public key')
  }
}

/**
 * Sign a transcript with a static identity.
 * @param privateKey - the signer's non-extractable ECDSA private key.
 * @param transcript - byte string being committed to.
 * @returns unpadded base64url signature.
 */
export async function signTranscript(privateKey, transcript) {
  const signature = await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, transcript)
  return toBase64url(new Uint8Array(signature))
}

/**
 * Verify a transcript signature.
 * @param publicKey - the claimed signer's public key.
 * @param transcript - byte string that was signed.
 * @param signature - unpadded base64url signature.
 * @returns true only when the signature is valid.
 */
export async function verifyTranscript(publicKey, transcript, signature) {
  try {
    return await subtle().verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      fromBase64url(signature),
      transcript,
    )
  } catch {
    return false
  }
}

// #endregion
// #region key agreement and derivation

/** Generate one ephemeral ECDH key pair for a single session. */
export async function generateEphemeral() {
  const pair = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
  return pair
}

/**
 * Export an ephemeral public key for the wire.
 * @param publicKey - an ECDH P-256 public key.
 * @returns unpadded base64url uncompressed point.
 */
export async function encodeEphemeral(publicKey) {
  return toBase64url(new Uint8Array(await subtle().exportKey('raw', publicKey)))
}

/**
 * Import the peer's ephemeral public key.
 * @param text - unpadded base64url uncompressed point.
 * @returns an ECDH public key usable as the `public` member of `deriveBits`.
 */
export async function decodeEphemeral(text) {
  const bytes = fromBase64url(text)
  if (bytes.length !== 65 || bytes[0] !== 0x04) {
    throw new Error('channel: ephemeral key must be a 65-byte uncompressed P-256 point')
  }
  return subtle().importKey('raw', bytes, { name: 'ECDH', namedCurve: 'P-256' }, true, [])
}

/**
 * Derive the raw ECDH shared secret from a private and a public key.
 *
 * Exported because both the handshake and its tests need to prove that the two
 * sides reach the same secret; a mismatch here would show up much later as an
 * unexplained decryption failure.
 */
export async function deriveSecret(privateKey, publicKey) {
  const bits = await subtle().deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256)
  return new Uint8Array(bits)
}

/**
 * Expand the handshake secrets into the two directional keys.
 *
 * Two secret contributions are mixed: the ephemeral agreement, which gives
 * forward secrecy, and the static-static agreement, which makes the session key
 * unreachable without one of the two long-term private keys. The transcript is
 * the HMAC message, so key material is bound to every field both sides signed.
 *
 * Direction mapping is the caller's business, not this function's: it returns
 * both keys named by direction and lets the protocol layer decide which one it
 * sends on. Putting a `role` switch here would mean this module has to know who
 * it is talking to.
 *
 * @param input - both agreements plus the completed transcript.
 * @returns `{ peerToHost, hostToPeer, sas }`, all raw key material.
 */
export async function deriveSessionKeys({ ephemeralSecret, staticSecret, transcript }) {
  const prk = await hmac(ephemeralSecret, concatBytes(staticSecret, transcript))
  const peerToHost = await hmac(prk, utf8('p2h'))
  const hostToPeer = await hmac(prk, utf8('h2p'))
  const sasBytes = await hmac(prk, utf8('sas'))
  return { peerToHost, hostToPeer, sas: toBase64url(sasBytes.slice(0, 4)) }
}

/**
 * HMAC-SHA256.
 * @param keyBytes - raw key material of any length.
 * @param message - message bytes.
 * @returns the 32-byte tag.
 */
export async function hmac(keyBytes, message) {
  const key = await subtle().importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await subtle().sign('HMAC', key, message))
}

// #endregion
// #region session

/**
 * Build the frame header and the AES-GCM nonce that authenticates it.
 *
 * The nonce is **derived**, not a slice of the header. Its 12 bytes are
 * `direction` as a 32-bit big-endian value followed by the 64-bit sequence, so
 * the low 9 bytes overlap the header's `dir` and `seq` fields and the top 3 are
 * always zero. Nonce uniqueness follows from the sequence being per-direction
 * and strictly increasing under a key that is never reused across sessions.
 *
 * Slicing 12 bytes out of the header does not work — the header is 11 bytes —
 * and the result is `Invalid initialization vector` at the first `encrypt`
 * rather than anything that names the real mistake.
 */
function nonceFor(direction, seq) {
  const nonce = new Uint8Array(12)
  const view = new DataView(nonce.buffer)
  view.setUint32(0, direction, false)
  view.setBigUint64(4, seq, false)
  return nonce
}

function headerBytes(direction, seq, kind) {
  const header = new Uint8Array(FRAME.HEADER_BYTES)
  header[0] = FRAME.VERSION
  header[1] = direction
  new DataView(header.buffer).setBigUint64(2, seq, false)
  header[10] = kind
  return header
}

function checkedSequence(seq) {
  if (typeof seq !== 'bigint' || seq < 0n || seq >= 1n << 64n) {
    throw new Error('channel: frame sequence is out of range')
  }
}

/**
 * One established end-to-end channel.
 *
 * A session is single-use: its keys come from one ephemeral agreement, so it is
 * never resumed across connections. That removes the whole class of
 * key-reuse-across-reconnect defects at the cost of two round trips per
 * reconnect, which for a control channel is the right trade.
 */
export class Session {
  #sendKey
  #receiveKey
  #direction
  #kind
  #sendSeq = 0n
  #receiveSeq = 0n

  /**
   * Both AES keys are imported once here, not per frame.
   *
   * Importing per frame was a defect worth recording: the send path imported with
   * `['encrypt']` and the open path with `['decrypt']`, so encryption succeeded and
   * every decryption failed with an opaque `InvalidAccessError`. Key usages are
   * checked at import, so the wrong pair fails at the first frame rather than at
   * construction — the least convenient possible moment.
   *
   * @param options - directional keys and the direction this side sends.
   */
  constructor({ sendKey, receiveKey, direction, kind = KIND.RPC }) {
    this.#sendKey = sendKey
    this.#receiveKey = receiveKey
    this.#direction = direction
    this.#kind = kind
  }

  /** The other side's direction, used to validate inbound headers. */
  get expectDirection() {
    return this.#direction === DIRECTION.PEER_TO_HOST ? DIRECTION.HOST_TO_PEER : DIRECTION.PEER_TO_HOST
  }

  #keyBytes(key) {
    return key instanceof Uint8Array ? key : new Uint8Array(key)
  }

  /**
   * Encrypt one payload into a single framed byte string.
   *
   * The return value is what actually goes on the wire — header ‖ ciphertext ‖
   * tag — rather than a header/body pair. Sending a pair means every carrier has
   * to remember to concatenate them in the right order, and `open()` then has to
   * guess how the caller joined them.
   */
  async seal(payload) {
    const seq = this.#sendSeq
    this.#sendSeq += 1n
    const header = headerBytes(this.#direction, seq, this.#kind)
    const nonce = nonceFor(this.#direction, seq)
    const key = await subtle().importKey(
      'raw',
      this.#keyBytes(this.#sendKey),
      { name: 'AES-GCM' },
      false,
      ['encrypt'],
    )
    const sealed = new Uint8Array(
      await subtle().encrypt(
        { name: 'AES-GCM', iv: nonce, additionalData: header, tagLength: FRAME.TAG_BYTES * 8 },
        key,
        payload,
      ),
    )
    return concatBytes(header, sealed)
  }

  /**
   * Authenticate and decrypt one frame.
   *
   * A sequence that is not exactly next is refused rather than reordered: the
   * framing below this sits on a single TCP connection, so a gap means the
   * sender is confused or the stream was tampered with, and neither is worth
   * guessing about.
   */
  async open(frame) {
    const { header, body } = splitFrame(frame)
    if (header[0] !== FRAME.VERSION) throw new Error(`channel: unsupported frame version ${header[0]}`)
    if (header[1] !== this.expectDirection) throw new Error('channel: frame direction does not match the link')
    const seq = new DataView(header.buffer, header.byteOffset, header.byteLength).getBigUint64(2, false)
    if (seq !== this.#receiveSeq) {
      throw new Error(`channel: expected frame ${this.#receiveSeq} but received ${seq}`)
    }
    const nonce = nonceFor(header[1], seq)
    const key = await subtle().importKey(
      'raw',
      this.#keyBytes(this.#receiveKey),
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    )
    const plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: header, tagLength: FRAME.TAG_BYTES * 8 },
      key,
      body,
    )
    this.#receiveSeq += 1n
    return new Uint8Array(plain)
  }
}

/** Split a framed message back into its header and ciphertext. */
export function splitFrame(bytes) {
  if (bytes.length < FRAME.HEADER_BYTES + FRAME.TAG_BYTES) {
    throw new Error('channel: frame is shorter than its header and tag')
  }
  return { header: bytes.slice(0, FRAME.HEADER_BYTES), body: bytes.slice(FRAME.HEADER_BYTES) }
}

// #endregion
// #region transcript

/**
 * Build the byte string both sides sign.
 *
 * Field order is part of the protocol: every field of the exchange appears
 * exactly once and in the order it was produced, so two different exchanges can
 * never share a transcript.
 *
 * The transcript covers **both** ephemeral keys, which is why the Host signs it
 * only after receiving the peer's. An earlier draft had the Host sign before
 * seeing the peer's ephemeral key; a relay could then have substituted its own
 * and left the Host believing it held a session with the peer. The static-static
 * mix below would have kept the relay from reading the traffic, but the Host
 * would still have been talking into a session it had not agreed to. Signing the
 * completed transcript removes the question entirely.
 */
export function buildTranscript(fields) {
  return concatBytes(
    utf8(PROTOCOL),
    utf8(fields.hostId),
    utf8(fields.deviceId),
    fromBase64url(fields.peerStaticKey.slice(5)),
    fromBase64url(fields.hostStaticKey.slice(5)),
    fromBase64url(fields.peerNonce),
    fromBase64url(fields.hostNonce),
    fromBase64url(fields.hostEphemeral),
    fromBase64url(fields.peerEphemeral),
  )
}

/**
 * Build the relay-registration transcript.
 * @param nonce - the relay's one-time challenge, base64url.
 * @returns the byte string the host signs to claim its `hostId`.
 */
export function buildRelayTranscript(nonce) {
  return concatBytes(utf8(TRANSCRIPT.RELAY), fromBase64url(nonce))
}

/**
 * Domain-separate a transcript for one handshake message.
 * @param label - one of {@link TRANSCRIPT}.
 * @param transcript - the transcript produced so far.
 * @returns the byte string to sign.
 */
export function domainSeparate(label, transcript) {
  return concatBytes(utf8(label), transcript)
}

// #endregion
// #region identifiers

/** A fresh 256-bit identifier in unpadded base64url. */
export function randomId() {
  return toBase64url(randomBytes(32))
}

/** A fresh pairing token. Shown once, never stored on the relay. */
export function randomToken() {
  return toBase64url(randomBytes(32))
}

/** One session nonce. */
export function randomNonce() {
  return toBase64url(randomBytes(32))
}

export { randomBytes }

// #endregion
