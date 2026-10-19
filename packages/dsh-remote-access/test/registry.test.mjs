import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_AGENT_SURFACE,
  DEFAULT_HOST_SURFACE,
  DEVICE_STATUS,
  REGISTRY_VERSION,
  confirmDevice,
  emptyRegistry,
  findDevice,
  listDevices,
  normalizeDevice,
  normalizeRegistry,
  removeDevice,
  revokeDevice,
  trustedDevices,
  upsertDevice,
} from '../src/registry.js'

const NOW = '2026-10-09T12:00:00.000Z'
const LATER = '2026-10-09T13:00:00.000Z'

function device(overrides = {}) {
  return {
    deviceId: 'dev-1',
    publicKey: 'cHVibGljLWtleS1vbmU',
    name: '测试设备',
    status: DEVICE_STATUS.PENDING,
    ...overrides,
  }
}

test('a device without a public key is rejected', () => {
  // Reconnecting proves identity by signing a challenge; without a key there is
  // nothing to verify, so such a record must never enter the registry.
  assert.throws(() => normalizeDevice(device({ publicKey: '' })), /publicKey/)
  assert.throws(() => normalizeDevice(device({ publicKey: undefined })), /publicKey/)
})

test('a device without an id is rejected', () => {
  assert.throws(() => normalizeDevice(device({ deviceId: '   ' })), /deviceId/)
})

test('an unknown status is rejected', () => {
  assert.throws(() => normalizeDevice(device({ status: 'maybe' })), /unknown status/)
})

test('the host surface is closed by default', () => {
  // "May talk to the Agent" must never imply "may change who may connect".
  const normalized = normalizeDevice(device())
  assert.deepEqual(normalized.surfaces, { agent: [], host: [] })
})

test('surfaces default to empty even when the field is absent', () => {
  const normalized = normalizeDevice({ ...device(), surfaces: undefined })
  assert.deepEqual(normalized.surfaces, { agent: [], host: [] })
})

test('an unknown operation surface is rejected', () => {
  assert.throws(
    () => normalizeDevice(device({ surfaces: { agent: [], admin: ['x'] } })),
    /unknown operation surface/,
  )
})

test('a repeated scope in one surface is rejected', () => {
  assert.throws(
    () => normalizeDevice(device({ surfaces: { agent: ['session:read', 'session:read'] } })),
    /repeats/,
  )
})

test('surface lists are sorted for stable diffs', () => {
  const normalized = normalizeDevice(device({ surfaces: { agent: ['session:read', 'session:list'] } }))
  assert.deepEqual(normalized.surfaces.agent, ['session:list', 'session:read'])
})

test('an unsupported registry version is rejected', () => {
  assert.throws(() => normalizeRegistry({ version: 99, devices: [] }), /unsupported registry version/)
})

test('duplicate device ids are rejected', () => {
  assert.throws(
    () => normalizeRegistry({ devices: [device(), device()] }),
    /duplicate deviceId/,
  )
})

test('an unparseable timestamp is rejected', () => {
  assert.throws(() => normalizeDevice(device({ pairedAt: 'not-a-time' })), /ISO timestamp/)
})

test('confirmation is the only transition into trusted, and stamps pairedAt once', () => {
  const paired = upsertDevice(emptyRegistry(), device(), NOW)
  assert.equal(findDevice(paired, 'dev-1').status, DEVICE_STATUS.PENDING)
  assert.equal(findDevice(paired, 'dev-1').pairedAt, NOW)
  assert.deepEqual(trustedDevices(paired), [])

  const confirmed = confirmDevice(paired, 'dev-1', undefined, LATER)
  const record = findDevice(confirmed, 'dev-1')
  assert.equal(record.status, DEVICE_STATUS.TRUSTED)
  assert.equal(record.pairedAt, NOW, 'pairedAt records first sighting and must not be restamped')
  assert.equal(record.lastSeenAt, LATER)
  assert.deepEqual(record.surfaces.agent, [...DEFAULT_AGENT_SURFACE].sort())
  assert.ok(record.surfaces.agent.includes('session:create'), 'the remote UI must be able to create its first session')
})

test('confirmation grants only the narrow host surface', () => {
  const paired = upsertDevice(emptyRegistry(), device(), NOW)
  const confirmed = confirmDevice(paired, 'dev-1', { agent: ['session:read'] }, LATER)
  assert.deepEqual(findDevice(confirmed, 'dev-1').surfaces.host, [...DEFAULT_HOST_SURFACE].sort())
})

test('confirmation refuses an unknown device', () => {
  assert.throws(() => confirmDevice(emptyRegistry(), 'nope', undefined, NOW), /unknown device/)
})

test('confirmation refuses a revoked device', () => {
  const paired = upsertDevice(emptyRegistry(), device(), NOW)
  const trusted = confirmDevice(paired, 'dev-1', undefined, NOW)
  const { registry } = revokeDevice(trusted, 'dev-1', LATER)
  assert.throws(() => confirmDevice(registry, 'dev-1', undefined, LATER), /revoked/)
})

test('revocation reports the record so live connections can be torn down', () => {
  // Refusing later requests is not enough: an established stream keeps delivering
  // events until the caller closes it, so the record must come back.
  const paired = upsertDevice(emptyRegistry(), device(), NOW)
  const trusted = confirmDevice(paired, 'dev-1', undefined, NOW)
  const { registry, revoked } = revokeDevice(trusted, 'dev-1', LATER)
  assert.equal(revoked.deviceId, 'dev-1')
  assert.equal(revoked.status, DEVICE_STATUS.REVOKED)
  assert.equal(findDevice(registry, 'dev-1').status, DEVICE_STATUS.REVOKED)
  assert.deepEqual(trustedDevices(registry), [])
})

test('revoking twice is idempotent', () => {
  const paired = upsertDevice(emptyRegistry(), device(), NOW)
  const trusted = confirmDevice(paired, 'dev-1', undefined, NOW)
  const once = revokeDevice(trusted, 'dev-1', LATER)
  const twice = revokeDevice(once.registry, 'dev-1', LATER)
  assert.deepEqual(twice.registry, once.registry)
  assert.equal(twice.revoked.status, DEVICE_STATUS.REVOKED)
})

test('revoking an unknown device is refused', () => {
  assert.throws(() => revokeDevice(emptyRegistry(), 'nope', NOW), /unknown device/)
})

test('a revoked device id cannot be revived by re-pairing', () => {
  // Otherwise revocation could be undone by anyone who reaches the pairing entry
  // point, which would make the operation decorative.
  const paired = upsertDevice(emptyRegistry(), device(), NOW)
  const trusted = confirmDevice(paired, 'dev-1', undefined, NOW)
  const { registry } = revokeDevice(trusted, 'dev-1', LATER)
  assert.throws(
    () => upsertDevice(registry, device({ status: DEVICE_STATUS.TRUSTED }), LATER),
    /cannot be revived/,
  )
})

test('a revoked device can still be removed outright', () => {
  const paired = upsertDevice(emptyRegistry(), device(), NOW)
  const trusted = confirmDevice(paired, 'dev-1', undefined, NOW)
  const { registry } = revokeDevice(trusted, 'dev-1', LATER)
  assert.deepEqual(removeDevice(registry, 'dev-1').devices, [])
})

test('devices stay sorted by id across upserts', () => {
  let registry = emptyRegistry()
  registry = upsertDevice(registry, device({ deviceId: 'dev-b' }), NOW)
  registry = upsertDevice(registry, device({ deviceId: 'dev-a' }), NOW)
  assert.deepEqual(listDevices(registry).map(entry => entry.deviceId), ['dev-a', 'dev-b'])
})

test('the registry is round-trippable through JSON', () => {
  const paired = upsertDevice(emptyRegistry(), device(), NOW)
  const confirmed = confirmDevice(paired, 'dev-1', undefined, NOW)
  const parsed = normalizeRegistry(JSON.parse(JSON.stringify(confirmed)))
  assert.deepEqual(parsed, confirmed)
  assert.equal(parsed.version, REGISTRY_VERSION)
})

test('an empty or missing registry normalizes to a valid one', () => {
  assert.deepEqual(normalizeRegistry(undefined), { version: REGISTRY_VERSION, devices: [] })
  assert.deepEqual(normalizeRegistry({}), { version: REGISTRY_VERSION, devices: [] })
})
