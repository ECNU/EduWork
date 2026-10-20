// The whole Host side without DSH: a real relay on loopback, a Host with a
// stand-in adapter, and devices speaking the protocol over real WebSockets.
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { FORBIDDEN } from '../src/connections/handler.ts'
import { HostStore } from '../src/devices/store.ts'
import type { HostAdapter } from '../src/host/adapter.ts'
import { deviceAuth, generateDeviceKey, pairingCode, parsePairingLink, type PairingLink } from '../src/protocol/auth.ts'
import { Channel, ChannelClosed, type Header } from '../src/protocol/channel.ts'
import { Close } from '../src/protocol/close-codes.ts'
import { prologue } from '../src/protocol/noise.ts'
import { RELAY_PATHS } from '../src/protocol/relay.ts'
import { TunnelClient } from '../src/protocol/tunnel.ts'
import { RemoteAccess, type RemoteAccessOptions } from '../src/remote-access.ts'
import { startRelay, until, withKey } from './loopback.ts'

/** A stand-in for DSH that records what reached it. */
function fakeAdapter() {
  const seen = { api: [] as string[], bodies: [] as string[], peers: 0, disposed: 0 }
  const adapter: HostAdapter = {
    createPeer: () => {
      seen.peers++
      return { dispose: async () => { seen.disposed++ } }
    },
    page: async () => new Response('<!doctype html>'),
    api: async request => {
      seen.api.push(new URL(request.url).pathname)
      seen.bodies.push(await request.text())
      return Response.json({ type: 'server-response', rpcId: 'r', result: { ok: true, value: [] } })
    },
    async *openStream() { yield 'event' },
    streamFailure: error => ({ code: 'internal', message: String(error), details: {} }),
  }
  return { adapter, seen }
}

async function startHost(t: TestContext, relay: string, overrides: Partial<RemoteAccessOptions> = {}) {
  const store = await HostStore.open(join(await mkdtemp(join(tmpdir(), 'remote-access-')), 'state.json'))
  const { adapter, seen } = fakeAdapter()
  const access = new RemoteAccess({ adapter, store, relay, credential: withKey(), hostName: 'Lab PC', warn: () => {}, ...overrides })
  access.start()
  t.after(() => access.stop())
  return { access, seen, store }
}

/** Connect a device to the Host behind `link` and authenticate; resolves with the Host's first reply. */
async function connectDevice(relay: string, link: PairingLink, key: CryptoKeyPair, invite?: string) {
  const socket = new WebSocket(`${relay.replace('http', 'ws')}${RELAY_PATHS.connect}${link.hostId}`)
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('message', ({ data }) => data === '{"t":"open"}' ? resolve() : reject(new Error(String(data))), { once: true })
    socket.addEventListener('close', ({ code }) => reject(new Error(`closed ${code}`)), { once: true })
  })
  const channel = await Channel.connect(socket, link.hostKey, prologue('relay', link.hostId), AbortSignal.timeout(5000))
  channel.send(await deviceAuth(key, channel.hash, invite === undefined ? undefined : { invite, name: 'Test phone' }))
  return { channel, code: await pairingCode(channel.hash), reply: (await channel.receive()).header }
}

test('pair with an invite and the owner\'s approval, work, reconnect, and lose access on revocation', async t => {
  const relay = await startRelay(t)
  const { access, seen } = await startHost(t, relay)
  await until(() => access.status().link.state === 'online', 'registration')
  const link = parsePairingLink(new URL(access.createInvite()).hash)!
  const phone = await generateDeviceKey()

  const pairing = connectDevice(relay, link, phone, link.invite)
  await until(() => access.status().pending.length === 1, 'the pairing request')
  const [request] = access.status().pending
  assert.equal(request!.name, 'Test phone')
  assert.equal(access.status().invite, undefined, 'the invite was used up')
  assert.ok(access.decide(request!.key, true))
  const first = await pairing
  assert.deepEqual(first.reply, { t: 'pending', host: 'Lab PC' })
  assert.equal(first.code, request!.code, 'both screens show the same code')
  assert.deepEqual((await first.channel.receive()).header, { t: 'ready', host: 'Lab PC' })

  const revoked = Promise.withResolvers<Header>()
  const client = new TunnelClient(first.channel, revoked.resolve)
  assert.equal((await client.fetch({ method: 'POST', url: '/api/session/list', body: new TextEncoder().encode('{}') })).status, 200)
  const rpc = async (url: string, body: unknown) => client.fetch({ method: 'POST', url, headers: { 'content-type': 'application/json' }, body: new TextEncoder().encode(JSON.stringify(body)) })
  const refused = await (await rpc('/api/credentials/set', { rpcId: 'x' })).json()
  assert.equal(refused.result.error.code, FORBIDDEN)
  const acknowledge = { rpcId: 'n', payload: { args: { ns: 'ui-settings-general', ops: [{ op: 'set', path: ['welcomeNoticeVersion'], value: 'v2' }] } } }
  assert.equal((await rpc('/api/settings/mutate', acknowledge)).status, 200)
  const theme = { rpcId: 't', payload: { args: { ns: 'ui-settings-general', ops: [{ op: 'set', path: ['theme'], value: 'dark' }] } } }
  assert.equal((await (await rpc('/api/settings/mutate', theme)).json()).result.error.code, FORBIDDEN)
  assert.deepEqual(seen.api, ['/api/session/list', '/api/settings/mutate'])
  assert.deepEqual(JSON.parse(seen.bodies[1]!), acknowledge, 'the checked call reaches DSH unchanged')

  const again = await connectDevice(relay, link, phone)
  assert.deepEqual(again.reply, { t: 'ready', host: 'Lab PC' }, 'a paired device reconnects without an invite')
  await until(() => access.status().devices[0]?.connections === 2, 'both connections')

  await access.revoke(request!.key)
  assert.deepEqual(await revoked.promise, { t: 'revoked' })
  assert.deepEqual((await again.channel.receive()).header, { t: 'revoked' }, 'told before the channel closes')
  await assert.rejects(again.channel.receive(), (error: ChannelClosed) => error.code === Close.forbidden)
  await until(() => seen.disposed === 2, 'both Peers disposed')
  const after = await connectDevice(relay, link, phone)
  assert.deepEqual(after.reply, { t: 'rejected', reason: 'unknown-device' })
})

test('an invite admits one device; strangers, declined and unanswered devices are turned away', async t => {
  const relay = await startRelay(t)
  const { access } = await startHost(t, relay, { pairing: { approvalMs: 100 } })
  await until(() => access.status().link.state === 'online', 'registration')
  const link = parsePairingLink(new URL(access.createInvite()).hash)!

  const declined = connectDevice(relay, link, await generateDeviceKey(), link.invite)
  await until(() => access.status().pending.length === 1, 'the pairing request')
  access.decide(access.status().pending[0]!.key, false)
  const refusal = await declined
  assert.deepEqual((await refusal.channel.receive()).header, { t: 'rejected', reason: 'declined' })

  const reused = await connectDevice(relay, link, await generateDeviceKey(), link.invite)
  assert.deepEqual(reused.reply, { t: 'rejected', reason: 'invalid-invite' })
  const stranger = await connectDevice(relay, link, await generateDeviceKey())
  assert.deepEqual(stranger.reply, { t: 'rejected', reason: 'unknown-device' })

  const fresh = parsePairingLink(new URL(access.createInvite()).hash)!
  const unanswered = await connectDevice(relay, fresh, await generateDeviceKey(), fresh.invite)
  assert.deepEqual((await unanswered.channel.receive()).header, { t: 'rejected', reason: 'timeout' })
  assert.equal(access.status().devices.length, 0)
})

test('stopping disconnects every device, including one still waiting for approval', async t => {
  const relay = await startRelay(t)
  const { access, seen } = await startHost(t, relay)
  await until(() => access.status().link.state === 'online', 'registration')
  const link = parsePairingLink(new URL(access.createInvite()).hash)!
  const pairing = connectDevice(relay, link, await generateDeviceKey(), link.invite)
  await until(() => access.status().pending.length === 1, 'the first request')
  access.decide(access.status().pending[0]!.key, true)
  const connected = await pairing
  assert.deepEqual((await connected.channel.receive()).header, { t: 'ready', host: 'Lab PC' })

  const next = parsePairingLink(new URL(access.createInvite()).hash)!
  const waiting = await connectDevice(relay, next, await generateDeviceKey(), next.invite)
  assert.deepEqual(waiting.reply, { t: 'pending', host: 'Lab PC' })
  access.stop()
  for (const { channel } of [connected, waiting]) {
    await assert.rejects(channel.receive(), (error: ChannelClosed) => error.code === Close.normal)
  }
  assert.equal(access.status().pending.length, 0)
  await until(() => seen.disposed === 1, 'the Peer disposed')
})

test('a wrong access key stops the link; a second Host with the same identity replaces the first', async t => {
  const relay = await startRelay(t)
  const wrong = await startHost(t, relay, { credential: withKey('guessed') })
  await until(() => wrong.access.status().link.state === 'refused', 'refusal')

  const first = await startHost(t, relay)
  await until(() => first.access.status().link.state === 'online', 'registration')
  const twin = new RemoteAccess({ adapter: fakeAdapter().adapter, store: first.store, relay, credential: withKey(), hostName: 'Twin', warn: () => {} })
  twin.start()
  t.after(() => twin.stop())
  await until(() => first.access.status().link.state === 'replaced', 'replacement')
  await until(() => twin.status().link.state === 'online', 'the twin online')
})
