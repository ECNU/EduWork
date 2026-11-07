import { lstat, readFile, readdir, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { acquireInstanceMutex, instanceIdentity, releaseInstanceMutex } from './install-mutex.mjs'
import { WRITABLE_ROOT_MARKER } from './writable-root.mjs'
import { rememberPortableSource } from './installed-migration.mjs'
import { checkInternalWorkspaces, checkRunning, listWindowsProcesses } from './portable-migration.mjs'
import { setTimeout as delay } from 'node:timers/promises'

async function info(path) {
  return lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error; return null })
}

function dataRoot(distribution, localAppData) {
  if (!/^[a-z0-9-]+$/u.test(distribution) || typeof localAppData !== 'string' || !isAbsolute(localAppData)) throw new Error('无法确认当前用户与发行版数据目录')
  return join(localAppData, 'EduWork', distribution)
}

export async function waitForInstalledProcesses({ programRoot, sourceRoot, wait = false, uninstall = false, listProcesses = listWindowsProcesses }) {
  const roots = [programRoot, sourceRoot].filter(Boolean)
  if (!roots.length || roots.some(root => typeof root !== 'string' || !isAbsolute(root))) throw new Error('无法确认需要关闭的程序目录')
  const deadline = Date.now() + (wait ? 15000 : 0)
  for (;;) {
    try {
      const processes = await listProcesses(), ignored = new Set()
      if (uninstall) {
        const expected = instanceIdentity(join(programRoot, 'Uninstall EduWork-Electron.exe'))
        let current = processes.find(item => item.ProcessId === process.pid)
        if (!current) throw new Error('无法确认卸载进程父链，已停止操作')
        for (let depth = 0; depth < 2; depth++) {
          current = processes.find(item => item.ProcessId === current?.ParentProcessId)
          if (!current) break
          if (typeof current.ExecutablePath === 'string' && instanceIdentity(current.ExecutablePath) === expected) ignored.add(current.ProcessId)
        }
      }
      await checkRunning(roots, async () => processes.filter(item => !ignored.has(item.ProcessId)))
      return
    }
    catch (error) {
      if (Date.now() >= deadline) throw error
      await delay(300)
    }
  }
}

export async function rememberInstallerSource({ programRoot, sourceRoot, distribution, localAppData = process.env.LOCALAPPDATA }) {
  await checkInstalledProgramTarget({ programRoot, distribution, localAppData })
  const settings = JSON.parse(await readFile(join(programRoot, 'resources/app/eduwork.desktop.json'), 'utf8'))
  await rememberPortableSource({ programRoot, writableRoot: dataRoot(distribution, localAppData), settings, sourceRoot })
}

export async function checkInstalledProgramTarget({ programRoot, distribution, localAppData = process.env.LOCALAPPDATA, uninstall = false }) {
  if (typeof programRoot !== 'string' || !isAbsolute(programRoot)) throw new Error('安装目录必须是绝对路径')
  const writable = instanceIdentity(dataRoot(distribution, localAppData)), program = instanceIdentity(programRoot)
  const inside = (root, path) => path === root || path.startsWith(root + (process.platform === 'win32' ? '\\' : '/'))
  if (inside(writable, program) || inside(program, writable)) throw new Error('程序目录与个人数据目录不能相互包含')
  // Electron's Toast shortcut would prefer the parent executable as a launcher.
  if (!uninstall && await info(join(dirname(programRoot), 'EduWork-Electron.exe'))) {
    throw new Error('上一级目录已有 EduWork 程序，请选择独立安装目录')
  }
  const root = await info(programRoot)
  if (!root) return
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('安装目标不能是文件或目录链接')
  if (!(await readdir(programRoot)).length) return
  const files = []
  const walk = async (directory, prefix = '') => {
    for (const name of await readdir(directory)) {
      const path = join(directory, name), entry = await lstat(path), relative = prefix + name
      if (entry.isSymbolicLink() || !entry.isFile() && !entry.isDirectory()) throw new Error('程序目录含链接或异常文件，已停止操作并保留数据')
      if (entry.isDirectory()) await walk(path, relative + '/')
      else files.push(relative)
    }
  }
  const file = join(programRoot, 'resources/app/eduwork.desktop.json'), identityInfo = await info(file)
  if (!identityInfo?.isFile() || identityInfo.isSymbolicLink()) throw new Error('安装目标已有其他文件，请选择新的程序目录')
  const identity = JSON.parse(await readFile(file, 'utf8'))
  if (identity.schemaVersion !== 1 || identity.shell !== 'electron' || identity.distribution !== distribution || identity.appId !== `org.eduwork.${distribution}.electron`
    || identity.dataLayout !== 'installed' || await info(join(programRoot, 'data'))) {
    throw new Error('安装目标包含旧便携版或其他发行版数据，请另选程序目录；安装后再选择旧目录迁入')
  }
  // NSIS recursive removal follows junctions; P must contain only owned, unlinked program files.
  await walk(programRoot)
  const manifest = JSON.parse(await readFile(join(programRoot, 'RELEASE-MANIFEST.json'), 'utf8'))
  if (manifest.schemaVersion !== 1 || manifest.kind !== 'eduwork-portable-release' || manifest.distribution !== distribution
    || manifest.shell !== 'electron' || manifest.platform !== 'windows-x64' || manifest.version !== identity.productVersion || !Array.isArray(manifest.files)) throw new Error('程序文件清单无效，已保留安装目录')
  const owned = new Set(manifest.files.map(file => file.path))
  const extras = new Set(['RELEASE-MANIFEST.json', 'Uninstall EduWork-Electron.exe', 'uninstallerIcon.ico', '7zip-installer-LICENSE.txt', '7zip-installer-COPYING.txt'])
  for (const file of files) {
    const cache = /^(.*)\/__pycache__\/([^/]+)\.cpython-\d+(?:\.opt-\d+)?\.pyc$/u.exec(file)
    if (!owned.has(file) && !extras.has(file) && !(cache && owned.has(`${cache[1]}/${cache[2]}.py`))) {
      throw new Error(`程序目录含未登记的文件，请先移到程序目录外：${file}`)
    }
  }
  await checkInternalWorkspaces(programRoot, join(dataRoot(distribution, localAppData), 'data', `${distribution}-electron`))
}

/** Only this edition's marked default W can be removed; filesystem links are unlinked, never followed. */
export async function removeInstalledData({ distribution, localAppData = process.env.LOCALAPPDATA, platform = process.platform }) {
  if (platform !== 'win32') throw new Error('此卸载数据操作仅支持 Windows')
  const root = dataRoot(distribution, localAppData)
  for (const path of [join(localAppData, 'EduWork'), root]) {
    const entry = await info(path)
    if (entry && (!entry.isDirectory() || entry.isSymbolicLink())) throw new Error('数据目录有链接或异常，已保留所有数据')
  }
  const mutex = await acquireInstanceMutex('writable', root, '客户端仍在使用个人数据，已保留数据')
  try {
    if (!await info(root)) return { removed: false }
    const file = join(root, WRITABLE_ROOT_MARKER), markerInfo = await info(file)
    if (!markerInfo?.isFile() || markerInfo.isSymbolicLink() || markerInfo.size > 16384) throw new Error('缺少有效数据归属记录，已保留所有数据')
    const marker = JSON.parse(await readFile(file, 'utf8'))
    if (marker.schemaVersion !== 1 || marker.layout !== 'installed' || marker.distribution !== distribution) {
      throw new Error('数据归属记录不匹配，已保留所有数据')
    }
    await rm(root, { recursive: true, force: true, maxRetries: 3 })
    return { removed: true }
  } finally { await releaseInstanceMutex(mutex) }
}
