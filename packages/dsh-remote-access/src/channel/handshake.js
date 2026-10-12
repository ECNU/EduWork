/**
 * The end-to-end handshake, as a transport-agnostic state machine.
 *
 * Both ends drive it through the same `next()` loop: hand it whatever arrived
 * on the wire, and it returns the message to send back, or `undefined` when it
 * is waiting. Nothing here knows about WebSockets, relays or HTTP — the tests
 * run two instances against each other in one process, which is the only way to
 * assert that both sides accept the same transcript.
 *
 * The shape and its security argument are in `notes/19-中继协议与端到端加密.md`.
 * Three properties are load-bearing and easy to break by accident:
 *
 * 1. **Both sides sign the same transcript, and it covers both ephemeral keys.**
 *    The peer signs last precisely so the Host cannot be tricked into committing
 *    to an ephemeral key the peer never sent.
 * 2. **The Host verifies the peer's static key against the pinned one**, never
 *    against a key arriving in the handshake. A handshake that trusts the key it
 *    was just handed authenticates nothing.
 * 3. **The static-static secret mixes the agreement keys**, not the signing keys.
 *    P-256 ECDSA and ECDH keys are not interchangeable in WebCrypto.
 */

import {
  DIRECTION,
  PROTOCOL,
  Session,
  TRANSCRIPT,
  buildTranscript,
  decodeEphemeral,
  decodePublicKey,
  deriveSecret,
  deriveSessionKeys,
  domainSeparate,
  encodeEphemeral,
  encodePublicKey,
  generateEphemeral,
  randomNonce,
  signTranscript,
  verifyTranscript,
} from './crypto.js'

/** Why a handshake was refused. Callers map these onto user-visible text. */
export const HANDSHAKE_FAILURE = Object.freeze({
  PROTOCOL: 'protocol-mismatch',
  TRANSCRIPT: 'transcript-invalid',
  HOST_SIGNATURE: 'host-signature-invalid',
  PEER_SIGNATURE: 'peer-signature-invalid',
  DEVICE_UNKNOWN: 'device-unknown',
  DEVICE_REVOKED: 'device-revoked',
})

function fail(reason) {
  const error = new Error(`remote-access handshake: ${reason}`)
  error.reason = reason
  return error
}

function expectMessage(message, type) {
  if (message === null || typeof message !== 'object' || message.t !== type) {
    throw fail(HANDSHAKE_FAILURE.PROTOCOL)
  }
  if (message.v !== PROTOCOL) throw fail(HANDSHAKE_FAILURE.PROTOCOL)
  return message
}

// #region initiator

/**
 * The device half: it holds the ephemeral key pair, proposes the session, and
 * verifies the Host before revealing anything about itself.
 */
export class PeerHandshake {
  #identity
  #hostId
  #deviceId
  #pin
  #ephemeral = null
  #peerNonce = null
  #transcript = null
  #hostAgreementKey = null
  #hostEphemeral = null
  #state = 'start'
  #session = null
  #sas = null

  /**
   * @param options - the device identity, its own id, the Host id, and optionally the pinned Host key.
   */
  constructor({ identity, deviceId, hostId, pinnedHostKey }) {
    this.#identity = identity
    this.#deviceId = deviceId
    this.#hostId = hostId
    this.#pin = pinnedHostKey
  }

  /** The derived session once `next()` has reported `done`. */
  get session() {
    return this.#session
  }

  /** The short authentication string, available once the handshake completes. */
  get sas() {
    return this.#sas
  }

  async #start() {
    this.#ephemeral = await generateEphemeral()
    this.#peerNonce = randomNonce()
    this.#state = 'await-host'
    return {
      t: 'hello',
      v: PROTOCOL,
      deviceId: this.#deviceId,
      Sh: await encodePublicKey(this.#identity.signing.publicKey),
      Xh: await encodePublicKey(this.#identity.agreement.publicKey),
      Rp: this.#peerNonce,
      Ep: await encodeEphemeral(this.#ephemeral.publicKey),
    }
  }

  /**
   * Consume one inbound message.
   * @param message - decoded handshake message, or undefined to start.
   * @returns the next message to send and whether the channel is established.
   */
  async next(message) {
    if (message === undefined) {
      if (this.#state !== 'start') throw fail(HANDSHAKE_FAILURE.PROTOCOL)
      return { send: await this.#start(), done: false }
    }

    if (this.#state !== 'await-host') throw fail(HANDSHAKE_FAILURE.PROTOCOL)
    const host = expectMessage(message, 'host')

    // Pin check first, before any cryptography: a Host whose key is not the one
    // we pinned is not worth verifying against.
    if (this.#pin !== undefined && this.#pin !== host.Sh) throw fail(HANDSHAKE_FAILURE.HOST_SIGNATURE)

    const transcript = buildTranscript({
      hostId: this.#hostId,
      deviceId: this.#deviceId,
      peerStaticKey: await encodePublicKey(this.#identity.signing.publicKey),
      hostStaticKey: host.Sh,
      peerNonce: this.#peerNonce,
      hostNonce: host.Rh,
      hostEphemeral: host.Eh,
      peerEphemeral: await encodeEphemeral(this.#ephemeral.publicKey),
    })
    const hostOk = await verifyTranscript(
      await decodePublicKey(host.Sh),
      domainSeparate(TRANSCRIPT.HELLO, transcript),
      host.sig,
    )
    if (!hostOk) throw fail(HANDSHAKE_FAILURE.HOST_SIGNATURE)

    this.#transcript = transcript
    this.#hostAgreementKey = await decodePublicKey(host.Xh, 'ECDH')
    this.#hostEphemeral = await decodeEphemeral(host.Eh)

    await this.#finish()
    this.#state = 'done'
    return {
      done: true,
      send: {
        t: 'prove',
        v: PROTOCOL,
        sig: await signTranscript(
          this.#identity.signing.privateKey,
          domainSeparate(TRANSCRIPT.PROVE, transcript),
        ),
      },
    }
  }

  async #finish() {
    const ephemeralSecret = await deriveSecret(this.#ephemeral.privateKey, this.#hostEphemeral)
    const staticSecret = await deriveSecret(this.#identity.agreement.privateKey, this.#hostAgreementKey)
    const keys = await deriveSessionKeys({
      ephemeralSecret,
      staticSecret,
      transcript: this.#transcript,
    })
    this.#sas = keys.sas
    this.#session = new Session({
      sendKey: keys.peerToHost,
      receiveKey: keys.hostToPeer,
      direction: DIRECTION.PEER_TO_HOST,
    })
  }
}

// #endregion
// #region responder

/**
 * The Host half: it proves who it is, then demands proof from the device before
 * agreeing to a session.
 *
 * The device's keys are read from the registry on every handshake. Nothing that
 * arrives in `hello` is trusted as an identity — the message is matched against
 * the record, not used to create one.
 */
export class HostHandshake {
  #identity
  #hostId
  #resolveDevice
  #ephemeral = null
  #hostNonce = null
  #transcript = null
  #peerSigningKey = null
  #peerAgreementKey = null
  #peerEphemeral = null
  #state = 'await-hello'
  #session = null
  #sas = null

  /**
   * @param options - host identity, host id, and the registry lookup for a device id.
   */
  constructor({ identity, hostId, resolveDevice }) {
    this.#identity = identity
    this.#hostId = hostId
    this.#resolveDevice = resolveDevice
  }

  get session() {
    return this.#session
  }

  get sas() {
    return this.#sas
  }

  /**
   * Consume one inbound message.
   * @param message - decoded handshake message, or undefined to poll.
   * @returns the next message to send and whether the channel is established.
   */
  async next(message) {
    if (message === undefined) return { send: undefined, done: this.#state === 'done' }

    if (this.#state === 'await-hello') {
      const hello = expectMessage(message, 'hello')
      if (typeof hello.deviceId !== 'string' || typeof hello.Sh !== 'string' || typeof hello.Xh !== 'string') {
        throw fail(HANDSHAKE_FAILURE.PROTOCOL)
      }
      const device = await this.#resolveDevice(hello.deviceId)
      if (device === undefined) throw fail(HANDSHAKE_FAILURE.DEVICE_UNKNOWN)
      if (device.status === 'revoked') throw fail(HANDSHAKE_FAILURE.DEVICE_REVOKED)
      if (device.publicKey !== hello.Sh || device.agreementKey !== hello.Xh) {
        throw fail(HANDSHAKE_FAILURE.PEER_SIGNATURE)
      }

      this.#peerSigningKey = hello.Sh
      this.#peerAgreementKey = await decodePublicKey(hello.Xh, 'ECDH')
      this.#peerEphemeral = await decodeEphemeral(hello.Ep)
      this.#ephemeral = await generateEphemeral()
      this.#hostNonce = randomNonce()

      const hostStaticKey = await encodePublicKey(this.#identity.signing.publicKey)
      const hostAgreementKey = await encodePublicKey(this.#identity.agreement.publicKey)
      const hostEphemeral = await encodeEphemeral(this.#ephemeral.publicKey)
      this.#transcript = buildTranscript({
        hostId: this.#hostId,
        deviceId: hello.deviceId,
        peerStaticKey: hello.Sh,
        hostStaticKey,
        peerNonce: hello.Rp,
        hostNonce: this.#hostNonce,
        hostEphemeral,
        peerEphemeral: hello.Ep,
      })
      this.#state = 'await-prove'
      return {
        done: false,
        send: {
          t: 'host',
          v: PROTOCOL,
          hostId: this.#hostId,
          Sh: hostStaticKey,
          Xh: hostAgreementKey,
          Rh: this.#hostNonce,
          Eh: hostEphemeral,
          sig: await signTranscript(
            this.#identity.signing.privateKey,
            domainSeparate(TRANSCRIPT.HELLO, this.#transcript),
          ),
        },
      }
    }

    if (this.#state === 'await-prove') {
      const prove = expectMessage(message, 'prove')
      const peerOk = await verifyTranscript(
        await decodePublicKey(this.#peerSigningKey),
        domainSeparate(TRANSCRIPT.PROVE, this.#transcript),
        prove.sig,
      )
      if (!peerOk) throw fail(HANDSHAKE_FAILURE.PEER_SIGNATURE)

      await this.#finish()
      this.#state = 'done'
      return {
        done: true,
        send: {
          t: 'ready',
          v: PROTOCOL,
          sig: await signTranscript(
            this.#identity.signing.privateKey,
            domainSeparate(TRANSCRIPT.READY, this.#transcript),
          ),
        },
      }
    }

    throw fail(HANDSHAKE_FAILURE.PROTOCOL)
  }

  async #finish() {
    const ephemeralSecret = await deriveSecret(this.#ephemeral.privateKey, this.#peerEphemeral)
    const staticSecret = await deriveSecret(this.#identity.agreement.privateKey, this.#peerAgreementKey)
    const keys = await deriveSessionKeys({
      ephemeralSecret,
      staticSecret,
      transcript: this.#transcript,
    })
    this.#sas = keys.sas
    this.#session = new Session({
      sendKey: keys.hostToPeer,
      receiveKey: keys.peerToHost,
      direction: DIRECTION.HOST_TO_PEER,
    })
  }
}

// #endregion
