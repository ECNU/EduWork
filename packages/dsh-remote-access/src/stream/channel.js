/**
 * Host side: one encrypted channel, presented to the Gateway as one carrier.
 *
 * The Gateway exposes a single dispatcher through two entry points, and a carrier
 * needs both:
 *
 *   - `dispatchRpc(endpoint, payload, signal, peer)` for unary calls;
 *   - `wireStream.open(endpoint, payload, uplink, peer, signal)` for logical
 *     streams, returning a promise of the downlink iterable.
 *
 * Those are the same two entry points the WebSocket adapter calls, which is why
 * this file replaces only the adapter — the WebSocket — and not the protocol.
 * Parsing, validation and the frame vocabulary come from the shipped
 * `stream-protocol`, so a frame this file invented could not be expressed in it.
 *
 * Reaching `RemoteStreamMuxServer` instead was the first attempt and it does not
 * fit: its only entry point is `handleUpgrade(req, socket, head, peer)`, which wants
 * a socket that has genuinely finished a WebSocket upgrade. There is no upgrade
 * here — the device was admitted by pairing, over a carrier that is already
 * authenticated — and manufacturing one would mean writing a WebSocket server to
 * hand it to the WebSocket server.
 */

import { UplinkInbox } from './uplink.js'

export { UplinkInbox } from './uplink.js'

/**
 * The shipped stream-protocol parser, loaded on first use.
 *
 * Deliberately not a static import. This module is reached from the plugin's entry
 * through the relay tunnel, so a static import of the Gateway would make the whole
 * plugin fail to load wherever the Gateway is not resolvable — and the failure would
 * be a module-resolution error in a file nobody edited, reported at boot, replacing
 * the plugin's own diagnostics with nothing. Deferring it means an unresolvable
 * Gateway costs exactly the streams and leaves unary calls, registration and the
 * trace intact.
 */
let clientFrameParser

async function loadClientFrameParser() {
  if (clientFrameParser === undefined) {
    const module = await import('@deepseek-ai/dsh-api-gateway/stream-protocol')
    clientFrameParser = module.parseRemoteStreamClientMessage
  }
  return clientFrameParser
}

/** Test seam: install a parser without going through the dynamic import. */
export function useClientFrameParser(parser) {
  clientFrameParser = parser
}

/** What `wireStream.open` resolves to: an async iterable of downlink values. */
function isAsyncIterable(value) {
  return value !== null && typeof value === 'object' && typeof value[Symbol.asyncIterator] === 'function'
}

/**
 * The unary response envelope the device's decoder accepts.
 *
 * The shape is not a preference. `parseConnectionResponse` in
 * `@deepseek-ai/dsh-client-connection` requires `type`, a string `rpcId`, and a
 * `result` record whose `ok` is exactly `true` or `false`; on failure all three of
 * `code`, `message` and `details` must be present with the right types. A locally
 * invented `{ code, message }` — which an earlier version of the relay's own Host
 * adapter produced — is refused by that decoder, so the device reports a transport
 * error instead of the failure the Host meant to send.
 */
function serverResponse(rpcId, result) {
  return { type: 'server-response', rpcId, result }
}

function failedResponse(rpcId, code, message, details = {}) {
  return serverResponse(rpcId, { ok: false, error: { code, message, details } })
}

/**
 * Turn one encrypted channel into Gateway calls and streams.
 *
 * One channel is one physical generation, so it owns one set of stream ids. A
 * channel that ends fails everything still open on it, because a device whose
 * carrier vanished did not cancel its streams and must not be left waiting.
 */
export class RemoteChannel {
  #dispatchRpc
  #open
  #failure
  #send
  #peer
  /** One controller for the channel's lifetime, so a close is observable. */
  #lifetime = new AbortController()
  /** streamId → the controller and inbox the Host method sees. */
  #streams = new Map()
  #pendingWrites = Promise.resolve()
  #closed = false
  /** Told about a dispatch failure nothing was waiting for; see `receive`. */
  #onDetachedFailure

  /**
   * @param options.dispatchRpc - the Gateway's `dispatchRpc`. It already answers in
   *   `RemoteResult` form (`{ ok, value }` / `{ ok: false, error }`), so its answer
   *   is passed through rather than re-derived; re-deriving is how a specific Host
   *   code becomes a generic one.
   * @param options.open - the Gateway's `wireStream.open`, called as
   *   `(endpoint, payload, uplink, peer, signal)`. The order matters and was wrong
   *   in this channel's first version: the fourth argument is the Peer and the fifth
   *   is the cancellation signal, not the other way round. A controller in the Peer
   *   position would be handed to business code, and a Peer in the signal position
   *   would fail at the first `signal.aborted`.
   * @param options.failure - the Gateway's `wireStream.failure`, which maps a value
   *   to `{ code, message, details }`. It recognises a `RemoteError` structurally and
   *   is **not** idempotent, so it is applied to Host errors only and never to a
   *   value this file already mapped.
   * @param options.send - writes one outbound text frame into the tunnel.
   * @param options.peer - the Peer every call on this channel speaks for.
   * @param options.onDetachedFailure - told about a dispatch failure that no caller is
   *   waiting for, which happens only when `receive` is asked not to await the reply.
   *   Optional, because a caller that always awaits has somewhere to report it.
   */
  constructor({ dispatchRpc, open, failure, send, peer, gate, onDetachedFailure } = {}) {
    if (typeof dispatchRpc !== 'function') throw new TypeError('remote channel: dispatchRpc is required')
    if (typeof open !== 'function') throw new TypeError('remote channel: open is required')
    if (typeof failure !== 'function') throw new TypeError('remote channel: failure is required')
    if (typeof send !== 'function') throw new TypeError('remote channel: send is required')
    if (gate !== undefined && typeof gate !== 'function') throw new TypeError('remote channel: gate must be a function')
    if (onDetachedFailure !== undefined && typeof onDetachedFailure !== 'function') {
      throw new TypeError('remote channel: onDetachedFailure must be a function')
    }
    this.#dispatchRpc = dispatchRpc
    this.#open = open
    this.#failure = failure
    this.#send = send
    this.#peer = peer
    this.#gate = gate
    this.#onDetachedFailure = onDetachedFailure
  }

  /**
   * The per-frame admission check, or `undefined` to admit everything.
   *
   * It is asked once per call and once per stream — at `open`, not per item — and it
   * is evaluated *here*, on the channel, because the decision has to be made every
   * time rather than captured when the connection was established. A device revoked
   * while its socket is up must be refused on its next request, and a snapshot taken
   * at handshake time would keep answering it.
   *
   * A refusal is answered with an envelope rather than by closing the channel: the
   * device is entitled to the reason, and dropping the link would leave it guessing
   * between "refused" and "the network went away".
   *
   * @returns a truthy value to admit, or a refusal with `{ code, message, details }`.
   */
  #gate

  /** How many logical streams this channel still owns. */
  get size() {
    return this.#streams.size
  }

  get closed() {
    return this.#closed
  }

  /**
   * Handle one inbound text frame.
   *
   * The frame vocabulary is the Gateway's, and the two kinds are told apart by shape
   * rather than by a discriminator because that is how the carriers are distinguished
   * upstream: a `client-request` is a unary call, and everything else that parses is
   * a logical-stream frame.
   *
   * ## Why a caller that needs frame order passes `awaitReply: false`
   *
   * A carrier that receives frames off a socket has to preserve their order, because a
   * stream `item` routed before its own `open` finds no stream to join and is dropped.
   * The only way to give it that order is to finish one frame's routing before starting
   * the next — which this method cannot do on its own if it also waits for the dispatch,
   * since a unary call can take as long as the Host method behind it.
   *
   * So the reply can be left un-awaited. Routing still completes before this returns —
   * a stream is registered and a call has been handed to the dispatcher — while the
   * dispatch itself proceeds independently. That keeps a slow call from blocking the
   * frames behind it, which matters because a stream `cancel` is one of them.
   *
   * The default stays `true` so every existing caller, and every test that reads the
   * reply after awaiting this, keeps its meaning.
   */
  async receive(text, { awaitReply = true } = {}) {
    if (this.#closed) throw new Error('remote channel: the channel is closed')
    const value = JSON.parse(text)
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && value.type === 'client-request') {
      if (awaitReply) {
        await this.#writeRaw(await this.#call(value))
        return
      }
      // Detached, and its own failure is contained: a rejected write would otherwise be
      // an unhandled rejection in a path whose caller has already returned.
      void (async () => {
        try {
          await this.#writeRaw(await this.#call(value))
        } catch (error) {
          this.#reportDispatchFailure(error)
        }
      })()
      return
    }
    await this.#handleStreamFrame(text)
  }

  /** Where a detached dispatch failure goes when nothing is waiting for the reply. */
  #reportDispatchFailure(error) {
    this.#onDetachedFailure?.(error)
  }

  /** Unary: answer in the envelope the device's decoder accepts. */
  async #call(envelope) {
    const { rpcId, method, payload } = envelope
    if (typeof rpcId !== 'string' || rpcId === '') throw new TypeError('remote channel: the request has no rpcId')
    if (typeof method !== 'string' || method === '') throw new TypeError('remote channel: the request has no method')

    const admission = this.#admit(method)
    if (admission !== true) {
      // The refusal's own code travels, rather than being mapped through a failure
      // mapper that would not recognise it: a refusal is already the wire shape, and
      // running it through `failure` would turn a specific refusal into a generic
      // internal error.
      return failedResponse(rpcId, admission.code, admission.message, admission.details)
    }

    try {
      // The `rpcId` travels as a fifth argument. The Gateway's own `dispatchRpc` takes
      // four and ignores extras, so this is additive; a relay needs it because the id
      // is what a replay check keys on, and a dispatcher that invented its own would
      // be unable to tell a retransmission from a second request.
      const result = await this.#dispatchRpc(method, payload, this.#lifetime.signal, this.#peer, rpcId)
      if (result !== null && typeof result === 'object' && result.ok === true) {
        // `serverResponse` takes the `result` record, not the bare value: the envelope
        // is `{ result: { ok, value } }`, and passing the value here would put the
        // payload where the result record belongs — the device would then read
        // `result.ok` off the business value and see a failure.
        return serverResponse(rpcId, { ok: true, value: result.value })
      }
      if (result !== null && typeof result === 'object' && result.ok === false) {
        const wire = this.#failure(result.error)
        return failedResponse(rpcId, wire.code, wire.message, wire.details)
      }
      return failedResponse(rpcId, 'gateway/internal', 'Remote dispatch returned an unrecognised result')
    } catch (error) {
      const wire = this.#failure(error)
      return failedResponse(rpcId, wire.code, wire.message, wire.details)
    }
  }

  /**
   * Ask the gate about one endpoint, then make the answer uniform.
   *
   * A gate is allowed to say yes in any truthy way and to refuse with either an error
   * or a refusal record, because the callers that exist are a policy function and an
   * operation fence. Normalising here means the two call sites — a call and a stream
   * open — cannot disagree about what a refusal looks like.
   */
  #admit(endpoint) {
    if (this.#gate === undefined) return true
    const verdict = this.#gate(endpoint)
    if (verdict === undefined || verdict === null) return true
    if (verdict === true) return true
    if (verdict === false) return { code: 'remote-access/refused', message: 'this operation is not allowed', details: {} }
    if (verdict.allowed === true) return true
    const source = verdict.refusal !== undefined && verdict.refusal !== null ? verdict.refusal : verdict
    return {
      code: typeof source.code === 'string' && source.code !== '' ? source.code : 'remote-access/refused',
      message: typeof source.message === 'string' && source.message !== ''
        ? source.message
        : 'this operation is not allowed',
      details: source.details !== null && typeof source.details === 'object' && !Array.isArray(source.details)
        ? source.details
        : (source.status === undefined ? {} : { status: source.status }),
    }
  }

  async #handleStreamFrame(text) {
    const parseRemoteStreamClientMessage = await loadClientFrameParser()
    const message = parseRemoteStreamClientMessage(text)
    switch (message.type) {
      case 'open':
        this.#openStream(message)
        return
      case 'item':
        this.#streams.get(message.streamId)?.inbox.push(message.value)
        return
      case 'end':
        this.#streams.get(message.streamId)?.inbox.end()
        return
      case 'cancel':
        this.#stop(message.streamId, new Error('Remote stream cancelled'))
        return
      default:
        // `parseRemoteStreamClientMessage` narrows to these four, so this is
        // unreachable for a valid parse. It exists so a future frame type fails
        // loudly here instead of silently doing nothing.
        throw new Error(`remote channel: unsupported stream frame ${JSON.stringify(message.type)}`)
    }
  }

  /** The channel ended. Every open stream fails; none is left dangling. */
  close(reason = 'Remote stream socket closed') {
    if (this.#closed) return
    this.#closed = true
    this.#lifetime.abort(new Error(reason))
    for (const streamId of [...this.#streams.keys()]) this.#stop(streamId, new Error(reason))
  }

  #stop(streamId, error) {
    const stream = this.#streams.get(streamId)
    if (stream === undefined) return
    this.#streams.delete(streamId)
    stream.control.abort(error)
    stream.inbox.fail(error)
  }

  /** Serialize writes: two frames may not interleave on the channel. */
  #writeRaw(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    this.#pendingWrites = this.#pendingWrites.then(() => this.#send(text), () => this.#send(text))
    return this.#pendingWrites
  }

  #openStream(message) {
    const { streamId, endpoint, payload } = message
    if (this.#streams.has(streamId)) {
      // A duplicate id would give two Host methods one stream's identity. The
      // WebSocket adapter closes the whole socket for this; over a tunnel there is
      // no socket to close, so the offending stream fails and the channel lives.
      void this.#writeRaw({
        type: 'error',
        streamId,
        error: this.#failure(new Error('api gateway: duplicate Remote stream open')),
      })
      return
    }

    // The gate is asked once per stream, at `open`, rather than per item: an item is
    // only meaningful inside a stream that was already admitted, and re-judging each
    // one would cut an allowed stream apart halfway through.
    const admission = this.#admit(endpoint)
    if (admission !== true) {
      void this.#writeRaw({ type: 'error', streamId, error: admission })
      return
    }

    // The Host method observes cancellation through `control.signal` and receives a
    // controller rather than a bare signal, because a Remote failure used as the
    // abort reason is how the Gateway distinguishes "we failed this stream" from
    // "the client cancelled it".
    const control = new AbortController()
    const stream = { control, inbox: new UplinkInbox() }
    this.#streams.set(streamId, stream)
    void this.#pump(streamId, endpoint, payload, stream)
  }

  async #pump(streamId, endpoint, payload, stream) {
    let source
    try {
      source = await this.#open(endpoint, payload, stream.inbox, this.#peer, stream.control.signal)
      if (!isAsyncIterable(source)) {
        throw new Error(`api gateway: stream Remote method did not return an AsyncIterable for ${endpoint}`)
      }
    } catch (error) {
      this.#streams.delete(streamId)
      stream.inbox.fail(error)
      await this.#writeRaw({ type: 'error', streamId, error: this.#failure(error) })
      return
    }

    try {
      for await (const value of source) {
        if (this.#closed) break
        // Not awaited. `#writeRaw` already serializes writes through one chain to keep
        // frames from interleaving, and awaiting that chain here would pace the
        // downlink one frame per microtask round trip — a stream of values would
        // trickle instead of flowing, and a caller measuring it would see a slow
        // stream rather than a bug. The chain is drained at the end below, so a
        // failure to write is still reported.
        void this.#writeRaw({ type: 'item', streamId, value })
      }
      if (!this.#closed && !stream.control.signal.aborted) {
        void this.#writeRaw({ type: 'end', streamId })
      }
    } catch (error) {
      // The downlink settled with a failure. The mux sends a failure frame only when
      // the abort reason is a Remote error and otherwise treats the abort as the
      // cancellation the client asked for; the same distinction applies here, so a
      // cancelled stream ends quietly rather than reporting an error nobody raised.
      if (!stream.control.signal.aborted) {
        await this.#writeRaw({ type: 'error', streamId, error: this.#failure(error) })
      }
    } finally {
      // Drain the write chain before this stream is forgotten, so a failed write is
      // observed here rather than surfacing later against a stream nobody owns.
      await this.#pendingWrites.catch(() => undefined)
      this.#streams.delete(streamId)
      stream.inbox.fail(new Error('Remote stream ended'))
    }
  }
}
