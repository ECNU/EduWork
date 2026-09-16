import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadUserConfig } from './user-config.mjs'
import { checkDesktopUpdates } from './desktop-updates.mjs'
import { exportDiagnostics } from './diagnostics.mjs'

/** Native-owned arguments only. The renderer chooses one allowlisted action,
 * never a filesystem path, process argument or credential reference. */
export async function workbenchAction({ action, config, version, shell, logs, root, product, home, updateStatus, configurationOverlay }) {
  if (!['status', 'check-updates', 'diagnostics'].includes(action) || !['wails', 'electron'].includes(shell)) throw Error('Invalid desktop action')
  if (action === 'diagnostics') return exportDiagnostics({ config, version, shell, logs, root, product, home, updateStatus, configurationOverlay })
  const settings = loadUserConfig(config)
  const base = { shell, version }
  if (action === 'check-updates') return { ...base, ...await checkDesktopUpdates({ updates: settings.updates, version, shell }) }
  if (action === 'status') return { ...base, phase: 'ready', message: settings.updates.manifestURL
    ? '此绿色版支持检查更新并打开发布页面下载。退出应用后替换程序，保留 data 和 config。'
    : '当前未配置更新渠道，可在 config/eduwork.jsonc 的 updates 中配置。' }

}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [action, config, version, shell, logs, root, product, home, updateJSON] = process.argv.slice(2)
  console.log(JSON.stringify(await workbenchAction({ action, config, version, shell, logs, root, product, home, updateStatus: updateJSON ? JSON.parse(updateJSON) : undefined })))
}
