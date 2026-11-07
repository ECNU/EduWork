import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { migratePortableToInstalled } from '../src/portable-migration.mjs'
import { confirmInstalledMigration, installedDataNeedsSetup, migrationRelaunchArgs, migrationSourceArgument,
  prepareInstalledData, readInstalledMigration, recordInstalledMigrationStartup, rememberPortableSource } from '../src/installed-migration.mjs'

const write = async (path, value) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value)) }
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const missing = path => assert.rejects(access(path), { code: 'ENOENT' })

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-first-install-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const sourceRoot = join(root, 'portable'), programRoot = join(root, 'installed'), writableRoot = join(root, 'userdata/example')
  const source = { schemaVersion: 1, shell: 'electron', distribution: 'example', appId: 'org.eduwork.example.electron',
    productVersion: '0.4.12', product: '../product', node: '../runtime/node.exe' }
  const settings = { ...source, dataLayout: 'installed', productVersion: '0.4.12-dev.20261107.1', productName: 'Synthetic EduWork' }
  for (const [directory, identity] of [[sourceRoot, source], [programRoot, settings]]) {
    await write(join(directory, 'resources/app/eduwork.desktop.json'), identity)
    await write(join(directory, 'release.json'), { version: identity.productVersion, dshVersion: '0.2.2-rc.1', dshCommit: '1'.repeat(40), nodeVersion: 'v24.22.1',
      ...(directory === programRoot ? { portableMigration: { schemaVersion: 1, dshCommit: '1'.repeat(40), sourceVersions: ['0.4.12'] } } : {}) })
    await write(join(directory, 'version'), '44.0.0')
    await write(join(directory, 'resources/product/assembly.json'), { distribution: 'example', dshCommit: '1'.repeat(40),
      externalPackages: [{ name: '@eduwork/dsh-memory', version: '0.2.1', tarballSHA256: 'a'.repeat(64) }] })
    await write(join(directory, 'RELEASE-MANIFEST.json'), { schemaVersion: 1, kind: 'eduwork-portable-release',
      version: identity.productVersion, distribution: 'example', shell: 'electron', platform: 'windows-x64',
      files: [{ path: 'resources/app/eduwork.desktop.json' }, { path: 'config/eduwork.jsonc' }] })
  }
  await write(join(programRoot, 'resources/product/resources/desktop/eduwork.jsonc'), '{"schemaVersion":1}')
  await write(join(sourceRoot, 'config/eduwork.jsonc'), '{"schemaVersion":1,"features":{"maxConcurrentRequests":2}}')
  await write(join(sourceRoot, 'config/custom.json'), { retained: true })
  const home = 'data/example-electron/dsh'
  await write(join(sourceRoot, home, 'sessions/project/session/log.jsonl'), '{"synthetic":true}\n')
  const db = new DatabaseSync(join(sourceRoot, home, 'memory.sqlite3'))
  db.exec("CREATE TABLE tombstones (id TEXT); INSERT INTO tombstones VALUES ('forgotten'); CREATE TABLE session_policies (id TEXT, enabled INTEGER); INSERT INTO session_policies VALUES ('private',0)")
  db.close()
  await write(join(sourceRoot, 'data/example-electron/browser/credentials.encrypted'), 'synthetic encrypted bytes')
  await write(join(sourceRoot, 'data/example-electron/browser/Local State'), '{}')
  await write(join(sourceRoot, 'data/configuration/state.json'), { schemaVersion: 1, configuration: '../config/eduwork.jsonc', initialized: true, trial: null })
  await write(join(sourceRoot, 'data/content-updates/scope/state.json'), { schemaVersion: 1, highest: 4, active: {}, pending: null, trial: null })
  await write(join(sourceRoot, 'data/publisher-bootstrap/scope/eduwork.jsonc'), '{}')
  await write(join(sourceRoot, 'data/state/update-channel-040.json'), { schemaVersion: 1, decision: 'kept' })
  const options = { programRoot, writableRoot, settings,
    choose: async () => ({ action: 'import', sourceRoot }), preview: async () => true,
    migrate: input => migratePortableToInstalled({ ...input, listProcesses: async () => [] }) }
  return { root, sourceRoot, programRoot, writableRoot, settings, options,
    pending: join(dirname(writableRoot), '.example-portable-migration.json'),
    run: changes => prepareInstalledData({ ...options, ...changes }) }
}

test('first-run preview cancels without initializing W or changing the portable source', async t => {
  const f = await fixture(t)
  const result = await f.run({ preview: async plan => { assert(plan.files.some(file => file.target === 'config/custom.json')); return false } })
  assert.equal(result.action, 'quit')
  await missing(f.writableRoot); await missing(f.pending)
  assert.equal((await json(join(f.sourceRoot, 'config/custom.json'))).retained, true)
})

test('a supplied portable request can be declined for fresh data, including interrupted initialization', async t => {
  const f = await fixture(t)
  await rememberPortableSource(f)
  await assert.rejects(f.run({ choose: async () => ({ action: 'fresh' }), initialize: async () => { throw new Error('synthetic initialization failure') } }), /initialization failure/)
  assert.equal((await json(f.pending)).phase, 'fresh')
  await access(f.sourceRoot); await missing(f.writableRoot)
  const result = await f.run({ choose: () => { throw new Error('fresh choice must survive restart') } })
  assert.equal(result.migrated, false)
  await access(f.sourceRoot); await missing(f.pending)
  assert.equal(await readFile(join(f.writableRoot, 'config/eduwork.jsonc'), 'utf8'), '{"schemaVersion":1}')
})

test('an invalid pending record remains untouched and never initializes data', async t => {
  const f = await fixture(t)
  await write(f.pending, 'false')
  await assert.rejects(f.run(), /格式无效/)
  assert.equal(await readFile(f.pending, 'utf8'), 'false')
  await missing(f.writableRoot); await access(f.sourceRoot)
})

test('portable data reaches W before normal startup; startup and user acceptance remain distinct', async t => {
  const f = await fixture(t), progress = []
  const result = await f.run({ onProgress: value => progress.push(value) })
  assert.equal(result.action, 'relaunch')
  assert.equal(result.migrated, true)
  assert.equal(result.receipt.state, 'activated')
  await missing(f.sourceRoot); await access(result.receipt.source.handoffRoot); await missing(f.pending)
  assert.equal(progress.at(-1).copied, progress.at(-1).total)
  assert.equal((await json(join(f.writableRoot, 'data/configuration/state.json'))).initialized, true)
  assert.equal((await json(join(f.writableRoot, 'data/content-updates/scope/state.json'))).highest, 4)
  assert.equal((await json(join(f.writableRoot, 'config/custom.json'))).retained, true)
  const db = new DatabaseSync(join(f.writableRoot, 'data/example-electron/dsh/memory.sqlite3'), { readOnly: true })
  try { assert.equal(db.prepare('SELECT id FROM tombstones').get().id, 'forgotten'); assert.equal(db.prepare('SELECT enabled FROM session_policies').get().enabled, 0) }
  finally { db.close() }
  await assert.rejects(recordInstalledMigrationStartup({ ...f, distribution: 'example', verifyCredentials: async () => { throw new Error('synthetic decryption failed') } }), /decryption failed/)
  assert.equal((await readInstalledMigration(f.writableRoot, 'example')).state, 'activated')
  await assert.rejects(confirmInstalledMigration(f.writableRoot, 'example'), /成功启动/)
  let decryptions = 0
  await recordInstalledMigrationStartup({ ...f, distribution: 'example', verifyCredentials: async () => { decryptions++ } })
  assert.equal(decryptions, 1)
  assert.equal((await readInstalledMigration(f.writableRoot, 'example')).state, 'started')
  assert.equal((await confirmInstalledMigration(f.writableRoot, 'example')).state, 'verified')
  await access(result.receipt.source.handoffRoot)
  assert.equal(await installedDataNeedsSetup(f.writableRoot, f.settings), false)
  assert.equal((await f.run({ choose: assert.fail })).action, 'continue')
})

test('fresh install initializes the package template only after an explicit choice', async t => {
  const f = await fixture(t)
  assert.equal((await f.run({ choose: async () => null })).action, 'quit')
  await missing(f.writableRoot)
  const result = await f.run({ choose: async () => ({ action: 'fresh' }), migrate: assert.fail })
  assert.equal(result.action, 'relaunch')
  assert.equal(result.migrated, false)
  assert.equal((await json(join(f.writableRoot, 'config/eduwork.jsonc'))).schemaVersion, 1)
  await access(f.sourceRoot)
  await assert.rejects(f.run({ sourceRoot: f.sourceRoot }), /已有个人数据/)
})

test('failed copies preserve the source and retain a recoverable first-run pointer', async t => {
  const f = await fixture(t)
  await assert.rejects(f.run({ migrate: options => migratePortableToInstalled({ ...options, listProcesses: async () => [],
    copyFileImpl: async () => { throw new Error('synthetic copy failure') } }) }), /synthetic copy failure/)
  await access(f.sourceRoot); await missing(f.writableRoot)
  assert.equal((await json(f.pending)).sourceRoot, f.sourceRoot)
  const result = await f.run({ choose: async value => {
    assert.equal(value.recovering, true); assert.equal(value.sourceRoot, f.sourceRoot)
    return { action: 'import', sourceRoot: value.sourceRoot }
  } })
  assert.equal(result.migrated, true)
  await missing(f.pending)
})

test('an unknown existing W, mismatched recovery pointer, and a second concurrent setup cannot overwrite data', async t => {
  const f = await fixture(t)
  await write(join(f.writableRoot, 'keep.txt'), 'keep')
  await assert.rejects(f.run({ choose: assert.fail }), /没有有效归属/)
  assert.equal(await readFile(join(f.writableRoot, 'keep.txt'), 'utf8'), 'keep')
  await rm(f.writableRoot, { recursive: true })
  await write(f.pending, { schemaVersion: 1, distribution: 'different' })
  await assert.rejects(f.run({ choose: assert.fail }), /不匹配/)
  await rm(f.pending)
  let enter, finish
  const entered = new Promise(resolve => { enter = resolve })
  const first = f.run({ choose: () => { enter(); return new Promise(resolve => { finish = resolve }) } })
  await entered
  await assert.rejects(f.run(), /另一个窗口/)
  finish(null); await first
})

test('migration source arguments are bounded, explicit, and removed from subsequent restarts', () => {
  const source = join(tmpdir(), 'portable')
  const args = ['--other', '--eduwork-migrate-source', source, '--last']
  assert.equal(migrationSourceArgument(args), source)
  assert.deepEqual(migrationRelaunchArgs(args), ['--other', '--last'])
  assert.throws(() => migrationSourceArgument(['--eduwork-migrate-source', 'relative']), /无效/)
  assert.throws(() => migrationSourceArgument([...args, '--eduwork-migrate-source', source]), /无效/)
})
