import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, mkdtemp, rm, readdir, realpath, stat } from 'node:fs/promises'
import { join, basename, extname } from 'node:path'
import { tmpdir } from 'node:os'

const exec = promisify(execFile)
const command = (file, args) => exec(file, args, { timeout: 30000, maxBuffer: 4 * 1024 * 1024 })

async function mountedImages() {
  const directory = await mkdtemp(join(tmpdir(), 'eduwork-installer-'))
  try {
    const file = join(directory, 'images.plist')
    const { stdout } = await command('/usr/bin/hdiutil', ['info', '-plist'])
    await writeFile(file, stdout, { mode: 0o600 })
    const result = await command('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file])
    return JSON.parse(result.stdout).images ?? []
  } finally { await rm(directory, { recursive: true, force: true }) }
}

async function signature(appPath) {
  await command('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath])
  const { stderr } = await command('/usr/bin/codesign', ['-d', '--verbose=4', appPath])
  const hash = stderr.match(/^CDHash=([a-f0-9]+)$/m)?.[1]
  if (!hash) throw new Error('Application signature identity unavailable')
  return hash
}

export async function findInstaller(appPath, images, identify = signature) {
  if (!images.length) return null
  const installed = await realpath(appPath)
  const identity = await identify(installed)
  const matches = []
  for (const image of images) {
    const mounts = (image['system-entities'] ?? []).map(row => row['mount-point']).filter(Boolean)
    if (mounts.length !== 1 || extname(image['image-path'] ?? '').toLowerCase() !== '.dmg') continue
    try {
      const mount = await realpath(mounts[0])
      if (installed.startsWith(mount + '/')) continue
      const apps = (await readdir(mount)).filter(name => name.endsWith('.app'))
      if (apps.length !== 1) continue
      const candidate = await realpath(join(mount, apps[0]))
      if (!candidate.startsWith(mount + '/') || await identify(candidate) !== identity) continue
      const imagePath = await realpath(image['image-path'])
      const file = await stat(imagePath)
      if (!file.isFile()) continue
      matches.push({ mount, imagePath, identity, device: file.dev, inode: file.ino, size: file.size, modified: file.mtimeMs })
    } catch { /* Unreadable or unrelated images are not installation candidates. */ }
  }
  return matches.length === 1 ? matches[0] : null
}

export async function cleanInstaller(candidate, { images = mountedImages, identify = signature, appPath, eject, trash }) {
  // Recheck after the dialog: a volume or image may have been replaced meanwhile.
  const current = await findInstaller(appPath, await images(), identify)
  if (!current || Object.keys(candidate).some(key => candidate[key] !== current[key])) throw new Error('安装镜像已变化，请手动检查。')
  await eject(current.mount)
  const file = await stat(current.imagePath)
  if (file.dev !== current.device || file.ino !== current.inode || file.size !== current.size || file.mtimeMs !== current.modified) throw new Error('安装卷已推出，但镜像文件已变化，请手动清理。')
  await trash(current.imagePath)
}

export async function offerInstallerCleanup({ app, window, shell, dialog, appPath,
  images = mountedImages, identify = signature, platform = process.platform,
  eject = mount => command('/usr/bin/hdiutil', ['detach', mount]) }) {
  if (platform !== 'darwin' || !app.isPackaged || !app.isInApplicationsFolder()) return
  const statePath = join(app.getPath('userData'), 'installer-cleanup.json')
  const candidate = await findInstaller(appPath, await images(), identify)
  if (!candidate || !window || window.isDestroyed()) return
  try {
    if (JSON.parse(await readFile(statePath, 'utf8')).identity === candidate.identity) return
  } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error }
  const { response } = await dialog.showMessageBox(window, {
    type: 'question', title: '清理安装文件', message: '安装已完成，是否清理安装文件？',
    detail: `将推出安装卷“${basename(candidate.mount)}”，并将以下镜像移到废纸篓：\n${candidate.imagePath}\n\n不会删除已安装的应用。`,
    buttons: ['推出并移到废纸篓', '保留'], defaultId: 0, cancelId: 1,
  })
  if (response === 0) {
    try {
      await cleanInstaller(candidate, { appPath, images, identify, eject, trash: path => shell.trashItem(path) })
    } catch (error) {
      if (!window.isDestroyed()) await dialog.showMessageBox(window, { type: 'warning', title: '未能完成清理', message: '请手动检查安装卷和 DMG 文件。', detail: error.message })
      return
    }
  }
  await writeFile(statePath, JSON.stringify({ identity: candidate.identity }), { mode: 0o600 })
}
