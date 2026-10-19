/**
 * Proof-of-possession for Host registration.
 *
 * The relay binds a `hostId` to a public key on first use. Before this module,
 * that binding proved nothing: the relay recorded whatever key and signature it
 * was given, and a caller who copied a public key could replace the live Host
 * with an invalid signature. The device handshake still authenticated the Host
 * key it had pinned, so a device would not talk to the impostor — but the real
 * Host was knocked offline, and a first registration could claim an unused id
 * without holding any private key at all.
 *
 * This module makes the relay check the claim before it changes any state. It is
 * deliberately standalone: the relay is deployed without the Host plugin or the
 * browser bundle, so it uses Node's `crypto` rather than importing the browser's
 * WebCrypto module. `test/relay.test.mjs` compares the transcript built here
 * with `buildRelayTranscript` from `channel/crypto.js`, so the two
 * implementations cannot drift apart silently.
 *
 * The signature is ECDSA P-256 / SHA-256 over a length-prefixed transcript:
 *
 *     "eduwork-relay-v2" || nonce || hostId || publicKey
 *
 * The nonce is the relay's fresh challenge. `hostId` and `publicKey` are bound
 * because a proof over the nonce alone could be replayed under a different id,
 * and because the relay must know that the key it is about to store is the one
 * the caller actually controls.
 */

import { createPublicKey, verify } from 'node:crypto'

/** SPKI DER prefix for a P-256 public key; the 65-byte point follows it. */
const P256_SPKI_PREFIX = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex')

/** A host id is a short opaque label, not a path or a user-supplied string. */
const HOST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u

/** Unpadded base64url, the encoding used by the rest of the protocol. */
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u

/** ECDSA P-256 signatures from WebCrypto are raw `r || s`, 32 bytes each. */
const SIGNATURE_BYTES = 64

/** Uncompressed P-256 points are 65 bytes and start with `0x04`. */
const PUBLIC_KEY_BYTES = 65

/** The relay's own cap, so a malformed frame cannot make it allocate freely. */
const MAX_PUBLIC_KEY_TEXT = 128
const MAX_SIGNATURE_TEXT = 128

function decodeBase64url(text) {
  if (typeof text !== 'string' || !BASE64URL_PATTERN.test(text)) {
    throw new Error('registration: invalid base64url')
  }
  return Buffer.from(text, 'base64url')
}

function lengthPrefixed(part) {
  const header = Buffer.alloc(4)
  header.writeUInt32BE(part.length, 0)
  return Buffer.concat([header, part])
}

/**
 * The exact bytes a Host signs to claim an id.
 *
 * Keep in lockstep with `buildRelayTranscript` in `channel/crypto.js`; the test
 * suite asserts byte equality rather than trusting the comment.
 *
 * @param fields.nonce - the relay's challenge, base64url.
 * @param fields.hostId - the claimed host id.
 * @param fields.publicKey - the `p256:` key presented for that id.
 * @returns a Buffer with the transcript.
 */
export function buildHostRegistrationTranscript({ nonce, hostId, publicKey }) {
  return Buffer.concat([
    lengthPrefixed(Buffer.from('eduwork-relay-v2', 'utf8')),
    lengthPrefixed(decodeBase64url(nonce)),
    lengthPrefixed(Buffer.from(hostId, 'utf8')),
    lengthPrefixed(Buffer.from(publicKey, 'utf8')),
  ])
}

/**
 * Whether a registration frame has the shape the verifier expects.
 *
 * Kept separate from verification so the relay can close a malformed frame
 * without pretending it was a cryptographic failure.
 *
 * @param fields - the parsed `register` message.
 */
export function isRegistrationShapeValid({ hostId, publicKey, sig }) {
  return typeof hostId === 'string'
    && HOST_ID_PATTERN.test(hostId)
    && typeof publicKey === 'string'
    && publicKey.startsWith('p256:')
    && publicKey.length <= MAX_PUBLIC_KEY_TEXT
    && typeof sig === 'string'
    && sig.length <= MAX_SIGNATURE_TEXT
    && BASE64URL_PATTERN.test(sig)
}

/**
 * Verify the Host's proof for one registration.
 *
 * @param fields.nonce - the challenge the relay sent on this socket.
 * @param fields.hostId - the claimed id.
 * @param fields.publicKey - the `p256:` key presented for that id.
 * @param fields.sig - base64url ECDSA signature over the transcript.
 * @returns true only when the signature is valid for this nonce and identity.
 */
export function verifyHostRegistration({ nonce, hostId, publicKey, sig }) {
  try {
    if (!isRegistrationShapeValid({ hostId, publicKey, sig })) return false
    const point = decodeBase64url(publicKey.slice('p256:'.length))
    if (point.length !== PUBLIC_KEY_BYTES || point[0] !== 0x04) return false
    const signature = decodeBase64url(sig)
    if (signature.length !== SIGNATURE_BYTES) return false
    const key = createPublicKey({
      key: Buffer.concat([P256_SPKI_PREFIX, point]),
      format: 'der',
      type: 'spki',
    })
    return verify(
      'sha256',
      buildHostRegistrationTranscript({ nonce, hostId, publicKey }),
      { key, dsaEncoding: 'ieee-p1363' },
      signature,
    )
  } catch {
    // A malformed point, a non-canonical signature and a bad signature are all
    // the same answer to the caller: this registration is not proven.
    return false
  }
}
