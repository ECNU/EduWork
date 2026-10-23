// In-memory WebSocket pair for protocol tests: asynchronous delivery, a real
// bufferedAmount, and switches to stall delivery or tamper with messages.
import { after } from 'node:test'
import { Channel, type SocketLike } from '../src/protocol/channel.ts'
import { generateKeyPair, prologue } from '../src/protocol/noise.ts'

type MessageListener = (event: { data: unknown }) => void
type CloseListener = (event: { code: number; reason: string }) => void

export class TestSocket implements SocketLike {
  binaryType = 'blob'
  bufferedAmount = 0
  closed: { code: number; reason: string } | undefined
  /** While true, sent messages stay buffered instead of reaching the peer. */
  stalled = false
  /** Rewrite outgoing binary messages before delivery. */
  tamper: ((bytes: Uint8Array) => Uint8Array) | undefined
  peer!: TestSocket
  readonly #messages = new Set<MessageListener>()
  readonly #closes = new Set<CloseListener>()
  readonly #held: (() => void)[] = []

  send(data: Uint8Array | string): void {
    if (this.closed !== undefined) return
    // Copy: Buffer#slice is a view into a shared pool.
    const payload = typeof data === 'string' ? data : (this.tamper?.(new Uint8Array(data)) ?? new Uint8Array(data)).buffer
    const size = typeof data === 'string' ? data.length : data.byteLength
    this.bufferedAmount += size
    const deliver = (): void => {
      this.bufferedAmount -= size
      if (this.peer.closed === undefined) for (const listener of this.peer.#messages) listener({ data: payload })
    }
    if (this.stalled) this.#held.push(deliver)
    else setImmediate(deliver)
  }

  resume(): void {
    this.stalled = false
    for (const deliver of this.#held.splice(0)) setImmediate(deliver)
  }

  close(code = 1000, reason = ''): void {
    if (this.closed !== undefined) return
    this.closed = { code, reason }
    setImmediate(() => {
      for (const listener of this.#closes) listener({ code, reason })
      this.peer.close(code, reason)
    })
  }

  addEventListener(type: 'message' | 'close', listener: MessageListener | CloseListener): void {
    if (type === 'message') this.#messages.add(listener as MessageListener)
    else this.#closes.add(listener as CloseListener)
  }

  removeEventListener(type: 'message' | 'close', listener: MessageListener | CloseListener): void {
    if (type === 'message') this.#messages.delete(listener as MessageListener)
    else this.#closes.delete(listener as CloseListener)
  }
}

export function socketPair(): [TestSocket, TestSocket] {
  const a = new TestSocket(), b = new TestSocket()
  a.peer = b
  b.peer = a
  return [a, b]
}

export const hostKeys = generateKeyPair()
export const hostPrologue = prologue('relay', 'host-id')

const open = new Set<Channel>()
// Close what a test file left open so Host-side timers do not hold the process.
after(() => { for (const channel of open) channel.close() })

/** Two ends of a completed handshake over a fresh socket pair. */
export async function channelPair(): Promise<{ device: Channel; host: Channel; sockets: [TestSocket, TestSocket] }> {
  const sockets = socketPair()
  const [device, host] = await Promise.all([
    Channel.connect(sockets[0], hostKeys.publicKey, hostPrologue, AbortSignal.timeout(2000)),
    Channel.accept(sockets[1], hostKeys, hostPrologue, AbortSignal.timeout(2000)),
  ])
  open.add(device)
  return { device, host, sockets }
}
