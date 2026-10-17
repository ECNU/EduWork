/**
 * Device side: the DSH Connection carrier over the encrypted channel.
 *
 * This is the join the whole direction turns on. The Gateway's browser half opens
 * its logical-stream mux with a bare `new WebSocket(remoteStreamUrl())` — the only
 * socket construction in the entire client stack — and takes its unary transport
 * from `__DSH_TRANSPORT__`. Both are injectable, so this file supplies those two
 * things over the encrypted channel and lets the official implementation do
 * everything above them: framing, multiplexing, uplink pumping, cancellation,
 * reconnection, generation.
 *
 * The alternative — a carrier that implements `rpc` itself — was where this started
 * and it is the wrong shape. It means re-deriving the logical-stream protocol, and
 * the protocol is not ours: `@deepseek-ai/dsh-api-gateway/stream-protocol` already
 * defines every frame in both directions, and the mock the DSH team ships for their
 * own client tests speaks it. Supplying a socket keeps one owner for that protocol.
 *
 * ## Known gap: binary attachments
 *
 * `createWebConnectionRpc` reads a `multipart/form-data` reply by splitting it into
 * its parts and reattaching `codec: 'bytes'` values along the attachment paths. The
 * encrypted channel here carries JSON text only, so a response that arrives as
 * multipart is not decoded — file download and image results would fail. This is a
 * declared limitation rather than an oversight: nothing in this phase produces such
 * a response, and supporting it means agreeing a binary framing for the channel,
 * which belongs with the protocol work rather than being smuggled in here.
 */

import { DIRECTION, KIND, Session } from '../channel/crypto.js'
import { StreamSocket } from './socket.js'
import { decodeResponse, parseRpcEnvelope } from './envelope.js'

/** A promise plus its resolver. */
function deferred() {
  let resolve
  let reject
  const promise = new Promise((settle, fail) => { resolve = settle; reject = fail })
  return { promise, resolve, reject }
}

/**
 * One encrypted link, carrying the device's calls and streams.
 *
 * A link owns exactly one `Session` per direction of use, so its sequence numbers
 * are contiguous: frames are authenticated with a strictly increasing counter, and
 * interleaving two sessions on one link would make every other frame fail to open.
 */
export class DeviceLink {
  #session
  #pending = new Map()
  #rpcSequence = 0
  #sockets = new Set()
  #closed = false

  /**
   * @param options.session - the sealed channel, sending as the peer.
   * @param options.send - writes one sealed frame to the transport.
   */
  constructor({ session, send } = {}) {
    if (session === undefined) throw new TypeError('device link: a session is required')
    if (typeof send !== 'function') throw new TypeError('device link: send is required')
    this.#session = session
    this.#send = send
  }

  #send

  get closed() {
    return this.#closed
  }

  /**
   * The unary transport, in the shape `createWebConnectionRpc` returns.
   *
   * Its contract is the client's own, which is why the channel is asserted the way
   * the client asserts it and the reply is validated by the client's decoder rather
   * than by a shape invented here. A `multipart/form-data` reply is not supported;
   * see the file comment.
   */
  get rpc() {
    return {
      call: (channel, endpoint, payload, signal) => this.#call(channel, endpoint, payload, signal),
      open: (channel, endpoint, payload, signal, uplink) => this.#open(channel, endpoint, payload, signal, uplink),
    }
  }

  /**
   * The globals the Connection installer reads.
   *
   * `rpc` is supplied directly, so `createWebConnectionRpc` is never consulted and
   * no `fetch` is needed: the installer takes `transport.rpc` when it is present and
   * only falls back to building one from `fetch`/`openStream` when it is not.
   *
   * `streamBaseUrl` exists only so `new URL('/api/remote.mux', streamBaseUrl)`
   * resolves; the path is discarded, because the socket below ignores the address it
   * is given. Without it the official mux client would build its URL from
   * `document.baseURI`, which on a device is the relay's own page rather than the
   * Host.
   */
  transportGlobals({ streamBaseUrl = 'https://remote.invalid/' } = {}) {
    return {
      streamBaseUrl,
      rpc: this.rpc,
      WebSocket: this.webSocketClass(),
    }
  }

  /** The `WebSocket` the Gateway's mux client will construct. */
  webSocketClass() {
    const link = this
    return class LinkedWebSocket extends StreamSocket {
      constructor(url, options = {}) {
        super(url, {
          ...options,
          tunnel: handlers => link.#openTunnel(handlers),
        })
      }
    }
  }

  async #call(channel, endpoint, payload, signal) {
    if (this.#closed) throw new Error('device link: the link is closed')
    if (typeof channel !== 'string' || typeof endpoint !== 'string') {
      throw new Error('device link: an RPC target needs a channel and an endpoint')
    }
    if (signal?.aborted === true) throw signal.reason ?? new Error('device link: the call was aborted')

    const rpcId = `device-${String(++this.#rpcSequence)}`
    const request = { type: 'client-request', rpcId, method: endpoint, payload }
    const waiting = deferred()
    this.#pending.set(rpcId, waiting)
    try {
      await this.#frame(request)
      return await waiting.promise
    } finally {
      this.#pending.delete(rpcId)
    }
  }

  /**
   * Open one logical stream.
   *
   * Synchronous, because that is what the client expects: it reads
   * `connection.rpc.open?.(...)` and passes the result straight to
   * `normalizeConnectionStream`, which iterates it. Returning a promise here would
   * be iterated as a single value instead of as the stream.
   */
  #open(channel, endpoint, payload, signal, uplink) {
    if (this.#closed) throw new Error('device link: the link is closed')
    if (channel !== '/api') {
      throw new Error(`device link: worker-local streams require the /api channel, got ${JSON.stringify(channel)}`)
    }
    const streamId = `s-${String(++this.#rpcSequence)}`
    return this.#stream(streamId, endpoint, payload, signal, uplink)
  }

  async *#stream(streamId, endpoint, payload, signal, uplink) {
    const inbox = []
    let wake
    let ended = false
    let failure
    const notify = () => { const w = wake; wake = undefined; w?.() }

    const entry = {
      push: value => { inbox.push({ value }); notify() },
      fail: error => { failure = error; notify() },
      end: () => { ended = true; notify() },
    }
    this.#streams.set(streamId, entry)
    const stop = () => { this.#streams.delete(streamId) }

    signal?.addEventListener('abort', () => {
      void this.#frame({ type: 'cancel', streamId }).catch(() => undefined)
      entry.fail(signal.reason ?? new Error('device link: the stream was aborted'))
    }, { once: true })

    try {
      await this.#frame({ type: 'open', streamId, endpoint, payload })
      // Uplink items are forwarded as they arrive; the pump ends when the caller's
      // iterable ends, which is the half-close the Host method observes.
      if (uplink !== undefined) {
        void (async () => {
          try {
            for await (const item of uplink) await this.#frame({ type: 'item', streamId, value: item })
            await this.#frame({ type: 'end', streamId })
          } catch (error) {
            entry.fail(error)
          }
        })()
      }

      for (;;) {
        while (inbox.length > 0) yield inbox.shift().value
        if (failure !== undefined) throw failure
        if (ended) return
        if (this.#closed) throw new Error('device link: the link is closed')
        await new Promise(resolve => { wake = resolve })
      }
    } finally {
      stop()
    }
  }

  #streams = new Map()

  /** One WebSocket-shaped connection over the encrypted link. */
  #openTunnel(handlers) {
    const state = { open: false, closed: false }
    const queue = []
    const connection = {
      id: `ws-${String(++this.#rpcSequence)}`,
      handlers,
      state,
      queue,
    }
    this.#sockets.add(connection)
    // The mux starts sending as soon as it is constructed, before anything has had a
    // chance to report the socket open. Those frames are queued and flushed here,
    // because a dropped `open` frame is a logical stream that never starts and never
    // fails.
    queueMicrotask(() => {
      if (connection.state.closed) return
      connection.state.open = true
      handlers.onOpen()
      for (const text of queue.splice(0)) this.#text(connection, text)
    })
    return {
      send: text => {
        if (!connection.state.open) { queue.push(text); return }
        this.#text(connection, text)
      },
      close: (code, reason) => {
        connection.state.closed = true
        this.#sockets.delete(connection)
        handlers.onClose(code, reason)
      },
    }
  }

  /**
   * Send one outbound text frame from a socket.
   *
   * The official mux speaks the logical-stream vocabulary and nothing else, so a
   * frame from it is sealed and forwarded. What the socket opened is recorded, so
   * the answers can find their way back: without that the tunnel sends but never
   * receives, and the symptom is a stream that opens and then yields nothing
   * forever — with no error anywhere to say why.
   */
  #text(connection, text) {
    let value
    try {
      value = JSON.parse(text)
    } catch {
      connection.handlers.onError('device link: a frame was not JSON')
      return
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value) || typeof value.type !== 'string') {
      connection.handlers.onError('device link: a frame is not a stream message')
      return
    }
    if (value.type === 'open' && typeof value.streamId === 'string') {
      this.#tunnelStreams.set(value.streamId, connection)
    }
    if (value.type === 'cancel' && typeof value.streamId === 'string') {
      this.#tunnelStreams.delete(value.streamId)
    }
    void this.#frame(value).catch(error => {
      connection.handlers.onError(String(error?.message ?? error))
    })
  }

  /** Streams opened through a socket, so their answers reach that socket. */
  #tunnelStreams = new Map()

  /**
   * Seal one value and hand the frame to the transport.
   *
   * Sealing and sending are one serialized step, not two awaits that happen to
   * follow each other. `seal` allocates the next sequence number, so two concurrent
   * calls can seal out of order and then write in that same order — and the frame
   * framing authenticates a strictly increasing counter, so the host refuses the
   * second frame and the first call never completes. One queue for the pair removes
   * the window entirely.
   */
  #frame(value) {
    const write = this.#pendingFrames.then(async () => {
      const sealed = await this.#session.seal(new TextEncoder().encode(JSON.stringify(value)))
      await this.#send(sealed)
    })
    // The queue must survive a failed write, or one rejection would stall every later
    // frame. The caller still receives the rejection.
    this.#pendingFrames = write.then(() => undefined, () => undefined)
    return write
  }

  #pendingFrames = Promise.resolve()

  /**
   * Accept one inbound sealed frame.
   *
   * Everything arrives here — unary answers and stream frames — because they share
   * one channel and one sequence. Unsealing is therefore the routing point, and the
   * caller is expected to have already authenticated the peer.
   */
  async receive(frame) {
    if (this.#closed) throw new Error('device link: the link is closed')
    const plain = await this.#session.open(frame)
    const value = parseRpcEnvelope(new TextDecoder().decode(plain))

    if (typeof value.rpcId === 'string' && value.type === 'server-response') {
      const waiting = this.#pending.get(value.rpcId)
      if (waiting !== undefined) {
        // The envelope's `result` is what `rpc.call` resolves to, because that is
        // what the client's own `createWebConnectionRpc` returns after decoding. Hand
        // back the envelope and every caller would unwrap it twice.
        try {
          waiting.resolve(decodeResponse(value).result)
        } catch (error) {
          waiting.reject(error)
        }
      }
      return
    }
    if (typeof value.streamId === 'string') {
      // Two ways a logical stream can exist on this link: `rpc.open`, whose reader
      // this link owns, and a socket, whose frames the mux parses itself. They are
      // routed to different places, and a stream id belongs to exactly one of them.
      const socket = this.#tunnelStreams.get(value.streamId)
      if (socket !== undefined) {
        if (value.type === 'end' || value.type === 'error') this.#tunnelStreams.delete(value.streamId)
        socket.handlers.onText(JSON.stringify(value))
        return
      }
      const entry = this.#streams.get(value.streamId)
      if (entry === undefined) return
      if (value.type === 'item') entry.push(value.value)
      else if (value.type === 'end') entry.end()
      else if (value.type === 'error') entry.fail(new Error(value.error?.message ?? 'device link: stream failed'))
      return
    }
    throw new Error(`device link: unrecognised inbound frame ${JSON.stringify(value.type)}`)
  }

  /** The link is gone. Every pending call and open stream fails. */
  close(reason = 'device link: the channel closed') {
    if (this.#closed) return
    this.#closed = true
    for (const waiting of this.#pending.values()) waiting.reject(new Error(reason))
    this.#pending.clear()
    for (const entry of this.#streams.values()) entry.fail(new Error(reason))
    this.#streams.clear()
    for (const connection of [...this.#sockets]) {
      connection.state.closed = true
      this.#sockets.delete(connection)
      connection.handlers.onClose(1006, reason)
    }
  }
}

/**
 * Build a link around a sealed channel.
 *
 * `send` is the transport's own write; `receive` is driven by whoever reads the
 * transport, so this construction makes no assumption about what carries the bytes —
 * a socket, a relay, or a loopback pair in a test.
 */
export function createDeviceLink({ session, send } = {}) {
  return new DeviceLink({ session, send })
}

/**
 * The `Session` a device sends as, given the negotiated keys.
 *
 * The device is the peer, so it seals with the peer-to-host key and opens with the
 * host-to-peer one. `Session` takes `sendKey`/`receiveKey`/`direction` rather than
 * the key pair itself, and getting that wrong is not subtle — the first frame fails
 * to open — but it is worth naming because the keys are handed around as a pair
 * named for their directions, not for their roles in a session.
 */
export function deviceSession(keys, { kind = KIND.RPC } = {}) {
  return new Session({
    sendKey: keys.peerToHost,
    receiveKey: keys.hostToPeer,
    direction: DIRECTION.PEER_TO_HOST,
    kind,
  })
}

/** The `Session` the host answers as: the mirror of {@link deviceSession}. */
export function hostSession(keys, { kind = KIND.RPC } = {}) {
  return new Session({
    sendKey: keys.hostToPeer,
    receiveKey: keys.peerToHost,
    direction: DIRECTION.HOST_TO_PEER,
    kind,
  })
}
