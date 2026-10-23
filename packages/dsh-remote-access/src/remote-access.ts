/**
 * Remote access for one Host, independent of DSH itself: the relay link brings
 * in device sockets; each is handshaken, admitted by pairing and then served
 * by the connection manager through the Host adapter.
 */
import { compressPages } from './connections/compression.ts'
import { Connections } from './connections/connections.ts'
import { Pairing, type PairingOptions, type PendingDevice } from './devices/pairing.ts'
import type { Device, HostStore } from './devices/store.ts'
import type { HostAdapter } from './host/adapter.ts'
import { formatPairingLink } from './protocol/auth.ts'
import { Channel, type SocketLike } from './protocol/channel.ts'
import { Close } from './protocol/close-codes.ts'
import { prologue } from './protocol/noise.ts'
import { relayBase } from './protocol/relay.ts'
import { RelayLink, type Admission, type LinkState } from './relay-link/link.ts'

export interface RemoteAccessOptions {
  readonly adapter: HostAdapter
  readonly store: HostStore
  /** The relay's public address, e.g. `https://remote.example.edu` or `https://example.edu/eduwork-remote/`. */
  readonly relay: string
  /** What admits this Host to the relay, asked before every registration; undefined when only the owner can renew it. */
  credential(): Promise<Admission | undefined>
  /** Shown to devices while pairing and once connected. */
  readonly hostName: string
  readonly warn: (message: string) => void
  /** The link, the invite, the pending list, the devices or their connections changed. */
  readonly onChange?: () => void
  readonly pairing?: PairingOptions
}

export interface RemoteAccessStatus {
  readonly hostId: string
  readonly link: LinkState
  /** The open invite; only the local panel can read this. */
  readonly invite?: { readonly link: string; readonly expiresAt: number }
  readonly pending: readonly PendingDevice[]
  readonly devices: readonly (Device & { readonly connections: number })[]
}

const HANDSHAKE_MS = 10_000

export class RemoteAccess {
  readonly #options: RemoteAccessOptions
  readonly #relay: string
  readonly #pairing: Pairing
  readonly #connections: Connections
  readonly #link: RelayLink
  /** Every channel past the handshake, admitted or not; stopping closes them all. */
  readonly #channels = new Set<Channel>()
  #stopped = false
  #state: LinkState = { state: 'stopped' }
  #inviteLink: string | undefined

  constructor(options: RemoteAccessOptions) {
    this.#options = options
    const relay = relayBase(options.relay)
    if (relay === undefined) throw new Error(`not a relay address: ${options.relay}`)
    this.#relay = relay
    this.#pairing = new Pairing(options.store, () => this.#changed(), options.pairing)
    this.#connections = new Connections(compressPages(options.adapter), options.warn)
    this.#link = new RelayLink({
      relay,
      credential: () => options.credential(),
      identity: options.store.identity,
      accept: socket => void this.#serve(socket).catch(error => options.warn(String(error))),
      onState: state => {
        // The settings page says what to do; why stays in the log.
        if (state.state === 'offline' || state.state === 'refused') options.warn(`relay ${state.state}: ${state.reason}`)
        this.#state = state
        this.#changed()
      },
    })
  }

  start(): void {
    this.#link.start()
  }

  /** Final: the link goes down and every device is disconnected, including those still pairing. */
  stop(): void {
    this.#stopped = true
    this.#link.stop()
    for (const channel of this.#channels) channel.close(Close.normal, 'remote access stopped')
  }

  status(): RemoteAccessStatus {
    const expiresAt = this.#pairing.inviteExpiresAt
    return {
      hostId: this.#options.store.identity.hostId,
      link: this.#state,
      ...expiresAt !== undefined && this.#inviteLink !== undefined && { invite: { link: this.#inviteLink, expiresAt } },
      pending: this.#pairing.pending,
      devices: this.#options.store.devices.map(device => ({ ...device, connections: this.#connections.count(device.key) })),
    }
  }

  /** A new single-use pairing link; any earlier one stops working. */
  createInvite(): string {
    const { identity } = this.#options.store
    const { secret } = this.#pairing.invite()
    this.#inviteLink = formatPairingLink(this.#relay, { hostId: identity.hostId, hostKey: identity.noise.publicKey, invite: secret })
    this.#changed()
    return this.#inviteLink
  }

  cancelInvite(): void {
    this.#inviteLink = undefined
    this.#pairing.cancelInvite()
  }

  /** The owner's answer for a device waiting to pair; false when it is no longer waiting. */
  decide(key: string, approved: boolean): boolean {
    return this.#pairing.decide(key, approved)
  }

  /** Forget the device and end its connections at once. */
  async revoke(key: string): Promise<void> {
    await this.#options.store.remove(key)
    this.#connections.revoke(key)
    this.#changed()
  }

  async #serve(socket: SocketLike): Promise<void> {
    const { identity } = this.#options.store
    let channel: Channel
    try {
      channel = await Channel.accept(socket, identity.noise, prologue('relay', identity.hostId), AbortSignal.timeout(HANDSHAKE_MS))
    } catch {
      return
    }
    if (this.#stopped) return channel.close(Close.normal, 'remote access stopped')
    this.#channels.add(channel)
    channel.signal.addEventListener('abort', () => this.#channels.delete(channel), { once: true })
    try {
      const device = await this.#pairing.admit(channel, this.#options.hostName)
      if (device === undefined) return
      this.#options.store.seen(device.key, new Date().toISOString()).catch(error => this.#options.warn(String(error)))
      const served = this.#connections.serve(channel, device.key)
      this.#changed()
      await served
      this.#changed()
    } catch (error) {
      channel.close(Close.unavailable, 'host error')
      throw error
    }
  }

  #changed(): void {
    this.#options.onChange?.()
  }
}
