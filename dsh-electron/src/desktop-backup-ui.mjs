import { app, BrowserWindow, dialog, shell } from 'electron'
import { isAbsolute, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { removeWindowMenu } from './desktop-menu.mjs'
import { loadUserConfig } from './user-config.mjs'
import { createDesktopBackup, desktopBackupLayout, hasPendingDesktopRestore, previewDesktopRestore,
  recoverDesktopRestore, restoreDesktopBackup } from './desktop-backup.mjs'

const flag = '--eduwork-data-operation='
const isOperation = arg => arg.startsWith(flag)
export const dataOperationDuringUpdate = args => args.includes('--update-health-file') || args.includes('--eduwork-migration')
const privacy = '备份包含个人数据和可能含密钥的配置，请保存在私有目录。设备登录凭据保留在原设备。'

export async function chooseDesktopBackup(window, restart) {
  const { response } = await dialog.showMessageBox(window, {
    type: 'question', title: '备份与恢复', message: '选择要执行的操作',
    detail: '客户端会先关闭运行中的服务。完成操作后会重新打开。\n' + privacy,
    buttons: ['创建备份', '从备份恢复', '取消'], defaultId: 0, cancelId: 2, noLink: true,
  })
  if (response === 2 || window.isDestroyed()) return
  const action = response === 0 ? 'backup' : 'restore'
  const selected = await dialog.showOpenDialog(window, {
    title: action === 'backup' ? '选择备份保存位置' : '选择包含 manifest.json 的完整备份文件夹',
    properties: action === 'backup' ? ['openDirectory', 'createDirectory'] : ['openDirectory'],
  })
  if (!selected.canceled && !window.isDestroyed()) restart([flag + action + ':' + selected.filePaths[0]])
}

async function maintenanceWindow(message) {
  const window = new BrowserWindow({ width: 560, height: 200, show: false, resizable: false, closable: false,
    title: '备份与恢复', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } })
  removeWindowMenu(window)
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    '<!doctype html><html lang="zh"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'">' +
    '<title>备份与恢复</title><body><h2>' + message + '</h2><p>请等待客户端完成操作。</p><progress aria-label="备份与恢复进度"></progress></body></html>'))
  window.show()
  return window
}

async function presentOperation(window, layout, action, folder) {
  if (action === 'backup') {
    const result = await createDesktopBackup(layout, folder)
    const { response } = await dialog.showMessageBox(window, {
      type: 'info', title: '备份已创建', message: `已备份 ${result.files} 个文件`,
      detail: result.folder + '\n' + privacy, buttons: ['显示备份文件夹', '继续启动'], defaultId: 1, noLink: true,
    })
    if (response === 0) shell.showItemInFolder(result.folder)
    return
  }
  const preview = await previewDesktopRestore(layout, folder)
  loadUserConfig(join(preview.folder, 'data/configuration/eduwork.jsonc'))
  const previousFiles = preview.previous.filter(row => row.kind === 'file').length
  const missing = preview.workspaces.filter(row => row.missing).map(row => row.path)
  const workspace = missing.length ? [
    `${missing.length} 个工作区路径当前不可用。恢复会保留原路径。`,
    ...missing.slice(0, 5), ...(missing.length > 5 ? ['另有 ' + (missing.length - 5) + ' 个路径'] : []),
  ] : []
  const { response } = await dialog.showMessageBox(window, {
    type: 'warning', title: '预览恢复',
    message: `用 ${preview.manifest.productVersion} 的备份替换当前数据？`,
    detail: [`备份时间 ${new Date(preview.manifest.createdAt).toLocaleString()}`,
      `${preview.files} 个文件 · ${(preview.bytes / 1048576).toFixed(1)} MiB`,
      `会替换配置、历史、附件、记忆和应用设置。当前 ${previousFiles} 个纳入备份范围的文件会随原目录保留。`,
      `保留位置 ${layout.history}`,
      '外部工作区文件需单独复制。换机后请按需登录。', ...workspace].join('\n'),
    buttons: ['取消', '替换并恢复'], defaultId: 0, cancelId: 0, noLink: true,
  })
  if (response !== 1) return
  window.setTitle('正在恢复个人数据…')
  const result = await restoreDesktopBackup(layout, preview.folder, preview.signature, { validateConfiguration: loadUserConfig })
  const completed = await dialog.showMessageBox(window, {
    type: 'info', title: '恢复完成', message: '备份数据已替换，客户端将重新打开',
    detail: '原数据保留于 ' + result.previous, buttons: ['显示原数据', '继续启动'], defaultId: 1, noLink: true,
  })
  if (completed.response === 0) shell.showItemInFolder(result.previous)
}

export async function handleDesktopBackup(paths, settings, argv, onMaintenance) {
  const args = argv.filter(isOperation), interrupted = await hasPendingDesktopRestore(paths)
  if (!args.length && !interrupted) return false
  onMaintenance()
  let window
  try {
    if (dataOperationDuringUpdate(argv)) throw Error('请先完成客户端的安装或更新')
    const assembly = JSON.parse(await readFile(join(paths.product, 'assembly.json'), 'utf8'))
    const layout = desktopBackupLayout(paths, settings, assembly)
    const recovery = await recoverDesktopRestore(layout)
    if (recovery) {
      await dialog.showMessageBox({ type: 'info', title: '已处理上次恢复',
        message: recovery.restored ? '已完成上次恢复' : '已恢复到替换前的数据',
        detail: '恢复记录和保留数据位于 ' + recovery.folder, buttons: ['继续启动'] })
    }
    if (args.length) {
      const selection = args.length === 1 && /^(backup|restore):([\s\S]+)$/u.exec(args[0].slice(flag.length))
      if (!selection || !isAbsolute(selection[2])) throw Error('请选择有效的备份目录')
      const [, action, folder] = selection
      window = await maintenanceWindow(action === 'backup' ? '正在创建备份…' : '正在校验备份…')
      await presentOperation(window, layout, action, folder)
    }
  } catch (error) {
    const pending = await hasPendingDesktopRestore(paths).catch(() => true)
    const options = { type: 'error', title: '备份与恢复',
      message: pending ? '恢复尚未完成。请保留恢复目录，客户端将退出。' : '操作未完成',
      detail: error.message, buttons: [pending ? '退出' : '继续启动'] }
    if (window) await dialog.showMessageBox(window, options)
    else await dialog.showMessageBox(options)
    if (pending) { app.exit(1); return true }
  }
  if (args.length) {
    app.relaunch({ args: argv.filter(arg => !isOperation(arg)) })
    app.exit()
    return true
  }
  return false
}
