import { app, BrowserWindow, dialog } from 'electron'
import { lstatSync, mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { desktopPaths } from './desktop-paths.mjs'
import { WRITABLE_ROOT_MARKER } from './writable-root.mjs'
import { migrationRelaunchArgs, migrationSourceArgument, pendingMigrationFile, prepareInstalledData } from './installed-migration.mjs'

/** Setup uses a temporary Electron profile; W is opened only by the relaunched application. */
export async function runInstalledFirstLaunch({ verifyingUpdate = false } = {}) {
  if (process.platform !== 'win32') return false
  const appRoot = app.getAppPath()
  const settings = JSON.parse(readFileSync(join(appRoot, 'eduwork.desktop.json'), 'utf8'))
  if (settings.dataLayout !== 'installed') {
    if (verifyingUpdate) throw Error('更新要求已安装的 EduWork')
    return false
  }
  const sourceRoot = migrationSourceArgument(process.argv.slice(1))
  const paths = desktopPaths({ appRoot, settings, localAppData: process.env.LOCALAPPDATA,
    testRoot: process.env.EDUWORK_DESKTOP_TEST_DATA_ROOT })
  const marker = lstatSync(join(paths.writableRoot, WRITABLE_ROOT_MARKER), { throwIfNoEntry: false })
  const pending = lstatSync(pendingMigrationFile(paths.writableRoot, settings.distribution), { throwIfNoEntry: false })
  if (marker && !sourceRoot && !pending) return false
  if (verifyingUpdate) throw Error('请先完成安装版个人数据的初始化或迁移')
  const profile = mkdtempSync(join(tmpdir(), 'eduwork-install-'))
  app.setPath('userData', profile)
  app.on('window-all-closed', () => {}) // Closing progress must not quit before relaunch is registered.
  await app.whenReady()
  let progress
  const closeProgress = () => { progress?.destroy(); progress = undefined }
  const choose = async ({ sourceRoot, recovering }) => {
    const cancelId = recovering ? 1 : sourceRoot ? 3 : 2
    const result = await dialog.showMessageBox({ type: 'question', title: settings.productName,
      message: recovering ? '上次数据迁移尚未完成' : '准备安装版个人数据',
      detail: recovering ? `旧目录和迁移现场已保留。可继续检查并恢复迁移：\n${sourceRoot}`
        : `个人数据将独立保存在：\n${paths.writableRoot}\n\n可以迁入旧便携版的会话、附件、记忆、设置与凭据，也可以使用全新数据。`,
      buttons: recovering ? ['继续上次迁移', '取消'] : sourceRoot ? ['迁移旧目录', '选择其他目录', '全新开始', '取消'] : ['迁移旧便携版数据', '全新开始', '取消'],
      defaultId: 0, cancelId, noLink: true })
    if (result.response === cancelId) return null
    if (recovering || sourceRoot && result.response === 0) return { action: 'import', sourceRoot }
    if (!recovering && result.response === (sourceRoot ? 2 : 1)) return { action: 'fresh' }
    const selected = await dialog.showOpenDialog({ title: '选择旧便携版的程序根目录（包含程序、config 和 data）',
      properties: ['openDirectory'], ...(sourceRoot ? { defaultPath: sourceRoot } : {}) })
    return selected.canceled ? null : { action: 'import', sourceRoot: selected.filePaths[0] }
  }
  const preview = async plan => {
    const recovery = plan.recovery
    const result = await dialog.showMessageBox({ type: 'info', title: recovery ? '恢复上次迁移' : '检查旧版数据',
      message: recovery ? '先恢复未完成迁移的旧目录，再重新检查数据' : `将迁入 ${plan.files.length} 个文件`,
      detail: recovery ? `恢复后会再次展示数据清单摘要，确认后才开始复制。\n旧目录：${plan.source}`
        : `旧版：${plan.identity.sourceVersion}\n新版：${plan.identity.targetVersion}\n数据量：${Math.ceil(plan.files.reduce((sum, file) => sum + file.bytes, 0) / 1024 / 1024)} MiB\n\n目标：${paths.writableRoot}\n\n会话、附件、完整记忆、配置和浏览器凭据一起迁入；外部工作区文件保持原位。旧目录会改名保留，检查新版数据前请勿删除。凭据依赖原 Windows 用户，迁移后仍需检查登录状态；配置中的绝对路径不会自动改写。`,
      buttons: [recovery ? '恢复并重新检查' : '开始迁移', '取消'], defaultId: 0, cancelId: 1, noLink: true })
    if (result.response !== 0) return false
    if (!recovery) {
      progress = new BrowserWindow({ width: 480, height: 220, resizable: false, minimizable: false,
        maximizable: false, closable: false, autoHideMenuBar: true, title: '正在安全迁移数据',
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } })
      progress.setMenu(null)
      await progress.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html lang="zh-CN"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><style>body{font:14px system-ui;padding:28px;line-height:1.7}p{color:#555}</style><h3>正在安全迁移数据</h3><p id="status" role="status" aria-live="polite">正在检查并复制文件，请勿强制退出。</p></html>'))
      progress.setProgressBar(2)
    }
    return true
  }
  for (;;) {
    try {
      const result = await prepareInstalledData({ programRoot: paths.root, writableRoot: paths.writableRoot,
        settings, sourceRoot, choose, preview, onProgress: ({ copied, total }) => {
          if (!progress || progress.isDestroyed()) return
          progress.setProgressBar(copied / total)
          void progress.webContents.executeJavaScript(`document.getElementById('status').textContent = ${JSON.stringify(`已校验 ${copied} / ${total} 个文件`)};`).catch(() => {})
        } })
      closeProgress()
      if (result.action !== 'quit') app.relaunch({ args: migrationRelaunchArgs(process.argv.slice(1)) })
      app.exit(0)
      return true
    } catch (error) {
      closeProgress()
      const result = await dialog.showMessageBox({ type: 'error', title: '数据准备未完成',
        message: '已停止操作，请保留旧目录和迁移现场', detail: error.message,
        buttons: ['重试', '退出'], defaultId: 1, cancelId: 1, noLink: true })
      if (result.response !== 0) { app.exit(1); return true }
    }
  }
}
