import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { desktopPaths } from '../src/desktop-paths.mjs'
import { migrateDesktopData } from '../src/desktop-data-migration.mjs'
import { initializeUserConfig } from '../src/initialize-user-config.mjs'
import { readMigrationLaunch, importLegacyData } from '../src/legacy-migration.mjs'
import { ConfigurationFile } from '../../dsh-host/configuration-file.mjs'

const save = async (path, text) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text) }
async function fixture(t, platform) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'eduwork-directory-')))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const settings = { distribution: 'eduwork', productVersion: '0.4.2', configurationOwnership: 'user', product: '../product', node: '../runtime/node' }
  const paths = desktopPaths({ userHome: join(directory, 'user'), appData: join(directory, 'Application Support'),
    appRoot: join(directory, platform === 'darwin' ? 'EduWork.app/Contents/Resources/app' : 'installed/resources/app'), platform, settings })
  await mkdir(paths.root, { recursive: true })
  return { directory, paths, settings }
}

for (const platform of ['darwin', 'win32']) test(`${platform} snapshots user state and preserves the complete old copy`, async t => {
  const { paths, settings } = await fixture(t, platform), { legacy } = paths
  const config = '// personal comments\n{"schemaVersion":1,"organizations":[],"updates":{"provider":"disabled"}}\n'
  await save(join(legacy.configRoot, 'eduwork.jsonc'), config)
  await save(join(legacy.configRoot, 'examples/custom.jsonc'), '// example')
  await save(join(legacy.dataRoot, 'dsh/sessions/session.json'), 'synthetic conversation')
  await save(join(legacy.dataRoot, 'dsh/attachments/file.txt'), 'synthetic attachment')
  await save(join(legacy.dataRoot, 'dsh/profiles/desktop-017/cordis.patch.yml'), '[]\n')
  await save(join(legacy.dataRoot, 'dsh/profiles/desktop/legacy.txt'), 'rollback profile')
  await save(join(legacy.dataRoot, 'browser/credentials.encrypted'), 'synthetic encrypted bytes')
  await save(join(legacy.updateDataRoot, 'state/update-preferences.json'), '{"policy":"development"}')
  await save(join(legacy.updateDataRoot, 'configuration/state.json'), JSON.stringify({ schemaVersion: 1,
    configuration: relative(legacy.updateDataRoot, join(legacy.configRoot, 'eduwork.jsonc')).replaceAll('\\', '/'), initialized: true, defaults: null }))
  const zip = join(legacy.updateDataRoot, 'state/updates/downloads/0.4.3/archive.zip')
  await save(zip, 'synthetic archive')
  await save(join(legacy.updateDataRoot, 'state/updates/pending-update.json'), JSON.stringify({ zipPath: zip, installDir: paths.root }))
  await migrateDesktopData(paths)
  assert.equal(await readFile(paths.config, 'utf8'), config)
  assert.equal(await readFile(join(paths.userRoot, 'examples/custom.jsonc'), 'utf8'), '// example')
  assert.equal(await readFile(join(paths.home, 'sessions/session.json'), 'utf8'), 'synthetic conversation')
  assert.equal(await readFile(join(paths.home, 'attachments/file.txt'), 'utf8'), 'synthetic attachment')
  assert.equal(await readFile(join(paths.userData, 'credentials.encrypted'), 'utf8'), 'synthetic encrypted bytes')
  assert.equal(await readFile(join(paths.home, 'profiles/desktop-native/cordis.patch.yml'), 'utf8'), '[]\n')
  assert.equal(await readFile(join(paths.home, 'profiles/desktop/legacy.txt'), 'utf8'), 'rollback profile')
  assert.equal(await readFile(join(legacy.dataRoot, 'dsh/profiles/desktop-017/cordis.patch.yml'), 'utf8'), '[]\n')
  const state = await new ConfigurationFile(paths.config, paths.updateDataRoot).open()
  assert.equal(state.state.initialized, true)
  const pending = JSON.parse(await readFile(join(paths.updateDataRoot, 'state/updates/pending-update.json')))
  assert.equal(pending.zipPath, join(paths.updateDataRoot, 'state/updates/downloads/0.4.3/archive.zip'))
  assert.equal(pending.installDir, paths.root)
  const health = join(paths.updateDataRoot, `state/updates/transactions/${settings.productVersion}/health.ok`)
  await mkdir(dirname(health), { recursive: true })
  assert.equal((await readMigrationLaunch({ ...paths, dataRoot: paths.updateDataRoot, settings, argv: ['--update-health-file', health] })).healthFile, health)
  await save(paths.config, '{"schemaVersion":1,"features":{"maxConcurrentRequests":7}}')
  await save(join(legacy.configRoot, 'eduwork.jsonc'), 'changed old file')
  await migrateDesktopData(paths)
  assert.match(await readFile(paths.config, 'utf8'), /maxConcurrentRequests/)
})

test('a failed snapshot never publishes a partial directory and can retry', async t => {
  const { paths } = await fixture(t, 'win32')
  await save(join(paths.legacy.configRoot, 'eduwork.jsonc'), '{"schemaVersion":1}')
  await save(join(paths.legacy.updateDataRoot, 'configuration/state.json'), '{"configuration":"wrong"}')
  await assert.rejects(migrateDesktopData(paths), /不匹配/)
  await assert.rejects(readdir(paths.userRoot), { code: 'ENOENT' })
  assert.ok((await readFile(join(paths.legacy.configRoot, 'eduwork.jsonc'), 'utf8')).includes('schemaVersion'))
  await rm(join(paths.legacy.updateDataRoot, 'configuration/state.json'))
  await migrateDesktopData(paths)
  assert.ok((await readFile(paths.config, 'utf8')).includes('schemaVersion'))
})

test('new installations initialize only the selected bundled template', async t => {
  const { paths } = await fixture(t, 'win32')
  await save(join(paths.product, 'resources/desktop/eduwork.jsonc'), '{"schemaVersion":1}')
  await save(join(paths.product, 'resources/desktop/examples/example.jsonc'), '// template')
  await migrateDesktopData(paths)
  await initializeUserConfig(paths)
  assert.equal(await readFile(paths.config, 'utf8'), '{"schemaVersion":1}')
  await save(paths.config, '// user\n{"schemaVersion":1}')
  await initializeUserConfig(paths)
  assert.match(await readFile(paths.config, 'utf8'), /user/)
})

test('links within copied DSH state point to the new home without following external links', { skip: process.platform === 'win32' }, async t => {
  const { paths } = await fixture(t, 'darwin')
  await save(join(paths.legacy.dataRoot, 'dsh/skills/example/SKILL.md'), 'synthetic skill')
  await symlink(join(paths.legacy.dataRoot, 'dsh/skills/example'), join(paths.legacy.dataRoot, 'dsh/linked-skill'))
  await migrateDesktopData(paths)
  await rm(paths.legacy.dataRoot, { recursive: true })
  assert.equal(await readFile(join(paths.home, 'linked-skill/SKILL.md'), 'utf8'), 'synthetic skill')
})

test('old updater handoffs can import into the authenticated user tree', async t => {
  const { paths, settings } = await fixture(t, 'win32')
  const sourceHome = join(paths.root, 'data/dsh')
  await save(join(sourceHome, 'sessions/a.json'), 'synthetic session')
  const transaction = join(paths.root, `data/state/updates/transactions/${settings.productVersion}`)
  const file = join(transaction, 'migration.json'), health = join(transaction, 'health.ok')
  await save(file, JSON.stringify({ schemaVersion: 1, kind: 'legacy-wails-v1', version: settings.productVersion, distribution: settings.distribution, sourceHome }))
  const launch = await readMigrationLaunch({ root: paths.root, settings, argv: ['--eduwork-migration', file, '--update-health-file', health] })
  await mkdir(paths.userRoot, { recursive: true })
  await importLegacyData({ root: paths.root, targetRoot: paths.userRoot, targetHome: paths.home, launch })
  assert.equal(await readFile(join(paths.home, 'sessions/a.json'), 'utf8'), 'synthetic session')
})


test('managed metadata links cannot rewrite the retained original', { skip: process.platform === 'win32' }, async t => {
  const { directory, paths } = await fixture(t, 'darwin')
  const outside = join(directory, 'retained-state.json'), original = '{"configuration":"original"}'
  await save(outside, original)
  await mkdir(join(paths.legacy.updateDataRoot, 'configuration'), { recursive: true })
  await symlink(outside, join(paths.legacy.updateDataRoot, 'configuration/state.json'))
  await assert.rejects(migrateDesktopData(paths), /包含链接/)
  assert.equal(await readFile(outside, 'utf8'), original)
  await assert.rejects(readdir(paths.userRoot), { code: 'ENOENT' })
})
