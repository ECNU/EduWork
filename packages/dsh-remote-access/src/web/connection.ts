/**
 * This browser's side of a connection: a relay socket, the handshake against
 * the Host key from the pairing link, and authentication with the device key.
 * `pair` runs it once with an invite; `HostLink` keeps a paired Host connected
 * and reconnects after losses.
 */
import { deviceAuth, generateDeviceKey, pairingCode, type AuthReply, type PairingLink } from '../protocol/auth.ts'
import { Channel, ChannelClosed } from '../protocol/channel.ts'
import { Close } from '../protocol/close-codes.ts'
import { prologue } from '../protocol/noise.ts'
import { RELAY_PATHS } from '../protocol/relay.ts'
import { TunnelClient } from '../protocol/tunnel.ts'
import type { PairedHost } from './hosts.ts'

const HANDSHAKE_MS = 15_000
const PING_MS = 20_000
const PONG_MS = 10_000
const BACKOFF_MS = [1000, 2000, 5000, 10_000, 30_000]

type Rejection = Extract<AuthReply, { t: 'rejected' }>['reason']

/** The Host turned this device away; only pairing again helps. */
export class Refused extends Error {
  readonly reason: Rejection | 'revoked'
  constructor(reason: Rejection | 'revoked') {
    super(reason)
    this.reason = reason
  }
}

/** Reach the Host through the relay, shake hands and authenticate; resolves with the Host's first answer. */
async function open(host: { hostId: string; hostKey: Uint8Array }, device: CryptoKeyPair, pairing?: { invite: string; name: string }) {
  const url = new URL(RELAY_PATHS.connect + host.hostId, document.baseURI)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const socket = new WebSocket(url)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => socket.close(), HANDSHAKE_MS)
    socket.addEventListener('message', ({ data }) => {
      clearTimeout(timer)
      if (data === '{"t":"open"}') resolve()
      else socket.close(Close.protocolError, 'unexpected relay message')
    }, { once: true })
    socket.addEventListener('close', ({ code, reason }) => {
      clearTimeout(timer)
      reject(new ChannelClosed(code, reason))
    }, { once: true })
  })
  const channel = await Channel.connect(socket, host.hostKey, prologue('relay', host.hostId), AbortSignal.timeout(HANDSHAKE_MS))
  channel.send(await deviceAuth(device, channel.hash, pairing))
  return { channel, code: await pairingCode(channel.hash), reply: (await channel.receive()).header as AuthReply }
}

/**
 * Pair with the Host behind an invite link. `onCode` shows the pairing code
 * while the owner confirms it on the Host; rejects with {@link Refused}.
 */
export async function pair(link: PairingLink, name: string, onCode: (code: string) => void): Promise<PairedHost> {
  const device = await generateDeviceKey()
  const { channel, code, reply } = await open(link, device, { invite: link.invite, name })
  try {
    let answer = reply
    if (answer.t === 'pending') {
      onCode(code)
      answer = (await channel.receive()).header as AuthReply
    }
    if (answer.t === 'rejected') throw new Refused(answer.reason)
    if (answer.t !== 'ready') throw new Error(`unexpected answer ${answer.t}`)
    return { hostId: link.hostId, hostKey: link.hostKey, name: answer.host, device, pairedAt: new Date().toISOString() }
  } finally {
    channel.close()
  }
}

export type HostLinkState =
  | { readonly state: 'connecting' }
  | { readonly state: 'connected'; readonly host: string }
  /** The Host is offline or the path was lost; retrying at `retryAt`. */
  | { readonly state: 'waiting'; readonly offline: boolean; readonly retryAt: number }
  /** Final: this device is no longer paired. */
  | { readonly state: 'unpaired'; readonly reason: Rejection | 'revoked' }

/** Keeps one paired Host connected for the page's lifetime. */
export class HostLink {
  readonly #host: PairedHost
  readonly #onState: (state: HostLinkState) => void
  #tunnel: TunnelClient | undefined
  #channel: Channel | undefined
  /** Ends the current wait before the next attempt. */
  #wake: (() => void) | undefined

  constructor(host: PairedHost, onState: (state: HostLinkState) => void) {
    this.#host = host
    this.#onState = onState
  }

  /** The tunnel while connected. */
  get tunnel(): TunnelClient | undefined { return this.#tunnel }

  start(): void {
    void this.#run()
  }

  /** Check the connection now, e.g. when the page comes back to the foreground. */
  check(): void {
    if (this.#wake !== undefined) return this.#wake()
    const tunnel = this.#tunnel, channel = this.#channel
    if (tunnel !== undefined && channel !== undefined) void this.#probe(tunnel, channel)
  }

  async #run(): Promise<void> {
    for (let failures = 0; ; failures++) {
      this.#onState({ state: 'connecting' })
      let offline = false
      try {
        const { channel, reply } = await open(this.#host, this.#host.device)
        if (reply.t === 'rejected') throw new Refused(reply.reason)
        if (reply.t !== 'ready') {
          channel.close(Close.protocolError, `unexpected answer ${reply.t}`)
          throw new Error(`unexpected answer ${reply.t}`)
        }
        failures = 0
        await this.#serve(channel, reply.host)
      } catch (error) {
        if (error instanceof Refused) return this.#onState({ state: 'unpaired', reason: error.reason })
        offline = error instanceof ChannelClosed && error.code === Close.hostOffline
      }
      const delay = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)]!
      this.#onState({ state: 'waiting', offline, retryAt: Date.now() + delay })
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, delay)
        this.#wake = () => {
          clearTimeout(timer)
          resolve()
        }
      })
      this.#wake = undefined
    }
  }

  /** Use the channel until it closes; revocation ends the link for good. */
  async #serve(channel: Channel, host: string): Promise<void> {
    let revoked = false
    const tunnel = new TunnelClient(channel, header => {
      if (header.t !== 'revoked') return channel.close(Close.protocolError, `unexpected frame ${header.t}`)
      revoked = true
    })
    this.#tunnel = tunnel
    this.#channel = channel
    this.#onState({ state: 'connected', host })
    const timer = setInterval(() => void this.#probe(tunnel, channel), PING_MS)
    await new Promise(resolve => channel.signal.addEventListener('abort', resolve, { once: true }))
    clearInterval(timer)
    this.#tunnel = undefined
    this.#channel = undefined
    if (revoked) throw new Refused('revoked')
  }

  /** Pages cannot see WebSocket pings, so ask the Host; silence means the path is dead. */
  async #probe(tunnel: TunnelClient, channel: Channel): Promise<void> {
    const timer = setTimeout(() => channel.close(Close.timeout, 'the Host stopped answering'), PONG_MS)
    await tunnel.ping().catch(() => {})
    clearTimeout(timer)
  }
}
