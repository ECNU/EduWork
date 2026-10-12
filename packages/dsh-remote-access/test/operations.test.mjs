/**
 * The fence's ability to refuse depends on being asked about the right name.
 *
 * These tests are about the join between two lists that must agree: the Host's
 * endpoint names and the operations a device may be granted. A gap between them
 * is not a missing feature, it is an authorization decision made by accident, so
 * every case here asserts a refusal as often as it asserts an allowance.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { OPERATION_TABLE } from '../src/gate.js'
import { DEVICE_STATUS } from '../src/registry.js'
import { ENDPOINT_OPERATIONS, decideEndpoint, isRetryable, operationForEndpoint } from '../src/channel/operations.js'

/** A device holding every operation the table can grant. */
function trustedDevice(overrides = {}) {
  return {
    deviceId: 'device-1',
    status: DEVICE_STATUS.TRUSTED,
    surfaces: { agent: Object.keys(OPERATION_TABLE), host: [] },
    ...overrides,
  }
}

test('真实的宿主端点映射到门禁操作，读写都由门禁裁决', () => {
  assert.equal(operationForEndpoint('session/list'), 'session:list')
  assert.equal(operationForEndpoint('session/page'), 'session:read')
  assert.equal(operationForEndpoint('session/prompt'), 'session:prompt')
  assert.equal(operationForEndpoint('session/cancel'), 'session:cancel')
  assert.equal(operationForEndpoint('workspace/list'), 'workspace:list')
  assert.equal(operationForEndpoint('settings/describe'), 'settings:read')
})

test('映射表里没有指向门禁未知操作的死条目', () => {
  // The mapping is only useful if both lists agree. An entry naming an operation
  // the fence does not know would silently become a refusal at runtime, which
  // reads exactly like a device being denied.
  for (const [endpoint, operation] of Object.entries(ENDPOINT_OPERATIONS)) {
    assert.ok(
      OPERATION_TABLE[operation] !== undefined,
      `endpoint ${endpoint} maps to ${operation}, which the gate table does not list`,
    )
  }
})

test('未列出的端点一律拒绝，不按名字猜', () => {
  for (const endpoint of ['session/create', 'session/rename', 'workspace/delete', 'workspace/archiveSession', 'device/revoke', 'plugin/install', 'terminal/open', 'session/nope', '', '   ']) {
    assert.equal(operationForEndpoint(endpoint), undefined, `${endpoint} must not resolve`)
    assert.deepEqual(
      decideEndpoint(trustedDevice(), endpoint),
      { allowed: false, reason: 'unknown-operation' },
      `${endpoint} must be refused even for a fully granted device`,
    )
  }
})

test('设备先于操作被裁决，未授权设备问不出端点是否存在', () => {
  // The two refusals must be the same shape. If an untrusted device got
  // `unknown-operation` for a nonsense endpoint and `operation-not-granted` for a
  // real one, the pair of answers would be an endpoint oracle.
  const pending = trustedDevice({ status: DEVICE_STATUS.PENDING })
  const revoked = trustedDevice({ status: DEVICE_STATUS.REVOKED })

  for (const device of [pending, revoked]) {
    assert.deepEqual(decideEndpoint(device, 'session/list'), { allowed: false, reason: 'device-not-trusted' })
    assert.deepEqual(decideEndpoint(device, 'session/nope'), { allowed: false, reason: 'unknown-operation' })
  }
  assert.deepEqual(decideEndpoint(undefined, 'session/list'), { allowed: false, reason: 'unknown-device' })
  assert.deepEqual(decideEndpoint(null, 'session/list'), { allowed: false, reason: 'unknown-device' })
})

test('设备没有拿到的那一项被拒，拿到的才放行', () => {
  const narrow = trustedDevice({ surfaces: { agent: ['session:list'], host: [] } })
  assert.equal(decideEndpoint(narrow, 'session/list').allowed, true)
  assert.deepEqual(
    decideEndpoint(narrow, 'session/prompt'),
    { allowed: false, reason: 'operation-not-granted' },
    'a read-only grant must not become a way to drive a turn',
  )
})

test('宿主管理面即使被写进设备记录也到不了', () => {
  // `HOST_SURFACE_ENABLED` is false and `stripHostSurface` exists so this cannot
  // be granted by accident. A record that names a host operation anyway must not
  // be the thing that opens it.
  const withHostGrant = {
    deviceId: 'device-1',
    status: DEVICE_STATUS.TRUSTED,
    surfaces: { agent: Object.keys(OPERATION_TABLE), host: Object.keys(OPERATION_TABLE) },
  }
  for (const endpoint of ['device/revoke', 'plugin/install', 'terminal/open']) {
    assert.equal(decideEndpoint(withHostGrant, endpoint).allowed, false, `${endpoint} must stay closed`)
  }
})

test('只有无副作用的端点可以断线重试', () => {
  // A device may resend a prompt under the same requestId — the Host dedupes it.
  // What it may not do is treat that as licence to resend freely, so the retry
  // set is narrower than the allowed set on purpose.
  assert.equal(isRetryable('session/list'), true)
  assert.equal(isRetryable('session/page'), true)
  assert.equal(isRetryable('settings/describe'), true)
  assert.equal(isRetryable('session/prompt'), false)
  assert.equal(isRetryable('session/cancel'), false)
  assert.equal(isRetryable('session/nope'), false)
})

test('每条放行的判决都带回副作用标记，供调用方决定能否重试', () => {
  for (const endpoint of Object.keys(ENDPOINT_OPERATIONS)) {
    const verdict = decideEndpoint(trustedDevice(), endpoint)
    assert.equal(verdict.allowed, true, `${endpoint} should be reachable by a fully granted device`)
    assert.equal(typeof verdict.sideEffect, 'boolean')
    assert.equal(verdict.sideEffect, !isRetryable(endpoint))
  }
})

test('端点名的空白被容忍，大小写不被猜测', () => {
  assert.equal(operationForEndpoint('  session/list  '), 'session:list')
  assert.equal(operationForEndpoint('Session/List'), undefined)
  assert.equal(operationForEndpoint(undefined), undefined)
  assert.equal(operationForEndpoint(42), undefined)
})
