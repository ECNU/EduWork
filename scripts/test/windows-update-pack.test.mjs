import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { writeInstalledManifest } from '../../dsh-electron/scripts/assemble-windows.mjs'
import { ZipReader } from '../lib/zip.mjs'
import {
  packWindowsUpdate, updateArtifactName, updateManifest, validateUpdateBaseURL, verifyUpdateCandidate,
} from '../pack-windows-update.mjs'

const version = '0.4.13-dev.20261116.2'
const baseURL = 'https://127-0-0-1.my.local-ip.co:18443'
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

async function installedCandidate(root) {
  const put = async (path, bytes) => {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), bytes)
  }
  await put('EduWork-Electron.exe', 'launcher')
  await put('README.txt', 'readme')
  await put('resources/app/eduwork.desktop.json', JSON.stringify({
    schemaVersion: 1, shell: 'electron', appId: 'org.eduwork.eduwork.electron',
    distribution: 'eduwork', productVersion: version, dataLayout: 'installed',
  }))
  await put('release.json', JSON.stringify({ schemaVersion: 1, shell: 'electron', version, distribution: 'eduwork' }))
  await writeInstalledManifest({ output: root, version, distribution: 'eduwork' })
  return root
}

const receipt = {
  kind: 'eduwork-windows-installed-candidate', version, distribution: 'eduwork',
  coreCommit: 'b'.repeat(40), checks: { installedAssembly: 'passed' },
}

test('update manifest names the artifact under its channel and target', () => {
  assert.equal(updateArtifactName(version, 'eduwork'), `EduWork-${version}-windows-x64-update.zip`)
  assert.throws(() => updateArtifactName(version, 'other'), /Unknown update distribution/)
  const manifest = updateManifest({ distribution: 'eduwork', version, baseURL, artifact: { bytes: 12, sha256: 'a'.repeat(64) } })
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.channel, 'development')
  assert.equal(manifest.target, 'windows-amd64')
  assert.deepEqual(manifest.artifacts, [{
    flavor: 'offline', fileName: `EduWork-${version}-windows-x64-update.zip`, bytes: 12,
    sha256: 'a'.repeat(64),
    url: `${baseURL}/development/EduWork-${version}-windows-x64-update.zip`,
    sha256Url: `${baseURL}/development/EduWork-${version}-windows-x64-update.zip.sha256`,
    shell: 'electron',
  }])
  assert.throws(() => updateManifest({ distribution: 'eduwork', version, baseURL, channel: '../escape', artifact: { bytes: 1, sha256: 'a'.repeat(64) } }), /channel/)
  assert.throws(() => updateManifest({ distribution: 'eduwork', version, baseURL, target: 'linux-x64', artifact: { bytes: 1, sha256: 'a'.repeat(64) } }), /target/)
})

test('update base URLs are HTTPS without credentials, query or fragment', () => {
  assert.equal(validateUpdateBaseURL(`${baseURL}/`), baseURL)
  for (const value of ['http://localhost:18443', 'https://user:' + 'x' + '@host', 'https://host/feed?x=1', 'https://host/feed#top', 'not-a-url']) {
    assert.throws(() => validateUpdateBaseURL(value), /Update base URL/)
  }
})

test('update candidate verification requires an installed identity and matching inventory', () => {
  const desktop = { schemaVersion: 1, shell: 'electron', dataLayout: 'installed', productVersion: version, distribution: 'eduwork' }
  const release = { schemaVersion: 1, shell: 'electron', version, distribution: 'eduwork' }
  const rows = [{ path: 'EduWork-Electron.exe', bytes: 8, sha256: 'c'.repeat(64) }]
  const manifest = {
    schemaVersion: 1, kind: 'eduwork-portable-release', shell: 'electron', platform: 'windows-x64',
    version, launcherVersion: version, flavor: 'offline', distribution: 'eduwork',
    launch: {
      protocol: 'eduwork-desktop/v1', shell: 'electron', executable: 'EduWork-Electron.exe',
      migration: 'wails-host-v1', distribution: 'eduwork',
    },
    files: rows,
  }
  assert.doesNotThrow(() => verifyUpdateCandidate({ desktop, release, manifest, rows }))
  assert.throws(() => verifyUpdateCandidate({ desktop: { ...desktop, dataLayout: 'portable' }, release, manifest, rows }), /installed-layout/)
  assert.throws(() => verifyUpdateCandidate({ desktop, release: { ...release, version: '0.4.13' }, manifest, rows }), /Product version differs/)
  assert.throws(() => verifyUpdateCandidate({ desktop, release, manifest: { ...manifest, files: [] }, rows }), /does not match the program tree/)
  assert.throws(() => verifyUpdateCandidate({ desktop, release, manifest: { ...manifest, launch: undefined }, rows }), /launch contract/)
})

test('update packaging writes a channel feed, sidecar and receipt', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-update-pack-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const candidate = await installedCandidate(join(root, 'candidate'))
  const receiptPath = join(root, 'installed-receipt.json')
  await writeFile(receiptPath, JSON.stringify(receipt))
  const output = join(root, 'feed')
  const result = await packWindowsUpdate({ candidate, output, baseURL, installedReceipt: receiptPath })
  const fileName = `EduWork-${version}-windows-x64-update.zip`
  const zipPath = join(output, 'development', fileName)
  const bytes = (await stat(zipPath)).size
  const digest = sha256(await readFile(zipPath))
  assert.equal(result.kind, 'eduwork-windows-update-candidate')
  assert.equal(result.coreCommit, receipt.coreCommit)
  assert.deepEqual(result.artifact, { file: fileName, bytes, sha256: digest })
  assert.equal(result.checks.update, 'not-run')
  assert.equal(result.checks.failureRecovery, 'not-run')
  assert.equal(await readFile(`${zipPath}.sha256`, 'utf8'), `${digest}  ${fileName}\n`)
  const manifest = JSON.parse(await readFile(join(output, 'development', 'latest-windows-amd64.json'), 'utf8'))
  assert.equal(manifest.version, version)
  assert.equal(manifest.distribution, 'eduwork')
  assert.equal(manifest.artifacts[0].sha256, digest)
  assert.equal(manifest.artifacts[0].bytes, bytes)
  const archive = await ZipReader.open(zipPath)
  const names = archive.entries.map(entry => entry.name).sort()
  assert.deepEqual(names, [
    'EduWork/EduWork-Electron.exe',
    'EduWork/README.txt',
    'EduWork/RELEASE-MANIFEST.json',
    'EduWork/release.json',
    'EduWork/resources/app/eduwork.desktop.json',
  ])
  await assert.rejects(packWindowsUpdate({ candidate, output: join(root, 'feed-no-receipt'), baseURL }), /receipt is required/)
  await assert.rejects(packWindowsUpdate({ candidate, output, baseURL, installedReceipt: receiptPath }), /new directory/)
})
