import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, readFile, readdir, readlink, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const absent = error => { if (error.code !== 'ENOENT') throw error; return null }
const inside = (root, path) => { const rel = relative(root, path); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep)) }
async function digest(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function refuseManagedLinks(root, path) {
  for (let current = path; inside(root, current); current = dirname(current)) {
    const info = await lstat(current).catch(absent)
    if (info?.isSymbolicLink()) throw new Error('迁移状态或 Profile 路径包含链接，原数据已保留，请先检查旧目录。')
    if (current === root) break
  }
}

// Snapshot complete trees without following links or exposing private data in logs.
async function inventory(mappings, legacyBrowser) {
  const rows = [], destinations = new Set()
  async function walk(source, destination) {
    const info = await lstat(source)
    if (destinations.has(destination)) throw new Error('旧数据目录包含重叠路径，请先检查配置与数据目录。')
    destinations.add(destination)
    if (info.isSymbolicLink()) rows.push({ source, destination, kind: 'link', target: await readlink(source), directory: (await stat(source).catch(absent))?.isDirectory() === true })
    else if (info.isDirectory()) {
      rows.push({ source, destination, kind: 'directory' })
      for (const name of (await readdir(source)).sort()) {
        if (source === legacyBrowser && ['SingletonLock', 'SingletonSocket', 'SingletonCookie'].includes(name)) continue
        await walk(join(source, name), join(destination, name))
      }
    } else if (info.isFile()) rows.push({ source, destination, kind: 'file', size: info.size, mode: info.mode, sha256: await digest(source) })
    else throw new Error('旧数据包含正在使用的文件，请完全退出旧客户端后重试。')
  }
  for (const mapping of mappings) await walk(mapping.source, mapping.destination)
  return rows
}

/** Copy and verify a legacy installation once; an existing user tree always wins. */
export async function migrateDesktopData({ userRoot, legacy }, { ownsLegacyLock = false } = {}) {
  if (!legacy || await lstat(userRoot).catch(absent)) return
  const mappings = []
  const addChildren = async (source, destination, exclude = () => false) => {
    const info = await lstat(source).catch(absent)
    if (!info) return
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('旧数据根目录必须是普通目录。')
    for (const name of (await readdir(source)).sort()) {
      if (!exclude(name)) mappings.push({ source: join(source, name), destination: join(destination, name) })
    }
  }
  // Both old platforms keep the browser, DSH and logs together; Windows keeps
  // update/content state beside edition namespaces instead of within them.
  await addChildren(legacy.dataRoot, userRoot, name => name === 'config' || name === 'data')
  await addChildren(legacy.configRoot, userRoot)
  await addChildren(legacy.updateDataRoot, join(userRoot, 'data'), name => /-(?:electron(?:-alpha)?|wails)$/.test(name))
  if (!mappings.length) return
  for (const name of ['SingletonLock', 'SingletonSocket']) {
    if (!ownsLegacyLock && await lstat(join(legacy.dataRoot, 'browser', name)).catch(absent)) throw new Error('请完全退出旧客户端，再迁移用户目录。')
  }
  await mkdir(dirname(userRoot), { recursive: true, mode: 0o700 })
  const lock = userRoot + '.migration-lock'
  try { await mkdir(lock, { mode: 0o700 }) }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('用户目录正在迁移；请等待另一客户端完成。若上次迁移中断，请退出客户端后删除旁边的 .migration-lock 目录。')
    throw error
  }
  const stage = userRoot + '.migration-' + randomUUID()
  try {
    if (await lstat(userRoot).catch(absent)) return
    const before = await inventory(mappings, join(legacy.dataRoot, 'browser'))
    await mkdir(stage, { mode: 0o700 })
    const relocate = path => {
      for (const mapping of mappings) if (inside(mapping.source, path)) {
        const moved = join(mapping.destination, relative(mapping.source, path))
        const oldProfile = join(userRoot, 'dsh/profiles/desktop-017')
        return inside(oldProfile, moved) ? join(userRoot, 'dsh/profiles/desktop-native', relative(oldProfile, moved)) : moved
      }
      return path
    }
    for (const row of before) {
      const target = join(stage, relative(userRoot, row.destination))
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      if (row.kind === 'directory') await mkdir(target, { recursive: true, mode: 0o700 })
      else if (row.kind === 'link') {
        const absolute = resolve(dirname(row.source), row.target), relocated = relocate(absolute)
        const linkTarget = relocated !== absolute ? relative(dirname(relocate(row.source)), relocated) : row.target
        await symlink(process.platform === 'win32' && row.directory ? relocated : linkTarget, target, row.directory ? (process.platform === 'win32' ? 'junction' : 'dir') : 'file')
      } else {
        await copyFile(row.source, target)
        if (await digest(target) !== row.sha256) throw new Error('旧用户数据在迁移期间发生变化，请退出旧客户端后重试。')
      }
    }
    if (JSON.stringify(await inventory(mappings, join(legacy.dataRoot, 'browser'))) !== JSON.stringify(before)) throw new Error('旧用户数据在迁移期间发生变化，请退出旧客户端后重试。')
    const oldProfile = join(stage, 'dsh/profiles/desktop-017')
    const newProfile = join(stage, 'dsh/profiles/desktop-native')
    await refuseManagedLinks(stage, oldProfile)
    await refuseManagedLinks(stage, newProfile)
    if (await lstat(oldProfile).catch(absent)) {
      if (await lstat(newProfile).catch(absent)) throw new Error('旧目录包含两份原生 Profile，请先选择需要迁移的一份。')
      await rename(oldProfile, newProfile)
    }
    // Configuration state authenticates a path relative to its data root.
    const statePath = join(stage, 'data/configuration/state.json')
    await refuseManagedLinks(stage, statePath)
    const state = await readFile(statePath, 'utf8').then(JSON.parse).catch(absent)
    if (state) {
      const oldIdentity = relative(legacy.updateDataRoot, join(legacy.configRoot, 'eduwork.jsonc')).replaceAll('\\', '/')
      if (state.configuration !== oldIdentity) throw new Error('旧配置状态与配置文件不匹配；原数据已保留。')
      // Overrides remain caller-owned and must not inherit the default file's state.
      state.configuration = relative(join(userRoot, 'data'), join(userRoot, 'eduwork.jsonc')).replaceAll('\\', '/')
      await writeFile(statePath, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 })
    }
    // Pending update archives and transaction paths relocate, installation paths do not.
    const pendingPath = join(stage, 'data/state/updates/pending-update.json')
    await refuseManagedLinks(stage, pendingPath)
    const pending = await readFile(pendingPath, 'utf8').then(JSON.parse).catch(absent)
    if (pending) {
      for (const key of ['zipPath']) if (typeof pending[key] === 'string') pending[key] = relocate(pending[key])
      await writeFile(pendingPath, JSON.stringify(pending, null, 2) + '\n', { mode: 0o600 })
    }
    await writeFile(join(stage, '.eduwork-directory-migration.json'), JSON.stringify({ schemaVersion: 1, source: legacy, files: before.filter(row => row.kind === 'file').length }, null, 2) + '\n', { mode: 0o600 })
    await rename(stage, userRoot)
  } finally {
    await rm(stage, { recursive: true, force: true })
    await rm(lock, { recursive: true, force: true })
  }
}
