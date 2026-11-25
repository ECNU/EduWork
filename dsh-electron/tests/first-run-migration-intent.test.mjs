import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrationIntentStore } from '../src/first-run-migration-intent.mjs'

test('a distribution has one atomic intent and another id cannot remove it', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-intent-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = migrationIntentStore({ localAppData: root, distribution: 'eduwork', platform: 'win32' })
  assert.equal(store.read(), null)
  const values = { sourceRoot: join(root, 'source'), sourceVersion: '0.4.14', installerVersion: '0.4.15' }
  const results = await Promise.allSettled([store.write(values), store.write(values)])
  const [success] = results.filter(row => row.status === 'fulfilled')
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1)
  assert.deepEqual(store.read(), success.value)
  assert.equal(store.remove(randomUUID()), false)
  assert.deepEqual(store.read(), success.value)
  assert.equal(store.remove(success.value.id), true)
  assert.equal(store.read(), null)
})

test('test roots are isolated; malformed or linked intents cannot auto-import', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-intent-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = migrationIntentStore({ localAppData: root, testRoot: join(root, 'fixture'), distribution: 'eduwork', platform: 'win32' })
  assert.equal(migrationIntentStore({ localAppData: '', platform: 'darwin' }), null)
  assert.throws(() => migrationIntentStore({ localAppData: root, distribution: '../other', platform: 'win32' }))
  await mkdir(join(root, 'fixture'), { recursive: true })
  await writeFile(store.path, '{}')
  assert.throws(() => store.read(), /意图/)
  assert.throws(() => store.remove(randomUUID()), /意图/)
  assert.equal(await readFile(store.path, 'utf8'), '{}')
  await rm(store.path)
  await symlink(root, store.path, 'junction')
  assert.throws(() => store.read(), /意图/)
  assert.equal(migrationIntentStore({ localAppData: root, distribution: 'eduwork', platform: 'win32' }).read(), null)
})
