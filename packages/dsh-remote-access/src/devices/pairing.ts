/**
 * Admission of one encrypted channel. A known device is let in at once. A new
 * device must present the current invite and then wait for the Host owner,
 * who confirms it by the pairing code both screens show. Nothing but `ready`
 * lets a device send exchanges.
 */
import { newInvite, pairingCode, verifyAuth, type AuthFrame, type AuthReply } from '../protocol/auth.ts'
import { equalBytes, utf8 } from '../protocol/bytes.ts'
import type { Channel } from '../protocol/channel.ts'
import { Close } from '../protocol/close-codes.ts'
import type { Device, HostStore } from './store.ts'

export interface PairingOptions {
  readonly inviteMs?: number
  /** How long the device may take to authenticate after the handshake. */
  readonly authMs?: number
  /** How long the owner has to confirm a new device. */
  readonly approvalMs?: number
}

export interface PendingDevice { readonly key: string; readonly name: string; readonly code: string; readonly since: string }

type Rejection = Extract<AuthReply, { t: 'rejected' }>['reason']

export class Pairing {
  readonly #store: HostStore
  readonly #onChange: () => void
  readonly #options: Required<PairingOptions>
  readonly #pending = new Map<string, PendingDevice & { decide(approved: boolean): void }>()
  #invite: { readonly secret: string; readonly expiresAt: number } | undefined

  /** @param onChange - the invite or the pending list changed; the panel refreshes. */
  constructor(store: HostStore, onChange: () => void, options: PairingOptions = {}) {
    this.#store = store
    this.#onChange = onChange
    this.#options = { inviteMs: 10 * 60_000, authMs: 10_000, approvalMs: 5 * 60_000, ...options }
  }

  /** Open a single-use invite, replacing any earlier one. */
  invite(): { readonly secret: string; readonly expiresAt: number } {
    this.#invite = { secret: newInvite(), expiresAt: Date.now() + this.#options.inviteMs }
    this.#onChange()
    return this.#invite
  }

  cancelInvite(): void {
    this.#invite = undefined
    this.#onChange()
  }

  /** The open invite's expiry, if one is still usable. */
  get inviteExpiresAt(): number | undefined {
    return this.#invite !== undefined && this.#invite.expiresAt > Date.now() ? this.#invite.expiresAt : undefined
  }

  get pending(): PendingDevice[] {
    return [...this.#pending.values()].map(({ key, name, code, since }) => ({ key, name, code, since }))
  }

  /** The owner's answer for a waiting device; false when it is no longer waiting. */
  decide(key: string, approved: boolean): boolean {
    const pending = this.#pending.get(key)
    pending?.decide(approved)
    return pending !== undefined
  }

  /** The admitted device once `ready` was sent; undefined once the channel was refused and closed. */
  async admit(channel: Channel, hostName: string): Promise<Device | undefined> {
    const deadline = setTimeout(() => channel.close(Close.timeout, 'no device authentication'), this.#options.authMs)
    let auth: AuthFrame | undefined
    try {
      auth = await verifyAuth((await channel.receive()).header, channel.hash)
    } catch {
      return undefined
    } finally {
      clearTimeout(deadline)
    }
    if (auth === undefined) {
      channel.close(Close.protocolError, 'invalid device authentication')
      return undefined
    }
    const known = this.#store.device(auth.key)
    if (known !== undefined) {
      channel.send({ t: 'ready', host: hostName })
      return known
    }
    if (auth.invite === undefined) return refuse(channel, 'unknown-device')
    if (!this.#redeem(auth.invite)) return refuse(channel, 'invalid-invite')
    const name = auth.name ?? ''
    channel.send({ t: 'pending', host: hostName })
    const answer = await this.#ask(channel, auth.key, name, await pairingCode(channel.hash))
    if (answer !== 'approved') return answer === 'closed' ? undefined : refuse(channel, answer)
    const device = { key: auth.key, name, pairedAt: new Date().toISOString() }
    await this.#store.add(device)
    channel.send({ t: 'ready', host: hostName })
    return device
  }

  #redeem(secret: string): boolean {
    const invite = this.#invite
    if (invite === undefined || invite.expiresAt <= Date.now() || !equalBytes(utf8(secret), utf8(invite.secret))) return false
    this.#invite = undefined
    this.#onChange()
    return true
  }

  #ask(channel: Channel, key: string, name: string, code: string): Promise<'approved' | 'declined' | 'timeout' | 'closed'> {
    return new Promise(resolve => {
      const finish = (answer: 'approved' | 'declined' | 'timeout' | 'closed'): void => {
        clearTimeout(timer)
        channel.signal.removeEventListener('abort', closed)
        this.#pending.delete(key)
        this.#onChange()
        resolve(answer)
      }
      const timer = setTimeout(() => finish('timeout'), this.#options.approvalMs)
      const closed = (): void => finish('closed')
      channel.signal.addEventListener('abort', closed, { once: true })
      this.#pending.get(key)?.decide(false)
      this.#pending.set(key, { key, name, code, since: new Date().toISOString(), decide: approved => finish(approved ? 'approved' : 'declined') })
      this.#onChange()
    })
  }
}

function refuse(channel: Channel, reason: Rejection): undefined {
  channel.send({ t: 'rejected', reason })
  channel.close(Close.forbidden, reason)
  return undefined
}
