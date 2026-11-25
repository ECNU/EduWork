import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { installedManifestRows, writeInstalledManifest } from '../scripts/assemble-windows.mjs'

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

test('installed release manifest inventories program files and excludes user state', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-installed-manifest-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const put = async (path, bytes) => {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), bytes)
  }
  await put('EduWork-Electron.exe', 'launcher')
  await put('README.txt', 'readme')
  await put('resources/app/eduwork.desktop.json', '{"shell":"electron"}')
  await put('config/eduwork.jsonc', 'user config')
  await put('data/state/pending-update.json', 'user state')
  await put('RELEASE-MANIFEST.json', 'stale manifest')
  const rows = await installedManifestRows(root)
  assert.deepEqual(rows.map(row => row.path), [
    'EduWork-Electron.exe',
    'README.txt',
    'resources/app/eduwork.desktop.json',
  ])
  assert.equal(rows.find(row => row.path === 'EduWork-Electron.exe').sha256, sha256(Buffer.from('launcher')))
  await writeInstalledManifest({ output: root, version: '0.0.0-test', distribution: 'eduwork' })
  const manifest = JSON.parse(await readFile(join(root, 'RELEASE-MANIFEST.json'), 'utf8'))
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.kind, 'eduwork-portable-release')
  assert.equal(manifest.version, '0.0.0-test')
  assert.equal(manifest.launcherVersion, '0.0.0-test')
  assert.equal(manifest.flavor, 'offline')
  assert.equal(manifest.distribution, 'eduwork')
  assert.equal(manifest.shell, 'electron')
  assert.equal(manifest.platform, 'windows-x64')
  assert.deepEqual(manifest.launch, {
    protocol: 'eduwork-desktop/v1', shell: 'electron', executable: 'EduWork-Electron.exe',
    migration: 'wails-host-v1', distribution: 'eduwork',
  })
  assert.deepEqual(manifest.files, rows)
})
