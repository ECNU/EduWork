/**
 * Relay server. It verifies Host registrations, pairs every device socket with
 * a fresh Host socket, and forwards the pair's binary messages without being
 * able to decrypt them. Pairs are independent sockets, so TCP backpressure
 * works end to end and one slow device never delays another.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import { base64url } from '../protocol/bytes.ts'
import { Close } from '../protocol/close-codes.ts'
import { MAX_MESSAGE, PROTOCOL } from '../protocol/constants.ts'
import { parseControl, RELAY_PATHS, verifyRegistration, type ControlMessage } from '../protocol/relay.ts'

export interface RelayOptions {
  /** Public origin Hosts and devices reach, e.g. `https://remote.example.edu`; bound into every registration. */
  readonly origin: string
  /** Credentials the operator issued to Host owners. */
  readonly accessKeys: readonly string[]
  /** Deadline for registering, accepting and the Host answering a device. */
  readonly timeoutMs?: number
  /** Ping interval; a socket that missed the previous ping is dropped. */
  readonly heartbeatMs?: number
  /** Device connections per Host, waiting or paired. */
  readonly maxConnectionsPerHost?: number
}

/** A paired destination holding more than this unsent stops the relay reading from its source. */
const HIGH_WATER = 1024 * 1024

export class Relay {
  readonly #options: Required<RelayOptions>
  readonly #keys: Buffer[]
  readonly #server = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE })
  readonly #hosts = new Map<string, WebSocket>()
  readonly #connections = new Map<string, number>()
  readonly #waiting = new Map<string, { device: WebSocket; hostId: string; timer: NodeJS.Timeout }>()
  readonly #alive = new WeakSet<WebSocket>()
  readonly #heartbeat: NodeJS.Timeout

  constructor(options: RelayOptions) {
    this.#options = { timeoutMs: 10_000, heartbeatMs: 25_000, maxConnectionsPerHost: 16, ...options }
    this.#keys = options.accessKeys.map(digest)
    this.#heartbeat = setInterval(() => {
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
    const path = new URL(request.url ?? '/', 'http://relay').pathname
    let route: ((ws: WebSocket) => void) | undefined
    if (path === RELAY_PATHS.host) route = ws => this.#host(ws)
    else if (path === RELAY_PATHS.accept) route = ws => this.#accept(ws)
    else if (path.startsWith(RELAY_PATHS.connect)) route = ws => this.#device(ws, path.slice(RELAY_PATHS.connect.length))
    if (route === undefined) return false
    this.#server.handleUpgrade(request, socket, head, ws => {
      this.#alive.add(ws)
      ws.on('pong', () => this.#alive.add(ws))
      route(ws)
    })
    return true
  }

  /** Stop accepting and close every socket as unavailable. */
  close(): void {
    clearInterval(this.#heartbeat)
    for (const socket of this.#server.clients) socket.close(Close.unavailable, 'relay stopped')
    this.#server.close()
  }

  #host(ws: WebSocket): void {
    const nonce = base64url(randomBytes(32))
    const deadline = setTimeout(() => ws.close(Close.timeout, 'registration timed out'), this.#options.timeoutMs)
    send(ws, { t: 'challenge', nonce })
    ws.once('message', async (data, isBinary) => {
      clearTimeout(deadline)
      const message = control(data, isBinary)
      const hostId = message?.hostId, sig = message?.sig
      if (message?.t !== 'register' || typeof hostId !== 'string' || typeof sig !== 'string') return ws.close(Close.protocolError, 'expected register')
      if (message.protocol !== PROTOCOL) return ws.close(Close.upgradeRequired, `relay serves ${PROTOCOL}`)
      if (!this.#allowed(message.accessKey) || !await verifyRegistration(hostId, this.#options.origin, nonce, sig)) return ws.close(Close.unauthorized, 'registration refused')
      if (ws.readyState !== WebSocket.OPEN) return
      this.#hosts.get(hostId)?.close(Close.replaced, 'registered again elsewhere')
      this.#hosts.set(hostId, ws)
      ws.on('message', () => ws.close(Close.protocolError, 'unexpected message'))
      ws.on('close', () => {
        if (this.#hosts.get(hostId) !== ws) return
        this.#hosts.delete(hostId)
        for (const waiting of this.#waiting.values()) if (waiting.hostId === hostId) waiting.device.close(Close.hostOffline, 'host offline')
      })
      send(ws, { t: 'registered' })
    })
  }

  #device(ws: WebSocket, hostId: string): void {
    const host = this.#hosts.get(hostId)
    if (host === undefined) return ws.close(Close.hostOffline, 'host offline')
    const count = this.#connections.get(hostId) ?? 0
    if (count >= this.#options.maxConnectionsPerHost) return ws.close(Close.overLimit, 'too many connections')
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
      send(waiting.device, { t: 'open' })
    })
  }

  #allowed(key: unknown): boolean {
    if (typeof key !== 'string') return false
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
  from.on('close', (code, reason) => to.close(code >= 4000 && code < 5000 ? code : Close.peerClosed, reason.toString()))
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
