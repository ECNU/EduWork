import assert from 'node:assert/strict'
import test from 'node:test'
import { createPortableMigration } from '../src/portable-migration-upgrade.mjs'

const update = { enabled: true, userEnabled: true, policy: 'stable' }
const installer = { version: '0.4.15', bytes: 200 }
const tick = () => new Promise(resolve => setImmediate(resolve))

test('installer discovery is coalesced, channel-bound and opt-in', async () => {
  let resolve, calls = 0
  const discover = () => { calls++; return new Promise(done => { resolve = done }) }
  assert.equal(createPortableMigration({ source: null, discover }), null)
  const migration = createPortableMigration({ source: {}, discover })
  await migration.check({ ...update, userEnabled: false })
  assert.equal(calls, 0)
  const first = migration.check(update), repeated = migration.check(update)
  assert.equal(calls, 1)
  assert.equal(migration.state({ ...update, policy: 'development' }), undefined)
  resolve(installer)
  await Promise.all([first, repeated])
  assert.equal(migration.state({ ...update, policy: 'development' }), undefined)
  assert.equal(migration.state(update), undefined)
})

test('migration never launches without update admission, confirmation and a strict stop', async () => {
  for (const failAt of ['reserve', 'preflight', 'download', 'recheck', 'inspect', 'confirm', 'stop', 'write', 'launch', 'success']) {
    const seen = []
    const result = (name, value) => async () => {
      seen.push(name)
      if (name === failAt) {
        if (name === 'confirm') return false
        throw Error(name)
      }
      return value
    }
    let preflights = 0
    const migration = createPortableMigration({ source: {}, discover: async () => installer,
      reserve: result('reserve', () => seen.push('release')), download: result('download', 'installer.exe'),
      preflight: () => result(++preflights === 1 ? 'preflight' : 'recheck', { root: 'source', version: '0.4.14' })(),
      inspectTasks: result('inspect', false), confirm: result('confirm', true),
      stop: result('stop', true), intents: { write: result('write', { id: 'intent' }), remove: () => seen.push('remove') },
      launch: result('launch', true), quit: () => seen.push('quit'), fail: () => seen.push('fail') })
    await migration.check(update)
    migration.dismiss(update)
    assert.equal(migration.state(update).dismissed, true)
    const transaction = migration.start(update)
    await tick()
    await transaction
    if (failAt === 'success') assert.deepEqual(seen, ['reserve', 'preflight', 'download', 'recheck', 'inspect', 'confirm', 'stop', 'write', 'launch', 'quit', 'release'])
    else {
      assert.equal(seen.includes('quit'), false)
      assert.equal(seen.includes('launch'), failAt === 'launch')
      assert.equal(seen.includes('remove'), failAt === 'launch')
      assert.equal(seen.includes('fail'), failAt !== 'confirm')
      if (failAt === 'preflight') assert.deepEqual(seen, ['reserve', 'preflight', 'fail', 'release'])
      if (failAt === 'recheck') assert.deepEqual(seen, ['reserve', 'preflight', 'download', 'recheck', 'fail', 'release'])
    }
  }
})

test('download cancellation is silent, unlocks migration and cannot reach strict shutdown', async () => {
  const preflight = Promise.withResolvers(), downloading = Promise.withResolvers()
  let releases = 0, signal
  const migration = createPortableMigration({ source: {}, discover: async () => installer,
    reserve: async () => () => releases++, preflight: () => preflight.promise,
    download: (_, options) => {
      signal = options.signal
      options.onProgress({ stage: 'downloading', downloadedBytes: 50, totalBytes: 200 })
      downloading.resolve()
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    }, inspectTasks: () => assert.fail('do not inspect tasks when cancelled'), fail: () => assert.fail('no error on user cancellation') })
  await migration.check(update)
  const run = migration.start(update)
  await tick()
  const idle = { version: installer.version, bytes: installer.bytes, dismissed: false, busy: false }
  assert.deepEqual(migration.state(update), { ...idle, busy: true, stage: 'preflight', downloadedBytes: 0, totalBytes: 200, cancellable: false })
  migration.cancel(update)
  preflight.resolve()
  await downloading.promise
  assert.deepEqual(migration.state(update), { ...idle, busy: true, stage: 'downloading', downloadedBytes: 50, totalBytes: 200, cancellable: true })
  migration.cancel(update)
  assert.equal(signal.aborted, true)
  assert.equal(migration.state(update).cancellable, false)
  await run
  assert.equal(releases, 1)
  assert.deepEqual(migration.state(update), idle)
})

test('verification and stopping disable cancellation before the transaction advances', async () => {
  const verified = Promise.withResolvers(), recheck = Promise.withResolvers()
  let signal, preflights = 0
  const migration = createPortableMigration({ source: {}, discover: async () => installer,
    reserve: async () => () => {}, preflight: async () => { if (++preflights === 2) await recheck.promise },
    download: (_, options) => {
      signal = options.signal
      options.onProgress({ stage: 'verifying', downloadedBytes: 200, totalBytes: 200 })
      return verified.promise
    }, inspectTasks: () => false, confirm: () => false, fail: error => assert.fail(error.message) })
  await migration.check(update)
  const run = migration.start(update)
  await tick()
  assert.equal(migration.state(update).stage, 'verifying')
  assert.equal(migration.state(update).cancellable, false)
  migration.cancel(update)
  verified.resolve('installer.exe')
  await tick()
  assert.equal(migration.state(update).stage, 'stopping')
  assert.equal(migration.state(update).cancellable, false)
  migration.cancel(update)
  assert.equal(signal.aborted, false)
  recheck.resolve()
  await run
  assert.equal(preflights, 2)
})
