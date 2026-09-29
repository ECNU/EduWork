// Overlays the institution desktop configuration into an immutable CI release
// archive, verifying every program file stays byte-identical. Node.js port of
// configure-desktop-archive.ps1.
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, realpath } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { capture, fullPath, isMainModule, pathExists, sha256File, statEntry, writeJSON, writeText } from './lib/build-util.mjs'
import { ZipReader, ZipWriter, isZipLink } from './lib/zip.mjs'

const scriptRoot = dirname(fileURLToPath(import.meta.url))

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

async function checkArchive(path) {
  const zip = await ZipReader.open(path)
  const entries = new Map()
  for (const entry of zip.entries) {
    if (/(^\/|\\|:|(^|\/)\.\.?(\/|$))/.test(entry.name) || isZipLink(entry)) throw new Error('Unsafe archive path or filesystem link.')
    const key = entry.name.toLowerCase()
    if (entries.has(key)) throw new Error('Duplicate archive entry.')
    entries.set(key, entry)
  }
  const roots = zip.entries.filter(entry => /^[^/]+\/RELEASE-MANIFEST\.json$/.test(entry.name))
  if (roots.length !== 1) throw new Error('Expected one desktop release manifest.')
  const prefix = roots[0].name.replace(/RELEASE-MANIFEST\.json$/, '')
  const manifest = JSON.parse(zip.read(roots[0]).toString('utf8'))
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported desktop archive.')
  let version
  let distribution
  if (manifest.launch) {
    if (manifest.launch.shell !== 'electron' || manifest.launch.protocol !== 'eduwork-desktop/v1') throw new Error('Unsupported update archive.')
    version = manifest.launcherVersion
    distribution = manifest.launch.distribution
  } else {
    if (manifest.kind !== 'eduwork-portable-release' || manifest.shell !== 'electron') throw new Error('Unsupported portable archive.')
    version = manifest.version
    distribution = manifest.distribution
  }
  const files = new Map()
  for (const file of manifest.files) {
    if (/(^\/|\\|:|(^|\/)\.\.?(\/|$)|^data\/)/.test(file.path) || files.has(file.path.toLowerCase())) throw new Error('Invalid or duplicate manifest path.')
    files.set(file.path.toLowerCase(), file)
    const entry = entries.get((prefix + file.path).toLowerCase())
    if (!entry || entry.uncompressedSize !== file.bytes) throw new Error(`Missing file or size mismatch: ${file.path}`)
    if (sha256(zip.read(entry)) !== file.sha256) throw new Error(`File digest mismatch: ${file.path}`)
  }
  if (zip.entries.filter(entry => !entry.name.endsWith('/')).length !== files.size + 1) throw new Error('Archive contains unlisted files.')
  const identityEntry = entries.get((prefix + 'resources/app/eduwork.desktop.json').toLowerCase())
  if (!identityEntry || !files.has('config/eduwork.jsonc')) throw new Error('Desktop identity or config is missing.')
  const identity = JSON.parse(zip.read(identityEntry).toString('utf8'))
  if (identity.shell !== 'electron' || identity.productVersion !== version || identity.distribution !== distribution) throw new Error('Desktop identity mismatch.')
  return { zip, prefix, manifest, files, identity }
}

export async function configureDesktopArchive({ archive, expectedSHA256, config, output } = {}) {
  if (!/^[a-fA-F0-9]{64}$/.test(expectedSHA256 ?? '')) throw new Error('Supply the expected CI archive SHA-256')
  archive = await realpath(fullPath(archive))
  config = await realpath(fullPath(config))
  output = fullPath(output)
  if (await pathExists(output)) throw new Error('Output already exists; keep the CI archive immutable.')
  if ((await sha256File(archive)).toLowerCase() !== expectedSHA256.toLowerCase()) throw new Error('CI archive SHA-256 mismatch.')
  const validation = await capture(process.execPath, [join(scriptRoot, 'validate-distribution-config.mjs'), config])
    .catch(() => { throw new Error('Institution configuration validation failed.') })
  const configSummary = JSON.parse(validation)
  const configBytes = await readFile(config)
  const configHash = sha256(configBytes)

  const source = await checkArchive(archive)
  const configPaths = ['config/eduwork.jsonc']
  if (source.identity.configurationOwnership === 'publisher') {
    const versionedConfig = `config/eduwork.${source.identity.productVersion}.jsonc`
    // Accept old CI archives without introducing a second file in new ones.
    if (source.files.has(versionedConfig.toLowerCase())) configPaths.push(versionedConfig)
  } else if (source.identity.configurationOwnership && source.identity.configurationOwnership !== 'user') {
    throw new Error('Unknown configuration ownership policy.')
  }
  const expectedPolicy = /-dev\./.test(source.identity.productVersion) ? 'development' : 'stable'
  if (configSummary.defaultPolicy && configSummary.defaultPolicy !== expectedPolicy) {
    throw new Error('Configuration update policy differs from the CI version channel.')
  }
  await mkdir(dirname(output), { recursive: true })
  const partial = `${output}.${randomUUID().replaceAll('-', '')}.partial`
  try {
    const replacements = new Map()
    for (const configPath of configPaths) {
      const configFile = source.files.get(configPath.toLowerCase())
      configFile.bytes = configBytes.length
      configFile.sha256 = configHash
      replacements.set((source.prefix + configPath).toLowerCase(), configBytes)
    }
    replacements.set((source.prefix + 'RELEASE-MANIFEST.json').toLowerCase(), Buffer.from(JSON.stringify(source.manifest, null, 2)))
    // Program entries are copied without recompression; only the configuration
    // overlay and its manifest rows are rewritten.
    const writer = await ZipWriter.create(partial)
    try {
      for (const entry of source.zip.entries) {
        const replacement = replacements.get(entry.name.toLowerCase())
        if (replacement === undefined) await writer.addRawEntry(entry, source.zip.rawData(entry))
        else await writer.addEntry(entry.name, replacement)
      }
      await writer.close()
    } catch (error) {
      await writer.abort()
      throw error
    }
    const configured = await checkArchive(partial)
    if (configured.files.size !== source.files.size) throw new Error('Archive file set changed.')
    for (const [key, file] of source.files) {
      if (configPaths.some(path => path.toLowerCase() === key)) continue
      if (configured.files.get(key).sha256 !== file.sha256) throw new Error(`Program file changed: ${file.path}`)
    }
    for (const configPath of configPaths) {
      if (configured.files.get(configPath.toLowerCase()).sha256 !== configHash) throw new Error('Configuration overlay failed.')
    }
    await rename(partial, output)
  } finally {
    // Only this invocation's explicitly named temporary file is removable.
    if (await pathExists(partial)) await rm(partial, { force: true })
  }
  const hash = await sha256File(output)
  await writeText(`${output}.sha256`, `${hash}  ${basename(output)}`)
  const receipt = {
    schemaVersion: 1,
    kind: 'eduwork-configured-desktop',
    version: source.identity.productVersion,
    distribution: source.identity.distribution,
    sourceCIArchiveSHA256: expectedSHA256.toLowerCase(),
    sha256: hash,
    bytes: (await statEntry(output)).size,
    programFilesUnchanged: true,
    changedFiles: [...configPaths, 'RELEASE-MANIFEST.json'],
    organizations: configSummary.organizations,
    configurationOwnership: source.identity.configurationOwnership || 'user',
    defaultPolicy: expectedPolicy,
    fileCount: source.files.size,
    publicationStatus: 'local-only',
  }
  await writeJSON(`${output}.receipt.json`, receipt)
  console.log(JSON.stringify(receipt, null, 2))
  return receipt
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      archive: { type: 'string' },
      'expected-sha256': { type: 'string' },
      config: { type: 'string' },
      output: { type: 'string' },
    },
  })
  if (!values.archive || !values['expected-sha256'] || !values.config || !values.output) {
    throw new Error('Use --archive <zip> --expected-sha256 <hash> --config <eduwork.jsonc> --output <zip>')
  }
  await configureDesktopArchive({
    archive: values.archive,
    expectedSHA256: values['expected-sha256'],
    config: values.config,
    output: values.output,
  })
}
