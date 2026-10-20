/**
 * HTTP exchanges and Gateway streams multiplexed over one {@link Channel}.
 * Frame names and meanings follow DSH's worker tunnel (`req`, `res-head`,
 * `res-chunk`, `stream-open`, `stream-item`, `abort`, …); bodies are chunked
 * under credit (body.ts) because a network carrier, unlike `postMessage`,
 * needs flow control.
 *
 * An exchange lives and dies with the channel it was opened on: when the
 * channel closes, the device's pending exchanges fail with the close reason
 * and the Host's handlers are aborted; whatever they produce afterwards is
 * dropped with the channel. Nothing is retried here.
 */
import { Credit, IncomingBody, sendBody } from './body.ts'
import { ChannelClosed, type Channel, type Frame, type Header } from './channel.ts'
import { Close } from './close-codes.ts'
import { Inbox } from './inbox.ts'

/** Origin of the `Request` objects the Host handler receives; only path and query come from the device. */
export const TUNNEL_ORIGIN = 'https://tunnel.invalid'
const NULL_BODY = new Set([204, 205, 304])

export interface TunnelRequest {
  readonly method: string
  /** Path and query beginning with a single `/`. */
  readonly url: string
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: Uint8Array | ReadableStream<Uint8Array> | null
}

export interface StreamFailure { readonly code: string; readonly message: string; readonly details: object }

/** The Host could not answer a request (as opposed to answering with an error status). */
export class TunnelError extends Error {
  override name = 'TunnelError'
}

/** The Host ended a stream with a stable failure. */
export class TunnelStreamError extends Error {
  override name = 'TunnelStreamError'
  readonly code: string
  readonly details: object
  constructor({ code, message, details }: StreamFailure) {
    super(message)
    this.code = code
    this.details = details
  }
}

/** What the Host plugs in: the same shapes as DSH's shared fetch handler and `wireStream.open`. */
export interface TunnelHandler {
  /**
   * `signal` aborts when the device aborts or the channel closes. Prefer it to
   * `request.signal`: Node's Request follows its init signal only while the
   * Request object itself is still reachable.
   */
  fetch(request: Request, signal: AbortSignal): Promise<Response>
  openStream(endpoint: string, payload: unknown, uplink: AsyncIterable<unknown>, signal: AbortSignal): AsyncIterable<unknown>
  streamFailure(error: unknown): StreamFailure
}

interface Exchange {
  receive(frame: Frame): void
  fail(reason: unknown): void
}

/**
 * Host side: serve the device's exchanges until the channel closes.
 * @param idleMs - close the channel when no frame arrived for this long; the device pings well within it.
 */
export async function serveTunnel(channel: Channel, handler: TunnelHandler, idleMs = 90_000): Promise<void> {
  const exchanges = new Map<number, { abort: AbortController; credit?: Credit; body?: IncomingBody; uplink?: Inbox<unknown> }>()
  const reject = (detail: string): void => channel.close(Close.protocolError, detail)
  let lastId = 0

  const request = (id: number, header: Header): void => {
    const { method, url, headers } = header
    if (typeof method !== 'string' || !isPath(url) || !isHeaders(headers) || typeof header.body !== 'boolean') return reject('malformed request')
    const abort = new AbortController(), credit = new Credit()
    const body = header.body ? new IncomingBody(bytes => channel.send({ t: 'credit', id, bytes })) : undefined
    exchanges.set(id, { abort, credit, body })
    const { signal } = abort
    void (async () => {
      try {
        const init = { method, headers, body: body?.readable ?? null, duplex: 'half', signal }
        const response = await handler.fetch(new Request(new URL(url, TUNNEL_ORIGIN), init as RequestInit), signal)
        const content = method === 'HEAD' || NULL_BODY.has(response.status) ? null : response.body
        if (signal.aborted || content === null) void response.body?.cancel().catch(() => {})
        if (signal.aborted) return
        channel.send({ t: 'res-head', id, status: response.status, headers: Object.fromEntries(response.headers) })
        if (content !== null) await sendBody(channel, id, 'res-chunk', content, credit, signal)
        channel.send({ t: 'res-end', id })
      } catch (error) {
        if (!signal.aborted) channel.send({ t: 'res-err', id, message: messageOf(error) })
      } finally {
        exchanges.delete(id)
      }
    })()
  }

  const stream = (id: number, header: Header): void => {
    if (typeof header.endpoint !== 'string' || header.endpoint === '') return reject('malformed stream')
    const abort = new AbortController(), uplink = new Inbox<unknown>()
    exchanges.set(id, { abort, uplink })
    const { signal } = abort
    void (async () => {
      try {
        for await (const value of handler.openStream(header.endpoint as string, header.payload, uplink, signal)) {
          if (signal.aborted) break
          channel.send({ t: 'stream-item', id, value })
        }
        if (!signal.aborted) channel.send({ t: 'stream-end', id })
      } catch (error) {
        if (!signal.aborted) channel.send({ t: 'stream-error', id, ...handler.streamFailure(error) })
      } finally {
        uplink.end()
        exchanges.delete(id)
      }
    })()
  }

  let idle: ReturnType<typeof setTimeout> | undefined
  const arm = (): void => {
    clearTimeout(idle)
    idle = setTimeout(() => channel.close(Close.timeout, 'device went silent'), idleMs)
  }
  arm()
  try {
    for (;;) {
      const { header, body } = await channel.receive()
      if (channel.signal.aborted) break
      arm()
      if (header.t === 'ping' && header.id === undefined) {
        channel.send({ t: 'pong' })
        continue
      }
      const id = header.id
      if (!isPositive(id)) { reject('frame without exchange id'); break }
      if (header.t === 'req' || header.t === 'stream-open') {
        if (id <= lastId) { reject('exchange id reused'); break }
        lastId = id
      }
      const exchange = exchanges.get(id)
      switch (header.t) {
        case 'req': request(id, header); break
        case 'stream-open': stream(id, header); break
        case 'req-chunk': if (exchange?.body?.push(body) === false) reject('credit exceeded'); break
        case 'req-end': exchange?.body?.close(); break
        case 'stream-uplink-item': exchange?.uplink?.push(header.value); break
        case 'stream-uplink-end': exchange?.uplink?.end(); break
        case 'credit': isPositive(header.bytes) ? exchange?.credit?.grant(header.bytes) : reject('malformed credit'); break
        case 'abort': exchange?.abort.abort(new Error('aborted by the device')); break
        default: reject(`unexpected frame ${header.t}`)
      }
    }
  } catch {
    // The channel closed; fall through to abort what is still running.
  }
  clearTimeout(idle)
  for (const { abort } of exchanges.values()) abort.abort(channel.signal.reason)
}

/** Device side: issue requests and open streams on the Host. */
export class TunnelClient {
  readonly #channel: Channel
  readonly #exchanges = new Map<number, Exchange>()
  readonly #onControl: (header: Header) => void
  readonly #pongs: (() => void)[] = []
  #nextId = 1

  /**
   * @param onControl - frames without an exchange id (such as revocation); by default they are a protocol error.
   */
  constructor(channel: Channel, onControl?: (header: Header) => void) {
    this.#channel = channel
    this.#onControl = onControl ?? (header => this.#reject(`unexpected frame ${header.t}`))
    void this.#run()
  }

  /** Perform one request; a closed or closing channel rejects with {@link ChannelClosed}. */
  async fetch(request: TunnelRequest, signal?: AbortSignal): Promise<Response> {
    signal?.throwIfAborted()
    this.#channel.signal.throwIfAborted()
    const id = this.#nextId++
    const channel = this.#channel
    const { promise, resolve, reject } = Promise.withResolvers<Response>()
    const credit = new Credit(), upload = new AbortController()
    let body: IncomingBody | undefined
    const finish = (): void => {
      this.#exchanges.delete(id)
      upload.abort()
      signal?.removeEventListener('abort', onAbort)
    }
    const fail = (reason: unknown): void => {
      finish()
      reject(reason)
      body?.error(reason)
    }
    const onAbort = (): void => {
      channel.send({ t: 'abort', id })
      fail(signal!.reason)
    }
    const nullBody = (status: number): boolean => request.method === 'HEAD' || NULL_BODY.has(status)

    channel.send({ t: 'req', id, method: request.method, url: request.url, headers: request.headers ?? {}, body: request.body != null })
    signal?.addEventListener('abort', onAbort, { once: true })
    this.#exchanges.set(id, {
      fail,
      receive: ({ header, body: bytes }) => {
        switch (header.t) {
          case 'res-head': {
            const { status, headers } = header
            if (body !== undefined || !isStatus(status) || !isHeaders(headers)) return this.#reject('malformed response')
            body = new IncomingBody(bytes => channel.send({ t: 'credit', id, bytes }), () => {
              channel.send({ t: 'abort', id })
              finish()
            })
            try {
              resolve(new Response(nullBody(status) ? null : body.readable, { status, headers }))
            } catch (error) {
              channel.send({ t: 'abort', id })
              fail(error)
            }
            return
          }
          case 'res-chunk': if (body?.push(bytes) !== true) this.#reject('unexpected response body'); return
          case 'res-end':
            if (body === undefined) return this.#reject('response ended before its head')
            finish()
            return body.close()
          case 'res-err': return fail(new TunnelError(String(header.message)))
          case 'credit': return isPositive(header.bytes) ? credit.grant(header.bytes) : this.#reject('malformed credit')
          default: return this.#reject(`unexpected frame ${header.t}`)
        }
      },
    })
    if (request.body != null) {
      sendBody(channel, id, 'req-chunk', request.body, credit, upload.signal).then(
        () => channel.send({ t: 'req-end', id }),
        (error: unknown) => {
          if (upload.signal.aborted) return
          channel.send({ t: 'abort', id })
          fail(error)
        },
      )
    }
    return promise
  }

  /**
   * Open one Gateway stream; same contract as DSH's `RpcStreamOpen`. Remote
   * failures throw {@link TunnelStreamError}; a lost channel throws {@link ChannelClosed}.
   */
  async *openStream(endpoint: string, payload: unknown, signal: AbortSignal, uplink?: AsyncIterable<unknown>): AsyncGenerator<unknown, void, undefined> {
    signal.throwIfAborted()
    this.#channel.signal.throwIfAborted()
    const id = this.#nextId++
    const inbox = new Inbox<Header>(), stop = new AbortController()
    const onAbort = (): void => inbox.fail(signal.reason)
    this.#channel.send({ t: 'stream-open', id, endpoint, payload })
    this.#exchanges.set(id, {
      fail: reason => inbox.fail(reason),
      receive: ({ header }) => {
        if (header.t === 'stream-item') return inbox.push(header)
        if (header.t !== 'stream-end' && header.t !== 'stream-error') return this.#reject(`unexpected frame ${header.t}`)
        this.#exchanges.delete(id)
        inbox.push(header)
        inbox.end()
      },
    })
    signal.addEventListener('abort', onAbort, { once: true })
    if (uplink !== undefined) void this.#pumpUplink(id, uplink, stop.signal, inbox)
    let terminal = false
    try {
      for await (const header of inbox) {
        if (header.t === 'stream-item') {
          yield header.value
          continue
        }
        terminal = true
        if (header.t === 'stream-error') throw new TunnelStreamError(failureOf(header))
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
      stop.abort()
      if (!terminal) {
        this.#exchanges.delete(id)
        this.#channel.send({ t: 'abort', id })
      }
    }
  }

  /**
   * One round trip to the Host. Pages cannot see WebSocket pings, so the web
   * client probes liveness with this and reconnects when it times out.
   */
  async ping(): Promise<void> {
    const closed = this.#channel.signal
    closed.throwIfAborted()
    const { promise, resolve, reject } = Promise.withResolvers<void>()
    const onClose = (): void => reject(closed.reason)
    closed.addEventListener('abort', onClose, { once: true })
    this.#pongs.push(resolve)
    this.#channel.send({ t: 'ping' })
    try {
      await promise
    } finally {
      closed.removeEventListener('abort', onClose)
    }
  }

  /** Forward the caller's uplink until it ends or the stream stops; its failure fails the stream. */
  async #pumpUplink(id: number, uplink: AsyncIterable<unknown>, stop: AbortSignal, inbox: Inbox<Header>): Promise<void> {
    const iterator = uplink[Symbol.asyncIterator]()
    const stopped = new Promise<IteratorResult<unknown>>(resolve => {
      stop.addEventListener('abort', () => resolve({ done: true, value: undefined }), { once: true })
    })
    try {
      for (;;) {
        const next = await Promise.race([iterator.next(), stopped])
        if (stop.aborted) return
        if (next.done) return this.#channel.send({ t: 'stream-uplink-end', id })
        this.#channel.send({ t: 'stream-uplink-item', id, value: next.value })
      }
    } catch (error) {
      if (!stop.aborted) inbox.fail(error)
    } finally {
      if (stop.aborted) void iterator.return?.()?.catch(() => {})
    }
  }

  async #run(): Promise<void> {
    try {
      for (;;) {
        const frame = await this.#channel.receive()
        const { id } = frame.header
        if (id === undefined) frame.header.t === 'pong' ? this.#pongs.shift()?.() : this.#onControl(frame.header)
        else if (isPositive(id)) this.#exchanges.get(id)?.receive(frame)
        else this.#reject('malformed exchange id')
      }
    } catch {
      this.#reject('tunnel failure')
      const reason = this.#channel.signal.reason as ChannelClosed
      for (const exchange of [...this.#exchanges.values()]) exchange.fail(reason)
      this.#exchanges.clear()
    }
  }

  #reject(detail: string): void {
    this.#channel.close(Close.protocolError, detail)
  }
}

const isPositive = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0
const isStatus = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 200 && (value as number) <= 599
const isHeaders = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every(v => typeof v === 'string')
const isPath = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('/') && URL.canParse(value, TUNNEL_ORIGIN) && new URL(value, TUNNEL_ORIGIN).origin === TUNNEL_ORIGIN
const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error)
const failureOf = (header: Header): StreamFailure => ({
  code: String(header.code),
  message: String(header.message),
  details: typeof header.details === 'object' && header.details !== null ? header.details : {},
})
