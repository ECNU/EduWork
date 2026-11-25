import assert from 'node:assert/strict'
import test from 'node:test'
import { createPortableMigration } from '../src/portable-migration-upgrade.mjs'

const update = { enabled: true, userEnabled: true, policy: 'stable' }
const installer = { version: '0.4.15' }
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
  for (const failAt of ['reserve', 'download', 'preflight', 'inspect', 'confirm', 'stop', 'write', 'launch', 'success']) {
    const seen = []
    const result = (name, value) => async () => {
      seen.push(name)
      if (name === failAt) {
        if (name === 'confirm') return false
        throw Error(name)
      }
      return value
    }
    const migration = createPortableMigration({ source: {}, discover: async () => installer,
      reserve: result('reserve', () => seen.push('release')), download: result('download', 'installer.exe'),
      preflight: result('preflight', { root: 'source', version: '0.4.14' }), inspectTasks: result('inspect', false), confirm: result('confirm', true),
      stop: result('stop', true), intents: { write: result('write', { id: 'intent' }), remove: () => seen.push('remove') },
      launch: result('launch', true), quit: () => seen.push('quit'), fail: () => seen.push('fail') })
    await migration.check(update)
    migration.dismiss(update)
    assert.equal(migration.state(update).dismissed, true)
    const transaction = migration.start(update)
    await tick()
    await transaction
    if (failAt === 'success') assert.deepEqual(seen, ['reserve', 'download', 'preflight', 'inspect', 'confirm', 'stop', 'write', 'launch', 'quit', 'release'])
    else {
      assert.equal(seen.includes('quit'), false)
      assert.equal(seen.includes('launch'), failAt === 'launch')
      assert.equal(seen.includes('remove'), failAt === 'launch')
      assert.equal(seen.includes('fail'), failAt !== 'confirm')
    }
  }
})
