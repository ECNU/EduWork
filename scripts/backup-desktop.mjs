import { createHash } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, rmdir, statfs } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { capture, childPath, isInside, isMainModule, readJSON, statEntry, writeJSON } from './lib/build-util.mjs'

const BACKUP_MANIFEST = 'BACKUP-MANIFEST.json'
const RELEASE_MANIFEST = 'RELEASE-MANIFEST.json'
const desktopPath = 'resources/app/eduwork.desktop.json'
const assemblyPath = 'resources/product/assembly.json'
const browserCaches = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache',
  'Shared Dictionary', 'Session Storage', 'lockfile', 'SingletonLock', 'DevToolsActivePort'])
const digest = value => createHash('sha256').update(value).digest('hex')
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const programPath = path => path !== RELEASE_MANIFEST && !['config', 'data'].includes(path.split('/')[0])

function safeRelative(path) {
  if (typeof path !== 'string' || !path || path.split('/').some(part => !part || part === '.' || part === '..'
    || /[<>:"\\|?*\x00-\x1f]/u.test(part) || /[ .]$/u.test(part)
    || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)(?:\.|$)/iu.test(part))) {
    throw new Error(`Unsafe Windows path: ${path}`)
  }
  return path
}

async function hashFile(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

// Resolve existing ancestors as well, so a missing target cannot hide a path overlap.
async function canonical(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('Use absolute directory paths')
  path = resolve(path)
  const info = await statEntry(path)
  if (info?.isSymbolicLink()) throw new Error(`Directory must not be a link: ${path}`)
  if (info) return realpath(path)
  return join(await canonical(dirname(path)), basename(path))
}

function separate(...paths) {
  for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) {
    if (isInside(paths[i], paths[j]) || isInside(paths[j], paths[i])) throw new Error('Input and output directories overlap')
  }
}

function selected(path, distribution) {
  const namespace = `data/${distribution}-electron`
  const roots = ['config', `${namespace}/dsh`, `${namespace}/browser`, `${namespace}/logs`,
    'data/state', 'data/configuration', 'data/content-updates', 'data/publisher-bootstrap']
  if (!roots.some(root => path === root || path.startsWith(root + '/') || root.startsWith(path + '/'))) return false
  if (path === 'data/state/updates' || path.startsWith('data/state/updates/')) return false
  const home = `${namespace}/dsh/`, browser = `${namespace}/browser/`
  if (path.startsWith(home)) {
    const local = path.slice(home.length)
    if (['.skill-staging', '.skill-trash', 'attachments/v1/tmp'].some(root => local === root || local.startsWith(root + '/'))) return false
  }
  if (path.startsWith(browser)) {
    const first = path.slice(browser.length).split('/')[0]
    if (browserCaches.has(first) || first.startsWith('declarative_performance_observer.db')) return false
  }
  return true
}

async function inventory(root, include = () => true) {
  const files = [], directories = []
  const walk = async (path, relative = '') => {
    const info = await lstat(path)
    if (info.isSymbolicLink()) throw new Error(`Filesystem links are not supported: ${relative || path}`)
    if (info.isDirectory()) {
      if (relative) directories.push(relative)
      const names = (await readdir(path)).sort(), seen = new Set()
      for (const name of names) {
        const child = relative ? `${relative}/${name}` : name
        if (!include(child)) continue
        safeRelative(child)
        const key = name.normalize('NFC').toLowerCase()
        if (seen.has(key)) throw new Error(`Case-colliding path: ${child}`)
        seen.add(key)
        await walk(join(path, name), child)
      }
    } else if (info.isFile()) {
      files.push({ path: relative, bytes: info.size, sha256: await hashFile(path) })
    } else throw new Error(`Unsupported filesystem entry: ${relative}`)
  }
  await walk(root)
  return { directories: directories.sort(), files: files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) }
}

function fileRows(files) {
  if (!Array.isArray(files)) throw new Error('File manifest is missing')
  const seen = new Set()
  return files.map(file => {
    const path = safeRelative(file.path), key = path.normalize('NFC').toLowerCase()
    if (seen.has(key) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/u.test(file.sha256)) {
      throw new Error(`Invalid or duplicate manifest entry: ${path}`)
    }
    seen.add(key)
    return { path, bytes: file.bytes, sha256: file.sha256 }
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}

async function readProgram(root) {
  const tree = await inventory(root, programPath)
  if (!(await lstat(join(root, RELEASE_MANIFEST))).isFile()) throw new Error('Release manifest must be a regular file')
  const manifestBytes = await readFile(join(root, RELEASE_MANIFEST))
  const manifest = JSON.parse(manifestBytes)
  const files = fileRows(manifest.files)
  if (manifest.schemaVersion !== 1 || manifest.kind !== 'eduwork-portable-release'
    || manifest.shell !== 'electron' || manifest.platform !== 'windows-x64'
    || files.some(file => file.path === RELEASE_MANIFEST || file.path.split('/')[0] === 'data')
    || !same(files.filter(file => programPath(file.path)), tree.files)) {
    throw new Error('Program files differ from the Windows portable release manifest')
  }
  for (const required of [desktopPath, assemblyPath, 'release.json', 'EduWork-Electron.exe', 'config/eduwork.jsonc']) {
    if (!files.some(file => file.path === required)) throw new Error(`Release manifest is missing ${required}`)
  }
  const desktop = await readJSON(join(root, desktopPath)), release = await readJSON(join(root, 'release.json'))
  const assembly = await readJSON(join(root, assemblyPath))
  if (desktop.schemaVersion !== 1 || desktop.shell !== 'electron' || !/^[a-z0-9-]+$/u.test(desktop.distribution)
    || desktop.appId !== `org.eduwork.${desktop.distribution}.electron`
    || desktop.dataLayout && desktop.dataLayout !== 'portable'
    || desktop.product !== '../product' || desktop.node !== '../runtime/node.exe'
    || desktop.productVersion !== manifest.version || desktop.distribution !== manifest.distribution
    || release.schemaVersion !== 1 || release.shell !== 'electron' || release.version !== manifest.version
    || release.distribution !== manifest.distribution || !release.dshVersion || !/^[a-f0-9]{40}$/u.test(release.dshCommit)
    || assembly.schemaVersion !== 1 || assembly.version !== manifest.version || assembly.distribution !== manifest.distribution
    || assembly.dshVersion !== release.dshVersion || assembly.dshCommit !== release.dshCommit) {
    throw new Error('Desktop, release and component identities do not match a supported portable build')
  }
  return {
    combination: { platform: manifest.platform, version: manifest.version, distribution: manifest.distribution,
      appId: desktop.appId, dshVersion: release.dshVersion, dshCommit: release.dshCommit,
      programFilesSHA256: digest(JSON.stringify(tree.files)) },
    components: { sourcePackages: assembly.sourcePackages, externalPackages: assembly.externalPackages,
      managedPackages: assembly.managedPackages, pluginInstallLockSHA256: assembly.pluginInstallLockSHA256 },
    directories: tree.directories,
    files: [...tree.files, { path: RELEASE_MANIFEST, bytes: manifestBytes.length, sha256: digest(manifestBytes) }],
  }
}

async function listWindowsProcesses() {
  const command = '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); @(Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object ProcessId,Name,ExecutablePath,CommandLine) | ConvertTo-Json -Compress'
  const value = JSON.parse(await capture('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command]))
  return Array.isArray(value) ? value : [value]
}

async function stopped(roots, listProcesses) {
  const processes = await listProcesses()
  if (!Array.isArray(processes) || !processes.length || processes.some(item => !Number.isInteger(item?.ProcessId))) {
    throw new Error('Could not verify running Windows processes')
  }
  for (const item of processes) {
    if (item.ProcessId === process.pid) continue
    const executable = item.ExecutablePath ? await realpath(item.ExecutablePath).catch(error => {
      if (error.code === 'ENOENT') return item.ExecutablePath
      throw error
    }) : ''
    const command = (item.CommandLine ?? '').replaceAll('\\', '/').toLowerCase()
    if (roots.some(root => executable && isInside(root, executable) || command.includes(root.replaceAll('\\', '/').toLowerCase()))
      || /^(?:EduWork-Electron|EduWork-Updater|EduWork|ChatECNU-Work|node|python|pythonw)\.exe$/iu.test(item.Name ?? '') && !executable && !command) {
      throw new Error(`Close EduWork and related processes before copying (pid ${item.ProcessId})`)
    }
  }
}

async function checkData(root, distribution, excludedRoots, files) {
  const namespace = `data/${distribution}-electron`
  if (!(await statEntry(join(root, 'config/eduwork.jsonc')))?.isFile()
    || !(await statEntry(join(root, namespace, 'dsh')))?.isDirectory()
    || !(await statEntry(join(root, namespace, 'browser')))?.isDirectory()) throw new Error('Portable configuration, DSH home or browser data is missing')
  const browser = join(root, namespace, 'browser')
  const vault = await statEntry(join(browser, 'credentials.encrypted'))
  if (vault && (!vault.isFile() || !(await statEntry(join(browser, 'Local State')))?.isFile())) {
    throw new Error('Credential vault requires browser/Local State')
  }
  for (const file of files.filter(file => file.path === 'data/configuration/state.json' || /^data\/content-updates\/[^/]+\/state\.json$/u.test(file.path))) {
    const state = await readJSON(join(root, file.path))
    if (state.schemaVersion !== 1 || state.trial || state.pending || state.retryable) throw new Error('Complete or recover the configuration/content update before copying')
    if (file.path === 'data/configuration/state.json' && state.configuration !== '../config/eduwork.jsonc') {
      throw new Error('Only the default portable configuration path is supported')
    }
  }
  const registry = join(root, namespace, 'dsh/storages/workspace.json')
  if (await statEntry(registry)) {
    const value = await readJSON(registry)
    if (value?.unit?.name !== 'workspace' || value.unit.version !== 2 || !value.tables?.workspaces
      || Array.isArray(value.tables.workspaces) || typeof value.tables.workspaces !== 'object') throw new Error('Unsupported workspace registry')
    for (const row of Object.values(value.tables.workspaces)) {
      if (!isAbsolute(row?.path ?? '')) throw new Error('Workspace must have an absolute external path')
      const path = await canonical(row.path)
      if (excludedRoots.some(root => isInside(root, path) || isInside(path, root))) throw new Error('Workspace overlaps a backup, program or restore directory; move it separately first')
    }
  }
}

async function noPendingUpdate(root) {
  const state = join(root, 'data/state/updates')
  if (await statEntry(join(state, 'pending-update.json'))
    || await statEntry(join(state, 'transactions')) && (await readdir(join(state, 'transactions'))).length) {
    throw new Error('Complete or recover the pending update before copying')
  }
}

async function emptyTarget(target) {
  const info = await statEntry(target)
  if (info && (!info.isDirectory() || info.isSymbolicLink() || (await readdir(target)).length)) throw new Error('Target must be absent or an empty real directory')
  return Boolean(info)
}

async function capacity(target, files, statfsImpl) {
  const space = await statfsImpl(dirname(target), { bigint: true })
  const blocks = BigInt(space.bavail), blockSize = BigInt(space.bsize)
  if (blocks < 0n || blockSize <= 0n) throw new Error('Could not verify available disk space')
  const available = blocks * blockSize
  const required = files.reduce((total, file) => total + BigInt(file.bytes), 16n * 1024n * 1024n)
  if (available < required) throw new Error('Insufficient free space for the copy and 16 MiB reserve')
}

async function copyInventory(source, target, tree, copyFileImpl) {
  for (const path of tree.directories) await mkdir(childPath(target, safeRelative(path)), { recursive: true })
  for (const file of tree.files) {
    const from = childPath(source, file.path), to = childPath(target, file.path)
    if (!(await lstat(from)).isFile()) throw new Error(`Source file changed: ${file.path}`)
    await mkdir(dirname(to), { recursive: true })
    await copyFileImpl(from, to, constants.COPYFILE_EXCL)
    if (await hashFile(to) !== file.sha256) throw new Error(`Copied file hash differs: ${file.path}`)
  }
}

async function stageOutput(target, build) {
  const staging = await mkdtemp(join(dirname(target), '.eduwork-backup-'))
  let removedEmpty = false
  try {
    await build(staging)
    if (await emptyTarget(target)) { await rmdir(target); removedEmpty = true }
    await rename(staging, target)
  } catch (error) {
    if (removedEmpty && !await statEntry(target)) await mkdir(target)
    throw error
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

function windowsOnly(platform) {
  if (platform !== 'win32') throw new Error('This prototype supports Windows portable builds only')
}

export async function backupDesktop({ source, output, dryRun = false, platform = process.platform,
  listProcesses = listWindowsProcesses, copyFileImpl = copyFile, statfsImpl = statfs } = {}) {
  windowsOnly(platform)
  const processRoots = [source, output]
  source = await canonical(source); output = await canonical(output)
  processRoots.push(source, output)
  separate(source, output)
  await emptyTarget(output)
  await stopped(processRoots, listProcesses)
  await noPendingUpdate(source)
  const program = await readProgram(source), distribution = program.combination.distribution
  const tree = await inventory(source, path => selected(path, distribution))
  await checkData(source, distribution, [source, output], tree.files)
  await capacity(output, tree.files, statfsImpl)
  const manifest = { schemaVersion: 1, kind: 'eduwork-portable-backup', createdAt: new Date().toISOString(),
    sourceRoot: source, combination: program.combination, components: program.components, ...tree }
  if (!dryRun) await stageOutput(output, async staging => {
    const payload = join(staging, 'payload')
    await mkdir(payload)
    await copyInventory(source, payload, tree, copyFileImpl)
    if (!same(tree, await inventory(payload)) || !same(tree, await inventory(source, path => selected(path, distribution)))
      || !same(program, await readProgram(source))) throw new Error('Source changed during backup; no backup was activated')
    await noPendingUpdate(source)
    await stopped(processRoots, listProcesses)
    await writeJSON(join(staging, BACKUP_MANIFEST), manifest)
  })
  return { action: 'backup', dryRun, output, combination: manifest.combination, files: tree.files,
    directories: tree.directories, externalWorkspaces: 'references-only', credentials: 'copied-without-decryption' }
}

export async function restoreDesktop({ backup, program, target, dryRun = false, platform = process.platform,
  listProcesses = listWindowsProcesses, copyFileImpl = copyFile, statfsImpl = statfs } = {}) {
  windowsOnly(platform)
  const processRoots = [program, target]
  backup = await canonical(backup); program = await canonical(program); target = await canonical(target)
  processRoots.push(program, target)
  separate(backup, program, target)
  await emptyTarget(target)
  await stopped(processRoots, listProcesses)
  await noPendingUpdate(program)
  const backupTree = await inventory(backup)
  if (backupTree.files.some(file => file.path !== BACKUP_MANIFEST && !file.path.startsWith('payload/'))
    || backupTree.directories.some(path => path !== 'payload' && !path.startsWith('payload/'))) throw new Error('Backup contains unlisted top-level entries')
  const manifest = await readJSON(join(backup, BACKUP_MANIFEST)), prepared = await readProgram(program)
  if (manifest.schemaVersion !== 1 || manifest.kind !== 'eduwork-portable-backup' || !same(manifest.combination, prepared.combination)) {
    throw new Error('Backup requires exactly the same application, DSH, plugins and program files')
  }
  const distribution = prepared.combination.distribution, payload = join(backup, 'payload')
  const tree = { directories: manifest.directories, files: fileRows(manifest.files) }
  if (!Array.isArray(tree.directories) || tree.directories.some(path => !selected(safeRelative(path), distribution))
    || tree.files.some(file => !selected(file.path, distribution)) || !same(tree, await inventory(payload))) {
    throw new Error('Backup payload differs from its data scope, file list or hashes')
  }
  if (typeof manifest.sourceRoot !== 'string' || !isAbsolute(manifest.sourceRoot)) throw new Error('Backup source identity is missing')
  await checkData(payload, distribution, [manifest.sourceRoot, backup, program, target], tree.files)
  await capacity(target, [...prepared.files, ...tree.files], statfsImpl)
  if (!dryRun) await stageOutput(target, async staging => {
    await copyInventory(program, staging, prepared, copyFileImpl)
    await copyInventory(payload, staging, tree, copyFileImpl)
    if (!same(tree, await inventory(staging, path => selected(path, distribution)))
      || !same(backupTree, await inventory(backup)) || !same(prepared, await readProgram(program))
      || !same(prepared.combination, (await readProgram(staging)).combination)) throw new Error('Backup or program changed during restore; no target was activated')
    await noPendingUpdate(program)
    await stopped(processRoots, listProcesses)
  })
  return { action: 'restore', dryRun, target, combination: prepared.combination, files: tree.files,
    programFileCount: prepared.files.length, externalWorkspaces: 'references-only', credentials: 'copied-without-decryption' }
}

if (isMainModule(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    source: { type: 'string' }, output: { type: 'string' }, backup: { type: 'string' }, program: { type: 'string' },
    target: { type: 'string' }, 'dry-run': { type: 'boolean', default: false },
  } })
  const [action] = positionals
  if (positionals.length !== 1 || !['backup', 'restore'].includes(action)
    || action === 'backup' && (!values.source || !values.output || values.backup || values.program || values.target)
    || action === 'restore' && (!values.backup || !values.program || !values.target || values.source || values.output)) {
    throw new Error('Use backup --source <portable> --output <backup> or restore --backup <backup> --program <portable> --target <empty directory> [--dry-run]')
  }
  const options = { ...values, dryRun: values['dry-run'] }
  console.log(JSON.stringify(await (action === 'backup' ? backupDesktop(options) : restoreDesktop(options)), null, 2))
}
