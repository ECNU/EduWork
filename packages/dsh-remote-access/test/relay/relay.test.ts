import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import test from 'node:test'
import { WebSocket } from 'ws'
import { PROTOCOL } from '../../src/protocol/constants.ts'
import { Close } from '../../src/protocol/close-codes.ts'
import { hostIdOf, RELAY_PATHS, signRegistration } from '../../src/protocol/relay.ts'
import { IssuerUnavailable } from '../../src/relay/id-token.ts'
import { Relay, type RelayOptions } from '../../src/relay/relay.ts'

// A relay sharing its domain, below a path of its own.
const RELAY = 'https://relay.test/remote/'
const KEY = 'operator-issued-key'

async function startRelay(options: Partial<RelayOptions> = {}) {
  const relay = new Relay({ url: RELAY, accessKeys: [KEY], timeoutMs: 300, address: request => String(request.headers['x-real-ip']), ...options })
  const server = createServer((_request, response) => response.writeHead(404).end())
  server.on('upgrade', (request, socket, head) => relay.upgrade(request, socket, head) || socket.destroy())
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `ws://127.0.0.1:${(server.address() as { port: number }).port}/remote/`
  return { base, stop: () => { relay.close(); server.close() } }
}

/** A ws client that queues what it receives. */
class Peer {
  readonly socket: WebSocket
  readonly closed: Promise<{ code: number; reason: string }>
  readonly #queue: (string | Buffer)[] = []
  #wake: (() => void) | undefined

  constructor(url: string, options: { autoPong?: boolean; headers?: Record<string, string> } = {}) {
    this.socket = new WebSocket(url, options)
    this.socket.on('message', (data: Buffer, isBinary) => {
      this.#queue.push(isBinary ? data : data.toString())
      this.#wake?.()
    })
    this.closed = new Promise(resolve => this.socket.on('close', (code, reason) => resolve({ code, reason: reason.toString() })))
    // A refused upgrade fails the handshake; its close (1006) says enough.
    this.socket.on('error', () => {})
  }

  async next(): Promise<string | Buffer> {
    while (this.#queue.length === 0) await new Promise<void>(resolve => { this.#wake = resolve })
    return this.#queue.shift()!
  }

  async json(): Promise<Record<string, unknown>> {
    return JSON.parse(await this.next() as string)
  }

  send(message: object | Uint8Array): void {
    this.socket.send(message instanceof Uint8Array ? message : JSON.stringify(message))
  }

  async code(): Promise<number> {
    return (await this.closed).code
  }
}

async function identity() {
  const keys = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']) as CryptoKeyPair
  return { ...keys, hostId: await hostIdOf(keys.publicKey) }
}

async function register(base: string, host: Awaited<ReturnType<typeof identity>>, change: (message: Record<string, unknown>) => void = () => {}, address = '192.0.2.1') {
  const peer = new Peer(base + RELAY_PATHS.host, { headers: { 'x-real-ip': address } })
  const { nonce } = await peer.json() as { nonce: string }
  const message = { t: 'register', protocol: PROTOCOL, hostId: host.hostId, accessKey: KEY, sig: await signRegistration(host.privateKey, RELAY, nonce) }
  change(message)
  peer.send(message)
  return peer
}

/** Device connects; the Host accepts on a fresh socket; both ends are returned once the device saw `open`. */
async function pair(base: string, control: Peer, hostId: string) {
  const device = new Peer(base + RELAY_PATHS.connect + hostId)
  const { id } = await control.json()
  const host = new Peer(base + RELAY_PATHS.accept)
  host.socket.once('open', () => host.send({ t: 'accept', id }))
  assert.deepEqual(await device.json(), { t: 'open' })
  return { device, host }
}

test('a registered Host serves each device on its own socket; bytes pass through untouched', async () => {
  const { base, stop } = await startRelay()
  const host = await identity()
  const control = await register(base, host)
  assert.deepEqual(await control.json(), { t: 'registered' })
  control.send({ t: 'ping' })
  assert.deepEqual(await control.json(), { t: 'pong' })
  const first = await pair(base, control, host.hostId), second = await pair(base, control, host.hostId)
  first.device.send(Uint8Array.of(1, 2, 3))
  second.host.send(Uint8Array.of(9))
  assert.deepEqual(await first.host.next(), Buffer.from([1, 2, 3]))
  assert.deepEqual(await second.device.next(), Buffer.from([9]))
  stop()
})

test('registration needs an issued key and a fresh signature for this relay and protocol', async () => {
  const { base, stop } = await startRelay()
  const host = await identity()
  const other = await identity()
  const otherRelay = await signRegistration(host.privateKey, 'https://elsewhere.test', 'nonce')
  const cases: [string, (message: Record<string, unknown>) => void, number][] = [
    ['unknown key', m => { m.accessKey = 'guess' }, Close.unauthorized],
    ['signature for another relay', m => { m.sig = otherRelay }, Close.unauthorized],
    ['claims another Host id', m => { m.hostId = other.hostId }, Close.unauthorized],
    ['other protocol', m => { m.protocol = 'eduwork-remote/2' }, Close.upgradeRequired],
    ['not a register message', m => { m.t = 'hello' }, Close.protocolError],
  ]
  for (const [name, change, code] of cases) assert.equal(await (await register(base, host, change)).code(), code, name)

  // A signature captured from one challenge does not answer the next.
  const first = new Peer(base + RELAY_PATHS.host)
  const { nonce } = await first.json() as { nonce: string }
  const captured = await signRegistration(host.privateKey, RELAY, nonce)
  first.socket.close()
  assert.equal(await (await register(base, host, m => { m.sig = captured })).code(), Close.unauthorized, 'replayed signature')

  const silent = new Peer(base + RELAY_PATHS.host)
  assert.equal(await silent.code(), Close.timeout)
  stop()
})

test('a newer verified registration replaces the old one; a refused one leaves it alone', async () => {
  const { base, stop } = await startRelay()
  const host = await identity()
  const old = await register(base, host)
  await old.json()
  const refused = await register(base, host, m => { m.accessKey = 'guess' })
  assert.equal(await refused.code(), Close.unauthorized)
  await pair(base, old, host.hostId)
  const current = await register(base, host)
  await current.json()
  assert.equal(await old.code(), Close.replaced)
  await pair(base, current, host.hostId)
  stop()
})

test('devices are refused for absent Hosts, unanswered connects and over the per-Host cap', async () => {
  const { base, stop } = await startRelay({ maxConnectionsPerHost: 2 })
  assert.equal(await new Peer(base + RELAY_PATHS.connect + 'nobody').code(), Close.hostOffline)
  const host = await identity()
  const control = await register(base, host)
  await control.json()

  const unanswered = new Peer(base + RELAY_PATHS.connect + host.hostId)
  await control.json()
  assert.equal(await unanswered.code(), Close.timeout)

  await pair(base, control, host.hostId)
  await pair(base, control, host.hostId)
  assert.equal(await new Peer(base + RELAY_PATHS.connect + host.hostId).code(), Close.overLimit)

  const bogus = new Peer(base + RELAY_PATHS.accept)
  bogus.socket.once('open', () => bogus.send({ t: 'accept', id: 'made-up' }))
  assert.equal(await bogus.code(), Close.protocolError)
  stop()
})

test('a waiting device learns at once when its Host goes offline', async () => {
  const { base, stop } = await startRelay({ timeoutMs: 5000 })
  const host = await identity()
  const control = await register(base, host)
  await control.json()
  const device = new Peer(base + RELAY_PATHS.connect + host.hostId)
  await control.json()
  control.socket.close()
  assert.equal(await device.code(), Close.hostOffline)
  stop()
})

test('closing one end closes the other, passing application codes through', async () => {
  const { base, stop } = await startRelay()
  const host = await identity()
  const control = await register(base, host)
  await control.json()
  const a = await pair(base, control, host.hostId)
  a.host.socket.close(Close.forbidden, 'revoked')
  assert.deepEqual(await a.device.closed, { code: Close.forbidden, reason: 'revoked' })
  const b = await pair(base, control, host.hostId)
  b.device.socket.close()
  assert.equal(await b.host.code(), Close.peerClosed)
  stop()
})

test('text on a paired connection, or data before open, is a protocol error', async () => {
  const { base, stop } = await startRelay({ timeoutMs: 5000 })
  const host = await identity()
  const control = await register(base, host)
  await control.json()
  const paired = await pair(base, control, host.hostId)
  paired.device.send({ t: 'open' })
  assert.equal(await paired.host.code(), Close.protocolError)

  const eager = new Peer(base + RELAY_PATHS.connect + host.hostId)
  eager.socket.once('open', () => eager.send(Uint8Array.of(1)))
  assert.equal(await eager.code(), Close.protocolError)
  stop()
})

test('a socket that stops answering pings is dropped', async () => {
  const { base, stop } = await startRelay({ heartbeatMs: 50 })
  const deaf = new Peer(base + RELAY_PATHS.host, { autoPong: false })
  assert.equal(await deaf.code(), 1006)
  stop()
})

/** Stands in for an issuer: `member:<subject>:<exp>` is valid, `down` finds the issuer unreachable. */
const issuer = {
  verify: async (token: string) => {
    const [kind, subject, exp] = token.split(':')
    if (kind === 'down') throw new IssuerUnavailable('issuer unreachable')
    if (kind !== 'member') throw new Error('invalid')
    return { subject: subject!, expiresAt: Number(exp) }
  },
}
const idToken = (subject: string, seconds = 3600) => (m: Record<string, unknown>) => {
  delete m.accessKey
  m.idToken = `member:${subject}:${Math.floor(Date.now() / 1000) + seconds}`
}

test('members register by ID Token, a few Hosts each, for as long as the token lasts', async () => {
  const { base, stop } = await startRelay({ idTokens: issuer, maxHostsPerMember: 2 })
  const [a, b, c, d] = [await identity(), await identity(), await identity(), await identity()]
  const first = await register(base, a, idToken('alice'))
  assert.deepEqual(await first.json(), { t: 'registered' })
  const brief = await register(base, b, idToken('alice', 1))
  assert.deepEqual(await brief.json(), { t: 'registered' })
  assert.equal(await (await register(base, c, idToken('alice'))).code(), Close.unauthorized, 'a third Host of the same member')
  assert.deepEqual(await (await register(base, c, idToken('bob'))).json(), { t: 'registered' })
  // The same Host registering again counts once.
  const again = await register(base, a, idToken('alice'))
  assert.deepEqual(await again.json(), { t: 'registered' })
  assert.equal(await first.code(), Close.replaced)
  await pair(base, again, a.hostId)
  // b's token lasts a second: the relay ends that registration, which makes room for another of alice's Hosts.
  assert.equal(await brief.code(), Close.timeout)
  assert.deepEqual(await (await register(base, d, idToken('alice'))).json(), { t: 'registered' })
  stop()
})

test('refused registrations make an address wait; an unreachable issuer is not a refusal', async () => {
  const keysOnly = await startRelay()
  const host = await identity()
  assert.equal(await (await register(keysOnly.base, host, idToken('alice'))).code(), Close.unauthorized, 'a relay that admits no organization')
  keysOnly.stop()

  const { base, stop } = await startRelay({ idTokens: issuer, refusalsPerMinute: 2 })
  const token = (value: string) => (m: Record<string, unknown>) => {
    delete m.accessKey
    m.idToken = value
  }
  assert.equal(await (await register(base, host, token('down'))).code(), Close.unavailable)
  assert.equal(await (await register(base, host, m => { m.idToken = 'member:alice:9999999999' })).code(), Close.unauthorized, 'both credentials')
  assert.equal(await (await register(base, host, token('forged'))).code(), Close.unauthorized, 'an invalid token')
  assert.equal(await (await register(base, host)).code(), Close.overLimit, 'even a valid key waits')
  assert.deepEqual(await (await register(base, host, undefined, '192.0.2.9')).json(), { t: 'registered' }, 'another address')
  stop()
})

test('a Host is asked to accept only so many connections a minute', async () => {
  const { base, stop } = await startRelay({ connectsPerMinute: 2 })
  const host = await identity()
  const control = await register(base, host)
  await control.json()
  await pair(base, control, host.hostId)
  await pair(base, control, host.hostId)
  assert.equal(await new Peer(base + RELAY_PATHS.connect + host.hostId).code(), Close.overLimit)
  stop()
})

test('a malformed frame ends only the connection that sent it', async () => {
  const { base, stop } = await startRelay()
  const host = await identity()
  const control = await register(base, host)
  await control.json()
  // Upgrade by hand, then send a text frame without the mask every client frame must carry.
  const { port } = new URL(base)
  const raw = connect(Number(port), '127.0.0.1')
  raw.write(`GET ${new URL(base).pathname}${RELAY_PATHS.host} HTTP/1.1\r\nHost: relay.test\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n`
    + 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n')
  await new Promise(resolve => raw.once('data', resolve))
  raw.write(Buffer.from([0x81, 0x01, 0x41]))
  await new Promise(resolve => raw.on('close', resolve))
  control.send({ t: 'ping' })
  assert.deepEqual(await control.json(), { t: 'pong' })
  await pair(base, control, host.hostId)
  stop()
})

test('a connection that goes before registering or accepting leaves no timer behind', async () => {
  const { base, stop } = await startRelay({ timeoutMs: 60_000 })
  const timers = (): number => process.getActiveResourcesInfo().filter(resource => resource === 'Timeout').length
  const before = timers()
  for (const path of [RELAY_PATHS.host, RELAY_PATHS.accept]) {
    const peer = new Peer(base + path)
    await new Promise(resolve => peer.socket.once('open', resolve))
    peer.socket.close()
    await peer.closed
  }
  // The relay sees the close a moment after the client does.
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.ok(timers() <= before)
  stop()
})

test('connections end with the credential that admitted their Host, unless it registered again in time', async () => {
  const { base, stop } = await startRelay({ idTokens: issuer })
  const [lapsing, renewed, dropped] = [await identity(), await identity(), await identity()]
  const pairs = []
  for (const host of [lapsing, renewed, dropped]) {
    const control = await register(base, host, idToken(host.hostId, 1))
    await control.json()
    pairs.push({ control, ...await pair(base, control, host.hostId) })
  }
  // One Host registers again with a later token before the first runs out; another loses its control
  // socket, as on a brief network loss, and registers again with a fresh token.
  await (await register(base, renewed, idToken(renewed.hostId))).json()
  pairs[2]!.control.socket.terminate()
  await (await register(base, dropped, idToken(dropped.hostId))).json()

  assert.equal(await pairs[0]!.device.code(), Close.timeout, 'a lapsed credential ends its connections')
  assert.equal(await pairs[0]!.host.code(), Close.timeout)
  for (const { device, host } of pairs.slice(1)) {
    device.send(Uint8Array.of(7))
    assert.deepEqual(await host.next(), Buffer.from([7]), 'a renewed credential keeps them')
  }
  stop()
})

test('a connection outlives a lost control socket only as long as the credential', async () => {
  const { base, stop } = await startRelay({ idTokens: issuer })
  const host = await identity()
  const control = await register(base, host, idToken('alice', 2))
  await control.json()
  const { device, host: end } = await pair(base, control, host.hostId)
  control.socket.terminate()
  await new Promise(resolve => setTimeout(resolve, 200))
  device.send(Uint8Array.of(1))
  assert.deepEqual(await end.next(), Buffer.from([1]), 'still open after the control socket is gone')
  assert.equal(await device.code(), Close.timeout)
  stop()
})

test('endpoints are only below the relay\'s path', async () => {
  const { base, stop } = await startRelay()
  const root = base.replace(/remote\/$/, '')
  for (const path of [RELAY_PATHS.host, RELAY_PATHS.connect + 'x', 'other/' + RELAY_PATHS.host]) {
    assert.equal(await new Peer(root + path).code(), 1006, path)
  }
  stop()
})
