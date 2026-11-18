import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, lstat, realpath, rename, rm, rmdir, statfs, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { assertSeparateRoots } from './desktop-paths.mjs'
import { remapSessionLogCwd, sessionDirectoryCwd } from './session-header-remap.mjs'

// First import of an old portable Electron installation into the installed
// user directory. The Wails-era updater handshake stays in legacy-migration.mjs.
// The source is never modified; the target is activated only after a fully
// verified copy staged on the target's own volume.

const dshRetained = new Set(['sessions', 'attachments', 'storages', 'skills', 'plugins', 'derived', 'settings.yaml', 'memory.sqlite3', 'memory.sqlite3-wal', 'memory.sqlite3-shm', 'session-query-memory.sqlite3', 'session-query-memory.sqlite3-wal', 'session-query-memory.sqlite3-shm'])
// Regenerable Chromium state; everything else under browser/ is persistent.
const browserSkipped = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'ShaderCache', 'GrShaderCache', 'DIPS', 'DIPS-wal', 'Shared Dictionary', 'blob_storage', 'optimization_guide_prediction_model_store', 'component_crx_cache', 'extensions_cache', 'Safe Browsing', 'Segmentation Platform', 'Trust Tokens', 'trust_tokens.db', 'trust_tokens.db-journal'])
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
async function fileDigest(path) { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex') }
const within = (root, path) => { const rel = relative(root, path); return rel !== '' && !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep) }
const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
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
  const readIdentity = async (path, missing) => JSON.parse(await readFile(path, 'utf8').catch(error => {
    if (error.code === 'ENOENT') throw Error(missing); throw error
  }))
  const release = await readIdentity(join(root, 'release.json'), '所选目录不是 EduWork 便携客户端（缺少 release.json）')
  const desktop = await readIdentity(join(root, 'resources/app/eduwork.desktop.json'), '所选目录不是 EduWork Electron 便携客户端')
  if (release.shell !== 'electron' || desktop.shell !== 'electron') throw Error('所选目录不是 Electron 版客户端，旧 Wails 数据请走原有迁移入口')
  if (desktop.dataLayout === 'installed') throw Error('所选目录是安装形态客户端，其用户数据不在程序目录内')
  if (release.distribution !== distribution || desktop.distribution !== distribution) throw Error(`发行标识不符：所选目录属于 ${release.distribution}，当前版本为 ${distribution}`)
  const dataRoot = join(root, 'data', `${distribution}-electron`)
  const home = join(dataRoot, 'dsh')
  if (!(await exists(home))?.isDirectory()) throw Error('所选目录没有用户数据（data 下缺少 dsh 主目录）')
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
  if (info.isDirectory()) { for (const name of (await readdir(path)).sort()) await walkTree(base, rel ? `${rel}/${name}` : name, visit); return }
  if (!info.isFile()) throw Error('旧数据包含非常规文件条目')
  await visit({ rel, bytes: info.size, sha256: await fileDigest(path) })
}

async function readRegistry(source) {
  const path = join(source.home, 'storages/workspace.json')
  if (!(await exists(path))) return null
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
// regenerable caches stay behind. Entries are {sourcePath, target, bytes, sha256}.
export async function buildCopyPlan(source, target) {
  const files = []
  const addTree = async (base, targetPrefix, rel = '') => walkTree(base, rel, entry => {
    files.push({ sourcePath: join(base, entry.rel), target: join(targetPrefix, entry.rel), bytes: entry.bytes, sha256: entry.sha256 })
  })
  const namespace = basename(source.dataRoot)
  for (const name of (await readdir(source.home)).sort()) {
    if (dshRetained.has(name)) await addTree(source.home, join('data', namespace, 'dsh'), name)
    else if (name === 'profiles') {
      // User delta and plugin manifest cross; the merged runtime is rebuilt on
      // first boot. The lockfile stays behind: pnpm records link: dependencies
      // relative to the profile directory, so a copied lockfile builds broken
      // links after the move; a repair install regenerates it from package.json.
      for (const profile of (await readdir(join(source.home, 'profiles'))).sort()) {
        for (const file of ['cordis.patch.yml', 'package.json', 'pnpm-workspace.yaml']) {
          const path = join(source.home, 'profiles', profile, file)
          if (await exists(path)) files.push({ sourcePath: path, target: join('data', namespace, 'dsh/profiles', profile, file), bytes: (await lstat(path)).size, sha256: await fileDigest(path) })
        }
      }
    }
  }
  if ((await exists(source.browser))?.isDirectory()) {
    for (const name of (await readdir(source.browser)).sort()) {
      if (!browserSkipped.has(name)) await addTree(source.browser, join('data', namespace, 'browser'), name)
    }
  }
  if ((await exists(source.config))?.isFile()) files.push({ sourcePath: source.config, target: 'config/eduwork.jsonc', bytes: (await lstat(source.config)).size, sha256: await fileDigest(source.config) })
  const dataDir = join(source.root, 'data')
  // software-update-preferences.json is the user's on/off choice;
  // update-preferences.json only records the channel and cannot replace it.
  for (const rel of ['configuration/state.json', 'configuration/eduwork.previous.jsonc', 'state/update-preferences.json', 'state/update-channel-040.json', 'state/software-update-preferences.json']) {
    if (await exists(join(dataDir, rel))) await addTree(dataDir, 'data', rel)
  }
  const moves = await planWorkspaceMoves({ registry: await readRegistry(source), source, target })
  for (const move of moves) {
    const real = await canonical(move.oldPath)
    if (!(await exists(real))?.isDirectory()) { move.missing = true; continue }
    await walkTree(real, '', entry => files.push({ sourcePath: join(real, entry.rel), target: join('workspaces', basename(move.newPath), entry.rel), bytes: entry.bytes, sha256: entry.sha256 }))
  }
  files.sort((a, b) => a.target < b.target ? -1 : a.target > b.target ? 1 : 0)
  return { files, moves }
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

async function volumeOf(path) {
  for (let current = resolve(path); ; current = dirname(current)) {
    if (await exists(current)) return current
    if (dirname(current) === current) throw Error('找不到目标所在的磁盘')
  }
}

export async function importPortableData({ sourceRoot, targetRoot, distribution, listProcesses, onProgress = () => {}, freeSpace = statfs }) {
  const source = await inspectPortableSource({ sourceRoot, distribution })
  if (!targetRoot || !isAbsolute(targetRoot)) throw Error('目标用户目录必须是绝对路径')
  const target = await canonical(targetRoot)
  assertSeparateRoots(source.root, target)
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
      if (receipt?.schemaVersion === 1 && receipt.state === 'imported' && same(receipt.sourceRoot, source.root)) {
        const current = await buildCopyPlan(source, target)
        if (digest(JSON.stringify(current.files)) === receipt.planDigest) {
          await rm(join(target, '.eduwork-import-progress.json'), { force: true }).catch(() => {})
          return receipt
        }
        throw Error('旧目录数据在上次导入后发生变化；请保留现有数据并人工核对后再试')
      }
      throw Error('目标用户目录已有数据，导入不会合并或覆盖；如需重来请先人工备份并清空该目录')
    }
  }
  const plan = await buildCopyPlan(source, target)
  const totalBytes = plan.files.reduce((sum, file) => sum + file.bytes, 0)
  const volume = await freeSpace(await volumeOf(dirname(target)))
  if (volume.bavail * volume.bsize < totalBytes * 1.1) throw Error('目标磁盘空间不足，未开始复制；旧目录保持原样')
  await mkdir(dirname(target), { recursive: true })
  // Leftovers from an interrupted attempt are reusable only while unactivated.
  for (const name of await readdir(dirname(target))) {
    if (!name.startsWith('.eduwork-import-')) continue
    const orphan = join(dirname(target), name), contents = await readdir(orphan)
    if (contents.length === 0 || contents.includes('.eduwork-import-progress.json')) await rm(orphan, { recursive: true, force: true })
    else throw Error(`存在无法识别的导入残留 ${name}，请人工检查后再试`)
  }
  const stage = join(dirname(target), `.eduwork-import-${randomUUID()}`)
  await mkdir(stage)
  const progressFile = join(stage, '.eduwork-import-progress.json')
  // Mark the stage immediately so a kill before the first copy still leaves a
  // recognizable import leftover rather than an unknown directory.
  await writeFile(progressFile, JSON.stringify({ schemaVersion: 1, state: 'copying', copied: 0, total: plan.files.length, bytes: totalBytes }) + '\n')
  try {
    for (let i = 0; i < plan.files.length; i++) {
      const file = plan.files[i], destination = join(stage, file.target)
      await mkdir(dirname(destination), { recursive: true })
      await copyFile(file.sourcePath, destination)
      if (await fileDigest(destination) !== file.sha256) throw Error('复制校验失败：旧数据可能仍在被写入；旧目录保持原样')
      if (i % 32 === 0 || i === plan.files.length - 1) {
        await writeFile(progressFile, JSON.stringify({ schemaVersion: 1, state: 'copying', copied: i + 1, total: plan.files.length, bytes: totalBytes }) + '\n')
        await onProgress({ copied: i + 1, total: plan.files.length, bytes: totalBytes })
      }
    }
    const after = await buildCopyPlan(source, target)
    if (digest(JSON.stringify(after.files)) !== digest(JSON.stringify(plan.files))) throw Error('旧数据仍在被写入，已放弃启用目标；旧目录保持原样')
    const moved = await applyWorkspaceRemap({ stage, namespace: basename(source.dataRoot), moves: plan.moves })
    const receipt = { schemaVersion: 1, state: 'imported', sourceRoot: source.root, sourceVersion: source.version, distribution,
      files: plan.files.length, bytes: totalBytes, planDigest: digest(JSON.stringify(plan.files)), workspacesMoved: moved,
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
