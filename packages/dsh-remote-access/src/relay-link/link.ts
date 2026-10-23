/**
 * The Host's side of the relay. It keeps one registered control socket and,
 * for every device the relay announces, opens a fresh socket and hands it on
 * for the end-to-end handshake. A refused registration, a replaced identity or
 * a credential only the owner can renew stops it until the owner acts;
 * anything else is retried with backoff. A credential that expires is replaced
 * by registering again shortly before, on a new control socket; devices
 * already connected are not affected. A renewal that fails keeps the
 * registration in place, which the relay ends when its credential expires,
 * and is tried again with backoff; one that brings no later expiry is not
 * tried again.
 */
import type { SocketLike } from '../protocol/channel.ts'
import { Close } from '../protocol/close-codes.ts'
import { PROTOCOL } from '../protocol/constants.ts'
import { parseControl, RELAY_PATHS, signRegistration, type RelayCredential } from '../protocol/relay.ts'
import type { HostIdentity } from '../devices/store.ts'

export type LinkState =
  | { readonly state: 'connecting' }
  | { readonly state: 'online' }
  | { readonly state: 'offline'; readonly reason: string; readonly retryAt: number }
  /** The relay refused the credential or the signature (`Close.unauthorized`), or the protocol version (`Close.upgradeRequired`). */
  | { readonly state: 'refused'; readonly code: number; readonly reason: string }
  /** Another process registered with this Host identity. */
  | { readonly state: 'replaced' }
  /** There is no credential until the owner acts, e.g. signs in again. */
  | { readonly state: 'lapsed' }
  | { readonly state: 'stopped' }

/** A credential for one registration and, for one that expires, when (Unix seconds). */
export interface Admission { readonly credential: RelayCredential; readonly expiresAt?: number }

export interface RelayLinkOptions {
  /** The relay's base URL, as `relayBase` gives it. */
  readonly relay: string
  /** Asked before every registration; undefined when only the owner can get a new one, e.g. by signing in again. */
  credential(): Promise<Admission | undefined>
  readonly identity: HostIdentity
  /** A device is waiting on this socket; it is open and accepted at the relay. */
  accept(socket: SocketLike): void
  onState(state: LinkState): void
  readonly pingMs?: number
  readonly pongMs?: number
  readonly backoffMs?: readonly number[]
  /** Register again this long before the credential expires, but no sooner than `renewAfterMs` after registering. */
  readonly renewBeforeMs?: number
  readonly renewAfterMs?: number
}

export class RelayLink {
  readonly #options: RelayLinkOptions & Required<Pick<RelayLinkOptions, 'pingMs' | 'pongMs' | 'backoffMs' | 'renewBeforeMs' | 'renewAfterMs'>>
  #control: WebSocket | undefined
  /** The registration being renewed, kept until the new one is in place. */
  #retiring: WebSocket | undefined
  /** The next ping or reconnect. */
  #timer: ReturnType<typeof setTimeout> | undefined
  #pongDeadline: ReturnType<typeof setTimeout> | undefined
  #renewal: ReturnType<typeof setTimeout> | undefined
  /** When the credential of the current registration expires, if it does (Unix seconds). */
  #expiresAt: number | undefined
  #failures = 0
  #stopped = true

  constructor(options: RelayLinkOptions) {
    this.#options = {
      pingMs: 25_000, pongMs: 10_000, backoffMs: [1000, 2000, 5000, 10_000, 30_000, 60_000], renewBeforeMs: 5 * 60_000, renewAfterMs: 30_000, ...options,
    }
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
    if (this.#retiring === undefined) this.#options.onState({ state: 'connecting' })
    const control = new WebSocket(this.#url(RELAY_PATHS.host))
    this.#control = control
    let expiresAt: number | undefined
    control.addEventListener('message', ({ data }) => {
      const message = typeof data === 'string' ? parseControl(data) : undefined
      // The registration being replaced still passes on devices until the relay closes it.
      if (message?.t === 'connect' && typeof message.id === 'string') return this.#open(message.id)
      if (this.#control !== control) return
      if (message?.t === 'challenge' && typeof message.nonce === 'string') {
        void Promise.all([this.#options.credential(), signRegistration(this.#options.identity.signingKey, this.#options.relay, message.nonce)]).then(([admission, sig]) => {
          if (this.#control !== control) return
          if (admission === undefined) return this.#halt({ state: 'lapsed' })
          expiresAt = admission.expiresAt
          control.send(JSON.stringify({ t: 'register', protocol: PROTOCOL, hostId: this.#options.identity.hostId, sig, ...admission.credential }))
        }, (error: Error) => this.#control === control && this.#failed(`no credential: ${error.message}`))
      } else if (message?.t === 'registered') {
        this.#failures = 0
        this.#retiring?.close()
        this.#retiring = undefined
        this.#options.onState({ state: 'online' })
        this.#ping(control)
        // Without a later expiry there is nothing to renew to; the relay ends the registration when it lapses.
        if (expiresAt !== undefined && expiresAt > (this.#expiresAt ?? 0)) {
          const { renewBeforeMs, renewAfterMs } = this.#options
          this.#renewal = setTimeout(() => this.#renew(), Math.max(expiresAt * 1000 - Date.now() - renewBeforeMs, renewAfterMs))
        }
        this.#expiresAt = expiresAt
      } else if (message?.t === 'pong') {
        clearTimeout(this.#pongDeadline)
        this.#ping(control)
      } else {
        control.close(Close.protocolError, 'unexpected relay message')
      }
    })
    control.addEventListener('close', ({ code, reason }) => {
      if (this.#control !== control) return
      if (code === Close.unauthorized || code === Close.upgradeRequired) this.#halt({ state: 'refused', code, reason })
      else if (code === Close.replaced) this.#halt({ state: 'replaced' })
      else this.#failed(reason || `closed (${code})`)
    })
  }

  /** Ping the relay after a pause; a missing pong means the path is dead even if the socket has not noticed. */
  #ping(control: WebSocket): void {
    this.#timer = setTimeout(() => {
      control.send(JSON.stringify({ t: 'ping' }))
      this.#pongDeadline = setTimeout(() => this.#retry('relay stopped answering'), this.#options.pongMs)
    }, this.#options.pingMs)
  }

  /** Register again on a new control socket; the relay closes the current one once the new one is in place. */
  #renew(): void {
    clearTimeout(this.#timer)
    clearTimeout(this.#pongDeadline)
    this.#retiring = this.#control
    this.#connect()
  }

  /** The control socket failed before or after registering; a renewal falls back on the registration it was to replace. */
  #failed(reason: string): void {
    const retiring = this.#retiring
    if (retiring === undefined || retiring.readyState !== WebSocket.OPEN) return this.#retry(reason)
    const control = this.#control
    this.#control = retiring
    this.#retiring = undefined
    control?.close()
    this.#ping(retiring)
    const delays = this.#options.backoffMs
    this.#renewal = setTimeout(() => this.#renew(), delays[Math.min(this.#failures++, delays.length - 1)]!)
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

  /** Abandon the control socket, and one being renewed; their later events are ignored. */
  #drop(): void {
    clearTimeout(this.#timer)
    clearTimeout(this.#pongDeadline)
    clearTimeout(this.#renewal)
    const control = this.#control, retiring = this.#retiring
    this.#control = undefined
    this.#retiring = undefined
    this.#expiresAt = undefined
    control?.close()
    retiring?.close()
  }

  #url(path: string): string {
    const url = new URL(path, this.#options.relay)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return url.href
  }
}
