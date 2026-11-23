import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, lstat, realpath, rename, rm, rmdir, statfs, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { remapSessionLogCwd, sessionDirectoryCwd } from './session-header-remap.mjs'
import * as jsonc from '../../dsh-host/vendor/jsonc-parser/parser.js'

// First import of an old portable Electron installation into the installed
// user directory. The Wails-era updater handshake stays in legacy-migration.mjs.
// The source is never modified; the target is activated only after a fully
// verified copy staged on the target's own volume.

const dshRetained = new Set(['sessions', 'attachments', 'storages', 'skills', 'plugins', 'derived', 'settings.yaml', 'memory.sqlite3', 'memory.sqlite3-wal', 'memory.sqlite3-shm', 'session-query-memory.sqlite3', 'session-query-memory.sqlite3-wal', 'session-query-memory.sqlite3-shm'])
// Regenerable Chromium state; everything else under browser/ is persistent.
const browserSkipped = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'ShaderCache', 'GrShaderCache', 'DIPS', 'DIPS-wal', 'Shared Dictionary', 'blob_storage', 'optimization_guide_prediction_model_store', 'component_crx_cache', 'extensions_cache', 'Safe Browsing', 'Segmentation Platform', 'Trust Tokens', 'trust_tokens.db', 'trust_tokens.db-journal'])
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
async function fileDigest(path) { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex') }
const within = (root, path) => path !== root && path.startsWith(root.endsWith(sep) ? root : root + sep)
const exists = async path => lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error })

// Resolve existing ancestors too: the target need not exist yet, and Windows
// may spell a parent with an 8.3 alias or a junction.
async function canonical(path) {
  path = resolve(path)
  try { return await realpath(path) }
  catch (error) {
    if (error.code !== 'ENOENT' || dirname(path) === path) throw error
    return join(await canonical(dirname(path)), basename(path))
  }
}
async function assertNoLinks(path) {
  for (let current = resolve(path); ; current = dirname(current)) {
    const info = await exists(current)
    if (info?.isSymbolicLink()) throw Error('迁移路径包含文件系统链接，请改用真实目录')
    if (dirname(current) === current) break
  }
}

async function sourceEntry(root, path) {
  if (!within(root, path)) throw Error('旧数据路径越界')
  let current = root, info = await exists(root)
  for (const part of relative(root, path).split(sep)) {
    if (info?.isSymbolicLink()) throw Error('旧数据包含链接，拒绝复制；请改用真实目录')
    if (!info) return null
    current = join(current, part)
    info = await exists(current)
  }
  if (info?.isSymbolicLink()) throw Error('旧数据包含链接，拒绝复制；请改用真实目录')
  if (info && !within(root, await realpath(path))) throw Error('旧数据路径越界')
  return info
}

function requireSourceFile(info) {
  if (!info?.isFile()) throw Error('旧数据包含非常规文件条目')
  return info
}

// Mirrors the runtime's projectKey (dsh-session-persistence-jsonl): separator
// runs collapse to '-', unsafe characters become ~XXXX, wrapped in '--'.
export function sessionProjectKey(cwd) {
  if (cwd.length === 0) throw Error('cannot encode an empty project path')
  let readable = '', separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i), ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') { if (!separatorRun) readable += '-'; separatorRun = true }
    else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) { readable += ch; separatorRun = false }
    else { readable += '~' + code.toString(16).toUpperCase().padStart(4, '0'); separatorRun = false }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

export async function inspectPortableSource({ sourceRoot, distribution }) {
  if (!sourceRoot || !isAbsolute(sourceRoot)) throw Error('旧客户端目录必须是绝对路径')
  const root = await canonical(sourceRoot)
  await assertNoLinks(sourceRoot)
  const readIdentity = async (path, missing) => {
    const info = await sourceEntry(root, path)
    if (!info) throw Error(missing)
    requireSourceFile(info)
    return JSON.parse(await readFile(path, 'utf8'))
  }
  const release = await readIdentity(join(root, 'release.json'), '所选目录不是 EduWork 便携客户端（缺少 release.json）')
  const desktop = await readIdentity(join(root, 'resources/app/eduwork.desktop.json'), '所选目录不是 EduWork Electron 便携客户端')
  if (release.shell !== 'electron' || desktop.shell !== 'electron') throw Error('所选目录不是 Electron 版客户端，旧 Wails 数据请走原有迁移入口')
  if (desktop.dataLayout === 'installed') throw Error('所选目录是安装形态客户端，其用户数据不在程序目录内')
  if (release.distribution !== distribution || desktop.distribution !== distribution) throw Error(`发行标识不符：所选目录属于 ${release.distribution}，当前版本为 ${distribution}`)
  const dataRoot = join(root, 'data', `${distribution}-electron`)
  const home = join(dataRoot, 'dsh')
  if (!(await sourceEntry(root, home))?.isDirectory()) throw Error('所选目录没有用户数据（data 下缺少 dsh 主目录）')
  return { root, version: release.version, dshVersion: release.dshVersion, dataRoot, home, browser: join(dataRoot, 'browser'), config: join(root, 'config/eduwork.jsonc') }
}

// Executables under the source root plus any process whose command line names
// it (the Host node runs from the product tree but serves the source data).
// The importer's own process chain is excluded; never a global process kill.
export function windowsSourceProcessLister(sourceRoot, selfPid = process.pid) {
  const root = resolve(sourceRoot)
  return async () => {
    const { spawn } = await import('node:child_process')
    // PowerShell 5.1 pipes OEM (GBK) text by default; force UTF-8 or Chinese
    // paths arrive mojibaked and the running-source check silently misses.
    const child = spawn('powershell', ['-NoProfile', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine | ConvertTo-Json -Compress'], { stdio: ['ignore', 'pipe', 'pipe'] })
    const out = [], err = []
    child.stdout.on('data', chunk => out.push(chunk)); child.stderr.on('data', chunk => err.push(chunk))
    const code = await new Promise((done, fail) => { child.once('error', fail); child.once('close', done) })
    if (code !== 0) throw Error(`无法枚举进程（exit ${code}）：${Buffer.concat(err).toString('utf8').slice(-500)}`)
    const text = Buffer.concat(out).toString('utf8').trim()
    const rows = text ? JSON.parse(text) : []
    const list = Array.isArray(rows) ? rows : [rows]
    const excluded = new Set([selfPid])
    for (let pid = selfPid; ;) {
      const row = list.find(item => item.ProcessId === pid)
      if (!row || excluded.has(row.ParentProcessId)) break
      excluded.add(row.ParentProcessId); pid = row.ParentProcessId
    }
    const prefix = (root + sep).toLowerCase(), reference = root.toLowerCase()
    // A boundary after the root keeps sibling directories like <root>-backup
    // from matching, whatever punctuation or whitespace follows the path.
    const rootPattern = new RegExp(reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w.$~-])')
    return list.filter(row => {
      if (excluded.has(row.ProcessId)) return false
      const exe = typeof row.ExecutablePath === 'string' ? row.ExecutablePath.toLowerCase() : ''
      const command = typeof row.CommandLine === 'string' ? row.CommandLine.toLowerCase() : ''
      return exe.startsWith(prefix) || rootPattern.test(command)
    }).map(row => ({ pid: row.ProcessId, name: row.Name }))
  }
}

async function walkTree(base, rel, visit) {
  const path = rel ? join(base, rel) : base
  const info = await lstat(path)
  if (info.isSymbolicLink()) throw Error('旧数据包含链接，拒绝复制；请改用真实目录')
  if (info.isDirectory()) {
    await visit({ rel, directory: true })
    for (const name of (await readdir(path)).sort()) await walkTree(base, rel ? `${rel}/${name}` : name, visit)
    return
  }
  if (!info.isFile()) throw Error('旧数据包含非常规文件条目')
  await visit({ rel, bytes: info.size, sha256: await fileDigest(path) })
}

async function readRegistry(source) {
  const path = join(source.home, 'storages/workspace.json')
  const info = await sourceEntry(source.root, path)
  if (!info) return null
  requireSourceFile(info)
  return JSON.parse(await readFile(path, 'utf8'))
}

// Workspaces registered inside the source program directory move to
// <target>/workspaces; external workspaces keep their original paths.
async function planWorkspaceMoves({ registry, source, target }) {
  const moves = [], used = new Set()
  for (const [id, workspace] of Object.entries(registry?.tables?.workspaces ?? {})) {
    if (typeof workspace.path !== 'string' || !isAbsolute(workspace.path)) continue
    // Canonicalize so 8.3/junction spellings still count as internal; the
    // registry spelling is kept for session-dir and projcache matching.
    // Disconnected drives/UNC paths cannot resolve and stay external.
    const real = await canonical(workspace.path).catch(() => resolve(workspace.path))
    if (!within(source.root, real)) continue
    let candidate = basename(real), index = 2
    while (used.has(candidate.toLowerCase())) candidate = `${basename(real)}-${index++}`
    used.add(candidate.toLowerCase())
    moves.push({ id, oldPath: workspace.path, newPath: join(target, 'workspaces', candidate), sessionIds: workspace.sessionIds ?? [] })
  }
  return moves
}

// Explicit allowlist: user data crosses, program-generated runtime state and
// regenerable caches stay behind.
export async function buildCopyPlan(source, target) {
  const files = [], directories = []
  const addTree = (base, targetPrefix, rel = '') => walkTree(base, rel, entry => {
    const target = join(targetPrefix, entry.rel)
    if (entry.directory) directories.push(target)
    else files.push({ sourcePath: join(base, entry.rel), target, bytes: entry.bytes, sha256: entry.sha256 })
  })
  const addFile = async (path, target) => {
    const info = await sourceEntry(source.root, path)
    if (info) files.push({ sourcePath: path, target, bytes: requireSourceFile(info).size, sha256: await fileDigest(path) })
  }
  const namespace = basename(source.dataRoot)
  if (!(await sourceEntry(source.root, source.home))?.isDirectory()) throw Error('旧目录缺少 dsh 主目录')
  for (const name of (await readdir(source.home)).sort()) {
    if (dshRetained.has(name)) await addTree(source.home, join('data', namespace, 'dsh'), name)
    else if (name === 'profiles') {
      // User delta and plugin manifest cross; the merged runtime is rebuilt on
      // first boot. The lockfile stays behind: pnpm records link: dependencies
      // relative to the profile directory, so a copied lockfile builds broken
      // links after the move; a repair install regenerates it from package.json.
      const profiles = join(source.home, 'profiles')
      await sourceEntry(source.root, profiles)
      for (const profile of (await readdir(profiles)).sort()) {
        for (const file of ['cordis.patch.yml', 'package.json', 'pnpm-workspace.yaml']) {
          await addFile(join(profiles, profile, file), join('data', namespace, 'dsh/profiles', profile, file))
        }
      }
    }
  }
  if ((await sourceEntry(source.root, source.browser))?.isDirectory()) {
    for (const name of (await readdir(source.browser)).sort()) {
      if (!browserSkipped.has(name)) await addTree(source.browser, join('data', namespace, 'browser'), name)
    }
  }
  await addFile(source.config, 'config/eduwork.jsonc')
  // The runtime resolves product.logoFile inside the config directory and
  // refuses to start when it is missing, so the referenced file must cross too.
  const configDir = dirname(source.config)
  const configText = await readFile(source.config, 'utf8').catch(() => null)
  // The runtime refuses a config with any parse error, so its values are not
  // authoritative here either; an empty file parses to no tree.
  const configErrors = []
  const config = configText === null ? undefined
    : jsonc.parseTree(configText.replace(/^﻿/, ''), configErrors, { allowTrailingComma: true })
  const logoFile = configErrors.length || config === undefined ? undefined : jsonc.getNodeValue(config)?.product?.logoFile
  if (typeof logoFile === 'string' && logoFile && !isAbsolute(logoFile)) {
    const logo = resolve(configDir, logoFile)
    // An escaping path is a config the runtime already rejects; the import must
    // not fail on it, nor copy anything outside the config directory.
    if (within(configDir, logo)) await addFile(logo, join('config', relative(configDir, logo)))
  }
  const dataDir = join(source.root, 'data')
  // software-update-preferences.json is the user's on/off choice;
  // update-preferences.json only records the channel and cannot replace it.
  for (const rel of ['configuration/state.json', 'configuration/eduwork.previous.jsonc', 'state/update-preferences.json', 'state/update-channel-040.json', 'state/software-update-preferences.json']) {
    await addFile(join(dataDir, rel), join('data', rel))
  }
  const moves = await planWorkspaceMoves({ registry: await readRegistry(source), source, target })
  for (const move of moves) {
    const real = await canonical(move.oldPath)
    if (!(await sourceEntry(source.root, real))?.isDirectory()) { move.missing = true; continue }
    await addTree(real, join('workspaces', basename(move.newPath)))
  }
  files.sort((a, b) => a.target < b.target ? -1 : a.target > b.target ? 1 : 0)
  return { files, directories: directories.sort(), moves }
}

async function requireWorkspaceDirectories(root, moves) {
  for (const move of moves) {
    if (!move.missing && !(await exists(join(root, 'workspaces', basename(move.newPath))))?.isDirectory()) {
      throw Error('导入目标缺少工作区目录，请保留现有数据并人工核对')
    }
  }
}

async function directoryDigest(root) {
  const directories = []
  async function walk(parent, prefix = '') {
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const rel = join(prefix, entry.name)
      directories.push(rel)
      await walk(join(root, rel), rel)
    }
  }
  await walk(root)
  return digest(JSON.stringify(directories.sort()))
}

// Applied to the staged copy only: registry paths, session directory names, the
// session header cwd and the cached working-directory fields. Session event
// content stays untouched.
async function applyWorkspaceRemap({ stage, namespace, moves }) {
  const applied = []
  const registryPath = join(stage, 'data', namespace, 'dsh/storages/workspace.json')
  const registry = JSON.parse(await readFile(registryPath, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error }))
  const sessionsRoot = join(stage, 'data', namespace, 'dsh/sessions')
  // The lossy project key can map several workspaces to one session directory.
  // Sessions are then split by header cwd instead of giving all to the first
  // mover — whether the co-owners are other movers or workspaces that stay.
  const byOldKey = new Map()
  for (const move of moves) {
    if (move.missing) continue
    const key = sessionProjectKey(move.oldPath)
    if (!byOldKey.has(key)) byOldKey.set(key, [])
    byOldKey.get(key).push(move)
  }
  // External workspaces (and internal ones whose directory is missing) keep
  // their original path and key; a mover must not take their sessions away.
  const movingIds = new Set(moves.filter(move => !move.missing).map(move => move.id))
  const stayKeys = new Set()
  for (const [id, workspace] of Object.entries(registry?.tables?.workspaces ?? {})) {
    if (movingIds.has(id) || typeof workspace.path !== 'string' || workspace.path.length === 0) continue
    stayKeys.add(sessionProjectKey(workspace.path))
  }
  for (const move of moves) {
    if (move.missing) continue
    if (registry?.tables?.workspaces?.[move.id]) registry.tables.workspaces[move.id].path = move.newPath
    const oldDir = join(sessionsRoot, sessionProjectKey(move.oldPath)), newDir = join(sessionsRoot, sessionProjectKey(move.newPath))
    const shared = byOldKey.get(sessionProjectKey(move.oldPath))
    if (shared.length > 1 || stayKeys.has(sessionProjectKey(move.oldPath))) {
      if (await exists(oldDir)) {
        for (const name of await readdir(oldDir)) {
          const sessionDir = join(oldDir, name)
          if (!(await lstat(sessionDir)).isDirectory()) continue
          const cwd = await sessionDirectoryCwd(sessionDir)
          const owner = shared.find(item => item.oldPath === cwd)
          // Unreadable or foreign sessions stay in the old directory; losing
          // them silently would be worse than leaving them unassigned.
          if (!owner) continue
          const ownerDir = join(sessionsRoot, sessionProjectKey(owner.newPath))
          await mkdir(ownerDir, { recursive: true })
          await rename(sessionDir, join(ownerDir, name))
        }
        if ((await readdir(oldDir)).length === 0) await rmdir(oldDir)
      }
      if (await exists(newDir)) await remapSessionLogCwd(newDir, move.oldPath, move.newPath)
    } else if (await exists(oldDir)) {
      await rename(oldDir, newDir)
      // The runtime identifies a session by its header cwd; renaming the project
      // directory alone leaves the header pointing at the old workspace.
      await remapSessionLogCwd(newDir, move.oldPath, move.newPath)
    }
    const projcache = join(stage, 'data', namespace, 'dsh/storages/session_projcache/sessions')
    // Match by cached cwd rather than the registry's sessionIds so sessions
    // missing from the registry list are remapped too.
    if (await exists(projcache)) {
      for (const name of await readdir(projcache)) {
        if (!name.endsWith('.json')) continue
        const cachePath = join(projcache, name)
        // The projection cache is regenerable from session events; a corrupt
        // entry must not block the import of the sessions themselves.
        const cache = await readFile(cachePath, 'utf8').then(JSON.parse).catch(() => null)
        if (!cache) continue
        let changed = false
        if (cache.record?.identity?.cwd === move.oldPath) { cache.record.identity.cwd = move.newPath; changed = true }
        if (cache.record?.rows?.workingDirectory?.val === move.oldPath) { cache.record.rows.workingDirectory.val = move.newPath; changed = true }
        if (changed) await writeFile(cachePath, JSON.stringify(cache, null, 2) + '\n')
      }
    }
    applied.push({ id: move.id, from: move.oldPath, to: move.newPath })
  }
  if (registry) await writeFile(registryPath, JSON.stringify(registry, null, 2) + '\n')
  return applied
}

function importOwnerExited(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid > 0x7fffffff) return false
  try { process.kill(pid, 0); return false }
  catch (error) { return error.code === 'ESRCH' }
}

async function reclaimImportStages(target, distribution, prefix) {
  const parent = dirname(target)
  for (const entry of await readdir(parent, { withFileTypes: true }).catch(() => [])) {
    const { name } = entry
    if (!entry.isDirectory() || !name.startsWith(prefix) || !/^[0-9a-f-]{36}$/.test(name.slice(prefix.length))) continue
    const stage = join(parent, name), progress = join(stage, '.eduwork-import-progress.json')
    try {
      if (!(await lstat(progress)).isFile()) continue
      const marker = JSON.parse(await readFile(progress, 'utf8'))
      if (marker?.schemaVersion === 1 && marker.state === 'copying' && marker.stage === name
        && marker.distribution === distribution && marker.target === target
        && importOwnerExited(marker.ownerPid)) await rm(stage, { recursive: true, force: true })
    } catch { /* Unreadable or unconfirmed stages do not block this import. */ }
  }
}

export async function importPortableData({ sourceRoot, targetRoot, distribution, listProcesses, onProgress = () => {}, freeSpace = statfs }) {
  const source = await inspectPortableSource({ sourceRoot, distribution })
  if (!targetRoot || !isAbsolute(targetRoot)) throw Error('目标用户目录必须是绝对路径')
  const target = await canonical(targetRoot)
  if (source.root === target || within(source.root, target) || within(target, source.root)) throw Error('Program and user data directories must be separate')
  await assertNoLinks(targetRoot)
  const running = await (listProcesses ?? windowsSourceProcessLister(source.root))()
  if (running.length) throw Error(`旧客户端或其后台 Host 仍在运行（${running.map(row => `${row.pid}:${row.name}`).join('、')}），请先正常退出后再导入`)
  const prior = await exists(target)
  if (prior) {
    const entries = await readdir(target)
    if (entries.length === 0) await rmdir(target)
    else {
      const receipt = entries.includes('.eduwork-migration.json')
        ? await readFile(join(target, '.eduwork-migration.json'), 'utf8').then(JSON.parse).catch(() => null) : null
      if (receipt?.schemaVersion === 2 && receipt.state === 'imported' && receipt.sourceRoot === source.root && receipt.distribution === distribution) {
        const current = await buildCopyPlan(source, target)
        if (digest(JSON.stringify(current)) !== receipt.planDigest) {
          throw Error('旧目录数据在上次导入后发生变化；请保留现有数据并人工核对后再试')
        }
        const directoryState = await directoryDigest(target).catch(() => null)
        if (!directoryState || directoryState !== receipt.targetDirectoryDigest) {
          throw Error('无法确认导入目标的工作区目录及其他目录与回执一致，请保留现有数据并人工核对')
        }
        await rm(join(target, '.eduwork-import-progress.json'), { force: true }).catch(() => {})
        return receipt
      }
      throw Error('目标用户目录已有数据，导入不会合并或覆盖；如需重来请先人工备份并清空该目录')
    }
  }
  const plan = await buildCopyPlan(source, target)
  const totalBytes = plan.files.reduce((sum, file) => sum + file.bytes, 0)
  const parent = dirname(target)
  await mkdir(parent, { recursive: true })
  const prefix = `.eduwork-import-${digest(JSON.stringify([distribution, target])).slice(0, 16)}-`
  await reclaimImportStages(target, distribution, prefix)
  const volume = await freeSpace(parent)
  if (volume.bavail * volume.bsize < totalBytes * 1.1) throw Error('目标磁盘空间不足，未开始复制；旧目录保持原样')
  const stageName = `${prefix}${randomUUID()}`, stage = join(parent, stageName)
  await mkdir(stage)
  const progressFile = join(stage, '.eduwork-import-progress.json')
  const progress = { schemaVersion: 1, state: 'copying', target, distribution, stage: stageName,
    ownerPid: process.pid, total: plan.files.length, bytes: totalBytes }
  const markProgress = copied => writeFile(progressFile, JSON.stringify({ ...progress, copied }) + '\n')
  try {
    await markProgress(0)
    for (const directory of plan.directories) await mkdir(join(stage, directory), { recursive: true })
    for (let i = 0; i < plan.files.length; i++) {
      const file = plan.files[i], destination = join(stage, file.target)
      await mkdir(dirname(destination), { recursive: true })
      const info = await sourceEntry(source.root, file.sourcePath)
      if (!info) throw Error('旧数据仍在被写入，已放弃启用目标；旧目录保持原样')
      requireSourceFile(info)
      await copyFile(file.sourcePath, destination)
      if (await fileDigest(destination) !== file.sha256) throw Error('复制校验失败：旧数据可能仍在被写入；旧目录保持原样')
      if (i % 32 === 0 || i === plan.files.length - 1) {
        await markProgress(i + 1)
        await onProgress({ copied: i + 1, total: plan.files.length, bytes: totalBytes })
      }
    }
    const after = await buildCopyPlan(source, target)
    if (JSON.stringify(after) !== JSON.stringify(plan)) throw Error('旧数据仍在被写入，已放弃启用目标；旧目录保持原样')
    await requireWorkspaceDirectories(stage, plan.moves)
    const moved = await applyWorkspaceRemap({ stage, namespace: basename(source.dataRoot), moves: plan.moves })
    const receipt = { schemaVersion: 2, state: 'imported', sourceRoot: source.root, sourceVersion: source.version, distribution,
      files: plan.files.length, bytes: totalBytes, planDigest: digest(JSON.stringify(plan)), targetDirectoryDigest: await directoryDigest(stage), workspacesMoved: moved,
      workspacesMissing: plan.moves.filter(move => move.missing).map(move => ({ id: move.id, path: move.oldPath })), createdAt: new Date().toISOString() }
    await writeFile(join(stage, '.eduwork-migration.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    // Keep the progress marker until activation succeeds so an interrupted
    // stage stays recognizable as an import leftover on retry.
    await rename(stage, target)
    await rm(join(target, '.eduwork-import-progress.json'), { force: true }).catch(() => {})
    return receipt
  } catch (error) {
    await rm(stage, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}
