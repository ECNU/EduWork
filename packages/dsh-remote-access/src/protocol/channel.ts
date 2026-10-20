/**
 * Encrypted, framed, ordered channel over one WebSocket. The browser and the
 * Host use the same class; only the handshake role differs.
 *
 * Wire: one binary WebSocket message is one Noise transport message. Its
 * plaintext is a flag byte (1 = more fragments follow) and a fragment of a
 * frame; a frame is a u32 big-endian header length, a JSON header and raw body.
 */
import { concat, fromUtf8, utf8 } from './bytes.ts'
import { Close } from './close-codes.ts'
import { initiate, MAX_PLAINTEXT, respond, type KeyPair, type Session } from './noise.ts'

/** Largest reassembled frame; a peer that sends more is closed. */
export const MAX_FRAME = 16 * 1024 * 1024
/** Unsent bytes beyond which the peer is considered stalled and the channel closes. */
export const MAX_BACKLOG = 4 * MAX_FRAME
/** {@link Channel.drained} waits until no more than this is buffered. */
const LOW_WATER = 1024 * 1024
const FRAGMENT = MAX_PLAINTEXT - 1
const MORE = 1
const EMPTY = new Uint8Array(0)

/** The WHATWG WebSocket surface the channel needs; browsers and Node's global WebSocket both provide it. */
export interface SocketLike {
  binaryType: string
  readonly bufferedAmount: number
  send(data: Uint8Array<ArrayBuffer>): void
  close(code?: number, reason?: string): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  addEventListener(type: 'close', listener: (event: { code: number; reason: string }) => void): void
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  removeEventListener(type: 'close', listener: (event: { code: number; reason: string }) => void): void
}

export interface Header { readonly t: string; readonly [field: string]: unknown }
export interface Frame { readonly header: Header; readonly body: Uint8Array }

export class ChannelClosed extends Error {
  readonly code: number
  readonly detail: string
  constructor(code: number, detail: string) {
    super(`channel closed (${code}${detail ? `: ${detail}` : ''})`)
    this.name = 'ChannelClosed'
    this.code = code
    this.detail = detail
  }
}

export class Channel {
  readonly #socket: SocketLike
  readonly #closer = new AbortController()
  #session: Session | undefined
  /** Raw messages that arrived before the session existed. */
  #early: Uint8Array[] = []
  #frames: Frame[] = []
  #fragments: Uint8Array[] = []
  #fragmentBytes = 0
  #wake: (() => void) | undefined

  /** Device side: run the IK handshake against the Host key from the pairing link. */
  static async connect(socket: SocketLike, hostKey: Uint8Array, prologue: Uint8Array, signal: AbortSignal): Promise<Channel> {
    const channel = new Channel(socket)
    return channel.#handshake(signal, async () => {
      const handshake = initiate(hostKey, prologue)
      socket.send(handshake.message)
      return handshake.finish(await channel.#raw())
    })
  }

  /** Host side: answer the device's handshake with the Host's static key. */
  static async accept(socket: SocketLike, keyPair: KeyPair, prologue: Uint8Array, signal: AbortSignal): Promise<Channel> {
    const channel = new Channel(socket)
    return channel.#handshake(signal, async () => {
      const { reply, session } = respond(keyPair, prologue, await channel.#raw())
      socket.send(reply)
      return session
    })
  }

  private constructor(socket: SocketLike) {
    this.#socket = socket
    socket.binaryType = 'arraybuffer'
    const onMessage = ({ data }: { data: unknown }): void => {
      if (!(data instanceof ArrayBuffer)) return this.close(Close.protocolError, 'unexpected text message')
      if (this.#session === undefined) this.#early.push(new Uint8Array(data))
      else this.#receive(new Uint8Array(data))
      this.#notify()
    }
    const onClose = ({ code, reason }: { code: number; reason: string }): void => this.#end(new ChannelClosed(code, reason))
    socket.addEventListener('message', onMessage)
    socket.addEventListener('close', onClose)
    this.signal.addEventListener('abort', () => {
      socket.removeEventListener('message', onMessage)
      socket.removeEventListener('close', onClose)
    }, { once: true })
  }

  /** Aborted once the channel is closed, by either side; the reason is a {@link ChannelClosed}. */
  get signal(): AbortSignal { return this.#closer.signal }

  /** Handshake hash of this connection. */
  get hash(): Uint8Array { return this.#session!.hash }

  /** Next frame in arrival order; rejects with the close reason once the channel closed and every earlier frame was read. One reader at a time. */
  async receive(): Promise<Frame> {
    while (this.#frames.length === 0) {
      this.signal.throwIfAborted()
      await this.#wait()
    }
    return this.#frames.shift()!
  }

  /** Send one frame. After close this is a no-op: results that arrive late belong to a closed connection and are dropped. */
  send(header: Header, body: Uint8Array = EMPTY): void {
    if (this.signal.aborted) return
    const head = utf8(JSON.stringify(header))
    const frame = concat(new Uint8Array(4), head, body)
    new DataView(frame.buffer).setUint32(0, head.byteLength)
    if (frame.byteLength > MAX_FRAME) throw new RangeError(`frame of ${frame.byteLength} bytes exceeds ${MAX_FRAME}`)
    for (let offset = 0; offset < frame.byteLength; offset += FRAGMENT) {
      const end = Math.min(offset + FRAGMENT, frame.byteLength)
      this.#socket.send(this.#session!.encrypt(concat(Uint8Array.of(end < frame.byteLength ? MORE : 0), frame.subarray(offset, end))))
    }
    if (this.#socket.bufferedAmount > MAX_BACKLOG) this.close(Close.overLimit, 'peer is not reading')
  }

  /** Resolve once the socket's send buffer is low; bulk senders await this between chunks. */
  async drained(): Promise<void> {
    while (this.#socket.bufferedAmount > LOW_WATER) {
      this.signal.throwIfAborted()
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    this.signal.throwIfAborted()
  }

  close(code: number = Close.normal, reason = ''): void {
    if (this.signal.aborted) return
    this.#socket.close(code, reason)
    this.#end(new ChannelClosed(code, reason))
  }

  async #handshake(signal: AbortSignal, run: () => Promise<Session>): Promise<Channel> {
    const onAbort = (): void => this.close(Close.timeout, 'handshake timed out')
    if (signal.aborted) onAbort()
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      this.#session = await run()
      for (const message of this.#early.splice(0)) this.#receive(message)
      return this
    } catch (error) {
      this.close(Close.protocolError, 'handshake failed')
      throw error
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  async #raw(): Promise<Uint8Array> {
    while (this.#early.length === 0) {
      this.signal.throwIfAborted()
      await this.#wait()
    }
    return this.#early.shift()!
  }

  #receive(message: Uint8Array): void {
    if (this.signal.aborted) return
    let plaintext: Uint8Array
    try {
      plaintext = this.#session!.decrypt(message)
    } catch {
      return this.close(Close.protocolError, 'decryption failed')
    }
    if (plaintext.byteLength === 0 || this.#fragmentBytes + plaintext.byteLength - 1 > MAX_FRAME) {
      return this.close(Close.protocolError, 'bad fragment')
    }
    this.#fragments.push(plaintext.subarray(1))
    this.#fragmentBytes += plaintext.byteLength - 1
    if (plaintext[0] === MORE) return
    const frame = concat(...this.#fragments.splice(0))
    this.#fragmentBytes = 0
    const parsed = decodeFrame(frame)
    if (parsed === undefined) return this.close(Close.protocolError, 'malformed frame')
    this.#frames.push(parsed)
  }

  #end(reason: ChannelClosed): void {
    if (this.signal.aborted) return
    this.#closer.abort(reason)
    this.#notify()
  }

  #wait(): Promise<void> {
    return new Promise(resolve => { this.#wake = resolve })
  }

  #notify(): void {
    const wake = this.#wake
    this.#wake = undefined
    wake?.()
  }
}

function decodeFrame(frame: Uint8Array): Frame | undefined {
  if (frame.byteLength < 4) return undefined
  const length = new DataView(frame.buffer, frame.byteOffset).getUint32(0)
  if (length > frame.byteLength - 4) return undefined
  try {
    const header: unknown = JSON.parse(fromUtf8(frame.subarray(4, 4 + length)))
    if (typeof header !== 'object' || header === null || Array.isArray(header) || typeof (header as Header).t !== 'string') return undefined
    return { header: header as Header, body: frame.subarray(4 + length) }
  } catch {
    return undefined
  }
}
