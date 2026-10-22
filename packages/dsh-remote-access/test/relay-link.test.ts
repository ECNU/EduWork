// The Host's link to a real relay on loopback, for credentials that expire.
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { WebSocket as Client } from 'ws'
import { HostStore } from '../src/devices/store.ts'
import type { SocketLike } from '../src/protocol/channel.ts'
import { Close } from '../src/protocol/close-codes.ts'
import { RELAY_PATHS } from '../src/protocol/relay.ts'
import { RelayLink, type LinkState } from '../src/relay-link/link.ts'
import { startRelay, until } from './loopback.ts'

test('a Host registered by ID Token registers again before it expires, keeping its devices connected', async t => {
  // `member:<exp>` stands in for an ID Token of one member, valid until exp.
  const relay = await startRelay(t, { idTokens: { verify: async token => ({ subject: 'alice', expiresAt: Number(token.split(':')[1]) }) } })
  const { identity } = await HostStore.open(join(await mkdtemp(join(tmpdir(), 'relay-link-')), 'state.json'))
  let issued = 0
  const states: LinkState['state'][] = []
  const accepted: SocketLike[] = []
  const link = new RelayLink({
    relay,
    identity,
    credential: async () => {
      issued++
      const expiresAt = Math.floor(Date.now() / 1000) + 4
      return { credential: { idToken: `member:${expiresAt}` }, expiresAt }
    },
    accept: socket => accepted.push(socket),
    onState: state => states.push(state.state),
    renewBeforeMs: 2500,
    renewAfterMs: 0,
  })
  link.start()
  t.after(() => link.stop())
  await until(() => states.includes('online'), 'registration')

  const device = new Client(relay.replace('http', 'ws') + RELAY_PATHS.connect + identity.hostId)
  const received: string[] = []
  device.on('message', data => received.push(data.toString()))
  await until(() => received.includes('{"t":"open"}'), 'the device accepted')
  // The token lasts 3–4 s and is renewed 2.5 s before it expires.
  await until(() => states.length === 3, 'a renewal')

  // Through the renewal the link stayed online and the device's connection stayed up.
  assert.deepEqual(states, ['connecting', 'online', 'online'])
  assert.equal(issued, 2)
  assert.equal(device.readyState, Client.OPEN)
  accepted[0]!.send(new TextEncoder().encode('still here'))
  await until(() => received.includes('still here'), 'bytes after renewal')
  const second = new Client(relay.replace('http', 'ws') + RELAY_PATHS.connect + identity.hostId)
  await until(() => accepted.length === 2, 'a device after renewal')
  device.close()
  second.close()
})

test('a Host that cannot renew its credential keeps trying; its devices go when the old one lapses', async t => {
  const relay = await startRelay(t, { idTokens: { verify: async token => ({ subject: 'alice', expiresAt: Number(token.split(':')[1]) }) } })
  const { identity } = await HostStore.open(join(await mkdtemp(join(tmpdir(), 'relay-link-')), 'state.json'))
  // The first token lasts 2 s; renewals fail, as when the issuer is down, until `renewable`.
  let issued = 0, renewable = false
  const states: LinkState[] = []
  const link = new RelayLink({
    relay,
    identity,
    credential: async () => {
      if (issued++ > 0 && !renewable) throw new Error('the issuer did not answer')
      const expiresAt = Math.floor(Date.now() / 1000) + 2
      return { credential: { idToken: `member:${expiresAt}` }, expiresAt }
    },
    accept: () => {},
    onState: state => states.push(state),
    renewBeforeMs: 1500,
    renewAfterMs: 0,
    backoffMs: [200],
  })
  link.start()
  t.after(() => link.stop())
  await until(() => states.some(state => state.state === 'online'), 'registration')
  const device = new Client(relay.replace('http', 'ws') + RELAY_PATHS.connect + identity.hostId)
  const closed = new Promise<number>(resolve => device.on('close', resolve))
  // Until then the failed renewals left the Host online.
  assert.deepEqual(states.map(state => state.state), ['connecting', 'online'])
  assert.equal(await closed, Close.timeout, 'the connection ends with the credential')
  await until(() => states.some(state => state.state === 'offline' && state.reason.includes('the issuer did not answer')), 'retries once offline')
  renewable = true
  states.length = 0
  await until(() => states.some(state => state.state === 'online'), 'registration once the credential is had again')
})

test('a Host whose credential only its owner can renew stops once the last one lapses', async t => {
  const relay = await startRelay(t, { idTokens: { verify: async token => ({ subject: 'alice', expiresAt: Number(token.split(':')[1]) }) } })
  const { identity } = await HostStore.open(join(await mkdtemp(join(tmpdir(), 'relay-link-')), 'state.json'))
  // Like a sign-in whose issuer stops renewing the ID Token: the last token while it lasts, then none.
  const expiresAt = Math.floor(Date.now() / 1000) + 2
  let asked = 0
  const states: LinkState['state'][] = []
  const link = new RelayLink({
    relay,
    identity,
    credential: async () => {
      asked++
      return Date.now() < expiresAt * 1000 ? { credential: { idToken: `member:${expiresAt}` }, expiresAt } : undefined
    },
    accept: () => {},
    onState: state => states.push(state.state),
    renewBeforeMs: 1500,
    renewAfterMs: 0,
    backoffMs: [200],
  })
  link.start()
  t.after(() => link.stop())
  // The renewal brings the same token, so it is not tried again. The relay ends the registration when the token
  // expires; asked again, the Host has none and stops instead of retrying.
  await until(() => states.includes('lapsed'), 'the lapsed credential')
  await new Promise(resolve => setTimeout(resolve, 1000))
  assert.deepEqual(states, ['connecting', 'online', 'online', 'offline', 'connecting', 'lapsed'])
  assert.equal(asked, 3)
})
