// Build the isolated static update feed for an installed-layout candidate.
// The ZIP is a complete electron update: the updater extracts and verifies it
// before replacing manifest-owned program files, so no Wails launcher or
// migration executable is required.
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { ensureDir, fullPath, isMainModule, pathExists, readJSON, sha256File, writeJSON, writeText } from './lib/build-util.mjs'
import { ZipWriter } from './lib/zip.mjs'
import { installedManifestRows } from '../dsh-electron/scripts/assemble-windows.mjs'

const DISTRIBUTION_NAMES = { eduwork: 'EduWork', 'eduwork-chatecnu': 'EduWork-ECNU' }

function requireMatch(condition, message) {
  if (!condition) throw new Error(message)
}

export function updateDistributionName(distribution) {
  const name = DISTRIBUTION_NAMES[distribution]
  requireMatch(name, 'Unknown update distribution')
  return name
}

export function updateArtifactName(version, distribution) {
  return `${updateDistributionName(distribution)}-${version}-windows-x64-update.zip`
}

export function validateUpdateBaseURL(baseURL) {
  let url
  try { url = new URL(baseURL) } catch { throw new Error('Update base URL is invalid') }
  requireMatch(url.protocol === 'https:' && url.hostname && !url.username && !url.password && !url.search && !url.hash,
    'Update base URL must be absolute HTTPS without credentials, query or fragment')
  return baseURL.replace(/\/+$/, '')
}

export function updateManifest({ distribution, version, baseURL, channel = 'development', target = 'windows-amd64', artifact }) {
  baseURL = validateUpdateBaseURL(baseURL)
  const fileName = updateArtifactName(version, distribution)
  return {
    schemaVersion: 1,
    distribution,
    channel,
    version,
    target,
    publishedAt: new Date().toISOString(),
    artifacts: [{
      flavor: 'offline',
      fileName,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
      url: `${baseURL}/${channel}/${fileName}`,
      sha256Url: `${baseURL}/${channel}/${fileName}.sha256`,
      shell: 'electron',
    }],
  }
}

export function verifyUpdateCandidate({ desktop, release, manifest, rows }) {
  requireMatch(desktop?.schemaVersion === 1 && desktop.shell === 'electron', 'Desktop identity is missing or unsupported')
  requireMatch(desktop.dataLayout === 'installed', 'Update packaging requires an installed-layout candidate')
  requireMatch(release?.schemaVersion === 1 && release.shell === 'electron', 'Release identity is missing or unsupported')
  requireMatch(desktop.productVersion === release.version, 'Product version differs between desktop identity and release')
  requireMatch(desktop.distribution === release.distribution, 'Distribution differs between desktop identity and release')
  requireMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(release.version ?? ''), 'Release version is invalid')
  requireMatch(manifest?.schemaVersion === 1 && manifest.kind === 'eduwork-portable-release'
    && manifest.shell === 'electron' && manifest.platform === 'windows-x64', 'Installed release manifest is invalid')
  requireMatch(manifest.launcherVersion === release.version && manifest.flavor === 'offline'
    && manifest.launch?.protocol === 'eduwork-desktop/v1' && manifest.launch?.shell === 'electron'
    && manifest.launch?.executable === 'EduWork-Electron.exe'
    && (manifest.launch?.migration === 'legacy-wails-v1' || manifest.launch?.migration === 'wails-host-v1')
    && manifest.launch?.distribution === desktop.distribution, 'Installed release manifest lacks the update launch contract')
  requireMatch(manifest.version === release.version && manifest.distribution === desktop.distribution,
    'Installed release manifest does not match the candidate identity')
  requireMatch(Array.isArray(manifest.files) && Array.isArray(rows), 'Installed release manifest has no file inventory')
  requireMatch(JSON.stringify(manifest.files) === JSON.stringify(rows), 'Installed release manifest does not match the program tree')
}

export async function packWindowsUpdate({ candidate, output, baseURL, installedReceipt, channel = 'development', target = 'windows-amd64' }) {
  candidate = fullPath(candidate)
  output = fullPath(output)
  baseURL = validateUpdateBaseURL(baseURL)
  requireMatch(!await pathExists(output), 'Update output must be a new directory')
  const desktop = await readJSON(join(candidate, 'resources/app/eduwork.desktop.json'))
  const release = await readJSON(join(candidate, 'release.json'))
  const manifest = await readJSON(join(candidate, 'RELEASE-MANIFEST.json')).catch(() => {
    throw new Error('Installed candidate has no RELEASE-MANIFEST.json')
  })
  const rows = await installedManifestRows(candidate)
  if (!installedReceipt) throw new Error('Installed-candidate receipt is required')
  const receipt = await readJSON(fullPath(installedReceipt))
  verifyUpdateCandidate({ desktop, release, manifest, rows })
  requireMatch(receipt.kind === 'eduwork-windows-installed-candidate', 'Installed-candidate receipt kind is invalid')
  requireMatch(receipt.version === release.version && receipt.distribution === desktop.distribution, 'Installed-candidate receipt does not match the candidate')
  requireMatch(/^[a-f0-9]{40}$/.test(receipt.coreCommit ?? ''), 'Installed-candidate receipt has no source commit')
  requireMatch(receipt.checks?.installedAssembly === 'passed', 'Installed assembly has not passed')

  const name = updateDistributionName(desktop.distribution)
  const fileName = updateArtifactName(release.version, desktop.distribution)
  const feed = join(output, channel)
  await ensureDir(feed)
  const zipPath = join(feed, fileName)
  const zip = await ZipWriter.create(zipPath)
  try {
    for (const file of rows) await zip.addEntry(`${name}/${file.path}`, await readFile(join(candidate, file.path)))
    await zip.addEntry(`${name}/RELEASE-MANIFEST.json`, Buffer.from(JSON.stringify(manifest, null, 2)))
    await zip.close()
  } catch (error) {
    await zip.abort()
    throw error
  }
  const bytes = (await stat(zipPath)).size
  const sha256 = await sha256File(zipPath)
  await writeText(`${zipPath}.sha256`, `${sha256}  ${fileName}\n`)
  const update = updateManifest({ distribution: desktop.distribution, version: release.version, baseURL, channel, target,
    artifact: { bytes, sha256 } })
  const manifestName = `latest-${target}.json`
  await writeJSON(join(feed, manifestName), update)
  const manifestSHA256 = await sha256File(join(feed, manifestName))
  const result = {
    schemaVersion: 1,
    kind: 'eduwork-windows-update-candidate',
    version: release.version,
    coreCommit: receipt.coreCommit,
    distribution: desktop.distribution,
    baseURL,
    channel,
    target,
    artifact: { file: fileName, bytes, sha256 },
    manifest: { file: manifestName, sha256: manifestSHA256 },
    publication: 'artifact-only',
    checks: { installedAssembly: 'passed', updatePackageBuilt: 'passed', update: 'not-run', failureRecovery: 'not-run' },
  }
  await writeJSON(join(output, 'update-candidate-receipt.json'), result)
  console.log(`Windows update package assembled: ${zipPath}`)
  return result
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({ options: {
    candidate: { type: 'string' }, output: { type: 'string' }, 'base-url': { type: 'string' },
    'installed-receipt': { type: 'string' }, channel: { type: 'string' }, target: { type: 'string' },
  } })
  if (!values.candidate || !values.output || !values['base-url']) {
    throw new Error('Use --candidate <installed candidate root> --output <new directory> --base-url <https://host[:port]> [--installed-receipt <json>] [--channel development] [--target windows-amd64]')
  }
  await packWindowsUpdate({
    candidate: values.candidate,
    output: values.output,
    baseURL: values['base-url'],
    installedReceipt: values['installed-receipt'],
    channel: values.channel ?? 'development',
    target: values.target ?? 'windows-amd64',
  })
}
