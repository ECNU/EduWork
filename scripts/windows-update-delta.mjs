// Windows delta updates for stable releases. A delta has the layout of the full
// release ZIP but carries only the next RELEASE-MANIFEST.json, the files whose
// content changed, and the files the updater never takes from an installation:
// user-managed roots and the venv configuration the Host rewrites at startup.
// Entries are copied from the release ZIP without recompression. The updater
// links every other file from the installation and verifies the staged tree
// against the complete manifest.
import { createHash } from 'node:crypto'
import { rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { desktopVersion } from './desktop-build-plan.mjs'
import { sha256File, writeText } from './lib/build-util.mjs'
import { ZipReader, ZipWriter } from './lib/zip.mjs'

const userManagedRoots = new Set(['data', 'config', '.env', '.env.local'])
// dsh-host/native-resources.mjs writes absolute paths into this file at startup.
const rewrittenAtStartup = 'resources/product/r/v/pyvenv.cfg'
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

export function windowsDeltaName(product, version, from) {
  desktopVersion(from)
  return `${product}-${version}-windows-x64-electron-from-${from}.zip`
}

function readRelease(zip) {
  const entry = zip.entries.find(item => /^[^/]+\/RELEASE-MANIFEST\.json$/.test(item.name))
  if (!entry) throw new Error('Release ZIP has no RELEASE-MANIFEST.json')
  const bytes = zip.read(entry)
  return { root: entry.name.split('/')[0], bytes, manifest: JSON.parse(bytes.toString('utf8')) }
}

export async function createWindowsDeltas({ archive, bases, product, version, output }) {
  if (!bases.length) return []
  const releaseZip = await ZipReader.open(archive)
  const release = readRelease(releaseZip)
  const releaseBytes = (await stat(archive)).size
  const declared = new Map(release.manifest.files.map(file => [file.path, file.sha256]))
  const relative = entry => entry.name.slice(release.root.length + 1)
  const deltas = []
  for (const base of bases) {
    const previous = readRelease(await ZipReader.open(base))
    const from = previous.manifest.version
    const known = new Map(previous.manifest.files.map(file => [file.path, file.sha256]))
    const carried = new Set(['RELEASE-MANIFEST.json', ...release.manifest.files
      .filter(file => known.get(file.path) !== file.sha256 || userManagedRoots.has(file.path.split('/')[0].toLowerCase()) || file.path === rewrittenAtStartup)
      .map(file => file.path)])
    const name = windowsDeltaName(product, version, from), path = join(output, name)
    const zip = await ZipWriter.create(path)
    try {
      for (const entry of releaseZip.entries) if (carried.has(relative(entry))) await zip.addRawEntry(entry, releaseZip.rawData(entry))
      await zip.close()
    } catch (error) {
      await zip.abort()
      throw error
    }
    const { size } = await stat(path)
    if (size > releaseBytes / 2) {
      console.log(`Skipping the delta from ${from}: it is larger than half of the full archive`)
      await rm(path)
      continue
    }
    // Read the delta back: every file it carries must have the declared content.
    const written = await ZipReader.open(path)
    for (const entry of written.entries) {
      const expected = declared.get(relative(entry))
      if (expected && sha256(written.read(entry)) !== expected) throw new Error(`${name} carries a damaged ${relative(entry)}`)
    }
    const digest = await sha256File(path)
    await writeText(`${path}.sha256`, `${digest}  ${name}`)
    deltas.push({ from, fromManifestSha256: sha256(previous.bytes), name, bytes: size, sha256: digest })
  }
  return deltas
}
