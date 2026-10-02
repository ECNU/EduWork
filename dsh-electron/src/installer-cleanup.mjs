import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, mkdtemp, rm, realpath, stat } from 'node:fs/promises'
import { join, basename, extname, isAbsolute, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'

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

const mountsOf = image => (image['system-entities'] ?? []).map(row => row['mount-point']).filter(Boolean)
async function installationIdentity(appPath) {
  const file = await stat(appPath)
  return `${file.dev}:${file.ino}:${file.birthtimeMs}`
}
async function imageIdentity(path) {
  const file = await stat(path)
  if (!file.isFile()) throw new Error('安装镜像不是普通文件。')
  return { device: file.dev, inode: file.ino, size: file.size, modified: file.mtimeMs }
}
async function checkImage(candidate) {
  const current = await imageIdentity(candidate.imagePath)
  if (Object.keys(current).some(key => current[key] !== candidate[key])) throw new Error('安装镜像已变化，保留文件供手动检查。')
}

export async function sourceInstaller(appPath, images, identify = signature) {
  const source = await realpath(appPath)
  for (const image of images) {
    const mounts = mountsOf(image)
    if (mounts.length !== 1 || extname(image['image-path'] ?? '').toLowerCase() !== '.dmg') continue
    const mount = await realpath(mounts[0]).catch(() => null)
    if (!mount || !source.startsWith(mount + sep)) continue
    const imagePath = await realpath(image['image-path'])
    return { imagePath, identity: await identify(source), ...await imageIdentity(imagePath) }
  }
  return null
}

export async function draggedInstaller(appPath, images, identify = signature) {
  if (!images.length) return null
  const installed = await realpath(appPath), identity = await identify(installed)
  let candidate = null
  for (const image of images) {
    const mounts = mountsOf(image)
    if (mounts.length !== 1 || extname(image['image-path'] ?? '').toLowerCase() !== '.dmg') continue
    const mount = await realpath(mounts[0]).catch(() => null)
    if (!mount) continue
    const source = await realpath(join(mount, basename(installed))).catch(() => null)
    if (!source || !source.startsWith(mount + sep) || source === installed ||
        await identify(source).catch(() => null) !== identity) continue
    const match = await sourceInstaller(source, [image], async () => identity)
    if (!match) continue
    if (candidate && candidate.imagePath !== match.imagePath) return null
    candidate = match
  }
  return candidate
}

export async function cleanInstaller(candidate, { appPath, images = mountedImages, identify = signature,
  eject = mount => exec('/usr/bin/hdiutil', ['detach', mount], { timeout: 2000 }), trash, wait = delay }) {
  if (!candidate || !isAbsolute(candidate.imagePath ?? '') || extname(candidate.imagePath).toLowerCase() !== '.dmg' ||
      !['device', 'inode', 'size', 'modified'].every(key => Number.isFinite(candidate[key])) ||
      await identify(appPath) !== candidate.identity) throw new Error('无法确认安装镜像来源，保留文件。')
  const installed = await realpath(appPath)
  for (let attempt = 0; attempt < 25; attempt++) {
    await checkImage(candidate)
    const mounts = []
    for (const image of await images()) {
      if (await realpath(image['image-path']).catch(() => null) === candidate.imagePath) {
        mounts.push(...await Promise.all(mountsOf(image).map(mount => realpath(mount))))
      }
    }
    if (mounts.length > 1 || mounts.some(mount => installed.startsWith(mount + sep))) throw new Error('安装卷仍在使用，保留文件。')
    try {
      for (const mount of mounts) await eject(mount)
      break
    } catch (error) {
      if (attempt === 24) throw error
      // The source process may still be exiting after Electron relaunches the installed app.
      await wait(250)
    }
  }
  await checkImage(candidate)
  await trash(candidate.imagePath)
}

export async function installFromDmg({ app, shell, dialog, appPath,
  images = mountedImages, identify = signature, platform = process.platform, defaultApp = process.defaultApp, eject, wait,
  warn = message => console.warn(message) }) {
  // The macOS assembler retains the Electron executable name, so isPackaged
  // is false even in a signed bundle. defaultApp identifies Electron CLI runs.
  if (platform !== 'darwin' || defaultApp) return false
  const statePath = join(app.getPath('userData'), 'pending-source-dmg-cleanup.json')
  const receiptPath = join(app.getPath('userData'), 'dmg-installation.json')
  if (app.isInApplicationsFolder()) {
    try {
      let candidate = JSON.parse(await readFile(statePath, 'utf8').catch(error => {
        if (error.code !== 'ENOENT') throw error
        return 'null'
      }))
      const receipt = JSON.parse(await readFile(receiptPath, 'utf8').catch(error => {
        if (error.code !== 'ENOENT') throw error
        return '{}'
      }))
      const installation = await installationIdentity(appPath)
      if (candidate && await identify(appPath) !== candidate.identity) {
        await rm(statePath, { force: true })
        candidate = null
      }
      if (!candidate && receipt.installation === installation && receipt.cleaned === true) return false
      if (!candidate) {
        candidate = await draggedInstaller(appPath, await images(), identify)
        if (!candidate || receipt.cancelled?.installations.includes(installation) && candidate.imagePath === receipt.cancelled.imagePath &&
            ['device', 'inode', 'size', 'modified'].every(key => candidate[key] === receipt.cancelled[key])) return false
        await writeFile(statePath, JSON.stringify(candidate), { mode: 0o600 })
      }
      await cleanInstaller(candidate, { appPath, images, identify, eject, wait, trash: path => shell.trashItem(path) })
      await rm(statePath, { force: true })
      await writeFile(receiptPath, JSON.stringify({ installation, cleaned: true }), { mode: 0o600 })
    } catch (error) {
      if (error.code === 'ENOENT') await rm(statePath, { force: true })
      else warn(`安装文件未清理，可手动推出安装卷并移到废纸篓：${error.message}`)
    }
    return false
  }
  const candidate = await sourceInstaller(appPath, await images(), identify)
  if (!candidate) return false
  await writeFile(statePath, JSON.stringify(candidate), { mode: 0o600 })
  try {
    if (app.moveToApplicationsFolder({ conflictHandler: conflict => {
      if (conflict === 'existsAndRunning') {
        dialog.showMessageBoxSync({ type: 'info', message: '请先退出已安装的应用，再重新打开安装卷中的应用。' })
        return false
      }
      return dialog.showMessageBoxSync({ type: 'question', message: '替换“应用程序”中的已有版本？',
        detail: '已有应用会移到废纸篓，用户配置和数据会保留。', buttons: ['替换', '取消'], defaultId: 1, cancelId: 1 }) === 0
    } })) return true
    await rm(statePath, { force: true })
  } catch (error) {
    await rm(statePath, { force: true })
    await dialog.showMessageBox({ type: 'error', message: '未能安装到“应用程序”目录', detail: `${error.message}\n可以重试，或将应用拖到“应用程序”目录后打开。` })
  }
  const installations = await Promise.all(['/Applications', join(app.getPath('home'), 'Applications')].map(directory =>
    installationIdentity(join(directory, basename(appPath))).catch(error => {
      if (error.code !== 'ENOENT') throw error
      return null
    })))
  await writeFile(receiptPath, JSON.stringify({ cancelled: { ...candidate, installations } }), { mode: 0o600 })
  app.quit()
  return true
}
