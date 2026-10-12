// The Host half: dial out to a relay, prove who we are, and carry the browser's
// calls through an end-to-end encrypted channel that the relay cannot read.
//
// The Host never listens. That is the whole point of this shape — no inbound
// port, no dynamic DNS name, no certificate on the machine running the agent —
// and it is why a relay may be somebody else's computer without becoming a
// place where the Host's credentials live.
//
// Three things happen on one socket and they must not be confused with each
// other, so they are explicit stages rather than a guess about what a frame is:
//
//   1. Relay control. The Host registers and is told when a device arrives.
//      Frames in this stage are the relay's JSON, never anything else.
//   2. End-to-end handshake. Once READY is exchanged, the relay stops parsing
//      and every frame belongs to `HostHandshake`. It is this layer that decides
//      which device is on the other end.
//   3. Data. Sealed frames carrying the browser's own RPC to the local Host.
//
// The order of the last stage is the acceptance criterion and is not negotiable:
// **decrypt, judge the device, judge the operation, admit, dispatch, encrypt**.
// An unauthorised device must be refused before anything is dispatched, so its
// bytes never reach the Host's RPC at all.
//
// `dispatch` is injected rather than reached for. That keeps this module
// testable without a running Host, and it keeps the one thing that touches the
// kernel's own session out of the module that decides who may speak.

import { buildRelayTranscript, encodePublicKey, PROTOCOL, signTranscript } from '../channel/crypto.js'
import { HostHandshake } from '../channel/handshake.js'
import { HOST_PATH, MESSAGE, RELAY_VERSION, UNAVAILABLE } from './protocol.js'

/** How long to wait for the relay to answer a registration before retrying. */
const DEFAULT_TIMEOUT_MS = 15_000
/** Backoff between reconnects, in milliseconds; the last value repeats. */
const DEFAULT_BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000]

/**
 * Close a socket without letting the close code throw.
 *
 * The WebSocket API only accepts `1000` or `3000`–`4999` from `close()`; passing
 * a protocol-error code such as `1002` throws `DOMException: invalid code`. That
 * matters more than it looks: the throw happens *inside* the handler that was
 * trying to report a bad frame, so the socket is never closed, the device waits
 * for a reply that cannot come, and a revocation or a frame error silently fails
 * to end the connection. The reason string carries the detail instead.
 */
function closeQuietly(target, code, reason) {
  try {
    target.close(1000, reason === undefined ? undefined : `${String(code)} ${reason}`.slice(0, 123))
  } catch {
    // Already closing or gone; there is nothing else to do about it.
  }
}

const readyFrame = JSON.stringify({ t: MESSAGE.READY })

/**
 * Turn a received frame into bytes, whatever the socket handed over.
 *
 * `binaryType` is set to `arraybuffer` on every connection, so this is normally
 * just a view over what arrived. It stays defensive because the alternative
 * failure mode is silent: `new Uint8Array(blob)` yields length zero, which
 * surfaces as a frame-format error rather than as a socket that was configured
 * wrong.
 */
function toBytes(data) {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  throw new TypeError(`remote-access: unexpected frame type ${Object.prototype.toString.call(data)}`)
}

/**
 * Why a device was refused, in a form the phone can act on.
 *
 * These reach the far end, so they say what happened and nothing more: no device
 * list, no reason that distinguishes "no such device" from "not confirmed yet"
 * beyond what the operator needs to do about it.
 */
export const REFUSAL = Object.freeze({
  NOT_PAIRED: { code: 401, message: 'this device is not paired with the host' },
  NOT_TRUSTED: { code: 403, message: 'this device has not been confirmed on the host' },
  REVOKED: { code: 403, message: 'this device has been revoked' },
  OPERATION: { code: 403, message: 'this operation is not allowed for this device' },
  MALFORMED: { code: 400, message: 'the request is not a Host RPC envelope' },
})

/**
 * The envelope that tells a device its call was refused.
 *
 * Returns the envelope itself, not a wrapper. An earlier version returned
 * `{ ok: false, response }` while the call sites sealed the wrapper, so every
 * refusal went out as `{ok, response}` with no `result` — the device could see
 * that something was wrong but not what, and the whole error path was broken in
 * a way that looked like a test assertion failure.
 */
function refuse(id, refusal, detail) {
  return {
    type: 'server-response',
    rpcId: id,
    result: { ok: false, error: { code: refusal.code, message: detail ?? refusal.message } },
  }
}

/**
 * Read one decrypted frame as a Host RPC call.
 *
 * Only the envelope is inspected. `payload` is passed through untouched because
 * the parameter names differ per method on the Host side (`session/create` takes
 * `request`, `session/list` takes `_request`), so a relay or a Host that parsed
 * it would be asserting a schema it does not own and would break on the next
 * Host release.
 */
export function readCall(bytes) {
  let envelope
  try {
    envelope = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return undefined
  }
  if (envelope === null || typeof envelope !== 'object') return undefined
  if (envelope.type !== 'client-request') return undefined
  if (typeof envelope.method !== 'string' || envelope.method === '') return undefined
  if (typeof envelope.rpcId !== 'string' || envelope.rpcId === '') return undefined
  return { rpcId: envelope.rpcId, method: envelope.method, payload: envelope.payload }
}

/**
 * Judge one call for one device.
 *
 * Split out from the tunnel so the decision can be asserted on its own, and so
 * the tunnel has exactly one place where a call becomes allowed.
 */
export function judgeCall({ device, devices }) {
  if (device === undefined) return { allowed: false, refusal: REFUSAL.NOT_PAIRED }
  if (device.status === 'revoked') return { allowed: false, refusal: REFUSAL.REVOKED }
  if (device.status !== 'trusted') return { allowed: false, refusal: REFUSAL.NOT_TRUSTED }
  if (devices.get(device.deviceId) === undefined) return { allowed: false, refusal: REFUSAL.NOT_PAIRED }
  return { allowed: true }
}

/**
 * How a device is found at handshake time.
 *
 * Reads from a live map rather than a snapshot so a revocation that lands while
 * a device is connecting is seen by the handshake that is in progress. That is
 * the difference between "revoked" and "revoked from now on": the acceptance
 * item is that revocation closes what is already open, and this is where that
 * starts.
 */
export function deviceResolver({ devices }) {
  return (deviceId) => devices.get(deviceId)
}

/**
 * Dial a relay and stay reachable through it.
 *
 * @param options.url        relay base URL, e.g. `wss://relay.example`.
 * @param options.hostId     this Host's id at the relay, stable across restarts.
 * @param options.identity   `generateIdentity()` result; the private half never leaves here.
 * @param options.devices    Map of deviceId -> `{ deviceId, publicKey, agreementKey, status }`.
 * @param options.decide     `(device, endpoint) => verdict`, from `channel/operations.js`.
 * @param options.dispatch   `({ rpcId, method, payload, device }) => response envelope`.
 * @param options.onDevice   called with a device id the first time it is seen.
 */
export async function createHostTunnel({
  url,
  hostId,
  identity,
  devices,
  decide,
  dispatch,
  onDevice = () => {},
  log = () => {},
  WebSocketImpl = globalThis.WebSocket,
  backoffMs = DEFAULT_BACKOFF_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (typeof WebSocketImpl !== 'function') {
    throw new TypeError('remote-access tunnel: no WebSocket implementation available')
  }
  let stopped = false
  let socket
  let attempt = 0
  let timer
  /** One link per connection: a session must not outlive the socket it was made on. */
  let session

  const relayUrl = `${url.replace(/\/+$/u, '')}${HOST_PATH}`
  const publicKey = await encodePublicKey(identity.signing.publicKey)

  const scheduleReconnect = () => {
    if (stopped) return
    const wait = backoffMs[Math.min(attempt, backoffMs.length - 1)]
    attempt += 1
    log(`remote-access: reconnecting in ${String(wait)}ms`)
    timer = setTimeout(connect, wait)
    // A pending reconnect must not hold the process open by itself.
    timer.unref?.()
  }

  /** Send one sealed frame, or drop it if the link is already gone. */
  const sendSealed = async (value) => {
    if (session === undefined || socket?.readyState !== 1) return false
    socket.send(await session.seal(new TextEncoder().encode(JSON.stringify(value))))
    return true
  }

  /** Sealed replies are queued per device so two prompts cannot interleave. */
  const handleData = async (bytes) => {
    if (session === undefined) return
    let plain
    try {
      plain = await session.open(bytes)
    } catch (error) {
      // A frame that will not authenticate ends the link. There is nothing to
      // answer: the sender cannot be trusted to read a reply, and continuing
      // would mean guessing which side lost sync.
      log(`remote-access: dropping a frame that did not authenticate: ${error.message}`)
      closeQuietly(socket, 1002, 'frame did not authenticate')
      return
    }

    const call = readCall(plain)
    if (call === undefined) {
      await sendSealed({ type: 'server-response', rpcId: '_', result: { ok: false, error: { code: REFUSAL.MALFORMED.code, message: REFUSAL.MALFORMED.message } } })
      return
    }

    const device = devices.get(session.deviceId)
    const verdict = judgeCall({ device, devices, decide })
    if (!verdict.allowed) {
      // Refused here, before dispatch. This is acceptance item one: an
      // unauthorised device is answered by the Host without its bytes ever
      // reaching the Host's RPC.
      log(`remote-access: refused ${call.method} from ${session.deviceId}`)
      await sendSealed(refuse(call.rpcId, verdict.refusal))
      return
    }

    const operation = decide(device, call.method)
    if (!operation.allowed) {
      log(`remote-access: refused ${call.method} for ${session.deviceId}: ${operation.reason}`)
      await sendSealed(refuse(call.rpcId, REFUSAL.OPERATION))
      return
    }

    let response
    try {
      response = await dispatch({ ...call, device })
    } catch (error) {
      log(`remote-access: dispatch failed for ${call.method}: ${error.message}`)
      response = {
        type: 'server-response',
        rpcId: call.rpcId,
        result: { ok: false, error: { code: 500, message: 'the host failed to handle this call' } },
      }
    }
    await sendSealed(response)
  }

  const handleHandshake = async (frame) => {
    const step = await handshake.next(frame)
    if (step.send !== undefined) socket.send(JSON.stringify(step.send))
    if (!step.done) return
    session = handshake.session
    // The device's identity comes from the handshake, which verified it against
    // the key recorded when it was paired. Nothing in the frame told us this, and
    // `deviceId` is only available because that check passed.
    session.deviceId = handshake.deviceId
    log(`remote-access: end-to-end channel established with ${String(handshake.deviceId)}`)
    onDevice(handshake.deviceId)
  }

  let handshake
  /** Which of the three stages the current socket is in. */
  const stage = { control: true }

  const connect = () => {
    if (stopped) return
    session = undefined
    stage.control = true
    let opened = false
    const current = new WebSocketImpl(relayUrl)
    // The spec default is `blob`, and `new Uint8Array(blob)` is an *empty* array
    // rather than an error — so without this line every sealed frame arrives as
    // zero bytes and fails as "shorter than its header and tag", which reads like
    // a protocol bug instead of a socket setting. Set before any listener so no
    // frame can be delivered in the other shape.
    current.binaryType = 'arraybuffer'
    socket = current

    const fail = (why) => {
      if (stopped || socket !== current) return
      log(`remote-access: ${why}`)
      closeQuietly(current, 1011, why)
    }

    const registrationTimer = setTimeout(() => {
      fail('the relay did not answer the registration in time')
    }, timeoutMs)
    registrationTimer.unref?.()

    current.addEventListener('open', () => {
      opened = true
      attempt = 0
    })
    current.addEventListener('error', () => fail('relay connection error'))
    current.addEventListener('close', (event) => {
      clearTimeout(registrationTimer)
      if (stopped || socket !== current) return
      if (opened && event?.code === 1000) {
        // The relay closed us deliberately and cleanly. Retrying immediately
        // would hammer a relay that has already made a decision about us.
        log(`remote-access: relay closed the connection (${String(event.code)} ${String(event.reason ?? '')})`)
      }
      session = undefined
      scheduleReconnect()
    })
    current.addEventListener('message', (event) => {
      void (async () => {
        try {
          if (stage.control) {
            if (typeof event.data !== 'string') return
            const message = JSON.parse(event.data)
            if (message.t === 'challenge') {
              // The relay stores this key as the binding for the host id, and
              // checks that a later registration presents the same one. It does
              // not verify the signature — it has no crypto of its own — so the
              // signature is an honest claim the relay cannot yet check, not a
              // check that has already happened. A device's protection is the
              // handshake below, where it verifies the Host key it pinned.
              current.send(JSON.stringify({
                t: 'register',
                v: RELAY_VERSION,
                hostId,
                publicKey,
                sig: await signTranscript(identity.signing.privateKey, buildRelayTranscript(message.nonce)),
              }))
              return
            }
            if (message.t === 'registered') {
              clearTimeout(registrationTimer)
              log(`remote-access: registered as ${hostId}`)
              return
            }
            if (message.t === 'denied') {
              // The relay is refusing this identity, and retrying with the same
              // key would be refused the same way. Stop rather than spin.
              stopped = true
              clearTimeout(registrationTimer)
              log(`remote-access: the relay refused this host id: ${String(message.reason)}`)
              closeQuietly(current, 1008, 'host id refused')
              return
            }
            if (message.t === 'peer-joined') {
              handshake = new HostHandshake({
                identity,
                hostId,
                resolveDevice: deviceResolver({ devices }),
              })
              // Said here, and it has to be: the device will not speak until the
              // Host does, so waiting for its `hello` before announcing the
              // hand-off is a deadlock. It is also true at this moment — the only
              // thing left to arrive is handshake traffic, because a device that
              // has not been told it is linked has nothing to say.
              current.send(readyFrame)
              stage.control = false
              return
            }
            if (message.t === 'peer-gone') {
              // Back to the control stage. A new device runs a new handshake, and
              // reusing the old one would mean two sessions on one key.
              handshake = undefined
              session = undefined
              stage.control = true
              return
            }
            if (message.t === 'unavailable') {
              stopped = true
              clearTimeout(registrationTimer)
              log(`remote-access: the relay cannot serve us: ${String(message.reason)}`)
              closeQuietly(current, 1000, 'relay cannot serve this host')
              return
            }
            return
          }

          // Sealed frames are binary — `seal()` returns one byte string, so there
          // is no header to decode and nothing to base64.
          if (session !== undefined) {
            await handleData(toBytes(event.data))
            return
          }
          await handleHandshake(JSON.parse(event.data))
          return
        } catch (error) {
          log(`remote-access: ${error.message}`)
          fail('dropping the link after an error')
        }
      })()
    })
  }

  connect()

  return {
    get connected() {
      return socket?.readyState === 1
    },
    /** The device on the other end, once the channel is up. */
    get deviceId() {
      return session?.deviceId
    },
    stop() {
      stopped = true
      clearTimeout(timer)
      session = undefined
      try {
        socket?.close(1000, 'host is shutting down')
      } catch {
        // Nothing to close.
      }
    },
  }
}

export { UNAVAILABLE, PROTOCOL }
