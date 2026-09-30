// Build and accept the Windows self-extracting release wrapper with Node.js.
import { createReadStream, createWriteStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { appendFile, copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { desktopVersion } from './desktop-build-plan.mjs'
import { fullPath, isMainModule, isWindows, pathExists, run, sha256File, writeJSON } from './lib/build-util.mjs'
import { getResource, readPEResources, writePEResources } from './lib/windows-pe.mjs'
import { assertInvokerManifest } from '../dsh-electron/scripts/set-updater-manifest.mjs'

const scriptRoot = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(scriptRoot, '..')

async function hashFile(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

function tarEntry(archive, entry, { hash = false, limit = 2 << 20 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('tar.exe', ['-xOf', archive, entry], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks = [], digest = createHash('sha256')
    let size = 0, stderr = ''
    child.stdout.on('data', chunk => {
      size += chunk.length
      if (hash) digest.update(chunk)
      else if (size <= limit) chunks.push(chunk)
      else child.kill()
    })
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    child.once('error', reject)
    child.once('close', code => {
      if (code !== 0 || (!hash && size > limit)) reject(new Error(`ZIP entry ${entry} is unavailable or too large: ${stderr.trim()}`))
      else resolve(hash ? { sha256: digest.digest('hex'), bytes: size } : Buffer.concat(chunks))
    })
  })
}

async function embedExtractorResources(executable, icon) {
  const { library, executable: pe, resources } = await readPEResources(executable)
  const icons = library.Data.IconFile.from(icon).icons.map(item => item.data)
  const xml = await readFile(join(scriptRoot, 'portable-extractor.manifest'))
  assertInvokerManifest(xml)
  resources.entries.splice(0, resources.entries.length,
    ...resources.entries.filter(entry => entry.type !== 3 && entry.type !== 14 && !(entry.type === 24 && entry.id === 1)))
  library.Resource.IconGroupEntry.replaceIconsForResource(resources.entries, 1, 0, icons)
  resources.entries.push({ type: 24, id: 1, lang: 0, codepage: 0,
    bin: xml.buffer.slice(xml.byteOffset, xml.byteOffset + xml.byteLength) })
  await writePEResources(executable, pe, resources)
  const verified = (await readPEResources(executable)).resources
  const group = library.Resource.IconGroupEntry.fromEntries(verified.entries).find(entry => entry.id === 1 && entry.lang === 0)
  if (!group || group.getIconItemsFromEntries(verified.entries).some((entry, index) =>
    !Buffer.from(entry.bin).equals(Buffer.from(icons[index]?.bin ?? [])))) throw new Error('Extractor icon differs from product icon')
  const manifests = getResource(verified.entries, 24, 1)
  if (manifests.length !== 1) throw new Error('Extractor manifest is missing')
  assertInvokerManifest(manifests[0].bin)
}

export async function packPortableExtractor({ archive, expectedSHA256, outputDirectory } = {}) {
  if (!isWindows) throw new Error('Build the Windows extractor on Windows')
  archive = fullPath(archive)
  outputDirectory = fullPath(outputDirectory)
  if (await pathExists(outputDirectory)) throw new Error('Use a new extractor output directory')
  if (!/^[a-f0-9]{64}$/i.test(expectedSHA256 ?? '')) throw new Error('Expected a SHA-256 checksum')
  const archiveSHA256 = await hashFile(archive)
  if (archiveSHA256 !== expectedSHA256.toLowerCase()) throw new Error('Input release ZIP does not match the expected SHA256')
  const filename = basename(archive)
  const match = filename.match(/^(EduWork(?:-ECNU)?)-(.+)-windows-x64-electron\.zip$/)
  if (!match) throw new Error('Unsupported Windows Electron ZIP name')
  const [, root, version] = match
  desktopVersion(version)
  const identityBytes = await tarEntry(archive, `${root}/resources/app/eduwork.desktop.json`)
  const desktop = JSON.parse(identityBytes.toString('utf8'))
  const distribution = root === 'EduWork' ? 'eduwork' : 'eduwork-chatecnu'
  if (desktop.productVersion !== version || desktop.shell !== 'electron' || desktop.distribution !== distribution) {
    throw new Error('Unsupported release identity')
  }
  const icon = await tarEntry(archive, `${root}/resources/brand/icon.ico`)
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(join(outputDirectory, 'brand.ico'), icon)
  const archiveBytes = (await stat(archive)).size
  const identity = { product: desktop.productName, version, distribution, root, sha256: archiveSHA256, bytes: archiveBytes }
  const exe = join(outputDirectory, `${root}-Setup.exe`)
  const encoded = Buffer.from(JSON.stringify(identity)).toString('base64')
  const compiler = (await run('go', ['env', 'GOVERSION'], { capture: true })).stdout.trim()
  await run('go', ['build', '-buildvcs=false', '-trimpath', '-ldflags', `-H=windowsgui -s -w -X main.buildIdentity=${encoded}`,
    '-o', exe, './cmd/eduwork-extract'], { cwd: join(repoRoot, 'dsh-desktop') })
  await embedExtractorResources(exe, icon)
  const payloadOffset = (await stat(exe)).size
  await pipeline(createReadStream(archive), createWriteStream(exe, { flags: 'a' }))
  const footer = Buffer.alloc(32)
  Buffer.from('EDUWORK-SFX-v1\0\0', 'ascii').copy(footer)
  footer.writeBigUInt64LE(BigInt(payloadOffset), 16)
  footer.writeBigUInt64LE(BigInt(archiveBytes), 24)
  await appendFile(exe, footer)
  const verification = join(outputDirectory, 'verification.json')
  await run(exe, ['--verify', '--report', verification])
  if (!(JSON.parse(await readFile(verification, 'utf8'))).success) throw new Error('Embedded payload verification failed')
  const assetName = `${root}-${version}-windows-x64-setup.zip`
  const asset = join(outputDirectory, assetName)
  await run('tar.exe', ['-a', '-cf', asset, '-C', outputDirectory, basename(exe)])
  const assetSHA256 = await hashFile(asset)
  await writeFile(`${asset}.sha256`, `${assetSHA256}  ${assetName}\n`)
  const receipt = {
    schemaVersion: 1, kind: 'eduwork-portable-extractor', format: 'zip-containing-self-extracting-exe',
    product: identity.product, version, distribution,
    payload: { name: filename, sha256: archiveSHA256, bytes: archiveBytes },
    extractor: { name: basename(exe), sha256: await hashFile(exe), bytes: (await stat(exe)).size,
      sourceCommit: (await run('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { capture: true })).stdout.trim(),
      sourceDirty: Boolean((await run('git', ['-C', repoRoot, 'status', '--porcelain'], { capture: true })).stdout.trim()), compiler },
    asset: { name: assetName, sha256: assetSHA256, bytes: (await stat(asset)).size },
    checks: { embeddedArchive: 'passed', manifestIdentity: 'passed', executionLevel: 'asInvoker' },
  }
  await writeJSON(`${asset}.json`, receipt)
  return receipt
}

export async function prepareWindowsPortableExtractor({ archive, expectedSHA256, outputDirectory, target, publishDirectory } = {}) {
  target = fullPath(target)
  publishDirectory = fullPath(publishDirectory)
  if (await pathExists(target)) throw new Error('Extractor acceptance requires a new destination')
  const receipt = await packPortableExtractor({ archive, expectedSHA256, outputDirectory })
  if (receipt.extractor.sourceDirty) throw new Error('CI extractor must be built from a clean source checkout')
  const asset = join(fullPath(outputDirectory), receipt.asset.name)
  const listing = (await run('tar.exe', ['-tf', asset], { capture: true })).stdout.trim().split(/\r?\n/)
  if (listing.length !== 1 || listing[0] !== receipt.extractor.name) throw new Error('Outer ZIP must contain only the extractor EXE')
  const delivered = await tarEntry(asset, receipt.extractor.name, { hash: true })
  if (delivered.bytes !== receipt.extractor.bytes || delivered.sha256 !== receipt.extractor.sha256) {
    throw new Error('Outer ZIP extractor differs from its receipt')
  }
  const report = join(fullPath(outputDirectory), 'extraction.json')
  await run(join(fullPath(outputDirectory), receipt.extractor.name), ['--extract-to', target, '--report', report])
  const extraction = JSON.parse(await readFile(report, 'utf8'))
  if (!extraction.success || fullPath(extraction.target) !== target || extraction.identity.sha256 !== expectedSHA256.toLowerCase()) {
    throw new Error('Extraction result does not match release payload or target')
  }
  receipt.checks.outerZIP = 'passed'
  receipt.checks.extraction = 'passed'
  const receiptName = `${receipt.asset.name}.json`
  const receiptPath = join(fullPath(outputDirectory), receiptName)
  await writeJSON(receiptPath, receipt)
  for (const name of [receipt.asset.name, `${receipt.asset.name}.sha256`, receiptName]) {
    const destination = join(publishDirectory, name)
    if (await pathExists(destination)) throw new Error(`Refusing to overwrite publish output: ${name}`)
    await copyFile(join(fullPath(outputDirectory), name), destination)
  }
  return { asset: receipt.asset, receipt: { name: receiptName, bytes: (await stat(receiptPath)).size, sha256: await sha256File(receiptPath) } }
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({ options: {
    archive: { type: 'string' }, 'expected-sha256': { type: 'string' }, output: { type: 'string' },
    target: { type: 'string' }, publish: { type: 'string' },
  } })
  if (!values.archive || !values['expected-sha256'] || !values.output) throw new Error('Use --archive --expected-sha256 --output')
  const result = values.target && values.publish
    ? await prepareWindowsPortableExtractor({ archive: values.archive, expectedSHA256: values['expected-sha256'], outputDirectory: values.output, target: values.target, publishDirectory: values.publish })
    : await packPortableExtractor({ archive: values.archive, expectedSHA256: values['expected-sha256'], outputDirectory: values.output })
  console.log(JSON.stringify(result))
}
