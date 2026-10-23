/**
 * Noise_IK_25519_ChaChaPoly_BLAKE2b through noise-handshake. The pairing link
 * pins the Host's static key; the initiator's static key is fresh for every
 * connection because the device proves its identity separately (auth.ts).
 */
import Noise from 'noise-handshake'
import Cipher from 'noise-handshake/cipher.js'
import { generateKeyPair as generate } from 'noise-handshake/dh.js'
import { utf8 } from './bytes.ts'
import { MAX_MESSAGE, PROTOCOL } from './constants.ts'

/** Largest plaintext of one Noise transport message: one 16-byte tag shorter than the message. */
export const MAX_PLAINTEXT = MAX_MESSAGE - 16
// noise-handshake encodes 32 of the 64 nonce bits; stop before the counter wraps.
const NONCE_LIMIT = 2 ** 32

export interface KeyPair { publicKey: Uint8Array; secretKey: Uint8Array }
/** A new static key pair, or the pair of a stored secret key. */
export const generateKeyPair = (secretKey?: Uint8Array): KeyPair => generate(secretKey)

export interface Session {
  /** Handshake hash: unique per connection; the device signs it and both sides derive the pairing code from it. */
  readonly hash: Uint8Array
  encrypt(plaintext: Uint8Array): Uint8Array<ArrayBuffer>
  /** Throws on a forged, reordered or replayed message. */
  decrypt(ciphertext: Uint8Array): Uint8Array
}

/** Bind the protocol version, the carrier and the Host identity into the handshake hash. */
export const prologue = (transport: 'relay', hostId: string): Uint8Array => utf8(`${PROTOCOL}\0${transport}\0${hostId}`)

/** Device side: the first handshake message, then the Host's reply completes the session. */
export function initiate(hostKey: Uint8Array, prologue: Uint8Array): { message: Uint8Array<ArrayBuffer>; finish(reply: Uint8Array): Session } {
  const state = new Noise('IK', true)
  state.initialise(prologue, hostKey)
  return { message: plain(state.send()), finish: reply => (state.recv(reply), session(state)) }
}

/** Host side: answer the device's first message; the session is complete once the reply is sent. */
export function respond(keyPair: KeyPair, prologue: Uint8Array, message: Uint8Array): { reply: Uint8Array<ArrayBuffer>; session: Session } {
  const state = new Noise('IK', false, keyPair)
  state.initialise(prologue)
  state.recv(message)
  return { reply: plain(state.send()), session: session(state) }
}

function session(state: Noise): Session {
  const tx = new Cipher(state.tx), rx = new Cipher(state.rx)
  let sent = 0, received = 0
  return {
    hash: plain(state.hash),
    encrypt(plaintext) {
      if (++sent === NONCE_LIMIT) throw new Error('noise: message limit reached')
      return plain(tx.encrypt(plaintext))
    },
    decrypt(ciphertext) {
      if (++received === NONCE_LIMIT) throw new Error('noise: message limit reached')
      return plain(rx.decrypt(ciphertext))
    },
  }
}

/** Node's sodium returns Buffers; hand out plain Uint8Array views so both platforms see the same type. */
const plain = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength)
