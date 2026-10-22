/**
 * Relay server. It verifies Host registrations, pairs every device socket with
 * a fresh Host socket, and forwards the pair's binary messages without being
 * able to decrypt them. Pairs are independent sockets, so TCP backpressure
 * works end to end and one slow device never delays another.
 *
 * A Host is admitted by an access key the operator issued, or by an ID Token
 * of an organization the operator admits. What an ID Token admits, the
 * registration and the connections paired under it, lasts until the token
 * expires, unless the Host registers again with a newer one; a Host that only
 * lost its control socket keeps its connections. Limits keep one address from
 * guessing credentials, one member from holding many registrations and one
 * Host from being flooded with connections.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import { base64url } from '../protocol/bytes.ts'
import { Close } from '../protocol/close-codes.ts'
import { MAX_MESSAGE, PROTOCOL } from '../protocol/constants.ts'
import { parseControl, RELAY_PATHS, verifyRegistration, type ControlMessage } from '../protocol/relay.ts'
import { IssuerUnavailable, type IdTokens } from './id-token.ts'
import { RateLimit } from './limits.ts'

export interface RelayOptions {
  /** Base URL Hosts and devices reach, as `relayBase` gives it, e.g. `https://example.edu/eduwork-remote/`; bound into every registration. */
  readonly url: string
  /** Credentials the operator issued to Host owners. */
  readonly accessKeys?: readonly string[]
  /** Admits the members of an organization by the ID Tokens its sign-in issues. */
  readonly idTokens?: Pick<IdTokens, 'verify'>
  /** Hosts one member may have registered at once. */
  readonly maxHostsPerMember?: number
  /** Refused registrations from one address per minute; past that it is refused without a check. */
  readonly refusalsPerMinute?: number
  /** Device connections one Host is asked to accept per minute. */
  readonly connectsPerMinute?: number
  /** The client's address; behind a reverse proxy, the header it sets. */
  readonly address?: (request: IncomingMessage) => string
  /** Deadline for registering, accepting and the Host answering a device. */
  readonly timeoutMs?: number
  /** Ping interval; a socket that missed the previous ping is dropped. */
  readonly heartbeatMs?: number
  /** Device connections per Host, waiting or paired. */
  readonly maxConnectionsPerHost?: number
}

/** The member a credential admits (none for an access key) and, for an ID Token, until when in Unix seconds. */
interface Admission { readonly member?: string; readonly expiresAt?: number }

/** A paired destination holding more than this unsent stops the relay reading from its source. */
const HIGH_WATER = 1024 * 1024

/** A registered Host: its control socket and, if admitted by ID Token, the member. */
interface Registration { readonly ws: WebSocket; readonly member?: string }

export class Relay {
  readonly #options: Required<Omit<RelayOptions, 'idTokens'>> & Pick<RelayOptions, 'idTokens'>
  readonly #keys: Buffer[]
  readonly #server = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE })
  readonly #hosts = new Map<string, Registration>()
  /** Registered Host ids by member. */
  readonly #members = new Map<string, Set<string>>()
  readonly #refusals: RateLimit
  readonly #connects: RateLimit
  readonly #connections = new Map<string, number>()
  /** Both ends of every paired connection, by Host. */
  readonly #pairs = new Map<string, Set<WebSocket>>()
  /** When the credential of each Host admitted by ID Token runs out. */
  readonly #deadlines = new Map<string, NodeJS.Timeout>()
  readonly #waiting = new Map<string, { device: WebSocket; hostId: string; timer: NodeJS.Timeout }>()
  readonly #alive = new WeakSet<WebSocket>()
  readonly #heartbeat: NodeJS.Timeout
  /** The path below which the relay's endpoints are, ending in `/`. */
  readonly #path: string

  constructor(options: RelayOptions) {
    this.#options = {
      accessKeys: [], timeoutMs: 10_000, heartbeatMs: 25_000, maxConnectionsPerHost: 16, maxHostsPerMember: 5,
      refusalsPerMinute: 10, connectsPerMinute: 60, address: request => request.socket.remoteAddress ?? '', ...options,
    }
    this.#keys = this.#options.accessKeys.map(digest)
    this.#path = new URL(options.url).pathname
    this.#refusals = new RateLimit(this.#options.refusalsPerMinute)
    this.#connects = new RateLimit(this.#options.connectsPerMinute)
    this.#heartbeat = setInterval(() => {
      this.#refusals.prune()
      this.#connects.prune()
      for (const socket of this.#server.clients) {
        // A paused socket is waiting for its peer to drain; its peer's own pings decide.
        if (socket.isPaused) continue
        if (!this.#alive.has(socket)) {
          socket.terminate()
          continue
        }
        this.#alive.delete(socket)
        socket.ping()
      }
    }, this.#options.heartbeatMs)
  }

  /** Take over an HTTP upgrade; false when the path is not a relay endpoint. */
  upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const pathname = new URL(request.url ?? '/', 'http://relay').pathname
    if (!pathname.startsWith(this.#path)) return false
    const path = pathname.slice(this.#path.length)
    let route: ((ws: WebSocket) => void) | undefined
    if (path === RELAY_PATHS.host) route = ws => this.#host(ws, this.#options.address(request))
    else if (path === RELAY_PATHS.accept) route = ws => this.#accept(ws)
    else if (path.startsWith(RELAY_PATHS.connect)) route = ws => this.#device(ws, path.slice(RELAY_PATHS.connect.length))
    if (route === undefined) return false
    this.#server.handleUpgrade(request, socket, head, ws => {
      this.#alive.add(ws)
      ws.on('pong', () => this.#alive.add(ws))
      // A malformed frame or a broken socket ends only this connection; its close handlers clean up.
      ws.on('error', () => ws.terminate())
      route(ws)
    })
    return true
  }

  /** Stop accepting and close every socket as unavailable. */
  close(): void {
    clearInterval(this.#heartbeat)
    for (const deadline of this.#deadlines.values()) clearTimeout(deadline)
    for (const socket of this.#server.clients) socket.close(Close.unavailable, 'relay stopped')
    this.#server.close()
  }

  #host(ws: WebSocket, address: string): void {
    const nonce = base64url(randomBytes(32))
    const deadline = setTimeout(() => ws.close(Close.timeout, 'registration timed out'), this.#options.timeoutMs)
    ws.on('close', () => clearTimeout(deadline))
    send(ws, { t: 'challenge', nonce })
    ws.once('message', async (data, isBinary) => {
      clearTimeout(deadline)
      const message = control(data, isBinary)
      const hostId = message?.hostId, sig = message?.sig
      if (message?.t !== 'register' || typeof hostId !== 'string' || typeof sig !== 'string') return ws.close(Close.protocolError, 'expected register')
      if (message.protocol !== PROTOCOL) return ws.close(Close.upgradeRequired, `relay serves ${PROTOCOL}`)
      if (!this.#refusals.allows(address)) return ws.close(Close.overLimit, 'too many refused registrations')
      const refuse = (reason: string): void => {
        this.#refusals.take(address)
        ws.close(Close.unauthorized, reason)
      }
      if (!await verifyRegistration(hostId, this.#options.url, nonce, sig)) return refuse('registration refused')
      let admission: Admission | undefined
      try {
        admission = await this.#admit(message)
      } catch (error) {
        return ws.close(Close.unavailable, (error as IssuerUnavailable).message)
      }
      if (admission === undefined) return refuse('registration refused')
      const { member, expiresAt } = admission
      const hosts = member === undefined ? undefined : this.#members.get(member) ?? new Set<string>()
      if (hosts !== undefined && !hosts.has(hostId) && hosts.size >= this.#options.maxHostsPerMember) return refuse('too many computers registered for this account')
      if (ws.readyState !== WebSocket.OPEN) return
      const previous = this.#hosts.get(hostId)
      if (previous !== undefined) {
        this.#release(hostId, previous)
        previous.ws.close(Close.replaced, 'registered again elsewhere')
      }
      const registration = { ws, member }
      this.#hosts.set(hostId, registration)
      if (member !== undefined) this.#members.set(member, hosts!.add(hostId))
      // A Host registered by ID Token is a member only while the token lasts; it registers again before then.
      clearTimeout(this.#deadlines.get(hostId))
      this.#deadlines.delete(hostId)
      if (expiresAt !== undefined) this.#deadlines.set(hostId, setTimeout(() => this.#expire(hostId), Math.min(expiresAt * 1000 - Date.now(), 2 ** 31 - 1)))
      // Hosts probe the control socket because their WebSocket cannot see protocol pings.
      ws.on('message', (data, isBinary) => control(data, isBinary)?.t === 'ping' ? send(ws, { t: 'pong' }) : ws.close(Close.protocolError, 'unexpected message'))
      ws.on('close', () => {
        if (this.#hosts.get(hostId) !== registration) return
        this.#hosts.delete(hostId)
        this.#release(hostId, registration)
        for (const waiting of this.#waiting.values()) if (waiting.hostId === hostId) waiting.device.close(Close.hostOffline, 'host offline')
      })
      send(ws, { t: 'registered' })
    })
  }

  /** Who a registration's credential admits; undefined when it admits no one. Throws only {@link IssuerUnavailable}. */
  async #admit(message: ControlMessage): Promise<Admission | undefined> {
    const { accessKey, idToken } = message
    if (typeof accessKey === 'string' && idToken === undefined) return this.#allowed(accessKey) ? {} : undefined
    if (typeof idToken !== 'string' || accessKey !== undefined || this.#options.idTokens === undefined) return undefined
    try {
      const { subject, expiresAt } = await this.#options.idTokens.verify(idToken)
      return { member: subject, expiresAt }
    } catch (error) {
      if (error instanceof IssuerUnavailable) throw error
      return undefined
    }
  }

  /** The Host's credential ran out: end its registration and every connection paired under it. */
  #expire(hostId: string): void {
    this.#deadlines.delete(hostId)
    this.#hosts.get(hostId)?.ws.close(Close.timeout, 'credential expired')
    for (const ws of this.#pairs.get(hostId) ?? []) ws.close(Close.timeout, 'credential expired')
  }

  #release(hostId: string, { member }: Registration): void {
    if (member === undefined) return
    const hosts = this.#members.get(member)!
    hosts.delete(hostId)
    if (hosts.size === 0) this.#members.delete(member)
  }

  #device(ws: WebSocket, hostId: string): void {
    const host = this.#hosts.get(hostId)?.ws
    if (host === undefined) return ws.close(Close.hostOffline, 'host offline')
    const count = this.#connections.get(hostId) ?? 0
    if (count >= this.#options.maxConnectionsPerHost || !this.#connects.take(hostId)) return ws.close(Close.overLimit, 'too many connections')
    this.#connections.set(hostId, count + 1)
    const id = base64url(randomBytes(16))
    const timer = setTimeout(() => ws.close(Close.timeout, 'host did not answer'), this.#options.timeoutMs)
    this.#waiting.set(id, { device: ws, hostId, timer })
    ws.on('message', early)
    ws.on('close', () => {
      clearTimeout(timer)
      this.#waiting.delete(id)
      const left = this.#connections.get(hostId)! - 1
      if (left === 0) this.#connections.delete(hostId)
      else this.#connections.set(hostId, left)
    })
    send(host, { t: 'connect', id })
  }

  #accept(ws: WebSocket): void {
    const deadline = setTimeout(() => ws.close(Close.timeout, 'accept timed out'), this.#options.timeoutMs)
    ws.on('close', () => clearTimeout(deadline))
    ws.once('message', (data, isBinary) => {
      clearTimeout(deadline)
      const message = control(data, isBinary)
      const waiting = message?.t === 'accept' && typeof message.id === 'string' ? this.#waiting.get(message.id) : undefined
      if (waiting === undefined) return ws.close(Close.protocolError, 'unknown connection')
      this.#waiting.delete(message!.id as string)
      clearTimeout(waiting.timer)
      waiting.device.off('message', early)
      pipe(waiting.device, ws)
      pipe(ws, waiting.device)
      const pairs = this.#pairs.get(waiting.hostId) ?? new Set<WebSocket>()
      this.#pairs.set(waiting.hostId, pairs)
      for (const end of [waiting.device, ws]) {
        pairs.add(end)
        end.on('close', () => {
          pairs.delete(end)
          if (pairs.size === 0 && this.#pairs.get(waiting.hostId) === pairs) this.#pairs.delete(waiting.hostId)
        })
      }
      send(waiting.device, { t: 'open' })
    })
  }

  #allowed(key: string): boolean {
    const presented = digest(key)
    return this.#keys.some(known => timingSafeEqual(known, presented))
  }
}

/** Forward binary messages; pause the source while the destination is backed up; close the destination with the source. */
function pipe(from: WebSocket, to: WebSocket): void {
  from.on('message', (data, isBinary) => {
    if (!isBinary) {
      from.close(Close.protocolError, 'text after pairing')
      return
    }
    to.send(data, { binary: true }, () => {
      if (from.isPaused && to.bufferedAmount < HIGH_WATER) from.resume()
    })
    if (to.bufferedAmount >= HIGH_WATER) from.pause()
  })
  // A deliberate close (1000 or an application code) reaches the other end as is; anything else is a lost peer.
  from.on('close', (code, reason) => to.close(code === Close.normal || (code >= 4000 && code < 5000) ? code : Close.peerClosed, reason.toString()))
}

/** A device sent data before its Host accepted. */
function early(this: WebSocket): void {
  this.close(Close.protocolError, 'message before open')
}

function control(data: RawData, isBinary: boolean): ControlMessage | undefined {
  return isBinary ? undefined : parseControl(data.toString())
}

function send(ws: WebSocket, message: ControlMessage): void {
  ws.send(JSON.stringify(message))
}

const digest = (key: string): Buffer => createHash('sha256').update(key).digest()
