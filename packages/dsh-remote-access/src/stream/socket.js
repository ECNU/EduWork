/**
 * A WebSocket the official Remote stream client will accept.
 *
 * The Gateway's browser half opens its logical-stream mux with a bare
 * `new WebSocket(remoteStreamUrl())` (`dsh-api-gateway/lib/client.js:507`). That
 * is the *only* socket construction in the whole client stack, which makes it the
 * only injection point — and a better one than reimplementing the mux: everything
 * above it (framing, multiplexing, uplink pumping, cancellation, reconnect) stays
 * the official implementation, and this file carries opaque text frames over
 * whatever tunnel it is given.
 *
 * What it therefore must get right is the WebSocket *interface*, not our protocol.
 * The caller is not a person reading our code; it is the official mux client, which
 * uses exactly this much of the API:
 *
 *   - `new WebSocket(url)` and the `open`, `message`, `error` and `close` events;
 *   - `socket.send(text)` for one complete text frame;
 *   - `socket.close(code, reason)`;
 *   - `socket.readyState` compared against the `WebSocket` constants.
 *
 * Deliberately not implemented: binary frames, subprotocols, protocol extensions
 * and `bufferedAmount`. The mux speaks text only, and inventing a binary path would
 * be inventing a thing nobody asked for. `binaryType` exists because a real
 * WebSocket has it, not because anything here reads it.
 *
 * Frames sent before the tunnel is open are queued rather than dropped. The mux
 * calls `send` from its own pump, which can run before the socket reports open, and
 * a dropped `open` frame would leave a logical stream that never starts and never
 * fails — the worst of the three outcomes.
 */

/** The readyState values a real WebSocket exposes, as instance and class members. */
export const CONNECTING = 0
export const OPEN = 1
export const CLOSING = 2
export const CLOSED = 3

export class StreamSocket {
  static CONNECTING = CONNECTING
  static OPEN = OPEN
  static CLOSING = CLOSING
  static CLOSED = CLOSED

  CONNECTING = CONNECTING
  OPEN = OPEN
  CLOSING = CLOSING
  CLOSED = CLOSED

  /** Present because the interface has it. The mux never changes it. */
  binaryType = 'blob'
  protocol = ''
  extensions = ''
  bufferedAmount = 0

  #url
  #state = CONNECTING
  #listeners = new Map()
  #queue = []
  #carrier
  #closeCode
  #closeReason

  /**
   * @param url - the address the caller asked for. Kept for the tunnel to read; a
   *   relay carrier ignores the path and uses it only to know a stream was wanted.
   * @param options.tunnel - the carrier, as `{ onText, onClose } => { send, close }`.
   *   Called immediately, so a tunnel that fails synchronously reports through the
   *   `error` then `close` events rather than by throwing out of the constructor —
   *   the caller is the official mux client, which has no try/catch around `new`.
   */
  constructor(url, options = {}) {
    this.#url = String(url)
    const tunnel = options.tunnel
    if (typeof tunnel !== 'function') throw new TypeError('stream socket: a tunnel factory is required')

    let carrier
    try {
      carrier = tunnel({
        onOpen: () => this.#settleOpen(),
        onText: text => this.#deliver(text),
        onClose: (code, reason) => this.#settleClose(code, reason),
        onError: message => this.#settleError(message),
      })
    } catch (error) {
      // Never throw out of the constructor. The mux would lose the socket reference
      // and the logical streams waiting on it would never settle.
      this.#settleError(error instanceof Error ? error.message : String(error))
      return
    }

    if (
      carrier === null || typeof carrier !== 'object'
      || typeof carrier.send !== 'function' || typeof carrier.close !== 'function'
    ) {
      this.#settleError('stream socket: the tunnel factory did not return a carrier with send() and close()')
      return
    }
    this.#carrier = carrier
  }

  /** The address this socket was constructed with. */
  get url() {
    return this.#url
  }

  get readyState() {
    return this.#state
  }

  addEventListener(type, handler) {
    if (typeof handler !== 'function') return
    if (!this.#listeners.has(type)) this.#listeners.set(type, new Set())
    this.#listeners.get(type).add(handler)
  }

  removeEventListener(type, handler) {
    this.#listeners.get(type)?.delete(handler)
  }

  /**
   * Send one complete text frame.
   *
   * Before the tunnel is open the frame is queued; after close it is dropped, which
   * is what a real WebSocket does and what the mux's own state machine already
   * guards against.
   */
  send(data) {
    if (this.#state === CLOSING || this.#state === CLOSED) return
    if (typeof data !== 'string') {
      // The mux is text-only. Accepting bytes would mean inventing an encoding and
      // silently corrupting whatever the caller meant.
      throw new TypeError('stream socket: only text frames are supported')
    }
    if (this.#state === CONNECTING) {
      this.#queue.push(data)
      return
    }
    this.#carrier.send(data)
  }

  /**
   * Begin the closing handshake.
   *
   * Only 1000 and 3000–4999 may go on the wire; anything else is replaced with
   * 1000. A real WebSocket throws on an invalid code, and the mux's dispose path
   * passes 1000 — but a throw during teardown would be reported as a stream
   * failure rather than as a closed socket, so the code is corrected instead.
   */
  close(code = 1000, reason = '') {
    if (this.#state === CLOSING || this.#state === CLOSED) return
    this.#state = CLOSING
    const valid = code === 1000 || (code >= 3000 && code <= 4999)
    this.#closeCode = valid ? code : 1000
    this.#closeReason = typeof reason === 'string' ? reason : String(reason)
    try {
      this.#carrier?.close(this.#closeCode, this.#closeReason)
    } catch {
      // A tunnel that throws while closing has still closed from the caller's side;
      // the close event below is what settles the mux's streams.
    }
    this.#settleClose(this.#closeCode, this.#closeReason)
  }

  #settleOpen() {
    if (this.#state !== CONNECTING) return
    this.#state = OPEN
    this.#emit('open', {})
    const queued = this.#queue
    this.#queue = []
    for (const text of queued) {
      try {
        this.#carrier.send(text)
      } catch (error) {
        this.#settleError(error instanceof Error ? error.message : String(error))
        return
      }
    }
  }

  #deliver(text) {
    if (this.#state !== OPEN) return
    this.#emit('message', { data: text })
  }

  #settleError(message) {
    const text = String(message)
    this.#state = CLOSED
    this.#defer(() => {
      this.#emit('error', { type: 'error', message: text, error: new Error(text) })
      this.#emit('close', { code: 1006, reason: text, wasClean: false })
      this.#listeners.clear()
    })
  }

  #settleClose(code, reason, { clean = true } = {}) {
    if (this.#state === CLOSED) return
    this.#state = CLOSED
    const text = typeof reason === 'string' ? reason : ''
    const event = {
      code: typeof code === 'number' ? code : clean ? 1000 : 1006,
      reason: text,
      wasClean: clean,
    }
    this.#defer(() => {
      this.#emit('close', event)
      this.#listeners.clear()
    })
  }

  /**
   * Run a terminal event after the current turn.
   *
   * A real WebSocket never dispatches `error` or `close` during construction: the
   * connection attempt is asynchronous, so the caller has always had its chance to
   * attach listeners by the time either fires. Emitting synchronously made both
   * events unobservable — the constructor reported the failure to a listener set
   * that was necessarily still empty, and the caller was left with a socket that
   * had silently died and never said so.
   */
  #defer(run) {
    if (typeof queueMicrotask === 'function') queueMicrotask(run)
    else setTimeout(run, 0)
  }

  #emit(type, event) {
    const handlers = this.#listeners.get(type)
    if (handlers === undefined) return
    for (const handler of [...handlers]) {
      try {
        handler(event)
      } catch (error) {
        // A listener that throws is the caller's bug, and rethrowing here would
        // abandon the remaining listeners for an event that cannot be re-delivered.
        if (typeof console !== 'undefined' && console.error !== undefined) {
          console.error(`[remote-access] ${type} listener threw:`, error)
        }
      }
    }
  }
}
