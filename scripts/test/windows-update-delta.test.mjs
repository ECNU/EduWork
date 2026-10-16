import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ZipReader, ZipWriter } from '../lib/zip.mjs'
import { createWindowsDeltas, windowsDeltaName } from '../windows-update-delta.mjs'

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
async function releaseZIP(path, version, files) {
  const manifest = Buffer.from(JSON.stringify({ schemaVersion: 1, version, launcherVersion: version, flavor: 'offline',
    files: Object.entries(files).map(([name, bytes]) => ({ path: name, bytes: bytes.length, sha256: sha256(bytes) })) }))
  const zip = await ZipWriter.create(path)
  await zip.addEntry('EduWork/RELEASE-MANIFEST.json', manifest)
  for (const [name, bytes] of Object.entries(files)) await zip.addEntry(`EduWork/${name}`, bytes)
  await zip.close()
  return manifest
}
async function fixture(t, previousRuntime) {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-windows-delta-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  // Incompressible, so the runtime dominates the size of either archive.
  const runtime = randomBytes(64 << 10), config = Buffer.from('{}'), venv = Buffer.from('home = C:\\build\\r\\p\n')
  const base = join(root, 'EduWork-0.4.3-windows-x64-electron.zip'), archive = join(root, 'EduWork-0.4.4-windows-x64-electron.zip')
  const baseManifest = await releaseZIP(base, '0.4.3', { 'EduWork-Electron.exe': previousRuntime ?? runtime, 'resources/app.js': Buffer.from('old app'),
    'resources/removed.js': Buffer.from('removed'), 'config/eduwork.jsonc': config, 'resources/product/r/v/pyvenv.cfg': venv })
  await releaseZIP(archive, '0.4.4', { 'EduWork-Electron.exe': runtime, 'resources/app.js': Buffer.from('new app'),
    'resources/added.js': Buffer.from('added'), 'config/eduwork.jsonc': config, 'resources/product/r/v/pyvenv.cfg': venv })
  const output = join(root, 'publish')
  await mkdir(output)
  return { base, archive, baseManifest, output }
}

test('a delta carries the manifest, changed files, user-managed roots and the venv configuration', async t => {
  const { base, archive, baseManifest, output } = await fixture(t)
  const [delta] = await createWindowsDeltas({ archive, bases: [base], product: 'EduWork', version: '0.4.4', output })
  const name = windowsDeltaName('EduWork', '0.4.4', '0.4.3'), bytes = await readFile(join(output, name))
  assert.deepEqual(delta, { from: '0.4.3', fromManifestSha256: sha256(baseManifest), name, bytes: bytes.length, sha256: sha256(bytes) })
  assert.equal(await readFile(join(output, `${name}.sha256`), 'utf8'), `${delta.sha256}  ${name}\n`)
  const zip = new ZipReader(bytes)
  assert.deepEqual(zip.entries.map(entry => entry.name).sort(), ['EduWork/RELEASE-MANIFEST.json', 'EduWork/config/eduwork.jsonc',
    'EduWork/resources/added.js', 'EduWork/resources/app.js', 'EduWork/resources/product/r/v/pyvenv.cfg'])
  assert.equal(zip.read(zip.entries.find(entry => entry.name === 'EduWork/resources/app.js')).toString(), 'new app')
})

test('a delta larger than half of the full archive is not published', async t => {
  const { base, archive, output } = await fixture(t, randomBytes(64 << 10))
  assert.deepEqual(await createWindowsDeltas({ archive, bases: [base], product: 'EduWork', version: '0.4.4', output }), [])
  assert.deepEqual(await readdir(output), [])
})
