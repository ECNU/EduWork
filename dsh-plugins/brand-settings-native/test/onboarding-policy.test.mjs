import assert from 'node:assert/strict'
import test from 'node:test'
import {
  acknowledgeUpstreamWelcomeNotice,
  UPSTREAM_WELCOME_NOTICE_NAMESPACE,
} from '../lib/onboarding-policy.js'

test('branded composition acknowledges the reviewed upstream welcome notice', async () => {
  let value = {}
  const writes = []
  const settings = {
    get(namespace) {
      assert.equal(namespace, UPSTREAM_WELCOME_NOTICE_NAMESPACE)
      return value
    },
    async update(namespace, patch) {
      assert.equal(namespace, UPSTREAM_WELCOME_NOTICE_NAMESPACE)
      writes.push(patch)
      value = { ...value, ...patch }
    },
  }
  assert.equal(await acknowledgeUpstreamWelcomeNotice(settings, '2026-08-13.1'), true)
  assert.deepEqual(writes, [{ welcomeNoticeVersion: '2026-08-13.1' }])
  assert.equal(await acknowledgeUpstreamWelcomeNotice(settings, '2026-08-13.1'), false)
  assert.equal(writes.length, 1)
})

test('unconfigured or retired upstream notice keeps native behavior', async () => {
  const settings = { get: () => undefined, update: async () => assert.fail('must not write') }
  assert.equal(await acknowledgeUpstreamWelcomeNotice(settings, ''), false)
  assert.equal(await acknowledgeUpstreamWelcomeNotice(settings, '2026-08-13.1', { waitMs: 0 }), false)
})

test('parallel Host composition waits for the official namespace registration', async () => {
  let value
  const settings = {
    get: () => value,
    async update(_namespace, patch) { value = patch },
  }
  setTimeout(() => { value = {} }, 5)
  assert.equal(await acknowledgeUpstreamWelcomeNotice(
    settings, '2026-08-13.1', { waitMs: 100, pollMs: 2 },
  ), true)
  assert.deepEqual(value, { welcomeNoticeVersion: '2026-08-13.1' })
})
