import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, rmdirSync } from 'node:fs'
import { copyFile, lstat, mkdir, open, readdir, readFile, rename, rm, statfs, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { acquireInstanceMutex, comparablePath, instanceIdentity, releaseInstanceMutex } from '../src/install-mutex.mjs'
import { WRITABLE_ROOT_MARKER, writableRootMarker } from '../src/writable-root.mjs'

const run = promisify(execFile)
const RECEIPT = '.eduwork-migration-receipt.json'
const DATA_NAMESPACE = distribution => `${distribution}-electron`
const browserCaches = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache',
  'Shared Dictionary', 'Session Storage', 'lockfile', 'SingletonLock', 'DevToolsActivePort', 'declarative_performance_observer.db'])

const within = (root, target) => {
  const base = comparablePath(root), child = comparablePath(target)
  const rel = relative(base, child)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep))
}
const same = (a, b) => comparablePath(a) === comparablePath(b)
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

async function checkRunning(sourceRoots, listProcesses) {
  const roots = (Array.isArray(sourceRoots) ? sourceRoots : [sourceRoots]).map(root => resolve(root))
  const physicalRoots = roots.map(root => instanceIdentity(root))
  const processes = await listProcesses()
  const knownNames = new Set(['EduWork-Electron.exe', 'EduWork-Updater.exe', 'ChatECNU-Work.exe', 'node.exe', 'python.exe'])
  const matches = processes.filter(item => {
    if (item.ProcessId === process.pid) return false
    const executable = typeof item.ExecutablePath === 'string' ? item.ExecutablePath : ''
    if (executable) {
      const identity = instanceIdentity(executable)
      if (physicalRoots.some(root => same(identity, root) || within(root, identity))) return true
    }
    if (!knownNames.has(item.Name)) return false
    const values = [item.ExecutablePath, item.CommandLine].filter(value => typeof value === 'string')
    return roots.some(root => values.some(value => same(value, root) || within(root, value) || value.toLowerCase().includes(root.toLowerCase())))
  })
  if (matches.length) throw new Error(`Old EduWork process is still running: ${matches.map(item => item.ProcessId).join(', ')}`)
}

const inventorySignature = files => files.map(({ source, sourcePath, target, bytes, sha256 }) => ({ source, sourcePath, target, bytes, sha256 }))
const sameInventory = (left, right) => JSON.stringify(inventorySignature(left)) === JSON.stringify(inventorySignature(right))

async function restoreSource(sourceRoot, handoffRoot) {
  if (!existsSync(handoffRoot)) return
  if (existsSync(sourceRoot)) throw new Error(`Original source path was recreated; handoff preserved at ${handoffRoot}`)
  await rename(handoffRoot, sourceRoot)
}

const MIGRATION_HEADROOM_BYTES = 16 * 1024 * 1024
const requiredSpace = files => files.reduce((total, file) => total + file.bytes, 0) + MIGRATION_HEADROOM_BYTES

function nearestExisting(path) {
  let current = resolve(path)
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return current
}

async function availableSpace(root, statfsImpl) {
  const stats = await statfsImpl(root)
  const blockSize = Number(stats.bsize)
  const blocks = Number(stats.bavail ?? stats.bfree)
  if (!Number.isFinite(blockSize) || blockSize <= 0 || !Number.isFinite(blocks) || blocks < 0) {
    throw new Error('Filesystem free-space values are invalid')
  }
  return blockSize * blocks
}

const journalPathFor = sourceRoot => sourceRoot + '.handoff.json'
const isOwnedStaging = (path, writableRoot) => {
  const absolute = resolve(path)
  return dirname(absolute) === resolve(dirname(writableRoot))
    && /^\.eduwork-migration-.+\.staging$/u.test(basename(absolute))
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true }
  catch (error) { return error.code === 'EPERM' }
}

async function writeJournal(path, value) {
  if (existsSync(path)) throw new Error(`Handoff journal already exists: ${path}`)
  const temporary = path + '.tmp-' + randomUUID()
  try {
    const handle = await open(temporary, 'wx')
    try {
      await handle.writeFile(JSON.stringify(value, null, 2) + '\n')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

async function inspectHandoff({ sourceRoot, targetRoot, writableRoot }) {
  const journalPath = journalPathFor(sourceRoot)
  const sourceExists = existsSync(sourceRoot)
  if (!existsSync(journalPath)) {
    if (sourceExists) return undefined
    const receipt = await readJSON(join(writableRoot, RECEIPT), true).catch(() => undefined)
    if (receipt?.kind === 'eduwork-portable-to-installed-v1'
      && (receipt.state === 'activated' || receipt.state === 'verified')
      && typeof receipt.source?.root === 'string' && same(receipt.source.root, sourceRoot)
      && typeof receipt.source?.handoffRoot === 'string' && existsSync(receipt.source.handoffRoot)
      && (typeof receipt.target?.programRoot !== 'string' || same(receipt.target.programRoot, targetRoot))) {
      return { action: 'committed', journalPath, handoffRoot: receipt.source.handoffRoot, reason: 'receipt' }
    }
    return { action: 'manual', journalPath, reason: 'source-missing-no-journal' }
  }
  let journal
  try { journal = await readJSON(journalPath) } catch { journal = undefined }
  if (!journal || journal.schemaVersion !== 1 || journal.kind !== 'eduwork-handoff-v1'
    || typeof journal.sourceRoot !== 'string' || typeof journal.targetRoot !== 'string'
    || typeof journal.writableRoot !== 'string' || typeof journal.handoffRoot !== 'string'
    || typeof journal.staging !== 'string') {
    return { action: 'manual', journalPath, reason: 'invalid-journal' }
  }
  if (!same(journal.sourceRoot, sourceRoot) || !same(journal.targetRoot, targetRoot) || !same(journal.writableRoot, writableRoot)) {
    return { action: 'manual', journalPath, journal, reason: 'journal-mismatch' }
  }
  if (!isAbsolute(journal.handoffRoot) || !same(dirname(resolve(journal.handoffRoot)), dirname(sourceRoot))
    || !basename(journal.handoffRoot).startsWith(basename(sourceRoot) + '.handoff-')
    || !isAbsolute(journal.staging) || !isOwnedStaging(journal.staging, writableRoot)) {
    return { action: 'manual', journalPath, journal, reason: 'invalid-journal-paths' }
  }
  if (journal.pid !== process.pid && isProcessAlive(journal.pid)) {
    return { action: 'in-progress', journalPath, journal, pid: journal.pid, reason: 'journal-owner-alive' }
  }
  const handoffExists = existsSync(journal.handoffRoot)
  if (sourceExists && !handoffExists) {
    return { action: 'cleanup-stale', journalPath, journal, staging: journal.staging }
  }
  if (sourceExists && handoffExists) {
    return { action: 'manual', journalPath, journal, reason: 'source-and-handoff' }
  }
  if (!sourceExists && handoffExists) {
    if (existsSync(writableRoot)) {
      const receipt = await readJSON(join(writableRoot, RECEIPT), true).catch(() => undefined)
      if (receipt?.kind === 'eduwork-portable-to-installed-v1'
        && typeof receipt.source?.handoffRoot === 'string' && same(receipt.source.handoffRoot, journal.handoffRoot)
        && (receipt.state === 'activated' || receipt.state === 'verified')) {
        return { action: 'committed', journalPath, journal, handoffRoot: journal.handoffRoot, reason: 'receipt' }
      }
      if (journal.targetWasEmptyAtHandoff === true) {
        let empty = false
        try { empty = (await readdir(writableRoot)).length === 0 } catch {}
        if (empty) return { action: 'restore', journalPath, journal, handoffRoot: journal.handoffRoot, staging: journal.staging }
      }
      return { action: 'manual', journalPath, journal, reason: 'target-conflict' }
    }
    return { action: 'restore', journalPath, journal, handoffRoot: journal.handoffRoot, staging: journal.staging }
  }
  return { action: 'manual', journalPath, journal, reason: 'source-and-handoff-missing' }
}

async function recoverHandoff({ sourceRoot, targetRoot, writableRoot, dryRun = false }) {
  const plan = await inspectHandoff({ sourceRoot, targetRoot, writableRoot })
  if (!plan) return undefined
  if (dryRun) return plan
  switch (plan.action) {
    case 'in-progress':
      throw new Error(`Another migration is in progress (pid ${plan.pid}): ${plan.journalPath}`)
    case 'committed':
      throw new Error(`Migration already activated; source is preserved at ${plan.handoffRoot}`)
    case 'manual':
      throw new Error(`Handoff recovery requires manual action (${plan.reason}): ${plan.journalPath || sourceRoot}`)
    case 'cleanup-stale':
      await rm(plan.staging, { recursive: true, force: true }).catch(() => {})
      await rm(plan.journalPath, { force: true })
      return { ...plan, recovered: false, cleaned: true }
    case 'restore':
      await rename(plan.handoffRoot, sourceRoot)
      await rm(plan.staging, { recursive: true, force: true }).catch(() => {})
      await rm(plan.journalPath, { force: true })
      return { ...plan, recovered: true }
    default:
      throw new Error(`Unknown handoff recovery action: ${plan.action}`)
  }
}

async function defaultListProcesses() {
  if (process.platform !== 'win32') return []
  const command = "Get-CimInstance Win32_Process | Select-Object ProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress"
  const { stdout } = await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
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
  // A recorded external path may be a link that resolves into the program directory.
  const physicalSource = instanceIdentity(sourceRoot)
  const internal = []
  for (const record of Object.values(workspaces)) {
    if (typeof record?.path !== 'string') continue
    if (within(physicalSource, instanceIdentity(record.path))) internal.push(record.path)
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

export async function migratePortableToInstalled(options = {}) {
  const { sourceRoot, targetRoot, writableRoot, dryRun = false } = options
  assertAbsolute(sourceRoot, 'Source program root')
  assertAbsolute(targetRoot, 'Target program root')
  assertAbsolute(writableRoot, 'Target writable root')
  const source = resolve(sourceRoot), target = resolve(targetRoot), writable = resolve(writableRoot)
  if (dryRun) {
    return migrateInternal({ ...options, sourceRoot: source, targetRoot: target, writableRoot: writable, dryRun: true })
  }
  assertSeparate(source, target, 'Source and target program roots')
  assertSeparate(source, writable, 'Source and writable root')
  assertSeparate(target, writable, 'Program and writable root')
  const sourceMutex = await acquireInstanceMutex('source', source, 'Another migration is in progress')
  let writableMutex
  try {
    writableMutex = await acquireInstanceMutex('writable', writable, 'Another migration or client is using the writable root')
    return await migrateInternal({ ...options, sourceRoot: source, targetRoot: target, writableRoot: writable, dryRun: false })
  } finally {
    await releaseInstanceMutex(writableMutex)
    await releaseInstanceMutex(sourceMutex)
  }
}

async function migrateInternal({ sourceRoot, targetRoot, writableRoot,
  listProcesses = defaultListProcesses, copyFileImpl = copyFile, writeReceiptImpl = writeFile,
  handoffImpl = rename, statfsImpl = statfs, now = () => new Date().toISOString(), dryRun = false } = {}) {
  assertAbsolute(sourceRoot, 'Source program root')
  assertAbsolute(targetRoot, 'Target program root')
  assertAbsolute(writableRoot, 'Target writable root')
  sourceRoot = resolve(sourceRoot); targetRoot = resolve(targetRoot); writableRoot = resolve(writableRoot)
  const recovery = await recoverHandoff({ sourceRoot, targetRoot, writableRoot, dryRun })
  if (dryRun && recovery) return {
    dryRun: true, source: sourceRoot, writableRoot, targetRoot, recovery,
    files: [], skipped: [], warnings: [],
  }
  assertSeparate(sourceRoot, targetRoot, 'Source and target program roots')
  const identity = await readIdentities(sourceRoot, targetRoot)
  const target = await targetState(writableRoot, sourceRoot, targetRoot)
  await checkRunning(sourceRoot, listProcesses)
  await checkUpdateTransactions(sourceRoot)
  await checkInternalWorkspaces(sourceRoot, identity.sourceDataRoot)
  await checkCredentials(join(identity.sourceDataRoot, 'browser'))
  const source = await inventorySelected(sourceRoot, identity.sourceDesktop.distribution)
  const spaceRequired = requiredSpace(source.files)
  let spaceFree, spaceError
  try { spaceFree = await availableSpace(nearestExisting(dirname(writableRoot)), statfsImpl) }
  catch (error) { spaceError = error }
  if (dryRun) return {
    dryRun: true, source: sourceRoot, writableRoot, targetRoot,
    identity: { distribution: identity.sourceDesktop.distribution, sourceVersion: identity.sourceDesktop.productVersion,
      targetVersion: identity.targetDesktop.productVersion, dshVersion: identity.sourceRelease.dshVersion },
    files: source.files.map(({ source, target, bytes, sha256 }) => ({ source, target, bytes, sha256 })),
    skipped: source.skipped, warnings: source.warnings,
    space: { requiredBytes: spaceRequired, freeBytes: spaceFree ?? null, error: spaceError?.message },
  }
  if (spaceError) throw new Error(`Unable to determine free space for migration: ${spaceError.message}`)
  if (spaceFree < spaceRequired) {
    throw new Error(`Insufficient free space for migration: need ${spaceRequired} bytes, available ${spaceFree}`)
  }
  const space = { requiredBytes: spaceRequired, freeBytes: spaceFree }
  await mkdir(dirname(writableRoot), { recursive: true })

  const handoffRoot = sourceRoot + '.handoff-' + randomUUID()
  const staging = join(dirname(writableRoot), `.eduwork-migration-${randomUUID()}.staging`)
  const journalPath = journalPathFor(sourceRoot)
  const journal = {
    schemaVersion: 1, kind: 'eduwork-handoff-v1', sourceRoot, handoffRoot, staging,
    targetRoot, writableRoot, targetWasEmptyAtHandoff: Boolean(target), createdAt: now(), pid: process.pid,
  }
  let sourceHandoffRoot, activated = false, journalPublished = false
  try {
    await writeJournal(journalPath, journal)
    journalPublished = true
    sourceHandoffRoot = handoffRoot
    try {
      await handoffImpl(sourceRoot, handoffRoot)
    } catch (error) {
      if (['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(error.code)) {
        throw new Error(`Old program directory is in use or cannot be moved aside: ${sourceRoot} (${error.code})`)
      }
      throw error
    }
    await checkRunning([sourceRoot, sourceHandoffRoot], listProcesses)
    await checkUpdateTransactions(sourceHandoffRoot)
    const afterHandoff = await inventorySelected(sourceHandoffRoot, identity.sourceDesktop.distribution)
    if (!sameInventory(source.files, afterHandoff.files)) throw new Error('Source data changed before migration')

    await mkdir(staging)
    for (const file of afterHandoff.files) {
      const destination = join(staging, file.target)
      await mkdir(dirname(destination), { recursive: true })
      await copyFileImpl(join(sourceHandoffRoot, file.source), destination)
      if (await hashFile(destination) !== file.sha256) throw new Error(`Copied file hash differs: ${file.target}`)
    }
    const after = await inventorySelected(sourceHandoffRoot, identity.sourceDesktop.distribution)
    if (!sameInventory(afterHandoff.files, after.files)) throw new Error('Source data changed during migration')
    await checkUpdateTransactions(sourceHandoffRoot)

    const marker = writableRootMarker({ distribution: identity.targetDesktop.distribution,
      productVersion: identity.targetDesktop.productVersion, now })
    await writeFile(join(staging, WRITABLE_ROOT_MARKER), JSON.stringify(marker, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    const receipt = {
      schemaVersion: 1, kind: 'eduwork-portable-to-installed-v1', state: 'staged',
      source: { root: sourceRoot, handoffRoot: sourceHandoffRoot, handoffAt: now(),
        distribution: identity.sourceDesktop.distribution,
        productVersion: identity.sourceDesktop.productVersion, dshVersion: identity.sourceRelease.dshVersion,
        dshCommit: identity.sourceRelease.dshCommit, manifestSha256: identity.sourceManifestSha256,
        identitySha256: identity.identitySha256 },
      target: { root: writableRoot, programRoot: targetRoot, dataLayout: 'installed',
        distribution: identity.targetDesktop.distribution, productVersion: identity.targetDesktop.productVersion,
        manifestSha256: identity.targetManifestSha256 },
      files: afterHandoff.files.map(({ source, target, bytes, sha256 }) => ({ source, target, bytes, sha256 })),
      space, skipped: source.skipped, warnings: source.warnings, createdAt: now(),
    }
    await writeReceiptAtomic(staging, receipt, writeReceiptImpl)
    // The old program is already moved aside; a process can no longer start
    // from the original path. Recheck the handoff path and update state before
    // activation.
    await checkRunning([sourceRoot, sourceHandoffRoot], listProcesses)
    await checkUpdateTransactions(sourceHandoffRoot)
    receipt.state = 'activated'; receipt.activatedAt = now()
    // The activated receipt is durable in staging before W becomes visible.
    // A crash or write failure can therefore never leave an activated W with a
    // staged or missing receipt; failure here leaves no W at all.
    await writeReceiptAtomic(staging, receipt, writeReceiptImpl)
    if (target) rmdirSyncCompat(writableRoot)
    await rename(staging, writableRoot)
    activated = true
    if (journalPublished) await rm(journalPath, { force: true }).catch(() => {})
    return { source: sourceRoot, sourceHandoffRoot, writableRoot, targetRoot,
      files: receipt.files, skipped: source.skipped, warnings: source.warnings, space, receipt }
  } catch (error) {
    let restored = !sourceHandoffRoot
    if (sourceHandoffRoot && !activated) {
      try {
        await restoreSource(sourceRoot, sourceHandoffRoot)
        restored = true
      } catch (restoreError) {
        throw new Error(`${error.message}; failed to restore old program path: ${restoreError.message}`)
      }
    }
    if (journalPublished && restored) await rm(journalPath, { force: true }).catch(() => {})
    throw error
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
    throw new Error('Use --source <old-program-root> --target-root <installed-program-root> --writable-root <W> [--dry-run]; the source is moved aside during migration and restored on failure')
  }
  const result = await migratePortableToInstalled({ sourceRoot: values.source, targetRoot: values['target-root'],
    writableRoot: values['writable-root'], dryRun: Boolean(values['dry-run']) })
  console.log(JSON.stringify(result, null, 2))
}
