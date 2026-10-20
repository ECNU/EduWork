/**
 * The Host's side of the relay. It keeps one registered control socket and,
 * for every device the relay announces, opens a fresh socket and hands it on
 * for the end-to-end handshake. A refused registration or a replaced identity
 * stops it until the owner acts; anything else is retried with backoff.
 */
import type { SocketLike } from '../protocol/channel.ts'
import { Close } from '../protocol/close-codes.ts'
import { PROTOCOL } from '../protocol/constants.ts'
import { parseControl, RELAY_PATHS, signRegistration } from '../protocol/relay.ts'
import type { HostIdentity } from '../devices/store.ts'

export type LinkState =
  | { readonly state: 'connecting' }
  | { readonly state: 'online' }
  | { readonly state: 'offline'; readonly reason: string; readonly retryAt: number }
  /** The relay refused the access key, the signature or the protocol version. */
  | { readonly state: 'refused'; readonly reason: string }
  /** Another process registered with this Host identity. */
  | { readonly state: 'replaced' }
  | { readonly state: 'stopped' }

export interface RelayLinkOptions {
  /** The relay's public address, e.g. `https://remote.example.edu`. */
  readonly relay: string
  readonly accessKey: string
  readonly identity: HostIdentity
  /** A device is waiting on this socket; it is open and accepted at the relay. */
  accept(socket: SocketLike): void
  onState(state: LinkState): void
  readonly pingMs?: number
  readonly pongMs?: number
  readonly backoffMs?: readonly number[]
}

export class RelayLink {
  readonly #options: RelayLinkOptions & Required<Pick<RelayLinkOptions, 'pingMs' | 'pongMs' | 'backoffMs'>>
  readonly #origin: string
  #control: WebSocket | undefined
  /** The next ping or reconnect. */
  #timer: ReturnType<typeof setTimeout> | undefined
  #pongDeadline: ReturnType<typeof setTimeout> | undefined
  #failures = 0
  #stopped = true

  constructor(options: RelayLinkOptions) {
    this.#options = { pingMs: 25_000, pongMs: 10_000, backoffMs: [1000, 2000, 5000, 10_000, 30_000, 60_000], ...options }
    this.#origin = new URL(options.relay).origin
  }

  start(): void {
    this.#stopped = false
    this.#connect()
  }

  stop(): void {
    this.#stopped = true
    this.#drop()
    this.#options.onState({ state: 'stopped' })
  }

  #connect(): void {
    this.#options.onState({ state: 'connecting' })
    const control = new WebSocket(this.#url(RELAY_PATHS.host))
    this.#control = control
    control.addEventListener('message', ({ data }) => {
      const message = typeof data === 'string' ? parseControl(data) : undefined
      if (message?.t === 'challenge' && typeof message.nonce === 'string') {
        void signRegistration(this.#options.identity.signingKey, this.#origin, message.nonce).then(sig => control.send(JSON.stringify({
          t: 'register', protocol: PROTOCOL, hostId: this.#options.identity.hostId, accessKey: this.#options.accessKey, sig,
        })), () => this.#retry('could not sign the registration'))
      } else if (message?.t === 'registered') {
        this.#failures = 0
        this.#options.onState({ state: 'online' })
        this.#ping(control)
      } else if (message?.t === 'pong') {
        clearTimeout(this.#pongDeadline)
        this.#ping(control)
      } else if (message?.t === 'connect' && typeof message.id === 'string') {
        this.#open(message.id)
      } else {
        control.close(Close.protocolError, 'unexpected relay message')
      }
    })
    control.addEventListener('close', ({ code, reason }) => {
      if (this.#control !== control) return
      if (code === Close.unauthorized || code === Close.upgradeRequired) this.#halt({ state: 'refused', reason })
      else if (code === Close.replaced) this.#halt({ state: 'replaced' })
      else this.#retry(reason || `closed (${code})`)
    })
  }

  /** Ping the relay after a pause; a missing pong means the path is dead even if the socket has not noticed. */
  #ping(control: WebSocket): void {
    this.#timer = setTimeout(() => {
      control.send(JSON.stringify({ t: 'ping' }))
      this.#pongDeadline = setTimeout(() => this.#retry('relay stopped answering'), this.#options.pongMs)
    }, this.#options.pingMs)
  }

  #open(id: string): void {
    const socket = new WebSocket(this.#url(RELAY_PATHS.accept))
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ t: 'accept', id }))
      this.#options.accept(socket)
    }, { once: true })
  }

  #retry(reason: string): void {
    this.#drop()
    if (this.#stopped) return
    const delays = this.#options.backoffMs
    const delay = delays[Math.min(this.#failures++, delays.length - 1)]!
    this.#options.onState({ state: 'offline', reason, retryAt: Date.now() + delay })
    this.#timer = setTimeout(() => this.#connect(), delay)
  }

  #halt(state: LinkState): void {
    this.#drop()
    this.#stopped = true
    this.#options.onState(state)
  }

  /** Abandon the current control socket; its later events are ignored. */
  #drop(): void {
    clearTimeout(this.#timer)
    clearTimeout(this.#pongDeadline)
    const control = this.#control
    this.#control = undefined
    control?.close()
  }

  #url(path: string): string {
    const url = new URL(path, this.#origin)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return url.href
  }
}
