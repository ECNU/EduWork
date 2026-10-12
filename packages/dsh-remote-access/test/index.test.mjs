// Tests for the package entry point.
//
// `src/index.js` is what `main` and every `exports` path lead to, and until now
// it had only ever been syntax-checked: importing it needs the three peer
// packages installed, which nothing in the test run did. The class below is the
// part of the package a DSH host touches first, so the stub here is deliberately
// shaped like the settings service the host actually injects — `register`,
// `get`, `update` and `describe` — rather than like the internals.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  DEFAULT_AGENT_SURFACE,
  DEVICE_STATUS,
  DeviceRegistry,
  SETTINGS_NAMESPACE,
  SettingsSchema,
  apply,
  inject,
  name,
} from '../src/index.js'
import { DeviceStore } from '../src/listener.js'

/**
 * A stand-in for the host's settings service.
 *
 * `withGet: false` models the older hosts that only expose `describe()`, which
 * `DeviceRegistry` claims to tolerate — a claim that is worth testing rather than
 * trusting, since it is the difference between working and throwing on those
 * hosts.
 *
 * `services` names what else the context can offer. `inject` only runs its
 * callback when every requested name is present, which is how the real container
 * behaves and the reason a plugin can ask for `connection` on a host that has no
 * web server without crashing it.
 */
function stubHost({ enabled = false, devices = [], relay, withGet = true, withRegister = true, services = {} } = {}) {
  const state = { [SETTINGS_NAMESPACE]: { enabled, devices, ...(relay === undefined ? {} : { relay }) } }
  const provided = new Map()
  const registered = []
  const updates = []
  const effects = []
  const available = { settings: {}, ...services }

  const ctx = {
    ...services,
    inject(names, callback) {
      const list = Array.isArray(names) ? names : [names]
      // Presence, not truthiness: a service is an object, so `=== true` would
      // report every real service as missing.
      if (!list.every(service => available[service] !== undefined)) return
      callback(ctx)
    },
    effect(callback) {
      effects.push(callback)
      const dispose = callback()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    provide(key, value) {
      provided.set(key, value)
    },
    settings: {
      ...(withRegister
        ? { register: (ns, schema, options) => registered.push({ ns, schema, options }) }
        : {}),
      ...(withGet ? { get: ns => state[ns] } : {}),
      describe: () => Object.entries(state).map(([ns, value]) => ({ ns, value })),
      update: async (ns, patch) => {
        updates.push({ ns, patch })
        state[ns] = { ...state[ns], ...patch }
      },
    },
  }
  return { ctx, state, provided, registered, updates, effects }
}

const device = (deviceId, name = deviceId) => ({ deviceId, name, publicKey: `key-${deviceId}` })

test('the entry point exports the shape a DSH host loads', () => {
  assert.equal(name, 'remote-access')
  assert.deepEqual(inject, ['settings'])
  // The namespace is not institution-branded: a public package must not carry a
  // school's name into a host that has nothing to do with that school.
  assert.equal(SETTINGS_NAMESPACE, 'eduwork-remote-access')
  assert.equal(SETTINGS_NAMESPACE.includes('chatecnu'), false)
})

test('apply registers the namespace and publishes the registry', () => {
  const host = stubHost()
  const registry = apply(host.ctx)

  assert.equal(host.registered.length, 1, 'the namespace must be registered exactly once')
  assert.equal(host.registered[0].ns, SETTINGS_NAMESPACE)
  assert.equal(host.registered[0].schema, SettingsSchema)
  // Empty relay settings, not absent ones: the registry reports "nowhere to dial"
  // as a pair of empty strings, and a missing field would make the check below
  // depend on which host wrote the settings file.
  assert.deepEqual(host.registered[0].options.base, {
    enabled: false,
    devices: [],
    relay: { url: '', hostId: '' },
  })

  assert.equal(host.provided.get('remoteAccess'), registry)
  assert.equal(registry instanceof DeviceRegistry, true)
})

test('没有 connection 服务时不连出，也不报错', () => {
  // A desktop profile with no web server is a supported shape. Asking for a
  // service that is not there must be a no-op, not a crash and not a fallback.
  const host = stubHost({ enabled: true, relay: { url: 'wss://relay.example', hostId: 'host-1' } })
  assert.doesNotThrow(() => apply(host.ctx))
  assert.equal(host.effects.length, 0, 'nothing may be scheduled without a connection to carry calls')
})

test('开着远连但没有中继地址时，不连出也不报错', () => {
  const host = stubHost({
    enabled: true,
    services: {
      connection: {
        operator: {},
        authenticatedUrl: () => 'http://127.0.0.1:1/?token=x',
        admit: () => ({ peer: {} }),
        createSharedFetchHandler: () => ({ fetch: async () => new Response('{}') }),
      },
    },
  })
  assert.doesNotThrow(() => apply(host.ctx))
  // The effect is scheduled — the decision is made inside it, where settings are
  // read live — but nothing is dialled, because there is nowhere to dial to.
  assert.equal(host.effects.length, 1)
})

test('remote access is off and empty until the operator turns it on', () => {
  const host = stubHost()
  const registry = apply(host.ctx)
  // Reach must never appear as a side effect of an upgrade, so the default is
  // the whole point rather than a detail.
  assert.equal(registry.enabled, false)
  assert.deepEqual(registry.list(), [])
  assert.deepEqual(registry.trusted(), [])
})

test('a device seen but not confirmed is recorded and still untrusted', async () => {
  const host = stubHost({ enabled: true })
  const registry = apply(host.ctx)

  // No `status` is passed: reading "record a device that has been seen" and
  // omitting it is the natural thing to do, and it must not throw.
  await registry.upsert(device('dev-1', '手机'))
  const recorded = registry.find('dev-1')

  assert.equal(recorded.name, '手机')
  assert.equal(recorded.status, DEVICE_STATUS.PENDING)
  // A pending device carries no authority at all: it has not been confirmed, so
  // there is nothing to grant.
  assert.deepEqual(recorded.surfaces.agent, [])
  assert.deepEqual(recorded.surfaces.host, [], 'the host surface is closed by default')
  assert.deepEqual(registry.trusted(), [], 'seeing a device is not trusting it')
  assert.deepEqual(host.updates.at(-1).ns, SETTINGS_NAMESPACE)
})

test('a device reconnecting keeps its status and its history', async () => {
  const host = stubHost({ enabled: true })
  const registry = apply(host.ctx)
  await registry.upsert(device('dev-1', '手机'))
  await registry.confirm('dev-1')
  const admitted = registry.find('dev-1')
  assert.equal(admitted.status, DEVICE_STATUS.TRUSTED)

  // A reconnect carries whatever the caller happens to send. A habitual
  // `status: 'pending'` must not undo the operator's decision, or every
  // reconnection would quietly withdraw the device.
  await registry.upsert({ ...device('dev-1', '手机'), status: DEVICE_STATUS.PENDING })
  const reseen = registry.find('dev-1')
  assert.equal(reseen.status, DEVICE_STATUS.TRUSTED, 'a reconnect must not demote')
  assert.deepEqual(registry.trusted().map(entry => entry.deviceId), ['dev-1'])
  // And it must not erase the record of when the device was admitted, nor the
  // authority that confirmation granted.
  assert.equal(reseen.pairedAt, admitted.pairedAt, 'a reconnect must not forget when it was paired')
  assert.deepEqual(reseen.surfaces.agent, [...DEFAULT_AGENT_SURFACE].sort())

  // The reverse direction: an upsert claiming `trusted` must not grant it.
  await registry.upsert(device('dev-2', '笔记本'))
  await registry.upsert({ ...device('dev-2', '笔记本'), status: DEVICE_STATUS.TRUSTED })
  assert.equal(registry.find('dev-2').status, DEVICE_STATUS.PENDING, 'an upsert must not grant trust')
  assert.deepEqual(registry.trusted().map(entry => entry.deviceId), ['dev-1'])

  // A revoked device id is spent: recording another sighting of it would let a
  // caller rewrite the identity behind a withdrawn credential.
  await registry.revoke('dev-1')
  await assert.rejects(() => registry.upsert(device('dev-1', '手机')), /cannot be revived/u)
  assert.equal(registry.find('dev-1').status, DEVICE_STATUS.REVOKED)
})

test('confirm is the only path into trusted, and it is what grants the agent surface', async () => {
  const host = stubHost({ enabled: true })
  const registry = apply(host.ctx)
  await registry.upsert(device('dev-1'))
  assert.deepEqual(registry.find('dev-1').surfaces.agent, [])

  await registry.confirm('dev-1')
  const confirmed = registry.find('dev-1')

  assert.deepEqual(registry.trusted().map(entry => entry.deviceId), ['dev-1'])
  assert.equal(confirmed.status, DEVICE_STATUS.TRUSTED)
  assert.notEqual(confirmed.pairedAt, undefined, 'admission time is recorded')
  // Confirmation is where authority comes from, so the default agent surface
  // arrives here and not before. Sorted is what normalization produces; comparing
  // against the constant directly would fail on ordering alone.
  assert.deepEqual(confirmed.surfaces.agent, [...DEFAULT_AGENT_SURFACE].sort())
  assert.deepEqual(confirmed.surfaces.host, [], 'confirming must never open the host surface')
})

test('a device loaded from persisted settings is normalized, not trusted blindly', async () => {
  const host = stubHost({
    enabled: true,
    devices: [
      { deviceId: 'dev-1', name: '手机', publicKey: 'k1', status: 'trusted', pairedAt: '2026-01-01T00:00:00.000Z' },
      { deviceId: 'dev-2', name: '旧设备', publicKey: 'k2', status: 'revoked', lastSeenAt: '2026-01-02T00:00:00.000Z' },
    ],
  })
  const registry = new DeviceRegistry({ ctx: host.ctx })

  assert.equal(registry.find('dev-1').status, DEVICE_STATUS.TRUSTED)
  assert.equal(registry.find('dev-2').status, DEVICE_STATUS.REVOKED)
  // A row marked `trusted` that carries no recorded surfaces grants nothing: the
  // flag alone is not authority, so fail closed.
  assert.deepEqual(registry.find('dev-1').surfaces.agent, [])
  assert.deepEqual(registry.find('dev-1').surfaces.host, [])
  // And a revoked row cannot be talked back into service.
  await assert.rejects(() => registry.upsert(device('dev-2')), /cannot be revived/u)
})

test('an unreadable stored row stops the registry instead of being skipped', () => {
  // Fail closed rather than drop. Skipping an unreadable row would be safe for a
  // device — an unknown device is not trusted either way — but the same code path
  // reads the rows that carry revocations, and silently discarding one of those is
  // the failure this whole package exists to prevent. So a malformed row makes the
  // registry refuse to load, and the operator sees the error rather than a
  // plausible-looking registry that is missing a revocation.
  const host = stubHost({
    enabled: true,
    devices: [
      { deviceId: 'dev-1', name: '手机', publicKey: 'k1', status: 'trusted' },
      { nonsense: true },
    ],
  })
  const registry = new DeviceRegistry({ ctx: host.ctx })
  assert.throws(() => registry.list(), /status must be a non-empty string/u)
  assert.throws(() => registry.trusted(), /status must be a non-empty string/u)
})

test('revoke hands back the device whose connections must also be closed', async () => {
  const host = stubHost({ enabled: true })
  const registry = apply(host.ctx)
  await registry.upsert(device('dev-1'))
  await registry.confirm('dev-1')

  const outcome = await registry.revoke('dev-1')

  // Persisting is only two thirds of revocation. The caller needs the device id
  // back, because the third part — tearing down its live connections — cannot be
  // done from here and is what makes the revocation real.
  assert.equal(outcome.revoked.deviceId, 'dev-1')
  assert.equal(outcome.revoked.status, DEVICE_STATUS.REVOKED)
  // The record carries no dedicated revocation timestamp: `lastSeenAt` is stamped
  // at the moment of revocation and then frozen, because an upsert may no longer
  // touch a revoked device. That is enough to order events, but it overloads one
  // field with two meanings — see the note in the package README.
  assert.notEqual(outcome.revoked.lastSeenAt, undefined)
  assert.deepEqual(registry.trusted(), [])
  assert.equal(registry.find('dev-1').status, DEVICE_STATUS.REVOKED)
  assert.deepEqual(outcome.registry.devices.map(entry => entry.deviceId), ['dev-1'], 'revoking is not forgetting')
})

test('remove forgets a device that revoke would keep', async () => {
  const host = stubHost({ enabled: true })
  const registry = apply(host.ctx)
  await registry.upsert(device('dev-1'))
  await registry.remove('dev-1')
  assert.equal(registry.find('dev-1'), undefined)
  assert.deepEqual(registry.list(), [])
})

test('a host that only exposes describe() still yields the registry', () => {
  // Older hosts have no `get`. The class claims to tolerate that; if the claim
  // were wrong, the failure would be a crash on exactly those hosts.
  const host = stubHost({
    enabled: true,
    withGet: false,
    devices: [{ deviceId: 'dev-1', name: '手机', publicKey: 'k1', status: 'trusted', pairedAt: '2026-01-01T00:00:00.000Z' }],
  })
  const registry = new DeviceRegistry({ ctx: host.ctx })
  assert.equal(registry.enabled, true)
  assert.deepEqual(registry.trusted().map(entry => entry.deviceId), ['dev-1'])
})

test('a host without a settings registrar is left alone rather than crashed into', () => {
  const host = stubHost({ withRegister: false })
  const registry = apply(host.ctx)
  assert.equal(host.registered.length, 0)
  // The service is still published: the host may register settings itself.
  assert.equal(host.provided.get('remoteAccess'), registry)
})

test('the schema defaults the flag off and rejects a malformed device list', () => {
  const parsed = SettingsSchema({ devices: [{ deviceId: 'dev-1' }] })
  assert.equal(parsed.enabled, false, 'an omitted flag must not become true')
  assert.deepEqual(parsed.devices, [{ deviceId: 'dev-1' }])
  assert.throws(() => SettingsSchema({ devices: 'nope' }))
})

test('the two device tables do not see each other, and this records that', () => {
  // The package ships two places a device can be recorded, and until this test
  // nothing said so out loud.
  //
  // `DeviceRegistry` (here) is the product-facing service: it lives in the host's
  // settings and holds devices only. `DeviceStore` (../src/listener.js) is what the
  // relay actually consults: one file holding devices, credentials and invitations
  // together, so a revocation cannot leave the first two disagreeing. It cannot use
  // settings, because the relay runs standalone with no Cordis host to inject one.
  //
  // Neither is wrong on its own. What is wrong is assuming they are the same table.
  // A device confirmed through one is unknown to the other, and a product that wires
  // up both has to keep them in step — which nothing here does. That obligation is
  // real, undocumented before now, and belongs to whoever assembles the plugin into
  // the product rather than to either store.
  //
  // This test pins the separation rather than the wiring on purpose. If someone
  // later unifies them, this failing is the intended signal that the documentation
  // and the integration contract need to change with it.
  // A real temporary directory, cleaned up at the end: the store writes a file, and
  // leaving one behind in the repository on every test run would be its own defect.
  const scratch = mkdtempSync(join(tmpdir(), 'dsh-remote-access-'))
  try {
    verifySeparateTables(scratch)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

function verifySeparateTables(scratchDirectory) {
  const store = new DeviceStore(join(scratchDirectory, 'devices.json'))
  const host = stubHost({ enabled: true })
  const registry = new DeviceRegistry({ ctx: host.ctx })

  const invitation = store.invite()
  store.redeem(invitation.code, '手机')
  const [device] = store.devices()
  store.confirm(device.deviceId)

  assert.equal(store.device(device.deviceId).status, DEVICE_STATUS.TRUSTED)
  assert.deepEqual(registry.list(), [], 'a device trusted by the relay is not in the settings registry')
  assert.deepEqual(store.devices().length, 1)

  registry.upsert({ deviceId: 'dev-from-settings', name: '笔记本', publicKey: 'k' })
  assert.equal(store.device('dev-from-settings'), undefined, 'and the other way round')
}
