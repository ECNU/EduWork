// The pinned upstream desktop primitives own native behavior. Product hooks retain edition
// configuration, portable directories, secure credentials, updates and attention.
import { app, dialog, protocol, powerMonitor, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { access } from 'node:fs/promises'
import { DesktopBackendController } from './backend-controller.ts'
import { DesktopFatalRecovery } from './fatal-recovery.ts'
import { DesktopQuitConfirmation } from './quit-confirmation.ts'
import { claimDesktopSingleInstance } from './single-instance.ts'
import { writeCrashReport, pruneCrashReports } from './crash-report.ts'
import { createWindow } from './main.ts'
import { SCHEME } from './ipc.ts'
import { resolveDesktopLocale } from './locale.ts'
import { readDesktopLoginShellEnvironment, resolveDesktopLoginShellConfig } from './login-shell-environment.ts'
import { DesktopHostProcess, staticDesktopResponse } from './eduwork-host-process.mjs'
import { installNativeDesktopBridge } from './native-desktop-bridge.mjs'
import { createSidebarBrowser } from './sidebar-browser.mjs'
import { redactDiagnostic } from './diagnostics.mjs'
import { connectInstalledStartup, installedStartupId } from './installed-startup-check.mjs'
import { shouldPresentMainWindow } from './startup-presentation.mjs'
import { configureEduworkPaths, installEduworkFromDmg, prepareEduworkDesktop, nativeBootstrap, desktopReady, desktopWebRoot,
  desktopStartupWindowPresent, trackHost, desktopHostLog, isQuitting, attachDesktopWindow, configureWindowNavigation,
  showDesktopFailure, showDesktop, checkProductUpdates, setDesktopQuitGuard, setInstalledUpdatePreparation, restartDesktop, stopDesktopServices, pickDesktopDirectory, desktopBootBrand, productUpdateObserver } from './product.mjs'

await configureEduworkPaths()
let mainWindow, bridge, product, entered = false, started = false, sessionEnding = false, recoveryExit = false
let startupTask, startupFailure, startupFailureShown = false, initialPresentationDone = false
let installedStartup
let hostEnvironment = process.env
const loginShellRead = new AbortController()
const locale = () => bridge?.locale() ?? resolveDesktopLocale(app.getLocale())
const sidebarBrowser = createSidebarBrowser({ getWindow: () => mainWindow })
const backend = new DesktopBackendController(onFailure => new DesktopHostProcess(product.node, product.profile, undefined,
  { bootstrap: nativeBootstrap(), onLog: desktopHostLog, onFailure, environment: hostEnvironment }), state => {
  if (state.phase === 'error' && started && !isQuitting()) reportFatal(state.failure, 'host')
})
async function closeBackend() {
  // Cancel shell preparation before the controller waits for startup to settle.
  loginShellRead.abort()
  // A drag cleanup failure must not leave the Host running during quit/restart.
  await Promise.all([bridge?.disposeFileDrags(), backend.close()])
}
trackHost({ stop: closeBackend })
const quit = new DesktopQuitConfirmation({ locale, inspect: () => backend.host?.inspectQuit(),
  show: options => dialog.showMessageBox(options), focus: () => { if (process.platform === 'darwin') app.focus({ steal: true }) } })
setDesktopQuitGuard(() => recoveryExit || sessionEnding ? Promise.resolve(true) : quit.confirm())
setInstalledUpdatePreparation(async () => {
  const host = backend.host
  if (!host) throw new Error('无法确认当前任务状态，请稍后再更新')
  const active = await host.updateTasks('inspect')
  if (!await quit.confirm()) return false
  if (backend.host !== host) throw new Error('客户端状态已变化，请重新检查更新')
  try {
    const stillActive = await host.updateTasks('lock')
    if (stillActive && !active) throw new Error('确认后有新任务开始，请重新检查并确认更新')
    await closeBackend()
    return true
  } catch (error) {
    await host.updateTasks('unlock').catch(() => {})
    throw error
  }
})
const recovery = new DesktopFatalRecovery({
  messages: () => locale().messages,
  show: options => dialog.showMessageBox(options),
  stop: async () => {
    // Preserve Host shutdown errors while the product cancels preparation and closes its resources.
    await Promise.all([stopDesktopServices(), closeBackend()])
  },
  disablePlugins: async () => { throw new Error('Required distribution plugins cannot be disabled') },
  exit: () => { recoveryExit = true; app.quit() },
  restart: () => { recoveryExit = true; restartDesktop() },
  revealReport: async path => { await access(path); shell.showItemInFolder(path) },
  writeReport: (error, source) => writeCrashReport(app.getPath('logs'), {
    source, phase: started ? 'running' : 'startup', error, rendererConsole: [], time: new Date(),
    app: { name: app.getName(), version: app.getVersion(), platform: process.platform, arch: process.arch,
      electron: process.versions.electron, node: process.versions.node, locale: locale().id },
  }),
})
function stopUnverifiedUpdate() {
  if (!installedStartup?.pending) return false
  if (!recoveryExit) { recoveryExit = true; app.quit() }
  return true
}
async function waitForUpdatedWorkbench(window) {
  // The pinned DSH renderer replaces the boot page after its workbench mounts.
  const mounted = await window.webContents.executeJavaScript(`new Promise(resolve => {
    const root = document.getElementById('root');
    if (!root) { resolve(false); return; }
    const check = () => {
      if (root.firstElementChild && !root.querySelector(':scope > [data-dsh-boot]')) {
        observer.disconnect();
        resolve(true);
      }
    };
    const observer = new MutationObserver(check);
    observer.observe(root, { childList: true });
    check();
  })`)
  if (!mounted) throw Error('新版工作台未能启动')
}
function reportFatal(error, source) {
  if (isQuitting()) return
  // Do not persist arbitrary Host error properties, renderer content or cookies.
  const safe = new Error(redactDiagnostic(error instanceof Error ? error.message : String(error)))
  desktopHostLog(`[desktop:${source}] ${safe.message}\n`)
  if (stopUnverifiedUpdate()) return
  void recovery.report(safe, source).catch(failure => {
    desktopHostLog(`[desktop:recovery] ${redactDiagnostic(failure.message)}\n`)
    recoveryExit = true; app.quit()
  })
}
function startBackend() {
  return backend.start(async () => {
    product = await prepareEduworkDesktop()
    const inherited = await readDesktopLoginShellEnvironment(process.env, resolveDesktopLoginShellConfig(process.env), { signal: loginShellRead.signal })
    const editionVariable = name => name.startsWith('EDUWORK_') || name.startsWith('CHATECNU_')
    hostEnvironment = Object.fromEntries(Object.entries(inherited.environment).filter(([name]) => !editionVariable(name)))
    // Edition bootstrap and resource paths remain owned by the launcher.
    for (const [name, value] of Object.entries(process.env)) if (editionVariable(name)) hostEnvironment[name] = value
    // Only the Host's own browser provider reads this; its children never inherit it.
    Object.assign(hostEnvironment, await sidebarBrowser.listen())
  })
}
// Early boot/locale requests must enter product recovery before the renderer reports failure.
function startOnce() {
  return startupTask ??= startBackend().catch(error => {
    void handleStartupFailure(error)
    throw error
  })
}
async function waitForHost() {
  await startOnce()
  if (isQuitting()) throw new Error('Desktop is shutting down')
  if (!backend.host) throw new Error('Desktop Host is unavailable')
}
async function handleStartupFailure(error) {
  if (startupFailureShown || isQuitting() || recovery.active) return
  startupFailure = error
  startupFailureShown = true
  desktopHostLog(`[desktop:startup] ${redactDiagnostic(error instanceof Error ? error.message : String(error))}\n`)
  if (stopUnverifiedUpdate()) return
  try { await showDesktopFailure(error) }
  catch (failure) { reportFatal(failure, 'main') }
}
async function main() {
  const probeId = process.platform === 'win32' ? installedStartupId(process.argv.slice(1)) : undefined
  if (probeId) installedStartup = connectInstalledStartup(probeId, () => stopUnverifiedUpdate())
  if (await installEduworkFromDmg() || isQuitting()) return
  if (!claimDesktopSingleInstance(app, showDesktop)) return
  void pruneCrashReports(app.getPath('logs')).catch(() => {})
  bridge = installNativeDesktopBridge({
    getHost: () => backend.host,
    waitForHost,
    getWindow: () => mainWindow,
    reportFatal,
    // The boot page reports the same startup failure after its IPC rejects;
    // the dedicated startup recovery already presents it once.
    onBootFailure: error => { if (startupFailure) { void handleStartupFailure(startupFailure); return } reportFatal(error, 'web-boot') },
    checkUpdates: checkProductUpdates,
    updates: productUpdateObserver,
    pickDirectory: pickDesktopDirectory,
    bootBrand: desktopBootBrand,
    sidebarBrowser,
  })
  const webRoot = desktopWebRoot()
  protocol.handle(SCHEME, request => {
    const staticResponse = staticDesktopResponse(request, webRoot)
    if (staticResponse) return staticResponse
    const host = backend.host
    return host ? host.fetch(request) : Promise.resolve(new Response(null, { status: 503 }))
  })
  powerMonitor.on('shutdown', () => { sessionEnding = true })

  mainWindow = createWindow(fileURLToPath(new URL('./preload-app.cjs', import.meta.url)), false, true, locale)
  const window = mainWindow
  bridge.attach(window)
  configureWindowNavigation(window)
  await attachDesktopWindow(window)
  window.on('session-end', () => { sessionEnding = true })
  // Any earlier presentation (Dock activation, tray) ends the initial show;
  // hiding it afterwards must not bring it back when startup completes.
  window.on('show', () => { initialPresentationDone = true })
  if (process.platform === 'darwin') {
    window.on('focus', () => { sessionEnding = false })
    window.on('show', () => { sessionEnding = false })
  }
  window.on('closed', () => { mainWindow = undefined })
  window.webContents.on('preload-error', (_event, _path, error) => reportFatal(error, 'renderer'))
  window.webContents.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
    if (mainFrame && code !== -3 && !window.isDestroyed()) reportFatal(new Error(`Desktop page failed (${code}: ${description})`), 'renderer')
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason !== 'clean-exit' && !window.isDestroyed()) reportFatal(new Error(`Desktop renderer exited: ${details.reason}`), 'renderer')
  })
  entered = true

  // Match upstream: load the document, start the Host, then present the window.
  const presentInitialWindow = () => {
    if (!shouldPresentMainWindow({
      presented: initialPresentationDone,
      appHidden: process.platform === 'darwin' && app.isHidden(),
      startupFailure: Boolean(startupFailure),
      quitting: isQuitting(),
      recoveryActive: recovery.active,
      destroyed: window.isDestroyed(),
      startupWindowPresent: desktopStartupWindowPresent(),
    })) return
    initialPresentationDone = true
    window.show()
  }
  const pageLoaded = window.loadURL(`${SCHEME}://app/index.html`)
  try { await pageLoaded } catch (error) {
    // A startup failure closes this window and aborts its navigation.
    if (startupFailure || isQuitting()) return
    throw error
  }
  const ready = await startOnce().then(() => true, () => false)
  if (!ready || isQuitting() || recovery.active || window.isDestroyed()) return
  // A Host can fail between reporting ready and the success receipt.
  if (!backend.host || backend.state.phase !== 'ready') {
    const failure = backend.state.phase === 'error' ? backend.state.failure : new Error('Desktop Host did not stay ready')
    await handleStartupFailure(failure)
    return
  }
  started = true
  const startupHealthy = () => !isQuitting() && !startupFailure && !recovery.active
    && !window.isDestroyed() && Boolean(backend.host) && backend.state.phase === 'ready'
  if (installedStartup && startupHealthy()) await waitForUpdatedWorkbench(window)
  await desktopReady(startupHealthy)
  if (backend.host && backend.state.phase === 'ready') {
    if (installedStartup && !startupHealthy()) return
    presentInitialWindow()
    if (installedStartup) {
      if (!window.isVisible()) throw Error('新版工作台未能显示')
      if (!await installedStartup.ready() || !startupHealthy()) return
    }
    // waitForHost() can start the backend. Optional menu discovery must only
    // join the completed startup, never initiate it or delay window display.
    void bridge.probeUserGuide().catch(() => {})
  }
  if (process.env.DSH_DESKTOP_OPEN_DEVTOOLS === '1' && !window.isDestroyed()) window.webContents.openDevTools({ mode: 'detach' })
}
app.on('will-quit', () => { quit.dispose(); bridge?.dispose(); sidebarBrowser.close() })
void app.whenReady().then(main).catch(async error => {
  if (isQuitting() || recovery.active || stopUnverifiedUpdate()) return
  if (entered) { reportFatal(error, 'main'); return }
  await showDesktopFailure(error)
}).catch(error => reportFatal(error, 'main'))
