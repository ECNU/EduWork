import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire, registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import { mkdtemp, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { migrationProgressPage } from '../src/first-run-progress.mjs'
import { firstRunPendingSync } from '../src/first-run.mjs'
import { migrationIntentStore } from '../src/first-run-migration-intent.mjs'

const semver = pathToFileURL(createRequire(new URL('../../scripts/electron-builder/package.json', import.meta.url)).resolve('semver')).href
const hook = registerHooks({ resolve(specifier, context, next) {
  return next(specifier === 'semver' && context.parentURL?.endsWith('/first-run-migration.mjs') ? semver : specifier, context)
} })
const { installedMigrationIntent, resolveInstalledMigration } = await import('../src/first-run-migration.mjs')
hook.deregister()

async function fixture(t) {
  const base = await mkdtemp(join(await realpath(tmpdir()), 'eduwork-migration-decision-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const targetRoot = join(base, 'installed')
  const intent = { id: 'intent', distribution: 'eduwork', sourceRoot: join(base, 'old'), sourceVersion: '0.4.14', installerVersion: '0.4.15' }
  const receipt = { schemaVersion: 2, state: 'imported', intentId: intent.id, distribution: intent.distribution, sourceRoot: intent.sourceRoot }
  const events = []
  const options = { targetRoot, version: '0.4.15', intent, store: { claim: async () => () => {}, remove: id => { events.push(['remove', id]); return true } },
    inspect: async () => ({ root: intent.sourceRoot, version: intent.sourceVersion }),
    useProgress: async run => { events.push('progress'); return run(() => {}) },
    importSource: async args => { events.push(['import', args.intentId]); return receipt },
    conflict: async () => { events.push('conflict'); return false },
    failed: async error => events.push(['error', error.message]),
  }
  return { targetRoot, intent, receipt, events, options }
}

test('only an installed Windows client checks for an intent; IO errors still block startup', () => {
  const denied = () => { throw Object.assign(Error('access denied'), { code: 'EACCES' }) }
  assert.equal(installedMigrationIntent({ platform: 'win32', dataLayout: undefined, openStore: denied }), undefined)
  assert.equal(installedMigrationIntent({ platform: 'darwin', dataLayout: 'installed', openStore: denied }), undefined)
  assert.equal(installedMigrationIntent({ platform: 'win32', dataLayout: 'installed', openStore: () => ({ read: () => null }) }), undefined)
  const error = installedMigrationIntent({ platform: 'win32', dataLayout: 'installed', openStore: () => ({ read: denied }) }).error
  assert.equal(error.code, 'EACCES')
})

test('installed startup quarantines invalid intent and uses its existing data without importing', async t => {
  const { targetRoot, intent: { sourceRoot, distribution } } = await fixture(t)
  const platform = 'win32', dataLayout = 'installed', testRoot = join(targetRoot, '..')
  const store = migrationIntentStore({ testRoot, distribution, platform })
  await mkdir(sourceRoot)
  await mkdir(targetRoot)
  await writeFile(join(sourceRoot, 'existing'), 'portable')
  await writeFile(join(targetRoot, 'existing'), 'installed')
  await writeFile(store.path, '{}')
  assert.equal(installedMigrationIntent({ testRoot, distribution, platform, dataLayout }), undefined)
  assert.equal(firstRunPendingSync({ platform, dataLayout, userRoot: targetRoot }), false)
  const backup = (await readdir(testRoot)).find(name => /^eduwork\.portable-migration\.invalid-\d+.*\.json$/.test(name))
  assert.equal(await readFile(join(testRoot, backup), 'utf8'), '{}')
  assert.equal(await readFile(join(sourceRoot, 'existing'), 'utf8'), 'portable')
  assert.equal(await readFile(join(targetRoot, 'existing'), 'utf8'), 'installed')
  assert.deepEqual(await readdir(sourceRoot), ['existing'])
  assert.deepEqual(await readdir(targetRoot), ['existing'])
})

test('an empty target imports exactly the validated source with progress before removing the matching intent', async t => {
  const { options, events } = await fixture(t)
  assert.equal((await resolveInstalledMigration(options)).action, 'imported')
  assert.deepEqual(events, ['progress', ['import', 'intent'], ['remove', 'intent']])
})

test('an installed downgrade or changed source cannot import or clear the intent', async t => {
  const { options, events } = await fixture(t)
  assert.equal((await resolveInstalledMigration({ ...options, version: '0.4.14' })).action, 'cancel')
  assert.equal((await resolveInstalledMigration({ ...options, inspect: async () => ({ root: options.intent.sourceRoot, version: '0.4.15' }) })).action, 'cancel')
  assert.deepEqual(events.map(entry => entry[0]), ['error', 'error'])
})

test('existing data is untouched on keep or cancel; only keep removes the intent', async t => {
  const { options, targetRoot, events } = await fixture(t)
  await mkdir(targetRoot)
  await writeFile(join(targetRoot, 'existing'), 'unchanged')
  assert.equal((await resolveInstalledMigration(options)).action, 'cancel')
  assert.equal((await resolveInstalledMigration({ ...options, conflict: async () => true })).action, 'relaunch')
  assert.deepEqual(events, ['conflict', ['remove', 'intent']])
  assert.deepEqual(await readdir(targetRoot), ['existing'])
  assert.equal(await readFile(join(targetRoot, 'existing'), 'utf8'), 'unchanged')
})

test('a nonempty target created during copy follows the same decision; never merges', async t => {
  const { options, targetRoot, events } = await fixture(t)
  const importSource = async () => {
    await mkdir(targetRoot)
    await writeFile(join(targetRoot, 'racer'), 'existing')
    throw Error('activation failed')
  }
  assert.equal((await resolveInstalledMigration({ ...options, importSource })).action, 'cancel')
  assert.deepEqual(events, ['progress', 'conflict'])
  assert.deepEqual(await readdir(targetRoot), ['racer'])
})

test('activation receipt resumes only the same intent without reading the source or copying again', async t => {
  const { options, targetRoot, receipt, events } = await fixture(t)
  await mkdir(targetRoot)
  await writeFile(join(targetRoot, '.eduwork-migration.json'), JSON.stringify({ ...receipt, intentId: 'older' }))
  assert.equal((await resolveInstalledMigration(options)).action, 'cancel')
  await writeFile(join(targetRoot, '.eduwork-migration.json'), JSON.stringify(receipt))
  const result = await resolveInstalledMigration({ ...options, inspect: () => assert.fail('source not required after activation') })
  assert.deepEqual(result, { action: 'imported', receipt })
  assert.deepEqual(events, ['conflict', ['remove', 'intent']])
})

test('progress is a labeled native control without a value before copy and after final verification starts', () => {
  assert.match(migrationProgressPage(), /<progress id="progress"><\/progress>/)
  assert.match(migrationProgressPage(), /<label for="progress">/)
  assert.match(migrationProgressPage({ copied: 3, total: 4 }), /<progress id="progress" max="4" value="3">/)
  assert.match(migrationProgressPage({ copied: 4, total: 4 }), /正在验证/)
  assert.doesNotMatch(migrationProgressPage({ copied: 4, total: 4 }), /value=/)
})
