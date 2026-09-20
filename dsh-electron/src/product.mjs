import { app, BrowserWindow, safeStorage, shell, Tray, Menu, nativeImage, dialog } from 'electron'
import { readFileSync, mkdirSync } from 'node:fs'
import { readFile, writeFile, access } from 'node:fs/promises'
import { join, resolve, isAbsolute } from 'node:path'
import { EncryptedVault, startNativeBridge } from './native-vault.mjs'
import { prepareProductProfile } from './product-profile.mjs'
import { DesktopLifecycle } from './lifecycle.mjs'
import { loadUserConfig } from './user-config.mjs'
import { openConfigurationFile } from './configuration-files.mjs'
import { desktopConfigurationPath, publisherConfigurationOverride } from './configuration-policy.mjs'
import { readMigrationLaunch, importLegacyData, writeMigrationHealth } from './legacy-migration.mjs'
import { startPortableUpdates } from './portable-updates.mjs'
import { startMacSparkleUpdates } from './mac-sparkle-updates.mjs'
import { workbenchAction } from './workbench-support.mjs'
import { desktopLogger } from './desktop-log.mjs'
import { attachExternalNavigation } from './external-navigation.mjs'

export function configureWindowNavigation(window) {
  attachExternalNavigation(window.webContents, url => shell.openExternal(url), () => {
    void dialog.showMessageBox(window, { type: 'error', title: '无法打开链接', message: '系统浏览器未能打开链接，请检查默认浏览器设置后重试。' })
  })
}

let settings, paths, bootstrap, progressWindow, nativeBridge, tray, mainWindow, user
let quitComplete = false
let migrationLaunch
let portableUpdates
const lifecycle = new DesktopLifecycle()
export function trackHost(host) { lifecycle.trackHost(host) }
export function desktopHostLog(chunk) { desktopLogger(join(paths.logs, 'desktop-host.log'))(chunk) }
export function isQuitting() { return lifecycle.closing }
export function configureEduworkPaths() {
  const appRoot = app.getAppPath()
  settings = JSON.parse(readFileSync(join(appRoot, 'eduwork.desktop.json'), 'utf8'))
  if (settings.schemaVersion !== 1 || settings.shell !== 'electron' || !/^[a-z0-9.-]+$/u.test(settings.appId)) throw new Error('Invalid EduWork desktop identity')
  const distributionRoot = resolve(appRoot, process.platform === 'darwin' ? '../../..' : '../..')
  const writableRoot = process.platform === 'darwin' ? join(app.getPath('appData'), settings.distribution + '-electron') : distributionRoot
  const testRoot = process.env.EDUWORK_DESKTOP_TEST_DATA_ROOT
  if (testRoot && (!isAbsolute(testRoot) || /(?:^|[\\/])current(?:[\\/]|$)/iu.test(testRoot))) throw new Error('Test data requires an isolated absolute directory')
  const dataRoot = testRoot ? resolve(testRoot) : process.platform === 'darwin' ? writableRoot : join(distributionRoot, 'data', settings.distribution + '-electron')
  const publisherConfig = publisherConfigurationOverride({settings,appRoot,writableRoot})
  paths = {
    root: distributionRoot,
    product: resolve(appRoot, settings.product),
    node: resolve(appRoot, settings.node),
    home: join(dataRoot, 'dsh'),
    userData: join(dataRoot, 'browser'),
    logs: join(dataRoot, 'logs'),
    config: desktopConfigurationPath({root:writableRoot,version:settings.productVersion,ownership:settings.configurationOwnership,override:process.env.EDUWORK_CONFIG_FILE ?? publisherConfig}),
    icon: process.platform === 'darwin' ? join(appRoot, '../brand/icon-256.png') : join(distributionRoot, 'resources/brand/icon-256.png'),
  }
  mkdirSync(paths.userData, { recursive: true })
  mkdirSync(paths.logs, { recursive: true })
  desktopHostLog(`\n[desktop] Starting ${settings.productVersion} (electron) ${new Date().toISOString()}\n`)
  app.setName(settings.productName)
  app.setPath('userData', paths.userData)
  app.setAppUserModelId(settings.appId)
  process.env.DSH_HOME = paths.home
  process.env.DSH_DESKTOP_DIAGNOSTIC_FILE = join(paths.logs, 'startup-error.log')
  // Own the process tree from the beginning of startup, including when the
  // user closes the progress window before the Host becomes ready.
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
  app.on('before-quit', event => {
    if (quitComplete) return
    event.preventDefault()
    if (lifecycle.closing) return
    void (async () => {
      await lifecycle.close()
      tray?.destroy(); tray = undefined
      quitComplete = true
      app.quit()
    })()
  })
}
export function prepareEduworkDesktop() { return lifecycle.prepare(prepareDesktop) }
async function prepareDesktop() {
  lifecycle.check()
  migrationLaunch = await readMigrationLaunch({root:paths.root,settings,argv:process.argv})
  progressWindow = new BrowserWindow({ width: 580, height: 280, resizable: false, title: settings.productName,
    icon: paths.icon,
    backgroundColor: '#faf8f4', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } })
  const title = String(settings.productName).replace(/[<>&"']/gu, '')
  const logo = 'data:image/png;base64,' + readFileSync(paths.icon).toString('base64')
  await progressWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><meta charset="utf-8"><style>body{font:16px system-ui;padding:36px;color:#313744;background:#faf8f4}progress{width:100%;margin-top:20px;accent-color:#2575ff}h2{display:flex;align-items:center;gap:12px}</style><h2><img alt="" width="40" height="40" src="' + logo + '">正在启动 ' + title + '</h2><p>正在准备本机工作环境…</p><progress></progress>'))
  lifecycle.check()
  if (!isAbsolute(paths.config)) throw new Error('EDUWORK_CONFIG_FILE must be an absolute path')
  if(settings.configurationOwnership==='publisher')await access(paths.config)
  user = loadUserConfig(paths.config)
  if (user.product.name) { settings.productName = user.product.name; app.setName(user.product.name); progressWindow.setTitle(user.product.name) }
  await writeMigrationHealth(migrationLaunch,'starting','正在迁移旧版历史数据')
  await importLegacyData({root:paths.root,targetHome:paths.home,launch:migrationLaunch,onProgress:progress=>
    writeMigrationHealth(migrationLaunch,'importing',`正在复制历史文件 ${progress.copied}/${progress.total}`)})
  if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text')) throw new Error('System credential encryption is unavailable')
  let launch = {}
  // A private development profile is optional and never copied into a release.
  // Explicitly opt in at launch; do not discover account files elsewhere.
  if (process.env.EDUWORK_DESKTOP_PRIVATE_CONFIG) {
    const privatePath = process.env.EDUWORK_DESKTOP_PRIVATE_CONFIG
    if (!isAbsolute(privatePath)) throw new Error('Private desktop configuration must use an absolute path')
    launch = JSON.parse(await readFile(privatePath, 'utf8'))
  }
  const prepared = await prepareProductProfile({ product: paths.product, home: paths.home, shell: 'electron',
    pluginConfig: launch.pluginConfig, patches: launch.patches, enterpriseProfile: launch.enterpriseProfile, userConfig: paths.config, configurationOwnership:settings.configurationOwnership })
  lifecycle.check()
  if (prepared.identity.distribution !== settings.distribution) throw new Error('Desktop and product editions do not match')
  for (const [key, value] of Object.entries({ ...prepared.environment, ...launch.environment })) if (typeof value === 'string') process.env[key] = value
  // Reassert the edition's immutable ownership after optional test settings.
  Object.assign(process.env, prepared.environment)
  portableUpdates = process.platform === 'darwin'
    ? startMacSparkleUpdates({appPath:app.getAppPath(),version:settings.productVersion,enabled:settings.macSparkle?.enabled === true})
    : await startPortableUpdates({root:paths.root,updates:user.updates,defaults:settings.updates,version:settings.productVersion,distribution:settings.distribution,onQuit:()=>app.quit()})
  if(portableUpdates)lifecycle.trackBridge(portableUpdates)
  const vault = new EncryptedVault(join(paths.userData, 'credentials.encrypted'), safeStorage)
  const bridge = await startNativeBridge({ vault, openExternal: url => shell.openExternal(url),
    workbench: async action => portableUpdates && action !== 'diagnostics' ? portableUpdates.action(action) : workbenchAction({ action, config: paths.config, version: settings.productVersion, shell: 'electron', logs: paths.logs, root: paths.root, product: paths.product, home: paths.home,
      updateStatus: action === 'diagnostics' && portableUpdates ? await portableUpdates.action('status').catch(error=>({error:error.message})) : undefined }),
    openConfiguration: settings.configurationOwnership==='publisher' ? undefined : target => openConfigurationFile(paths.config, target, path => shell.openPath(path)) })
  lifecycle.trackBridge(bridge)
  nativeBridge = bridge
  bootstrap = bridge.bootstrap
  await writeFile(join(paths.logs, 'desktop-start.json'), JSON.stringify({ shell: 'electron', productVersion: settings.productVersion, dshVersion: prepared.identity.dshVersion, pid: process.pid, startedAt: new Date().toISOString() }, null, 2))
  lifecycle.check()
  return { profile: prepared.profile, node: paths.node }
}
export function nativeBootstrap() { if (!bootstrap) throw new Error('Native desktop bridge is not ready'); return bootstrap }
export async function desktopReady() { await writeMigrationHealth(migrationLaunch,'ready'); if (progressWindow && !progressWindow.isDestroyed()) progressWindow.close(); progressWindow = undefined }

export async function attachDesktopWindow(window) {
  mainWindow = window
  window.setTitle(settings.productName)
  window.setIcon(paths.icon)
  window.on('page-title-updated', event => { event.preventDefault(); window.setTitle(settings.productName) })
  const show = () => { if (!window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.show(); window.focus() } }
  const action = value => {
    show()
    if (!['new-session', 'settings'].includes(value) || window.isDestroyed()) return
    // Only the trusted application renderer receives these two fixed actions.
    if (!window.webContents.getURL().startsWith('dsh-app://app/')) return
    void window.webContents.executeJavaScript(`(window.__eduworkTrayActions ??= []).push(${JSON.stringify(value)}); window.dispatchEvent(new Event('eduwork:tray-action'));`).catch(() => {})
  }
  try {
    const icon = nativeImage.createFromPath(process.platform === 'darwin' ? join(app.getAppPath(), '../brand/icon-32.png') : join(paths.root, 'resources/brand/icon-32.png'))
    lifecycle.check()
    if (icon.isEmpty()) throw new Error('No system tray icon available')
    tray = new Tray(icon)
    tray.setToolTip(settings.productName)
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开 ' + settings.productName, click: show },
      { label: '新建会话', click: () => action('new-session') },
      { type: 'separator' },
      { label: '检查更新', click: () => { show(); void checkProductUpdates() } },
      { label: '设置', click: () => action('settings') },
      { type: 'separator' },
      { label: '退出 ' + settings.productName, click: () => app.quit() },
    ]))
    tray.on('double-click', show)
  } catch (error) {
    tray?.destroy(); tray = undefined
    if (isQuitting()) throw error
    console.warn('System tray unavailable; closing the window will exit.')
  }
  window.on('close', event => {
    if (!isQuitting() && tray && user?.closeAction !== 'exit') { event.preventDefault(); window.hide() }
  })
}

export function checkProductUpdates() {
 if (!mainWindow || mainWindow.isDestroyed()) return
 mainWindow.show();mainWindow.focus()
 if (process.platform === 'darwin' && settings.macSparkle?.enabled && portableUpdates) {
   return portableUpdates.action('check-updates').catch(error => dialog.showMessageBox(mainWindow, {type:'error',title:'检查更新失败',message:error.message}))
 }
 return mainWindow.webContents.executeJavaScript("window.dispatchEvent(new Event('eduwork:open-updates'));").catch(()=>{})
}
export async function showDesktopFailure(error) {
  if (isQuitting()) return
  await writeMigrationHealth(migrationLaunch,'failed','新版未完成启动，旧版数据仍保留').catch(()=>{})
  const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
  if (!progressWindow || progressWindow.isDestroyed()) progressWindow = new BrowserWindow({ width: 660, height: 470, title: settings.productName, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } })
  progressWindow.setSize(660, 470)
  progressWindow.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    if (url === 'eduwork-startup://restart/') { app.relaunch(); app.quit() }
    if (url === 'eduwork-startup://exit/') app.quit()
  })
  await progressWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><meta charset="utf-8"><style>body{font:15px system-ui;margin:32px;color:#313744;background:#faf8f4}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#fff0f1;padding:16px;color:#9f2636}a{display:inline-block;margin:12px 12px 0 0;padding:9px;border:1px solid #aaa;border-radius:6px;color:inherit}</style><h2>${escape(settings.productName)} 暂时未能启动</h2><p>修正以下问题后可重新启动。原有配置和历史数据不会被重置。</p><pre>${escape(error.message || error)}</pre><p>配置文件：${escape(paths.config)}</p><a href="eduwork-startup://restart/">重新启动</a><a href="eduwork-startup://exit/">退出</a>`))
  progressWindow.show()
}
