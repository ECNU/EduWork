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
import { RemoteChannel } from '../stream/channel.js'
import { HOST_PATH, MESSAGE, RELAY_VERSION, UNAVAILABLE } from './protocol.js'

/**
 * Map a thrown value to the wire failure shape, the way the Gateway's `rpcError`
 * does.
 *
 * Transcribed rather than imported: the Gateway does not expose that mapper through
 * its `exports` map, and reaching into `lib/types/...` by path would tie this package
 * to a file layout the Gateway never promised. What the transcription has to keep is
 * the one property that matters: a `RemoteError` is identified **structurally** and
 * keeps its own code, so a Host failure arrives at the device as itself rather than
 * as a generic internal error.
 */
function toWireFailure(error) {
  const remote = error !== null && typeof error === 'object'
    && error.isDSHRemoteError === true && typeof error.code === 'string'
    ? error
    : undefined
  if (remote !== undefined) {
    return { code: remote.code, message: remote.message, details: remote.details }
  }
  return {
    code: 'gateway/internal',
    message: error instanceof Error ? error.message : String(error),
    details: {},
  }
}

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
/**
 * Why a device or a call was refused.
 *
 * The codes are strings, not HTTP statuses, and every one of them becomes the
 * `code` of a failure envelope. That matters because the device decodes envelopes
 * with `parseConnectionResponse`, which requires a string `code` and a record
 * `details` — so a numeric status here is not a stylistic choice, it is an envelope
 * the device refuses to decode. A refusal that cannot be decoded does not report a
 * refusal; it reports a transport error, which is the opposite of the point.
 *
 * The status that used to live in `code` is kept in `status`, where a caller can
 * still reach it.
 */
export const REFUSAL = Object.freeze({
  NOT_PAIRED: { code: 'remote-access/not-paired', status: 401, message: 'this device is not paired with the host' },
  NOT_TRUSTED: { code: 'remote-access/not-trusted', status: 403, message: 'this device has not been confirmed on the host' },
  REVOKED: { code: 'remote-access/revoked', status: 403, message: 'this device has been revoked' },
  OPERATION: { code: 'remote-access/operation-refused', status: 403, message: 'this operation is not allowed for this device' },
  MALFORMED: { code: 'remote-access/malformed', status: 400, message: 'the request is not a Host RPC envelope' },
})

/**
 * The envelope that tells a device its call was refused.
 *
 * Returns the envelope itself, not a wrapper. An earlier version returned
 * `{ ok: false, response }` while the call sites sealed the wrapper, so every
 * refusal went out as `{ok, response}` with no `result` — the device could see
 * that something was wrong but not what, and the whole error path was broken in
 * a way that looked like a test assertion failure.
 *
 * The `details` field is not optional. `parseConnectionResponse` requires it to be
 * a record and refuses the envelope without it, so omitting it turned every refusal
 * into a transport error at the device — the failure mode this whole family of
 * defects shares.
 */
function refuse(id, refusal, detail) {
  return {
    type: 'server-response',
    rpcId: id,
    result: {
      ok: false,
      error: {
        code: refusal.code,
        message: detail ?? refusal.message,
        details: { status: refusal.status },
      },
    },
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
 * @param options.onUnknownDevice - called with a `hello` from a device the registry
 *   does not know (`{ deviceId, publicKey, agreementKey }`); the handshake still fails.
 * @param options.connections - `LiveConnections`; a device session is registered there
 *   so a revocation can close the socket rather than only refuse the next call.
 */
export async function createHostTunnel({
  url,
  hostId,
  identity,
  devices,
  decide,
  dispatch,
  /**
   * The Gateway's `wireStream.open`, called as `(endpoint, payload, uplink, peer, signal)`.
   * Optional: a deployment that only needs unary calls can leave it out, and an `open`
   * frame then fails the one stream it named rather than the connection.
   */
  openStream = async () => {
    throw new Error('remote-access: this host does not serve Remote streams')
  },
  onDevice = () => {},
  onUnknownDevice = async () => {},
  connections,
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

  /**
   * Serialize sealed sends.
   *
   * `Session.seal` reserves its sequence synchronously, but it is asynchronous on the
   * wire: two concurrent callers can finish in the other order, and the device's
   * `open` refuses a sequence that is not exactly next. A stream item overtaking the
   * response (or the `$events` ready frame) makes the device drop every later frame,
   * which is indistinguishable from a dead stream — the workspace list simply never
   * arrives. One chain keeps sealing and sending in call order.
   */
  let sendChain = Promise.resolve()
  const sealAndSend = (boundSession, boundSocket, payload) => {
    // The caller decides which session and socket this frame belongs to. Binding
    // here, rather than reading `session` when the queue reaches the front, is
    // what keeps a slow response for device A from being sealed with device B's
    // session after A disconnects and B attaches to the same relay link.
    const run = sendChain.then(async () => {
      if (boundSession === undefined || boundSession !== session) return false
      if (boundSocket === undefined || boundSocket !== socket || boundSocket.readyState !== 1) return false
      boundSocket.send(await boundSession.seal(payload))
      return true
    })
    sendChain = run.then(() => undefined, () => undefined)
    return run
  }

  /**
   * Send one already-serialized frame for a specific session.
   *
   * The channel passes the session it was built for, so an async answer that
   * outlives its device is dropped instead of being delivered to the next one.
   */
  const sendSealedText = (boundSession, boundSocket, text) => sealAndSend(
    boundSession,
    boundSocket,
    new TextEncoder().encode(text),
  )

  /**
   * The channel for the current session, built when the handshake completes.
   *
   * One per session, because a session must not outlive the socket it was made on and
   * neither must the streams it carries. It owns the envelope vocabulary and the
   * logical-stream frames; the tunnel keeps the socket, the registration and the
   * decision about who may act.
   */
  let channel

  /**
   * The admission gate, asked once per call and once per stream.
   *
   * Deliberately a function rather than a decision made when the channel was built:
   * the device registry is live, so a device revoked while its socket is up has to be
   * refused on its next request. Reading the record again here is what makes
   * revocation an action rather than a note.
   */
  const gateFor = (deviceId, endpoint) => {
    if (deviceId === undefined) return REFUSAL.NOT_PAIRED
    const device = devices.get(deviceId)
    const verdict = judgeCall({ device, devices, decide })
    if (!verdict.allowed) {
      log(`remote-access: refused ${endpoint} from ${String(deviceId)}: ${verdict.refusal.code}`)
      return verdict.refusal
    }
    const operation = decide(device, endpoint)
    if (!operation.allowed) {
      log(`remote-access: refused ${endpoint} for ${String(deviceId)}: ${operation.reason}`)
      return REFUSAL.OPERATION
    }
    return true
  }

  /**
   * Refuse the current device without touching the relay link.
   *
   * The relay socket is shared with every other device and with the Host's own
   * registration, so a bad frame from one device may only drop that device. The relay
   * has a `drop-peer` control frame for exactly this.
   */
  const dropPeer = (reason) => {
    try {
      socket?.send(JSON.stringify({ t: 'drop-peer' }))
    } catch {
      // The socket is already gone; detaching the device is still correct.
    }
    detachPeer(reason)
  }

  /** Sealed frames on an established session: calls and logical streams alike. */
  const handleData = async (bytes) => {
    // Capture the channel for this frame. A disconnect can clear the shared
    // `channel` while `session.open` is awaiting; reading it again afterwards is how
    // the old code produced "Cannot read properties of undefined (reading 'receive')"
    // on a reconnect, which then looked like a relay failure.
    const active = channel
    if (active === undefined) return
    let text
    try {
      text = new TextDecoder().decode(await session.open(bytes))
    } catch (error) {
      // A frame that will not authenticate ends *this device's* channel, not the
      // shared relay link: the sender cannot be trusted to read a reply, and a
      // pending device must not be able to bounce the Host's registration.
      log(`remote-access: dropping a frame that did not authenticate: ${error.message}`)
      dropPeer('frame did not authenticate')
      return
    }
    try {
      // Routing completes before this returns; a slow Host method is left detached so
      // that a stream cancel or an approval answer behind it is not stuck in the queue.
      await active.receive(text, { awaitReply: false })
    } catch (error) {
      log(`remote-access: dropping the peer after an invalid frame: ${String(error?.message ?? error)}`)
      dropPeer('invalid frame')
    }
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
    // Register the live session so a revocation can close it rather than only
    // refusing the next call. `open` refuses a device sealed by an earlier
    // revocation, which closes the race: a socket that finished its handshake just
    // after the operator pressed revoke loses instead of slipping through.
    try {
      liveHandle = connections?.open(session.deviceId, {
        // Revocation ends the *device* connection, not the Host's relay link: ask
        // the relay to refuse the peer and drop it. Closing the shared socket here
        // would also disconnect the Host and interrupt any other device.
        close: () => {
          try {
            socket.send(JSON.stringify({ t: 'drop-peer' }))
          } catch {
            // The socket is already gone; the close handler cleans up.
          }
          detachPeer('device revoked')
        },
      })
    } catch (error) {
      log(`remote-access: refusing a session for a revoked device: ${String(error?.message ?? error)}`)
      closeQuietly(socket, 1008, 'device revoked')
      return
    }
    log(`remote-access: end-to-end channel established with ${String(handshake.deviceId)}`)
    onDevice(handshake.deviceId)
    // Built here rather than when the socket opened, because the device identity —
    // and therefore every decision the gate makes — only exists once the handshake
    // has proved it.
    const channelSession = session
    const channelSocket = socket
    const channelDeviceId = session.deviceId
    channel = new RemoteChannel({
      dispatchRpc: async (endpoint, payload, signal, peer, rpcId) => {
        const device = devices.get(channelDeviceId)
        // The same verdict the gate used, passed down so only a call that changes
        // something gets the adapter's at-most-once memory. Reads are cheap to repeat
        // and their answers should reflect the current state.
        const verdict = decide(device, endpoint)
        if (verdict?.allowed !== true) {
          // A revocation between the gate and the dispatch must not let the call run.
          throw new Error(`remote-access: ${endpoint} is no longer allowed`)
        }
        const response = await dispatch({
          rpcId,
          method: endpoint,
          payload,
          device,
          peer,
          signal,
          sideEffect: verdict?.sideEffect === true,
        })
        // The relay's dispatcher answers with an envelope because that is what it
        // hands back to the device. The channel owns the envelope, so only the result
        // is taken from it; passing the envelope through would nest it twice.
        return response?.result ?? response
      },
      open: (endpoint, payload, uplink, peer, signal) => openStream(endpoint, payload, uplink, peer, signal),
      failure: (error) => toWireFailure(error),
      onDetachedFailure: (error) => {
        log(`remote-access: a detached call failed: ${String(error?.message ?? error)}`)
      },
      // The channel hands over one complete text frame, already serialized and in the
      // Gateway's frame vocabulary. Re-parsing it here only to re-seal it would be a
      // round trip through JSON that can lose and cannot gain. The session/socket
      // pair is the one this channel was built for, not whichever is current when a
      // slow answer finally arrives.
      send: async (text) => { await sendSealedText(channelSession, channelSocket, text) },
      peer: undefined,
      gate: (endpoint) => gateFor(channelDeviceId, endpoint),
    })
  }

  let handshake
  /** The live-connection entry for the device on the current socket, once it has a session. */
  let liveHandle
  /** Which of the three stages the current socket is in. */
  const stage = { control: true }

  /**
   * Tear down the device side of the current link without touching the relay socket.
   *
   * The socket is shared by every device the Host serves, so it must not be closed
   * when one device leaves or is revoked. Detaching the live entry, closing the
   * channel's streams and returning to the control stage is the whole cleanup; the
   * next `peer-joined` starts a new handshake on the same socket.
   */
  const detachPeer = (reason) => {
    const handle = liveHandle
    liveHandle = undefined
    handle?.detach?.()
    try {
      channel?.close(reason)
    } catch (error) {
      log(`remote-access: error closing streams after ${reason}: ${String(error?.message ?? error)}`)
    }
    channel = undefined
    handshake = undefined
    session = undefined
    stage.control = true
  }

  const connect = () => {
    if (stopped) return
    // A reconnect starts a new session; the old socket's entry must not linger in
    // the live registry, or a later revocation would try to close something already gone.
    liveHandle?.detach()
    liveHandle = undefined
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
      // The session died with the socket; its live-registry entry must die with it.
      liveHandle?.detach()
      liveHandle = undefined
      if (stopped || socket !== current) return
      if (opened && event?.code === 1000) {
        // Deliberate replacement by a newer registration of the same host. Reconnecting
        // would replace that newer instance, and the two would keep kicking each other.
        log(`remote-access: relay replaced this connection (${String(event.code)} ${String(event.reason ?? '')}); not reconnecting`)
        stopped = true
        session = undefined
        try {
          channel?.close('replaced by a newer registration')
        } catch {
          // Nothing left to close.
        }
        channel = undefined
        return
      }
      session = undefined
      // The channel dies with its session. Its streams were carried by that socket,
      // and leaving them open would keep Host methods running for a peer that is gone.
      //
      // Closing a channel ends every stream on it, and a stream that fails may surface
      // its failure synchronously — a Host method's uplink reader, for instance, can be
      // waiting inside `for await` and see the inbox fail. This runs inside a socket
      // event handler, where a throw would become an uncaught exception in a callback
      // that has no caller to report it to, so the teardown is contained and logged
      // instead. The reconnect below is what matters for the user; a failure while
      // unwinding streams must not be allowed to skip it.
      try {
        channel?.close('the relay link closed')
      } catch (error) {
        log(`remote-access: error closing streams after the relay link ended: ${String(error?.message ?? error)}`)
      }
      channel = undefined
      scheduleReconnect()
    })
    // Inbound frames are taken one at a time, in arrival order.
    //
    // A sealed frame has to be decrypted before it can be routed, and decryption is
    // asynchronous, so handling each message in its own floating task lets two frames
    // that arrived in order finish out of order. For two independent unary calls that
    // only reorders replies. For a logical stream it loses data: an `item` routed
    // before the `open` that created its stream has nothing to join, the value is
    // discarded, and the Host method waits for something the device already sent.
    //
    // This was a real intermittent failure — a stream test failed about one run in
    // three with a timeout on the uplink — not a theoretical one.
    //
    // What is serialised is the *routing*. The reply to a unary call is left un-awaited
    // so that a slow Host method cannot hold up the frames behind it, because a stream
    // `cancel` is one of them. See `RemoteChannel.receive`.
    let inbound = Promise.resolve()
    const handleMessage = async (event) => {
      try {
        // `peer-gone` arrives as text and, once the peer is attached, the relay's
        // control frame is indistinguishable from a sealed frame by type alone —
        // whether it lands during the handshake or after the session. Handling it
        // before the sealed path is what keeps a device disconnect from being read as
        // a frame that failed to authenticate, which used to drop the Host's whole
        // relay link and interrupt whatever else it was serving.
        if (typeof event.data === 'string' && stage.control === false) {
          let control
          try {
            control = JSON.parse(event.data)
          } catch {
            control = undefined
          }
          if (control?.t === 'peer-gone') {
            detachPeer('the device left')
            return
          }
        }
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
                sig: await signTranscript(identity.signing.privateKey, buildRelayTranscript({
                  nonce: message.nonce,
                  hostId,
                  publicKey,
                })),
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
                onUnknownDevice,
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
              liveHandle?.detach()
              liveHandle = undefined
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
            // After READY the only legal frames are sealed binary. The relay's
            // `peer-gone` is handled above; any other text frame is a protocol
            // error from this device, not a relay control frame.
            if (typeof event.data === 'string') {
              dropPeer('unexpected text frame after the handshake')
              return
            }
            await handleData(toBytes(event.data))
            return
          }
          await handleHandshake(JSON.parse(event.data))
          return
      } catch (error) {
        log(`remote-access: ${error.message}`)
        // A device that cannot complete its handshake is a problem with that
        // device, not with the relay link. Closing the link would also drop a
        // device the Host is serving, and anyone who knows the host id could
        // bounce the Host with one bad hello. Ask the relay to refuse just this
        // peer and go back to waiting for the next one.
        if (session === undefined && stage.control === false) {
          liveHandle?.detach()
          liveHandle = undefined
          handshake = undefined
          stage.control = true
          try {
            current.send(JSON.stringify({ t: 'drop-peer' }))
          } catch {
            // The socket is already gone; the close handler reconnects.
          }
          return
        }
        fail('dropping the link after an error')
      }
    }
    current.addEventListener('message', (event) => {
      // Chained rather than awaited by the listener, which cannot await: the chain is
      // what gives the frames their order. `handleMessage` contains its own failure, so
      // this never rejects and the chain cannot stall.
      inbound = inbound.then(() => handleMessage(event))
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
      liveHandle?.detach()
      liveHandle = undefined
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
