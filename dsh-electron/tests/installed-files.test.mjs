import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { checkInstalledProgramTarget, removeInstalledData, rememberInstallerSource, waitForInstalledProcesses } from '../src/installed-files.mjs'
import { acquireInstanceMutex, releaseInstanceMutex } from '../src/install-mutex.mjs'
import { pendingMigrationFile } from '../src/installed-migration.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-installer-'))
  t.after(() => rm(root, { force: true, recursive: true }))
  const localAppData = join(root, 'local'), programRoot = join(root, 'program'), distribution = 'example'
  const writable = join(localAppData, 'EduWork', distribution)
  const json = async (path, value) => {
    await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, JSON.stringify(value))
    if (path === join(programRoot, 'resources/app/eduwork.desktop.json')) await json(join(programRoot, 'RELEASE-MANIFEST.json'), {
      schemaVersion: 1, kind: 'eduwork-portable-release', shell: 'electron', platform: 'windows-x64', distribution: value.distribution,
      version: value.productVersion, files: [{ path: 'resources/app/eduwork.desktop.json' }],
    })
  }
  const settings = { schemaVersion: 1, shell: 'electron', productVersion: '0.4.13', dataLayout: 'installed', distribution, appId: 'org.eduwork.example.electron' }
  return { root, localAppData, programRoot, distribution, writable, json, settings }
}

test('installer accepts a fresh target or this installed edition, and rejects portable and data directories', async t => {
  const f = await fixture(t)
  await checkInstalledProgramTarget(f)
  await f.json(join(f.programRoot, 'resources/app/eduwork.desktop.json'), f.settings)
  await checkInstalledProgramTarget(f)
  await mkdir(join(f.programRoot, 'data'))
  await assert.rejects(checkInstalledProgramTarget(f), /便携版/)
  await assert.rejects(checkInstalledProgramTarget({ ...f, programRoot: f.writable }), /相互包含/)
  await assert.rejects(checkInstalledProgramTarget({ ...f, programRoot: f.localAppData }), /相互包含/)
  await rm(join(f.programRoot, 'data'), { recursive: true })
  await f.json(join(f.programRoot, 'resources/app/eduwork.desktop.json'), { ...f.settings, distribution: 'another' })
  await assert.rejects(checkInstalledProgramTarget(f), /其他发行版/)
})

test('installer rejects a parent executable that would intercept the installed Start menu link', async t => {
  const f = await fixture(t)
  await writeFile(join(f.root, 'EduWork-Electron.exe'), 'portable fixture')
  await assert.rejects(checkInstalledProgramTarget(f), /独立安装目录/u)
  await checkInstalledProgramTarget({ ...f, uninstall: true })
})

test('explicit data removal requires the exact edition marker and excludes external workspace links', async t => {
  const f = await fixture(t), external = join(f.root, 'external')
  await f.json(join(external, 'sentinel.json'), { preserved: true })
  await mkdir(f.writable, { recursive: true })
  await assert.rejects(removeInstalledData({ ...f, platform: 'win32' }), /归属/)
  const marker = join(f.writable, '.eduwork-writable-root.json')
  await f.json(marker, { schemaVersion: 1, layout: 'installed', distribution: 'another' })
  await assert.rejects(removeInstalledData({ ...f, platform: 'win32' }), /不匹配/)
  await f.json(marker, { schemaVersion: 1, layout: 'installed', distribution: f.distribution })
  await symlink(external, join(f.writable, 'workspace'), process.platform === 'win32' ? 'junction' : 'dir')
  const lease = await acquireInstanceMutex('writable', f.writable)
  await assert.rejects(removeInstalledData({ ...f, platform: 'win32' }), /仍在使用/)
  await releaseInstanceMutex(lease)
  assert.deepEqual(await removeInstalledData({ ...f, platform: 'win32' }), { removed: true })
  assert.equal(JSON.parse(await readFile(join(external, 'sentinel.json'))).preserved, true)
  assert.deepEqual(await removeInstalledData({ ...f, platform: 'win32' }), { removed: false })
})

test('linked data roots are retained', async t => {
  const f = await fixture(t), external = join(f.root, 'external')
  await f.json(join(external, 'sentinel.json'), { preserved: true })
  await mkdir(join(f.writable, '..'), { recursive: true })
  await symlink(external, f.writable, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(removeInstalledData({ ...f, platform: 'win32' }), /链接/)
  assert.equal(JSON.parse(await readFile(join(external, 'sentinel.json'))).preserved, true)
})

test('program junctions, extra personal files and internal workspaces block recursive NSIS cleanup', async t => {
  const f = await fixture(t), external = join(f.root, 'external')
  await f.json(join(f.programRoot, 'resources/app/eduwork.desktop.json'), f.settings)
  await f.json(join(external, 'sentinel.json'), { preserved: true })
  const link = join(f.programRoot, 'project-link')
  await symlink(external, link, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(checkInstalledProgramTarget(f), /链接/)
  assert.equal(JSON.parse(await readFile(join(external, 'sentinel.json'))).preserved, true)
  await rm(link)
  await writeFile(join(f.programRoot, 'personal.txt'), 'must retain')
  await assert.rejects(checkInstalledProgramTarget(f), /未登记/)
  assert.equal(await readFile(join(f.programRoot, 'personal.txt'), 'utf8'), 'must retain')
  await rm(join(f.programRoot, 'personal.txt'))
  await f.json(join(f.writable, 'data/example-electron/dsh/storages/workspace.json'), { tables: { workspaces: { internal: { path: f.programRoot } } } })
  await assert.rejects(checkInstalledProgramTarget(f), /Program-directory workspaces/)
})

test('only bytecode derived from a manifest-owned Python source is disposable', async t => {
  const f = await fixture(t)
  await f.json(join(f.programRoot, 'resources/app/eduwork.desktop.json'), f.settings)
  const manifest = JSON.parse(await readFile(join(f.programRoot, 'RELEASE-MANIFEST.json')))
  manifest.files.push({ path: 'resources/runtime/python/owned.py' })
  await f.json(join(f.programRoot, 'RELEASE-MANIFEST.json'), manifest)
  await f.json(join(f.programRoot, 'resources/runtime/python/owned.py'), {})
  await f.json(join(f.programRoot, 'resources/runtime/python/__pycache__/owned.cpython-311.pyc'), {})
  await checkInstalledProgramTarget(f)
  await f.json(join(f.programRoot, 'resources/runtime/python/__pycache__/personal.cpython-311.pyc'), {})
  await assert.rejects(checkInstalledProgramTarget(f), /未登记/)
})

test('installer source handoff persists the exact source without opening it or replacing another request', async t => {
  const f = await fixture(t), sourceRoot = join(f.root, '旧便携版 路径')
  await f.json(join(f.programRoot, 'resources/app/eduwork.desktop.json'), f.settings)
  await rememberInstallerSource({ ...f, sourceRoot })
  const pending = JSON.parse(await readFile(pendingMigrationFile(f.writable, f.distribution)))
  assert.equal(pending.sourceRoot, sourceRoot)
  assert.equal(pending.programRoot, f.programRoot)
  assert.equal(pending.phase, 'selected')
  await rememberInstallerSource({ ...f, sourceRoot })
  await assert.rejects(rememberInstallerSource({ ...f, sourceRoot: join(f.root, 'another') }), /未完成迁移/)
  await f.json(join(f.writable, '.eduwork-writable-root.json'), { schemaVersion: 1, layout: 'installed', distribution: f.distribution })
  await assert.rejects(rememberInstallerSource({ ...f, sourceRoot }), /已有个人数据/)
})

test('running application and background processes are rejected without terminating them', async t => {
  const f = await fixture(t)
  const listProcesses = async () => [{ Name: 'node.exe', ProcessId: process.pid + 100, ExecutablePath: join(f.programRoot, 'resources/runtime/node.exe') }]
  await assert.rejects(waitForInstalledProcesses({ ...f, listProcesses }), /still running/)
  await waitForInstalledProcesses({ ...f, listProcesses: async () => [] })
  await assert.rejects(waitForInstalledProcesses({ ...f, listProcesses: async () => { throw new Error('CIM unavailable') } }), /CIM unavailable/)
})

test('only the current uninstaller parent chain is excluded from running-program checks', async t => {
  const f = await fixture(t), uninstaller = join(f.programRoot, 'Uninstall EduWork-Electron.exe')
  const parent = process.pid + 100
  const self = { ProcessId: process.pid, ParentProcessId: parent }
  const direct = { ProcessId: parent, ParentProcessId: 1, Name: 'Uninstall EduWork-Electron.exe', ExecutablePath: uninstaller }
  await waitForInstalledProcesses({ ...f, uninstall: true, listProcesses: async () => [self, direct] })
  const temporary = { ProcessId: parent, ParentProcessId: parent + 1, ExecutablePath: join(f.root, 'temp/uninstaller.exe') }
  const original = { ...direct, ProcessId: parent + 1 }
  await waitForInstalledProcesses({ ...f, uninstall: true, listProcesses: async () => [self, temporary, original] })
  await assert.rejects(waitForInstalledProcesses({ ...f, uninstall: true, listProcesses: async () => [self, direct, { ...direct, ProcessId: parent + 2 }] }), /still running/)
  await assert.rejects(waitForInstalledProcesses({ ...f, uninstall: true, listProcesses: async () => [self, { ...direct, ExecutablePath: join(f.programRoot, 'EduWork-Electron.exe') }] }), /still running/)
})
