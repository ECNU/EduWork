// The Host's link to a real relay on loopback, for credentials that expire.
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { WebSocket as Client } from 'ws'
import { HostStore } from '../src/devices/store.ts'
import type { SocketLike } from '../src/protocol/channel.ts'
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
