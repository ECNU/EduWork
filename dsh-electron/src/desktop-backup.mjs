import { createHash, randomUUID } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { chmod, copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, statfs, symlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const KIND = 'eduwork-desktop-backup'
const MANIFEST = 'manifest.json'
const MANIFEST_LIMIT = 64 * 1024 * 1024
const RESTORE = 'pending.json'
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const kinds = { configuration: 'directory', dsh: 'directory', appearance: 'file', pet: 'file',
  updatePreferences: 'file', softwareUpdatePreferences: 'file' }
const keys = Object.keys(kinds)
const entryInfo = path => lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error })
const digest = text => createHash('sha256').update(text).digest('hex')
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const fold = path => process.platform === 'win32' ? path.toLowerCase() : path
const inside = (parent, path) => {
  const part = relative(fold(parent), fold(path))
  return !isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep)
}
const overlaps = (first, second) => inside(first, second) || inside(second, first)

async function physical(path) {
  if (!isAbsolute(path)) throw Error('需要绝对文件路径')
  const item = await entryInfo(path)
  if (item) {
    if (item.isSymbolicLink()) throw Error('不能使用链接作为备份或恢复目录：' + path)
    return realpath(path)
  }
  return join(await physical(dirname(path)), basename(path))
}
async function readJSON(path, maximum = 8 * 1024 * 1024) {
  const item = await entryInfo(path)
  if (!item) return null
  if (!item.isFile() || item.isSymbolicLink() || item.size > maximum) throw Error('备份记录文件无效：' + path)
  const value = JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/u, ''))
  if (!object(value)) throw Error('备份记录格式无效：' + path)
  return value
}
async function writeRecord(path, value) {
  const temporary = path + '.' + randomUUID() + '.tmp'
  const file = await open(temporary, 'wx', 0o600)
  try {
    try {
      await file.writeFile(JSON.stringify(value) + '\n')
      await file.sync()
    } finally { await file.close() }
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }) }
}

const historyPath = paths => join(dirname(paths.home), 'backup-restore')
export const hasPendingDesktopRestore = async paths => Boolean(await entryInfo(join(historyPath(paths), RESTORE)))

export function desktopBackupLayout(paths, settings, assembly, { platform = process.platform, arch = process.arch } = {}) {
  const root = platform === 'darwin' ? dirname(paths.home) : paths.root
  if (!['win32', 'darwin'].includes(platform)
    || settings.sourceAlpha || (settings.configurationOwnership ?? 'user') !== 'user'
    || resolve(paths.config) !== resolve(root, 'config/eduwork.jsonc')) throw Error('备份与恢复需要客户端默认的用户配置和数据目录')
  if (!/^[a-z0-9-]+$/u.test(settings.distribution) || settings.appId !== 'org.eduwork.' + settings.distribution + '.electron'
    || assembly.distribution !== settings.distribution || !/^[0-9a-f]{40}$/u.test(assembly.dshCommit ?? '')
    || typeof assembly.dshVersion !== 'string' || !assembly.dshVersion || !Array.isArray(assembly.externalPackages)
    || !assembly.externalPackages.length || typeof settings.productVersion !== 'string' || !settings.productVersion) {
    throw Error('无法确认客户端与数据版本')
  }
  const components = assembly.externalPackages.map(row => {
    if (typeof row?.name !== 'string' || typeof row.version !== 'string' || !SHA256.test(row.tarballSHA256 ?? '')) {
      throw Error('客户端组件清单不完整')
    }
    return [row.name, row.version, row.tarballSHA256].join(':')
  }).sort()
  return {
    root, program: paths.root, product: paths.product, updateRoot: paths.updateDataRoot,
    history: historyPath(paths),
    targets: { configuration: dirname(paths.config), dsh: paths.home,
      appearance: join(paths.userData, 'visual-style.json'), pet: join(paths.userData, 'desktop-pet.json'),
      updatePreferences: join(paths.updateDataRoot, 'state/update-preferences.json'),
      softwareUpdatePreferences: join(paths.updateDataRoot, 'state/software-update-preferences.json') },
    identity: { appId: settings.appId, distribution: settings.distribution,
      platform, arch, dshVersion: assembly.dshVersion, dshCommit: assembly.dshCommit, components },
    productVersion: settings.productVersion,
  }
}

async function ownedPath(root, path) {
  if (!inside(root, path) || fold(await physical(path)) !== fold(resolve(await physical(root), relative(root, path)))) {
    throw Error('客户端数据目录存在链接：' + path)
  }
}
async function verifyLayout(layout) {
  const paths = Object.values(layout.targets)
  for (const path of [layout.history, layout.updateRoot, ...paths]) await ownedPath(layout.root, path)
  for (const [index, path] of paths.entries()) {
    if (path === layout.root || overlaps(layout.history, path) || paths.slice(0, index).some(other => overlaps(other, path))) {
      throw Error('客户端数据目录重叠')
    }
  }
}
async function checkTransactions(layout) {
  const state = join(layout.updateRoot, 'state/updates'), transactions = join(state, 'transactions')
  await ownedPath(layout.root, transactions)
  for (const path of [join(state, 'pending-update.json'), join(layout.updateRoot, 'state/pending-update.json')]) {
    if (await entryInfo(path)) throw Error('请先完成挂起的软件更新')
  }
  if (await entryInfo(transactions)) {
    for (const name of await readdir(transactions)) {
      const directory = join(transactions, name)
      const item = await entryInfo(directory)
      if (!item?.isDirectory() || item.isSymbolicLink()) throw Error('软件更新事务目录无效')
      const committed = await entryInfo(join(directory, 'committed'))
      if (!committed?.isFile() || committed.isSymbolicLink()) throw Error('请先恢复中断的软件更新')
    }
  }
  const configState = join(layout.updateRoot, 'configuration/state.json')
  await ownedPath(layout.root, configState)
  if ((await readJSON(configState))?.trial) throw Error('请先完成配置更新')
  const contents = join(layout.updateRoot, 'content-updates')
  await ownedPath(layout.root, contents)
  if (await entryInfo(contents)) {
    for (const scope of await readdir(contents)) {
      const path = join(contents, scope, 'state.json')
      await ownedPath(layout.root, path)
      const status = await readJSON(path)
      if (status?.pending || status?.trial) throw Error('请先完成或恢复内容更新')
    }
  }
}
function checkSegment(name) {
  if (name === '.' || name === '..' || !name || /[<>:"/\\|?*\u0000-\u001f]/u.test(name)
    || /[. ]$/u.test(name) || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(name)) {
    throw Error('备份中有不可移植的文件名：' + name)
  }
}
const localFiles = ['.env', '.npmrc', '.credentials.yaml']
const excludedPaths = [
  /^dsh\/(?:\.env|\.npmrc|\.credentials(?:\.yaml)?|\.skill-staging|\.skill-trash|attachments\/v1\/tmp)(?:\/|$)/iu,
  /^dsh\/profiles\/(?:[^/]+\/(?:\.env|\.npmrc)|desktop\/\.eduwork-module-link\.json)(?:\/|$)/iu,
  // pnpm recreates this file with the current device's store path.
  /^dsh\/profiles\/[^/]+\/node_modules\/\.modules\.yaml$/iu,
]
const excluded = path => excludedPaths.some(pattern => pattern.test(path))
const modulesPrefix = path => /^dsh\/profiles\/[^/]+\/node_modules\//u.exec(path)?.[0]
const configurationPresent = entries => entries.some(item => item.path === 'configuration/eduwork.jsonc' && item.kind === 'file')

async function hashFile(path, before) {
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of createReadStream(path)) { bytes += chunk.length; hash.update(chunk) }
  const after = await entryInfo(path)
  if (!after?.isFile() || after.isSymbolicLink() || before.size !== bytes || after.size !== bytes
    || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino || before.dev !== after.dev) {
    throw Error('文件在备份期间发生变化：' + path)
  }
  return hash.digest('hex')
}

async function inventory(roots, product) {
  const entries = []
  async function walk(file, path, item) {
    if (product && excluded(path)) return
    if (path === 'dsh/profiles/desktop/.eduwork-module-link.pending.json') throw Error('请先完成客户端数据目录初始化')
    if (item.isSymbolicLink()) {
      if (product && path === 'dsh/profiles/desktop/node_modules') {
        const receipt = await readJSON(join(dirname(file), '.eduwork-module-link.json'))
        const expected = await realpath(join(product, 'd/node_modules'))
        if (receipt?.schemaVersion === 1 && typeof receipt.target === 'string' && isAbsolute(receipt.target)
          && fold(await realpath(receipt.target)) === fold(expected) && fold(await realpath(file)) === fold(expected)) return
      }
      const prefix = product && modulesPrefix(path)
      if (prefix) {
        const modules = await realpath(dataPath(roots, prefix.slice(0, -1)))
        const target = await realpath(file)
        const part = relative(modules, target)
        if (part && inside(modules, target)) {
          entries.push({ path, kind: 'link', target: prefix + part.split(sep).join('/') })
          return
        }
      }
      throw Error('备份数据中存在链接：' + path)
    }
    if (item.isDirectory()) {
      entries.push({ path, kind: 'directory' })
      const names = (await readdir(file)).sort()
      const namesSeen = new Set()
      for (const name of names) {
        checkSegment(name)
        const equivalent = name.normalize('NFC').toLowerCase()
        if (namesSeen.has(equivalent)) throw Error('备份数据中有重名文件：' + path)
        namesSeen.add(equivalent)
        const child = join(file, name)
        await walk(child, path + '/' + name, await lstat(child))
      }
    } else if (item.isFile()) {
      entries.push({ path, kind: 'file', bytes: item.size, sha256: await hashFile(file, item), executable: Boolean(item.mode & 0o111) })
    } else throw Error('备份数据中存在非普通文件：' + path)
  }
  for (const key of keys) {
    const path = roots[key]
    const item = await entryInfo(path)
    if (!item) continue
    if (item.isSymbolicLink() || (kinds[key] === 'directory' ? !item.isDirectory() : !item.isFile())) throw Error('数据目录类型不匹配：' + key)
    await walk(path, key, item)
  }
  return entries
}
const payloadRoots = path => Object.fromEntries(keys.map(key => [key, join(path, key)]))
const total = entries => entries.reduce((sum, item) => sum + (item.bytes ?? 0), 0)
const dataPath = (roots, name) => {
  const [key, ...parts] = name.split('/')
  if (!Object.hasOwn(roots, key)) throw Error('备份包含未知的数据区域')
  parts.forEach(checkSegment)
  return join(roots[key], ...parts)
}
// Transfer filesystems can change permissions. Apply the recorded executable bit during restore.
const contentEntries = entries => entries.map(({ executable, ...item }) => item)
function verifiedPayload(entries, declared) {
  const files = declared.filter(item => item?.kind !== 'link')
  if (files.some(item => item?.kind === 'file' && typeof item.executable !== 'boolean')
    || JSON.stringify(contentEntries(entries)) !== JSON.stringify(contentEntries(files))) {
    throw Error('备份文件与清单不一致，请选择另一份完整备份')
  }
  const physical = new Map(entries.map(item => [item.path, item]))
  const used = new Set(entries.map(item => item.path.normalize('NFC').toLowerCase()))
  for (const item of declared) {
    if (item.kind !== 'link') continue
    const prefix = typeof item.path === 'string' && modulesPrefix(item.path)
    const name = prefix && item.path.normalize('NFC').toLowerCase()
    const parent = prefix && item.path.slice(0, item.path.lastIndexOf('/'))
    if (!prefix || typeof item.target !== 'string' || !item.target.startsWith(prefix)
      || used.has(name) || physical.get(parent)?.kind !== 'directory' || !physical.has(item.target)) {
      throw Error('备份包含无效的插件依赖链接')
    }
    checkSegment(item.path.slice(parent.length + 1))
    used.add(name)
  }
}
async function restoreLinks(entries, roots) {
  for (const item of entries) {
    if (item.kind !== 'link') continue
    const path = dataPath(roots, item.path), target = dataPath(roots, item.target)
    const info = await entryInfo(target)
    if (!info || info.isSymbolicLink()) throw Error('插件依赖文件已变化：' + item.target)
    if (process.platform === 'win32' && info.isDirectory()) await symlink(target, path, 'junction')
    else await symlink(relative(dirname(path), target), path, info.isDirectory() ? 'dir' : 'file')
  }
}
async function space(path, bytes) {
  const fs = await statfs(path)
  if (fs.bavail * fs.bsize < bytes + 16 * 1024 * 1024) throw Error('可用磁盘空间不足，数据未被覆盖')
}
async function copyPrivateFile(from, to, mode) {
  await copyFile(from, to, constants.COPYFILE_EXCL)
  await chmod(to, mode & 0o111 ? 0o700 : 0o600)
}
async function copyVerified(entries, source, target) {
  const files = entries.filter(item => item.kind !== 'link')
  for (const item of files) {
    const from = dataPath(source, item.path), to = dataPath(target, item.path)
    const original = await entryInfo(from)
    if (!original || original.isSymbolicLink()) throw Error('备份文件已变化：' + item.path)
    if (item.kind === 'directory') {
      if (!original.isDirectory()) throw Error('备份目录已变化：' + item.path)
      await mkdir(to, { mode: 0o700 })
    } else {
      if (!original.isFile()) throw Error('备份文件已变化：' + item.path)
      await copyPrivateFile(from, to, item.executable ? 0o700 : 0o600)
    }
  }
  const actual = await inventory(target)
  if (JSON.stringify(contentEntries(actual)) !== JSON.stringify(contentEntries(files))) throw Error('复制后的备份文件校验失败')
}

async function retainLocalCredentials(home, stage) {
  const profiles = await readdir(join(home, 'profiles'), { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  const files = [...localFiles, ...profiles.filter(entry => entry.isDirectory())
    .flatMap(entry => ['.env', '.npmrc'].map(file => join('profiles', entry.name, file)))]
  for (const name of files) {
    const from = join(home, name), item = await entryInfo(from)
    if (!item) continue
    if (!item.isFile() || item.isSymbolicLink()) throw Error('本机凭据文件不是普通文件：' + from)
    await ownedPath(home, from)
    const target = join(stage, name)
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    await copyPrivateFile(from, target, item.mode)
  }
}

async function workspaces(data, layout) {
  const value = await readJSON(join(data, 'dsh/storages/workspace.json'), 32 * 1024 * 1024)
  const result = new Map()
  for (const row of Object.values(value?.tables?.workspaces ?? {})) {
    if (typeof row?.path !== 'string') continue
    const path = row.path
    let checked = path
    if (isAbsolute(path)) {
      const actual = await realpath(path).catch(error => {
        if (!['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ELOOP'].includes(error.code)) throw error
        return path
      })
      for (const key of ['dsh', 'configuration']) {
        const target = layout.targets[key]
        if (inside(target, actual)) checked = join(data, key, relative(target, actual))
      }
    }
    const info = isAbsolute(checked) ? await stat(checked).catch(error => {
      if (!['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ELOOP'].includes(error.code)) throw error
      return null
    }) : null
    result.set(path, { path, missing: !info?.isDirectory() })
  }
  return [...result.values()]
}

export async function createDesktopBackup(layout, destination) {
  await verifyLayout(layout)
  if (await entryInfo(join(layout.history, RESTORE))) throw Error('请先恢复上一次中断的操作')
  await checkTransactions(layout)
  const parent = await physical(destination)
  if (!(await entryInfo(parent))?.isDirectory()) throw Error('请选择已有的备份保存目录')
  const name = 'EduWork-Backup-' + new Date().toISOString().replace(/[:.]/gu, '-') + '-' + randomUUID().slice(0, 8)
  const folder = join(parent, name)
  for (const path of [layout.root, layout.program]) {
    if (overlaps(await physical(path), folder)) throw Error('请将备份保存到程序和个人数据目录外')
  }
  const entries = await inventory(layout.targets, layout.product)
  if (!configurationPresent(entries)) throw Error('找不到完整的客户端配置')
  verifiedPayload(entries.filter(item => item.kind !== 'link'), entries)
  await space(parent, total(entries))
  const stage = await mkdtemp(join(parent, '.eduwork-backup-'))
  try {
    const data = join(stage, 'data')
    await mkdir(data, { mode: 0o700 })
    await copyVerified(entries, layout.targets, payloadRoots(data))
    if (JSON.stringify(await inventory(layout.targets, layout.product)) !== JSON.stringify(entries)) throw Error('备份期间个人数据已变化，请关闭其他写入程序后重试')
    const manifest = { kind: KIND, schemaVersion: 1, identity: layout.identity, productVersion: layout.productVersion,
      createdAt: new Date().toISOString(), entries }
    if (Buffer.byteLength(JSON.stringify(manifest)) + 1 > MANIFEST_LIMIT) throw Error('备份文件清单过大')
    await writeRecord(join(stage, MANIFEST), manifest)
    if (await entryInfo(folder)) throw Error('备份目标已存在')
    await rename(stage, folder)
    return { folder, files: entries.filter(item => item.kind === 'file').length, bytes: total(entries) }
  } finally { await rm(stage, { recursive: true, force: true }) }
}

export async function previewDesktopRestore(layout, folder) {
  await verifyLayout(layout)
  if (await entryInfo(join(layout.history, RESTORE))) throw Error('请先恢复上一次中断的操作')
  await checkTransactions(layout)
  const path = await physical(folder), data = join(path, 'data')
  for (const target of [...Object.values(layout.targets), layout.history]) {
    if (overlaps(path, await physical(target))) throw Error('请选择客户端数据目录外的备份')
  }
  if (!(await entryInfo(path))?.isDirectory()) throw Error('请选择一个完整的 EduWork 备份目录')
  const manifest = await readJSON(join(path, MANIFEST), MANIFEST_LIMIT)
  if (manifest?.kind !== KIND || manifest.schemaVersion !== 1 || !Array.isArray(manifest.entries)
    || typeof manifest.productVersion !== 'string' || !manifest.productVersion || typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt))) throw Error('不是有效的 EduWork 备份')
  if (JSON.stringify(manifest.identity) !== JSON.stringify(layout.identity)) throw Error('备份的发行版、系统架构或数据组件与本客户端不兼容')
  const dataInfo = await entryInfo(data)
  if (!dataInfo?.isDirectory() || dataInfo.isSymbolicLink()) throw Error('备份数据目录缺失或无效')
  const names = await readdir(data)
  if (names.some(name => !keys.includes(name))) throw Error('备份包含未登记的数据区域')
  const entries = await inventory(payloadRoots(data))
  if (!configurationPresent(entries) || entries.some(item => excluded(item.path))) {
    throw Error('备份文件与清单不一致，请选择另一份完整备份')
  }
  verifiedPayload(entries, manifest.entries)
  const previous = await inventory(layout.targets, layout.product)
  return { folder: path, manifest, previous, signature: digest(JSON.stringify({ manifest, previous })),
    files: entries.filter(item => item.kind === 'file').length, bytes: total(entries),
    workspaces: await workspaces(data, layout) }
}

async function memoryTombstones(home, scratch) {
  const name = 'memory.sqlite3'
  const present = await entryInfo(join(home, name))
  if (!present) {
    if (await entryInfo(join(home, name + '-wal'))) throw Error('记忆数据库缺失，已保留现有数据')
    return new Map()
  }
  await mkdir(scratch, { mode: 0o700 })
  for (const file of [name, name + '-wal']) {
    const source = join(home, file), item = await entryInfo(source)
    if (!item) continue
    if (!item.isFile() || item.isSymbolicLink()) throw Error('记忆数据库不是普通文件')
    await copyFile(source, join(scratch, file))
  }
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(join(scratch, name), { readOnly: true })
  try {
    if (db.prepare('PRAGMA user_version').get().user_version !== 1) throw Error('无法验证此版本的记忆遗忘记录')
    const unit = db.prepare("SELECT version FROM units WHERE name = 'local_memory'").get()
    if (!unit) return new Map()
    if (unit.version !== 1) throw Error('无法验证此版本的记忆遗忘记录')
    return new Map(db.prepare('SELECT key, value FROM u_local_memory_tombstones').all().map(row => [row.key, row.value]))
  } finally { db.close() }
}
function operation(layout, id) {
  const folder = join(layout.history, id)
  return { folder, stage: join(folder, 'staged'), previous: join(folder, 'previous'), journal: join(layout.history, RESTORE) }
}
async function move(from, to) {
  const entry = await entryInfo(from)
  if (!entry || entry.isSymbolicLink() || await entryInfo(to)) throw Error('恢复目录已变化，保留全部数据：' + to)
  await rename(from, to)
}

export async function recoverDesktopRestore(layout) {
  const file = join(layout.history, RESTORE)
  if (!await entryInfo(file)) return null
  await verifyLayout(layout)
  const state = await readJSON(file)
  if (!state || state.schemaVersion !== 1 || !UUID.test(state.id ?? '') || !['switching', 'committed'].includes(state.phase)
    || state.appId !== layout.identity.appId
    || ![state.incoming, state.original].every(list => Array.isArray(list) && new Set(list).size === list.length && list.every(key => keys.includes(key)))) {
    throw Error('恢复记录无效，未覆盖任何文件')
  }
  const paths = operation(layout, state.id)
  for (const path of [paths.folder, paths.stage, paths.previous]) {
    const entry = await entryInfo(path)
    if (!entry?.isDirectory() || entry.isSymbolicLink()) throw Error('恢复暂存目录缺失或已被替换：' + path)
  }
  if (state.phase === 'switching') {
    for (const key of keys) {
      const target = layout.targets[key], previous = join(paths.previous, key), staged = join(paths.stage, key)
      const saved = await entryInfo(previous), incoming = await entryInfo(staged), active = await entryInfo(target)
      if (saved) {
        if (!state.original.includes(key)) throw Error('原数据保留记录不一致：' + key)
        if (active) {
          if (incoming || !state.incoming.includes(key)) throw Error('恢复期间数据目录被其他程序写入：' + key)
          await move(target, staged)
        }
        await move(previous, target)
      } else if (!state.original.includes(key) && active) {
        if (incoming || !state.incoming.includes(key)) throw Error('恢复期间数据目录被其他程序写入：' + key)
        await move(target, staged)
      } else if (state.original.includes(key) && !active) {
        throw Error('无法确认原数据位置，已保留恢复现场：' + key)
      }
    }
  }
  await rm(file)
  return { restored: state.phase === 'committed', folder: paths.folder, previous: paths.previous }
}

export async function restoreDesktopBackup(layout, folder, signature, { validateConfiguration }) {
  const preview = await previewDesktopRestore(layout, folder)
  if (preview.signature !== signature) throw Error('备份或当前数据已变化，请重新预览')
  await mkdir(layout.history, { recursive: true, mode: 0o700 })
  const id = randomUUID(), paths = operation(layout, id)
  await space(layout.history, preview.bytes)
  await mkdir(paths.folder, { mode: 0o700 })
  await mkdir(paths.stage, { mode: 0o700 })
  await mkdir(paths.previous, { mode: 0o700 })
  let switching = false
  try {
    await copyVerified(preview.manifest.entries, payloadRoots(join(preview.folder, 'data')), payloadRoots(paths.stage))
    await validateConfiguration(join(paths.stage, 'configuration/eduwork.jsonc'))
    await retainLocalCredentials(layout.targets.dsh, join(paths.stage, 'dsh'))
    const currentMemory = await memoryTombstones(layout.targets.dsh, join(paths.folder, 'memory-current'))
    const incomingMemory = await memoryTombstones(join(paths.stage, 'dsh'), join(paths.folder, 'memory-incoming'))
    for (const [key, value] of currentMemory) {
      if (incomingMemory.get(key) !== value) throw Error('这份备份缺少当前的记忆遗忘记录。请在空数据的客户端恢复，或选择更新的备份')
    }
    for (const suffix of ['memory-current', 'memory-incoming']) await rm(join(paths.folder, suffix), { recursive: true, force: true })
    await checkTransactions(layout)
    if (JSON.stringify(await inventory(layout.targets, layout.product)) !== JSON.stringify(preview.previous)) throw Error('当前个人数据已变化，请重新预览')
    const original = preview.previous.filter(row => keys.includes(row.path)).map(row => row.path)
    const incoming = await readdir(paths.stage)
    const journal = { schemaVersion: 1, id, appId: layout.identity.appId, phase: 'switching', original, incoming }
    for (const key of incoming) await mkdir(dirname(layout.targets[key]), { recursive: true, mode: 0o700 })
    await writeRecord(paths.journal, journal)
    switching = true
    for (const key of keys) {
      if (original.includes(key)) await move(layout.targets[key], join(paths.previous, key))
      if (incoming.includes(key)) await move(join(paths.stage, key), layout.targets[key])
    }
    await restoreLinks(preview.manifest.entries, layout.targets)
    await writeRecord(paths.journal, { ...journal, phase: 'committed' })
  } catch (error) {
    if (switching) {
      try { await recoverDesktopRestore(layout) }
      catch (recovery) { throw new Error(error.message + '\n原数据和恢复现场仍保留：' + paths.folder + '\n' + recovery.message) }
    } else {
      await rm(paths.folder, { recursive: true, force: true })
    }
    throw error
  }
  return recoverDesktopRestore(layout)
}
