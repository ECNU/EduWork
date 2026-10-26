import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, rmdirSync } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { WRITABLE_ROOT_MARKER, writableRootMarker } from '../src/writable-root.mjs'

const run = promisify(execFile)
const RECEIPT = '.eduwork-migration-receipt.json'
const DATA_NAMESPACE = distribution => `${distribution}-electron`
const browserCaches = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache',
  'Shared Dictionary', 'Session Storage', 'lockfile', 'SingletonLock', 'DevToolsActivePort', 'declarative_performance_observer.db'])

const within = (root, target) => {
  let base = resolve(root), child = resolve(target)
  if (process.platform === 'win32') { base = base.toLowerCase(); child = child.toLowerCase() }
  const rel = relative(base, child)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep))
}
const same = (a, b) => process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b)
const hashFile = path => new Promise((resolveHash, reject) => {
  const hash = createHash('sha256')
  createReadStream(path).on('data', chunk => hash.update(chunk)).on('error', reject).on('end', () => resolveHash(hash.digest('hex')))
})
const readJSON = async (path, optional = false) => {
  try { return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')) }
  catch (error) { if (error.code === 'ENOENT' && optional) return undefined; throw error }
}
const lstatOptional = path => lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error })

function assertSeparate(source, target, label) {
  if (within(source, target) || within(target, source)) throw new Error(`${label} overlaps: ${source} / ${target}`)
}
function assertAbsolute(path, label) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error(`${label} must be an absolute path`)
}

async function listFiles(root, path, exclude = () => false) {
  const absolute = join(root, path)
  const info = await lstat(absolute)
  if (info.isSymbolicLink()) throw new Error(`Migration source contains a link: ${path}`)
  if (info.isFile()) return [{ path: '', absolute, bytes: info.size, sha256: await hashFile(absolute) }]
  if (!info.isDirectory()) throw new Error(`Migration source has an unsupported entry: ${path}`)
  const files = []
  const walk = async (directory, prefix) => {
    for (const name of (await readdir(directory)).sort()) {
      const child = join(directory, name), childPath = prefix ? prefix + '/' + name : name
      const stat = await lstat(child)
      if (stat.isSymbolicLink()) throw new Error(`Migration source contains a link: ${path}/${childPath}`)
      if (stat.isDirectory()) {
        if (!exclude(childPath, true)) await walk(child, childPath)
      } else if (stat.isFile()) {
        if (!exclude(childPath, false)) files.push({ path: childPath, absolute: child, bytes: stat.size, sha256: await hashFile(child) })
      } else throw new Error(`Migration source has an unsupported entry: ${path}/${childPath}`)
    }
  }
  await walk(absolute, '')
  return files
}

function mappingsFor(distribution) {
  const dsh = `data/${DATA_NAMESPACE(distribution)}/dsh`
  const browser = `data/${DATA_NAMESPACE(distribution)}/browser`
  const logs = `data/${DATA_NAMESPACE(distribution)}/logs`
  return [
    { from: 'config/eduwork.jsonc', to: 'config/eduwork.jsonc' },
    { from: 'config/examples', to: 'config/examples', optional: true },
    { from: 'config/update.bridge.json', to: 'config/update.bridge.json', optional: true },
    { from: dsh, to: dsh, exclude: path => path === '.skill-staging' || path.startsWith('.skill-staging/')
      || path === '.skill-trash' || path.startsWith('.skill-trash/')
      || path === 'attachments/v1/tmp' || path.startsWith('attachments/v1/tmp/') },
    { from: browser, to: browser, exclude: path => browserCaches.has(path.split('/')[0]) || path.split('/')[0].startsWith('declarative_performance_observer.db') },
    { from: logs, to: logs, optional: true },
    { from: 'data/state/update-preferences.json', to: 'data/state/update-preferences.json', optional: true },
    { from: 'data/state/software-update-preferences.json', to: 'data/state/software-update-preferences.json', optional: true },
    { from: 'data/configuration/eduwork.previous.jsonc', to: 'data/configuration/eduwork.previous.jsonc', optional: true },
  ]
}

async function inventorySelected(sourceRoot, distribution) {
  const files = [], skipped = [], warnings = []
  for (const mapping of mappingsFor(distribution)) {
    const absolute = join(sourceRoot, mapping.from)
    const info = await lstatOptional(absolute)
    if (!info) {
      if (mapping.optional) { skipped.push({ path: mapping.from, reason: 'missing' }); continue }
      throw new Error(`Required migration source is missing: ${mapping.from}`)
    }
    if (info.isSymbolicLink()) throw new Error(`Migration source contains a link: ${mapping.from}`)
    const list = await listFiles(sourceRoot, mapping.from, mapping.exclude)
    if (info.isDirectory() && mapping.exclude) {
      const top = (await readdir(absolute)).filter(name => mapping.exclude(name + '/', true))
      for (const name of top) skipped.push({ path: mapping.from + '/' + name, reason: 'excluded' })
    }
    for (const file of list) {
      const target = file.path ? mapping.to + '/' + file.path : mapping.to
      files.push({ source: file.path ? mapping.from + '/' + file.path : mapping.from, sourcePath: file.path, target,
        bytes: file.bytes, sha256: file.sha256, absolute: file.absolute })
    }
  }
  if (skipped.length) warnings.push(`Excluded migration paths: ${skipped.map(item => item.path).join(', ')}`)
  return { files, skipped, warnings }
}

async function checkRunning(sourceRoot, listProcesses) {
  const processes = await listProcesses()
  const matches = processes.filter(item => {
    const values = [item.ExecutablePath, item.CommandLine].filter(value => typeof value === 'string')
    return values.some(value => same(value, sourceRoot) || within(sourceRoot, value) || value.toLowerCase().includes(resolve(sourceRoot).toLowerCase()))
  })
  if (matches.length) throw new Error(`Old EduWork process is still running: ${matches.map(item => item.ProcessId).join(', ')}`)
}

async function defaultListProcesses() {
  if (process.platform !== 'win32') return []
  const command = "Get-CimInstance Win32_Process -Filter \"Name='EduWork-Electron.exe' OR Name='EduWork-Updater.exe' OR Name='ChatECNU-Work.exe'\" | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress"
  const { stdout } = await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, maxBuffer: 1024 * 1024 })
  const text = stdout.trim()
  if (!text) return []
  const value = JSON.parse(text)
  return Array.isArray(value) ? value : [value]
}

async function checkUpdateTransactions(sourceRoot) {
  const state = join(sourceRoot, 'data/state/updates')
  if (existsSync(join(state, 'pending-update.json'))) throw new Error('Source has a pending update; complete or recover it before migration')
  for (const name of ['transactions']) {
    const directory = join(state, name)
    if (existsSync(directory) && (await readdir(directory)).length) throw new Error(`Source has an unfinished update transaction: ${name}`)
  }
}

async function checkInternalWorkspaces(sourceRoot, dataRoot) {
  const registry = join(dataRoot, 'dsh/storages/workspace.json')
  if (!existsSync(registry)) return []
  const value = await readJSON(registry)
  const workspaces = value?.tables?.workspaces ?? {}
  const internal = []
  for (const record of Object.values(workspaces)) {
    if (typeof record?.path !== 'string') continue
    if (within(sourceRoot, record.path)) internal.push(record.path)
  }
  if (internal.length) throw new Error(`Program-directory workspaces require manual migration: ${internal.join(', ')}`)
  return []
}

async function checkCredentials(browserRoot) {
  if (existsSync(join(browserRoot, 'credentials.encrypted')) && !existsSync(join(browserRoot, 'Local State'))) {
    throw new Error('Credential vault requires browser/Local State; copy both together')
  }
}

async function targetState(targetRoot, sourceRoot, programRoot) {
  assertAbsolute(targetRoot, 'Writable root')
  assertSeparate(sourceRoot, targetRoot, 'Source and writable root')
  assertSeparate(programRoot, targetRoot, 'Program and writable root')
  const marker = join(targetRoot, WRITABLE_ROOT_MARKER)
  const info = await lstatOptional(targetRoot)
  if (!info) return undefined
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Target writable root is not a directory: ${targetRoot}`)
  if (existsSync(marker)) throw new Error(`Target writable root is already initialized: ${targetRoot}`)
  if ((await readdir(targetRoot)).length) throw new Error(`Target writable root is not empty: ${targetRoot}`)
  return { empty: true }
}

function assertManifest(manifest, desktop, release, label) {
  if (!manifest || manifest.schemaVersion !== 1 || manifest.kind !== 'eduwork-portable-release'
    || manifest.shell !== 'electron' || manifest.platform !== 'windows-x64') {
    throw new Error(`${label} RELEASE-MANIFEST.json is invalid`)
  }
  if (manifest.version !== desktop.productVersion || manifest.version !== release.version) {
    throw new Error(`${label} manifest version differs from desktop/release`)
  }
  if (manifest.distribution !== desktop.distribution) throw new Error(`${label} manifest distribution differs`)
  if (!Array.isArray(manifest.files) || !manifest.files.length
    || !manifest.files.some(file => file.path === 'resources/app/eduwork.desktop.json')
    || !manifest.files.some(file => file.path === 'config/eduwork.jsonc')) {
    throw new Error(`${label} RELEASE-MANIFEST.json is incomplete`)
  }
}

async function readManifest(root, label) {
  try { return await readJSON(join(root, 'RELEASE-MANIFEST.json')) }
  catch (error) { if (error.code === 'ENOENT') throw new Error(`${label} RELEASE-MANIFEST.json is missing`); throw error }
}

async function readIdentities(sourceRoot, targetRoot) {
  const sourceDesktop = await readJSON(join(sourceRoot, 'resources/app/eduwork.desktop.json'))
  const targetDesktop = await readJSON(join(targetRoot, 'resources/app/eduwork.desktop.json'))
  const sourceRelease = await readJSON(join(sourceRoot, 'release.json'))
  const targetRelease = await readJSON(join(targetRoot, 'release.json'))
  const sourceManifest = await readManifest(sourceRoot, 'Source')
  const targetManifest = await readManifest(targetRoot, 'Target')
  if (sourceDesktop.schemaVersion !== 1 || sourceDesktop.shell !== 'electron') throw new Error('Source desktop identity is invalid')
  if (targetDesktop.schemaVersion !== 1 || targetDesktop.shell !== 'electron') throw new Error('Target desktop identity is invalid')
  if (sourceDesktop.dataLayout !== undefined && sourceDesktop.dataLayout !== 'portable') throw new Error('Source must use the portable data layout')
  if (targetDesktop.dataLayout !== 'installed') throw new Error('Target must use the installed data layout')
  if (sourceDesktop.distribution !== targetDesktop.distribution) throw new Error('Source and target distributions differ')
  if (sourceDesktop.appId !== targetDesktop.appId) throw new Error('Source and target appIds differ')
  const expectedAppId = `org.eduwork.${sourceDesktop.distribution}.electron`
  if (sourceDesktop.appId !== expectedAppId) throw new Error('Source appId does not match its distribution')
  if (sourceDesktop.productVersion !== sourceRelease.version) throw new Error('Source desktop and release versions differ')
  if (targetDesktop.productVersion !== targetRelease.version) throw new Error('Target desktop and release versions differ')
  if (typeof sourceRelease.dshVersion !== 'string' || !sourceRelease.dshVersion
    || typeof sourceRelease.dshCommit !== 'string' || !/^[a-f0-9]{40}$/i.test(sourceRelease.dshCommit)) {
    throw new Error('Source release DSH identity is missing')
  }
  if (typeof targetRelease.dshVersion !== 'string' || !targetRelease.dshVersion
    || typeof targetRelease.dshCommit !== 'string' || !/^[a-f0-9]{40}$/i.test(targetRelease.dshCommit)) {
    throw new Error('Target release DSH identity is missing')
  }
  if (sourceRelease.dshVersion !== targetRelease.dshVersion || sourceRelease.dshCommit !== targetRelease.dshCommit) throw new Error('Source and target DSH versions differ')
  const base = version => String(version ?? '').split('-')[0]
  if (base(sourceDesktop.productVersion) !== base(targetDesktop.productVersion)) throw new Error('Source and target product baselines differ')
  assertManifest(sourceManifest, sourceDesktop, sourceRelease, 'Source')
  assertManifest(targetManifest, targetDesktop, targetRelease, 'Target')
  const sourceDataRoot = join(sourceRoot, 'data', DATA_NAMESPACE(sourceDesktop.distribution))
  const sourceConfig = join(sourceRoot, 'config/eduwork.jsonc')
  if (!existsSync(sourceConfig)) throw new Error('Source configuration is missing')
  if (!existsSync(sourceDataRoot)) throw new Error('Source portable data root is missing')
  const identitySha256 = createHash('sha256').update(JSON.stringify({ sourceDesktop, sourceRelease })).digest('hex')
  return { sourceDesktop, targetDesktop, sourceRelease, targetRelease, sourceDataRoot, sourceConfig,
    sourceManifestSha256: await hashFile(join(sourceRoot, 'RELEASE-MANIFEST.json')),
    targetManifestSha256: await hashFile(join(targetRoot, 'RELEASE-MANIFEST.json')), identitySha256 }
}

export async function migratePortableToInstalled({ sourceRoot, targetRoot, writableRoot,
  listProcesses = defaultListProcesses, copyFileImpl = copyFile, writeReceiptImpl = writeFile,
  now = () => new Date().toISOString(), dryRun = false } = {}) {
  assertAbsolute(sourceRoot, 'Source program root')
  assertAbsolute(targetRoot, 'Target program root')
  assertAbsolute(writableRoot, 'Target writable root')
  sourceRoot = resolve(sourceRoot); targetRoot = resolve(targetRoot); writableRoot = resolve(writableRoot)
  assertSeparate(sourceRoot, targetRoot, 'Source and target program roots')
  const identity = await readIdentities(sourceRoot, targetRoot)
  const target = await targetState(writableRoot, sourceRoot, targetRoot)
  await checkRunning(sourceRoot, listProcesses)
  await checkUpdateTransactions(sourceRoot)
  await checkInternalWorkspaces(sourceRoot, identity.sourceDataRoot)
  await checkCredentials(join(identity.sourceDataRoot, 'browser'))
  const source = await inventorySelected(sourceRoot, identity.sourceDesktop.distribution)
  if (dryRun) return {
    dryRun: true, source: sourceRoot, writableRoot, targetRoot,
    identity: { distribution: identity.sourceDesktop.distribution, sourceVersion: identity.sourceDesktop.productVersion,
      targetVersion: identity.targetDesktop.productVersion, dshVersion: identity.sourceRelease.dshVersion },
    files: source.files.map(({ source, target, bytes, sha256 }) => ({ source, target, bytes, sha256 })),
    skipped: source.skipped, warnings: source.warnings,
  }

  const staging = join(dirname(writableRoot), `.eduwork-migration-${randomUUID()}.staging`)
  let activated = false
  try {
    await mkdir(staging)
    for (const file of source.files) {
      const destination = join(staging, file.target)
      await mkdir(dirname(destination), { recursive: true })
      await copyFileImpl(file.absolute, destination)
      if (await hashFile(destination) !== file.sha256) throw new Error(`Copied file hash differs: ${file.target}`)
    }
    const after = await inventorySelected(sourceRoot, identity.sourceDesktop.distribution)
    if (JSON.stringify(after.files.map(({ source: from, sourcePath, target, bytes, sha256 }) => ({ source: from, sourcePath, target, bytes, sha256 })))
      !== JSON.stringify(source.files.map(({ source: from, sourcePath, target, bytes, sha256 }) => ({ source: from, sourcePath, target, bytes, sha256 })))) {
      throw new Error('Source data changed during migration')
    }
    const marker = writableRootMarker({ distribution: identity.targetDesktop.distribution,
      productVersion: identity.targetDesktop.productVersion, now })
    await writeFile(join(staging, WRITABLE_ROOT_MARKER), JSON.stringify(marker, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    const receipt = {
      schemaVersion: 1, kind: 'eduwork-portable-to-installed-v1', state: 'staged',
      source: { root: sourceRoot, distribution: identity.sourceDesktop.distribution,
        productVersion: identity.sourceDesktop.productVersion, dshVersion: identity.sourceRelease.dshVersion,
        dshCommit: identity.sourceRelease.dshCommit, manifestSha256: identity.sourceManifestSha256,
        identitySha256: identity.identitySha256 },
      target: { root: writableRoot, programRoot: targetRoot, dataLayout: 'installed',
        distribution: identity.targetDesktop.distribution, productVersion: identity.targetDesktop.productVersion,
        manifestSha256: identity.targetManifestSha256 },
      files: source.files.map(({ source, target, bytes, sha256 }) => ({ source, target, bytes, sha256 })),
      skipped: source.skipped, warnings: source.warnings, createdAt: now(),
    }
    await writeReceiptAtomic(staging, receipt, writeReceiptImpl)
    // A process may have restarted during the copy. This narrows the window;
    // exclusive handoff/locking remains an integration precondition.
    await checkRunning(sourceRoot, listProcesses)
    receipt.state = 'activated'; receipt.activatedAt = now()
    // The activated receipt is durable in staging before W becomes visible.
    // A crash or write failure can therefore never leave an activated W with a
    // staged or missing receipt; failure here leaves no W at all.
    await writeReceiptAtomic(staging, receipt, writeReceiptImpl)
    if (target) rmdirSyncCompat(writableRoot)
    await rename(staging, writableRoot)
    activated = true
    return { source: sourceRoot, writableRoot, targetRoot, files: receipt.files, skipped: source.skipped, warnings: source.warnings, receipt }
  } finally {
    if (!activated) await rm(staging, { recursive: true, force: true }).catch(() => {})
  }
}

function rmdirSyncCompat(path) {
  // The empty target was checked above; use the directory-only removal so a
  // concurrent non-empty root is never deleted recursively.
  try { rmdirSync(path) } catch (error) { if (error.code !== 'ENOENT') throw error }
}

async function writeReceiptAtomic(staging, receipt, writeImpl) {
  const target = join(staging, RECEIPT)
  const temporary = target + '.' + randomUUID() + '.tmp'
  await writeImpl(temporary, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  await rename(temporary, target)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: {
    source: { type: 'string' }, 'target-root': { type: 'string' }, 'writable-root': { type: 'string' }, 'dry-run': { type: 'boolean' },
  } })
  if (!values.source || !values['target-root'] || !values['writable-root']) {
    throw new Error('Use --source <old-program-root> --target-root <installed-program-root> --writable-root <W> [--dry-run]')
  }
  const result = await migratePortableToInstalled({ sourceRoot: values.source, targetRoot: values['target-root'],
    writableRoot: values['writable-root'], dryRun: Boolean(values['dry-run']) })
  console.log(JSON.stringify(result, null, 2))
}
