import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { loadUserConfig } from '../../dsh-host/user-config.mjs'
import { createDesktopBackup, desktopBackupLayout, hasPendingDesktopRestore, previewDesktopRestore,
  recoverDesktopRestore, restoreDesktopBackup } from '../src/desktop-backup.mjs'
import { desktopPaths } from '../src/desktop-paths.mjs'

const settings = { appId: 'org.eduwork.eduwork.electron', distribution: 'eduwork', productVersion: '0.4.13', product: '../product', node: '../node' }
const assembly = { distribution: 'eduwork', dshVersion: '0.2.2', dshCommit: 'a'.repeat(40),
  externalPackages: [{ name: '@eduwork/test-package', version: '1.0.0', tarballSHA256: 'b'.repeat(64) }] }
const config = '{"schemaVersion":1}'
const platform = process.platform === 'win32' ? 'win32' : 'darwin'
const restore = (layout, preview) => restoreDesktopBackup(layout, preview.folder, preview.signature, { validateConfiguration: loadUserConfig })

async function put(file, text) {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, text)
}
async function fixture(t) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'eduwork-backup-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  async function desktop(name, initialized = true) {
    const appRoot = join(root, name, platform === 'win32' ? 'resources/app' : 'EduWork.app/Contents/Resources/app')
    const paths = desktopPaths({ appRoot, appData: join(root, name, 'Library'), platform, settings })
    const layout = desktopBackupLayout(paths, settings, assembly, { platform })
    await mkdir(paths.userData, { recursive: true })
    if (initialized) await put(paths.config, config)
    return { paths, layout }
  }
  const destination = join(root, 'backup storage')
  await mkdir(destination)
  return { root, destination, desktop }
}

test('round trip keeps owned history and attachments, previews external paths and preserves replaced data', async t => {
  const { root, desktop, destination } = await fixture(t)
  const { layout, paths } = await desktop('source')
  const external = join(root, 'project')
  await put(join(external, 'private.txt'), 'external project contents')
  await put(join(paths.home, 'sessions/abc/events.jsonl'), '{"attachment":"xyz"}')
  const attachment = join(paths.home, 'attachments/v1/xyz')
  await put(attachment, 'attachment body')
  if (process.platform !== 'win32') await chmod(attachment, 0o644)
  await put(join(paths.home, 'settings.yaml'), 'preferences: true\n')
  await put(join(paths.home, 'skills/example/SKILL.md'), 'synthetic skill')
  await put(join(paths.home, 'skills/example/tool.sh'), '#!/bin/sh\nexit 0\n')
  if (process.platform !== 'win32') await chmod(join(paths.home, 'skills/example/tool.sh'), 0o755)
  await put(join(paths.home, '.credentials.yaml'), 'excluded old credential')
  await put(join(paths.home, '.env'), 'KEY=synthetic-source')
  await put(join(paths.home, 'profiles/desktop-017/.npmrc'), '//example.invalid/:_authToken=synthetic-source')
  await put(join(paths.userData, 'credentials.encrypted'), 'excluded desktop vault')
  await put(layout.targets.appearance, '{"style":"dsh"}')
  await put(layout.targets.pet, '{"visible":false}')
  await put(layout.targets.updatePreferences, '{"schemaVersion":1,"policy":"stable"}')
  const internal = join(paths.home, 'imported-workspaces/internal')
  await put(join(internal, 'workspace.txt'), 'owned project contents')
  const missing = join(root, 'old machine', 'lost')
  await put(join(paths.home, 'storages/workspace.json'), JSON.stringify({
    tables: { workspaces: { kept: { path: external }, missing: { path: missing }, internal: { path: internal } } },
  }))
  const exported = await createDesktopBackup(layout, destination)
  if (process.platform !== 'win32') await chmod(join(exported.folder, 'data/dsh/skills/example/tool.sh'), 0o644)
  const { layout: target, paths: targetPaths } = await desktop('target')
  await put(join(targetPaths.home, 'sessions/original'), 'prior session')
  await put(join(targetPaths.home, '.credentials.yaml'), 'prior local credential')
  await put(join(targetPaths.home, '.env'), 'KEY=synthetic-target')
  await put(join(targetPaths.home, 'profiles/desktop-017/.npmrc'), '//example.invalid/:_authToken=synthetic-target')
  await put(join(targetPaths.userData, 'credentials.encrypted'), 'target vault')
  await put(target.targets.softwareUpdatePreferences, 'previous update preference')
  const preview = await previewDesktopRestore(target, exported.folder)
  assert.equal(preview.files, exported.files)
  assert.deepEqual(preview.workspaces, [{ path: external, missing: false }, { path: missing, missing: true }, { path: internal, missing: false }])
  assert.ok(!preview.manifest.entries.some(row => /credential|private\.txt|\.env|\.npmrc/u.test(row.path)))
  if (process.platform !== 'win32') assert.equal((await stat(join(exported.folder, 'data/dsh/attachments/v1/xyz'))).mode & 0o777, 0o600)
  const result = await restore(target, preview)
  assert.equal(result.restored, true)
  assert.equal(await readFile(join(targetPaths.home, 'sessions/abc/events.jsonl'), 'utf8'), '{"attachment":"xyz"}')
  assert.equal(await readFile(join(targetPaths.home, 'attachments/v1/xyz'), 'utf8'), 'attachment body')
  assert.equal(await readFile(join(targetPaths.home, 'imported-workspaces/internal/workspace.txt'), 'utf8'), 'owned project contents')
  assert.equal(await readFile(join(result.previous, 'dsh/sessions/original'), 'utf8'), 'prior session')
  assert.equal(await readFile(join(result.previous, 'dsh/.credentials.yaml'), 'utf8'), 'prior local credential')
  assert.equal(await readFile(join(targetPaths.home, '.credentials.yaml'), 'utf8'), 'prior local credential')
  assert.equal(await readFile(join(targetPaths.home, '.env'), 'utf8'), 'KEY=synthetic-target')
  assert.match(await readFile(join(targetPaths.home, 'profiles/desktop-017/.npmrc'), 'utf8'), /synthetic-target/u)
  assert.equal(await readFile(join(targetPaths.userData, 'credentials.encrypted'), 'utf8'), 'target vault')
  if (process.platform !== 'win32') assert.equal((await stat(join(targetPaths.home, 'skills/example/tool.sh'))).mode & 0o777, 0o700)
  assert.equal(await readFile(target.targets.appearance, 'utf8'), '{"style":"dsh"}')
  assert.equal(await readFile(target.targets.pet, 'utf8'), '{"visible":false}')
  assert.equal(await readFile(target.targets.updatePreferences, 'utf8'), '{"schemaVersion":1,"policy":"stable"}')
  await assert.rejects(stat(target.targets.softwareUpdatePreferences), { code: 'ENOENT' })
  assert.equal(await readFile(join(result.previous, 'softwareUpdatePreferences'), 'utf8'), 'previous update preference')
  assert.equal(await hasPendingDesktopRestore(targetPaths), false)
})

test('clean target accepts a compatible backup, rejecting a modified file or mismatched component first', async t => {
  const { desktop, destination } = await fixture(t)
  const source = await desktop('source'), target = await desktop('target', false)
  await put(join(source.paths.home, 'settings.yaml'), 'good data')
  const { folder } = await createDesktopBackup(source.layout, destination)
  await assert.rejects(previewDesktopRestore({ ...target.layout, identity: { ...target.layout.identity, components: ['different'] } }, folder), /不兼容/u)
  const payload = join(folder, 'data/dsh/settings.yaml')
  await writeFile(payload, 'bad bytes')
  await assert.rejects(previewDesktopRestore(target.layout, folder), /清单不一致/u)
  await assert.rejects(stat(target.paths.config), { code: 'ENOENT' })
  await writeFile(payload, 'good data')
  await restore(target.layout, await previewDesktopRestore(target.layout, folder))
  assert.equal(await readFile(target.paths.config, 'utf8'), config)
})

test('refuses symlinked data and destinations inside active data', async t => {
  const { root, desktop, destination } = await fixture(t)
  const { layout, paths } = await desktop('source')
  await mkdir(paths.home)
  await assert.rejects(createDesktopBackup(layout, paths.home), /个人数据目录外/u)
  const other = join(root, 'unowned')
  await put(join(other, 'sensitive.txt'), 'do not copy')
  await symlink(other, join(paths.home, 'unowned'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(createDesktopBackup(layout, destination), /存在链接/u)
  assert.deepEqual(await readdir(destination), [])
})

test('software update state and changes after preview block restore without touching current data', async t => {
  const { desktop, destination } = await fixture(t)
  const source = await desktop('source'), target = await desktop('target')
  const { folder } = await createDesktopBackup(source.layout, destination)
  const pending = join(target.paths.updateDataRoot, 'state/updates/pending-update.json')
  await put(pending, '{}')
  await assert.rejects(previewDesktopRestore(target.layout, folder), /挂起的软件更新/u)
  await rm(pending)
  const preview = await previewDesktopRestore(target.layout, folder)
  await put(join(target.paths.home, 'new session'), 'written after preview')
  await assert.rejects(restore(target.layout, preview), /重新预览/u)
  assert.equal(await readFile(join(target.paths.home, 'new session'), 'utf8'), 'written after preview')
})

test('next startup rolls back interruption between root replacements without losing either copy', async t => {
  const { desktop } = await fixture(t)
  const { layout, paths } = await desktop('target')
  const id = randomUUID(), base = join(layout.history, id)
  const previous = join(base, 'previous'), staged = join(base, 'staged')
  await mkdir(previous, { recursive: true })
  await mkdir(staged)
  await put(join(paths.home, 'session'), 'prior history')
  await rename(layout.targets.configuration, join(previous, 'configuration'))
  await rename(layout.targets.dsh, join(previous, 'dsh'))
  await put(paths.config, '{"schemaVersion":1,"desktop":{"closeAction":"exit"}}')
  await put(join(staged, 'dsh/session'), 'incoming history')
  await put(join(layout.history, 'pending.json'), JSON.stringify({
    schemaVersion: 1, id, appId: layout.identity.appId, phase: 'switching',
    original: ['configuration', 'dsh'], incoming: ['configuration', 'dsh'],
  }))
  assert.equal(await hasPendingDesktopRestore(paths), true)
  assert.equal((await recoverDesktopRestore(layout)).restored, false)
  assert.equal(await readFile(paths.config, 'utf8'), config)
  assert.equal(await readFile(join(paths.home, 'session'), 'utf8'), 'prior history')
  assert.equal(await readFile(join(staged, 'dsh/session'), 'utf8'), 'incoming history')
  assert.equal(await recoverDesktopRestore(layout), null)
})

test('a forget record in the current SQLite WAL prevents replacing data with an older backup', async t => {
  const { desktop, destination } = await fixture(t)
  const source = await desktop('source'), target = await desktop('target')
  await mkdir(target.paths.home)
  const database = join(target.paths.home, 'memory.sqlite3')
  const db = new DatabaseSync(database)
  try {
    db.exec(`PRAGMA user_version=1;
      CREATE TABLE units(name TEXT PRIMARY KEY, version INTEGER);
      INSERT INTO units VALUES('local_memory', 1);
      CREATE TABLE u_local_memory_tombstones(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;
      INSERT INTO u_local_memory_tombstones VALUES('synthetic-key', '{}');`)
    const { folder } = await createDesktopBackup(source.layout, destination)
    await assert.rejects(restore(target.layout, await previewDesktopRestore(target.layout, folder)), /记忆遗忘记录/u)
    assert.deepEqual(db.prepare('SELECT key FROM u_local_memory_tombstones').get()?.key, 'synthetic-key')
    assert.equal(await hasPendingDesktopRestore(target.paths), false)
  } finally { db.close() }
})

test('a profile-local pnpm junction is rebuilt for the target and a manifest cannot link outside the profile', async t => {
  const { desktop, destination } = await fixture(t)
  const source = await desktop('source'), target = await desktop('target')
  const modules = 'profiles/desktop-017/node_modules'
  const plugin = '.pnpm/example@1.0.0/node_modules/example'
  const sourcePlugin = join(source.paths.home, modules, plugin)
  await put(join(source.paths.home, modules, '.modules.yaml'), 'storeDir: /previous-device/store')
  await put(join(sourcePlugin, 'package.json'), '{"name":"example","version":"1.0.0"}')
  await symlink(sourcePlugin, join(source.paths.home, modules, 'example'), process.platform === 'win32' ? 'junction' : 'dir')
  const { folder } = await createDesktopBackup(source.layout, destination)
  const manifestPath = join(folder, 'manifest.json')
  const original = await readFile(manifestPath, 'utf8')
  const manifest = JSON.parse(original)
  const link = manifest.entries.find(item => item.kind === 'link')
  assert.equal(link.target, 'dsh/' + modules + '/' + plugin)
  assert.ok(!manifest.entries.some(item => item.path.endsWith('/.modules.yaml')))
  await assert.rejects(stat(join(folder, 'data/dsh', modules, 'example')), { code: 'ENOENT' })
  link.target = 'configuration/eduwork.jsonc'
  await writeFile(manifestPath, JSON.stringify(manifest))
  await assert.rejects(previewDesktopRestore(target.layout, folder), /无效的插件依赖链接/u)
  await writeFile(manifestPath, original)
  await restore(target.layout, await previewDesktopRestore(target.layout, folder))
  assert.equal(await realpath(join(target.paths.home, modules, 'example')), await realpath(join(target.paths.home, modules, plugin)))
})
