import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DENY_REASONS,
  HOST_SURFACE_ENABLED,
  OPERATION_TABLE,
  SURFACE_HOST,
  decide,
  grantedOperations,
  isAllowed,
  stripHostSurface,
} from '../src/gate.js'
import { DEFAULT_AGENT_SURFACE, DEFAULT_HOST_SURFACE, DEVICE_STATUS, confirmDevice, emptyRegistry, upsertDevice } from '../src/registry.js'

const NOW = '2026-10-09T12:00:00.000Z'

function trustedDevice(overrides = {}) {
  const paired = upsertDevice(emptyRegistry(), {
    deviceId: 'dev-1',
    publicKey: 'cHVibGljLWtleQ',
    name: '测试手机',
    status: DEVICE_STATUS.PENDING,
  }, NOW)
  const confirmed = confirmDevice(paired, 'dev-1', undefined, NOW)
  const [device] = confirmed.devices
  return { ...device, ...overrides }
}

test('an unknown device is refused', () => {
  assert.deepEqual(decide(undefined, 'session:list'), { allowed: false, reason: DENY_REASONS.UNKNOWN_DEVICE })
  assert.deepEqual(decide(null, 'session:list'), { allowed: false, reason: DENY_REASONS.UNKNOWN_DEVICE })
})

test('a pending device is refused', () => {
  // Seen is not trusted: a device that reached the pairing endpoint but was
  // never confirmed on this machine gets nothing.
  const device = trustedDevice({ status: DEVICE_STATUS.PENDING })
  assert.deepEqual(decide(device, 'session:list'), { allowed: false, reason: DENY_REASONS.NOT_TRUSTED })
  assert.equal(isAllowed(device, 'session:list'), false)
})

test('a revoked device is refused', () => {
  const device = trustedDevice({ status: DEVICE_STATUS.REVOKED })
  assert.deepEqual(decide(device, 'session:list'), { allowed: false, reason: DENY_REASONS.NOT_TRUSTED })
})

test('an unknown operation is refused', () => {
  const device = trustedDevice()
  for (const operation of ['session:delete', 'admin:everything', '', '   ', undefined, 42, null]) {
    assert.equal(isAllowed(device, operation), false, `${String(operation)} must be refused`)
  }
})

test('a granted operation is allowed and reports whether it mutates', () => {
  const device = trustedDevice()
  assert.deepEqual(decide(device, 'session:list'), {
    allowed: true,
    operation: 'session:list',
    surface: 'agent',
    sideEffect: false,
  })
  assert.deepEqual(decide(device, 'session:prompt'), {
    allowed: true,
    operation: 'session:prompt',
    surface: 'agent',
    sideEffect: true,
  })
})

test('mutating operations are flagged so retries can be deduplicated', () => {
  // "Reconnecting does not repeat an operation" is implemented against this
  // flag, so a mutating operation that forgets it silently loses the guarantee.
  const mutating = ['session:prompt', 'session:cancel']
  for (const operation of mutating) {
    assert.equal(OPERATION_TABLE[operation].sideEffect, true, `${operation} must be marked as mutating`)
  }
  const reading = ['session:list', 'session:read', 'workspace:list', 'workspace:read', 'artifact:read']
  for (const operation of reading) {
    assert.equal(OPERATION_TABLE[operation].sideEffect, false, `${operation} must not be marked as mutating`)
  }
})

test('an operation outside the grant is refused', () => {
  const device = trustedDevice({ surfaces: { agent: ['session:list'], host: [] } })
  assert.equal(isAllowed(device, 'session:list'), true)
  assert.deepEqual(decide(device, 'session:prompt'), { allowed: false, reason: DENY_REASONS.NOT_GRANTED })
})

test('a device with an empty agent grant can do nothing', () => {
  const device = trustedDevice({ surfaces: { agent: [], host: [] } })
  assert.deepEqual(grantedOperations(device), [])
})

test('the remote host surface is narrow even when the record lists more', () => {
  // The record is not allowed to be the last word. Enabling the host surface for
  // the remote workspace picker does not open pairing, credentials, plugins or
  // terminals: the code-level allowlist is the upper bound.
  assert.equal(HOST_SURFACE_ENABLED, true)
  const device = trustedDevice({
    surfaces: {
      agent: ['session:list'],
      host: ['directory:list', 'workspace:create', 'device:list', 'device:revoke', 'credential:read'],
    },
  })
  assert.equal(isAllowed(device, 'directory:list'), true)
  assert.equal(isAllowed(device, 'workspace:create'), true)
  for (const operation of ['device:list', 'device:confirm', 'device:revoke', 'invitation:create', 'credential:read', 'plugin:install', 'terminal:open']) {
    assert.equal(isAllowed(device, operation), false, `${operation} must stay unreachable`)
  }
  assert.equal(isAllowed(device, 'session:list'), true, 'the agent surface still works')
})

test('credential, plugin and terminal operations are all on the host surface', () => {
  // If one of these were filed under `agent` it would become reachable the
  // moment a device is confirmed, which is exactly the escalation to avoid.
  for (const operation of ['credential:read', 'credential:write', 'plugin:install', 'plugin:uninstall', 'terminal:open']) {
    assert.equal(OPERATION_TABLE[operation].surface, SURFACE_HOST, `${operation} must sit on the host surface`)
  }
})

test('stripHostSurface removes the host grant and keeps the agent one', () => {
  const stripped = stripHostSurface({ agent: ['session:list'], host: ['device:revoke'] })
  assert.deepEqual(stripped, { agent: ['session:list'], host: [] })
})

test('a confirmed device gets exactly the default surfaces', () => {
  const device = trustedDevice()
  assert.deepEqual(grantedOperations(device), [...DEFAULT_AGENT_SURFACE, ...DEFAULT_HOST_SURFACE].sort())
})

test('grantedOperations is empty for anything not trusted', () => {
  assert.deepEqual(grantedOperations({ status: DEVICE_STATUS.PENDING, surfaces: { agent: ['session:list'] } }), [])
  assert.deepEqual(grantedOperations(undefined), [])
})

test('a device record with a missing surfaces field is refused rather than throwing', () => {
  const device = { deviceId: 'dev-1', status: DEVICE_STATUS.TRUSTED }
  assert.deepEqual(decide(device, 'session:list'), { allowed: false, reason: DENY_REASONS.NOT_GRANTED })
  assert.deepEqual(grantedOperations(device), [])
})

test('surrounding whitespace in an operation name is tolerated', () => {
  const device = trustedDevice()
  assert.equal(isAllowed(device, '  session:list  '), true)
})

test('every entry in the operation table names a known surface', () => {
  for (const [operation, entry] of Object.entries(OPERATION_TABLE)) {
    assert.ok(['agent', 'host'].includes(entry.surface), `${operation} names an unknown surface`)
    assert.equal(typeof entry.sideEffect, 'boolean', `${operation} must declare sideEffect`)
  }
})
