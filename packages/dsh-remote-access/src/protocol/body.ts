/**
 * Credit-based flow control for request and response bodies. Each body starts
 * with {@link WINDOW} bytes of credit; the receiver grants more as its reader
 * consumes, so a slow reader bounds the sender's memory and one large download
 * cannot starve the other exchanges on the same channel.
 */
import type { Channel } from './channel.ts'

export const WINDOW = 1024 * 1024
/** Body bytes per frame, leaving room for the frame header inside one Noise message. */
export const CHUNK = 64_000
const GRANT_THRESHOLD = WINDOW / 4

/** Sender side: bytes the peer currently allows. */
export class Credit {
  #available = WINDOW
  #wake: (() => void) | undefined

  grant(bytes: number): void {
    this.#available += bytes
    this.#wake?.()
  }

  /** Wait for credit and take up to `max` bytes of it. */
  async take(max: number, signal: AbortSignal): Promise<number> {
    while (this.#available === 0) {
      signal.throwIfAborted()
      await new Promise<void>(resolve => {
        const done = (): void => {
          signal.removeEventListener('abort', done)
          this.#wake = undefined
          resolve()
        }
        this.#wake = done
        signal.addEventListener('abort', done, { once: true })
      })
    }
    const bytes = Math.min(max, this.#available)
    this.#available -= bytes
    return bytes
  }
}

/** Stream `source` as `type` frames for exchange `id`, honouring credit and the socket's send buffer. */
export async function sendBody(
  channel: Channel,
  id: number,
  type: string,
  source: Uint8Array | ReadableStream<Uint8Array>,
  credit: Credit,
  signal: AbortSignal,
): Promise<void> {
  const send = async (bytes: Uint8Array): Promise<void> => {
    for (let offset = 0; offset < bytes.byteLength;) {
      const length = await credit.take(Math.min(CHUNK, bytes.byteLength - offset), signal)
      await channel.drained()
      signal.throwIfAborted()
      channel.send({ t: type, id }, bytes.subarray(offset, offset + length))
      offset += length
    }
  }
  if (source instanceof Uint8Array) return send(source)
  const reader = source.getReader()
  const cancel = (): void => void reader.cancel(signal.reason).catch(() => {})
  signal.addEventListener('abort', cancel, { once: true })
  try {
    for (let next = await reader.read(); !next.done; next = await reader.read()) await send(next.value)
    signal.throwIfAborted()
  } catch (error) {
    void reader.cancel(error).catch(() => {})
    throw error
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}

/** Receiver side: a ReadableStream fed by body frames that grants credit as its reader consumes. */
export class IncomingBody {
  readonly readable: ReadableStream<Uint8Array>
  #controller!: ReadableStreamDefaultController<Uint8Array>
  /** Bytes the sender may still send without further credit. */
  #outstanding = WINDOW
  #done = false

  /**
   * @param grant - send a credit frame for this body.
   * @param cancel - the reader gave up; tell the sender to stop.
   */
  constructor(grant: (bytes: number) => void, cancel?: (reason: unknown) => void) {
    this.readable = new ReadableStream<Uint8Array>({
      start: controller => { this.#controller = controller },
      pull: () => {
        const room = this.#controller.desiredSize! - this.#outstanding
        if (room < GRANT_THRESHOLD) return
        this.#outstanding += room
        grant(room)
      },
      cancel: reason => {
        this.#done = true
        cancel?.(reason)
      },
    }, new ByteLengthQueuingStrategy({ highWaterMark: WINDOW }))
  }

  /** Queue one chunk; false when it exceeds the credit the sender was given. */
  push(chunk: Uint8Array): boolean {
    if (chunk.byteLength > this.#outstanding) return false
    this.#outstanding -= chunk.byteLength
    if (!this.#done) this.#controller.enqueue(chunk)
    return true
  }

  close(): void {
    if (this.#done) return
    this.#done = true
    this.#controller.close()
  }

  error(reason: unknown): void {
    if (this.#done) return
    this.#done = true
    this.#controller.error(reason)
  }
}
