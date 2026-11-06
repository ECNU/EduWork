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
import { startupDiagnostic } from './startup-failure.mjs'
import { PET_SCHEME } from './desktop-pet-core.mjs'
import { shouldPresentMainWindow } from './startup-presentation.mjs'
import { configureEduworkPaths, installEduworkFromDmg, prepareEduworkDesktop, nativeBootstrap, desktopReady, desktopWebRoot,
  desktopStartupWindowPresent, trackHost, desktopHostLog, isQuitting, attachDesktopWindow, configureWindowNavigation,
  showDesktopFailure, cancelDesktopStartup, isShutdownFailed, recordStartupStopFailureHealth, showDesktop, checkProductUpdates, setDesktopQuitGuard, restartDesktop, stopDesktopServices, pickDesktopDirectory, desktopBootBrand, productUpdateObserver } from './product.mjs'

configureEduworkPaths()
// Electron accepts one privileged-scheme registration; the pet page scheme is
// served only in the desktop pet's own session.
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true,
} }, { scheme: PET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }])
let mainWindow, bridge, product, entered = false, started = false, sessionEnding = false, recoveryExit = false
let startupTask, startupFailure, startupFailureShown = false, initialPresentationDone = false
let hostStarting = false
let hostEnvironment = process.env
const loginShellRead = new AbortController()
const locale = () => bridge?.locale() ?? resolveDesktopLocale(app.getLocale())
const sidebarBrowser = createSidebarBrowser({ getWindow: () => mainWindow })
const backend = new DesktopBackendController(onFailure => new DesktopHostProcess(product.node, product.profile, undefined,
  { bootstrap: nativeBootstrap(), onLog: desktopHostLog, onFailure, environment: hostEnvironment }), state => {
  if (state.phase === 'error' && !isQuitting()) reportWindowFailure(state.failure, hostStarting ? 'host' : 'main')
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
const recovery = new DesktopFatalRecovery({
  messages: () => locale().messages,
  show: options => dialog.showMessageBox(options),
  stop: async () => {
    // Keep Host failures critical. Resource-only failures are logged because the
    // Host/bridge state is known; they must not trap recovery exit or restart.
    const [backend, services] = await Promise.allSettled([closeBackend(), stopDesktopServices()])
    const backendError = backend.status === 'rejected' ? backend.reason : undefined
    const serviceError = services.status === 'rejected' ? services.reason : undefined
    if (backendError) {
      const errors = [backendError, serviceError].filter(Boolean)
      throw startupDiagnostic(errors.length > 1
        ? new AggregateError(errors, 'Desktop recovery could not stop the Host')
        : errors[0], redactDiagnostic)
    }
    if (serviceError) {
      if (serviceError?.resourceOnly === true && serviceError?.critical !== true) {
        desktopHostLog(`[desktop:cleanup] ${startupDiagnostic(serviceError, redactDiagnostic).message}\n`)
        return
      }
      throw startupDiagnostic(serviceError, redactDiagnostic)
    }
  },
  disablePlugins: async () => { throw new Error('Required distribution plugins cannot be disabled') },
  // Exit is an explicit user decision. The Host/bridge stop failure is logged by
  // stop(); DesktopExit completes the approved quit with baseline semantics.
  exit: () => { recoveryExit = true; app.quit() },
  restart: () => { recoveryExit = true; restartDesktop() },
  revealReport: async path => { await access(path); shell.showItemInFolder(path) },
  writeReport: (error, source) => writeCrashReport(app.getPath('logs'), {
    source, phase: started ? 'running' : 'startup', error, rendererConsole: [], time: new Date(),
    app: { name: app.getName(), version: app.getVersion(), platform: process.platform, arch: process.arch,
      electron: process.versions.electron, node: process.versions.node, locale: locale().id },
  }),
})
function reportFatal(error, source) {
  if (isQuitting() && !isShutdownFailed()) return
  // Do not persist arbitrary Host error properties, renderer content or cookies.
  const safe = startupDiagnostic(error, redactDiagnostic)
  desktopHostLog(`[desktop:${source}] ${safe.message}\n`)
  void recovery.report(safe, source).catch(failure => {
    desktopHostLog(`[desktop:recovery] ${startupDiagnostic(failure, redactDiagnostic).message}\n`)
    recoveryExit = true; app.quit()
  })
}
function reportWindowFailure(error, source) {
  if (started) reportFatal(error, source)
  else void handleStartupFailure(error, source)
}
function startupBarrier() {
  if (startupFailure) throw startupFailure
  if (recovery.active) throw new Error('Desktop recovery is active')
}
function containsFailure(error, target, depth = 0, seen = new Set()) {
  if (error === target) return true
  if (depth > 6 || seen.has(error)) return false
  seen.add(error)
  if (error instanceof AggregateError && error.errors.some(item => containsFailure(item, target, depth + 1, seen))) return true
  return error instanceof Error && error.cause !== undefined && containsFailure(error.cause, target, depth + 1, seen)
}
function startBackend() {
  return backend.start(async () => {
    product = await prepareEduworkDesktop()
    startupBarrier()
    const inherited = await readDesktopLoginShellEnvironment(process.env, resolveDesktopLoginShellConfig(process.env), { signal: loginShellRead.signal })
    startupBarrier()
    const editionVariable = name => name.startsWith('EDUWORK_') || name.startsWith('CHATECNU_')
    hostEnvironment = Object.fromEntries(Object.entries(inherited.environment).filter(([name]) => !editionVariable(name)))
    // Edition bootstrap and resource paths remain owned by the launcher.
    for (const [name, value] of Object.entries(process.env)) if (editionVariable(name)) hostEnvironment[name] = value
    // Only the Host's own browser provider reads this; its children never inherit it.
    Object.assign(hostEnvironment, await sidebarBrowser.listen())
    startupBarrier()
    hostStarting = true
  })
}
// Early boot/locale requests must enter product recovery before the renderer reports failure.
function startOnce() {
  if (startupFailure) return Promise.reject(startupFailure)
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
async function cancelStartup() {
  // Abort downloads and the login-shell probe, cancel the backend attempt, and
  // wait for preparation/Host teardown before product rollback touches the same
  // state. The cancelled attempt cannot create a Host after the failure.
  loginShellRead.abort()
  cancelDesktopStartup()
  try { await backend.stop() }
  catch (error) {
    desktopHostLog(`[desktop:startup] cleanup failed: ${startupDiagnostic(error, redactDiagnostic).message}\n`)
    return error
  }
}
async function handleStartupFailure(error, source = 'main') {
  if (startupFailureShown || isQuitting() || recovery.active) return
  startupFailure = error
  startupFailureShown = true
  desktopHostLog(`[desktop:startup] ${startupDiagnostic(error, redactDiagnostic).message}\n`)
  // The first failure owns recovery. Cancelling preparation prevents a later
  // configuration/updater error from stacking a second dialog; a restart reruns
  // preparation, where that specialized page remains available.
  const stopFailure = await cancelStartup()
  if (isQuitting() || recovery.active) return
  if (stopFailure) {
    // The locked Host may still be running: neither content rollback nor an
    // automatic restart is safe until the Host state is known. Keep both reasons
    // once; a startup+cleanup AggregateError already carries its stop failure.
    desktopHostLog('[desktop:startup] Host stop failed; content rollback and automatic restart are skipped\n')
    let healthFailure
    try { await recordStartupStopFailureHealth() } catch (healthError) { healthFailure = healthError }
    const reported = containsFailure(error, stopFailure) ? error
      : new AggregateError([error, stopFailure], 'Desktop startup failed and the background Host could not be stopped')
    reportFatal(healthFailure
      ? new AggregateError([reported, healthFailure], 'Desktop startup failed and the update health marker could not be written')
      : reported, source)
    return
  }
  try {
    await showDesktopFailure(error, failure => reportFatal(failure, source))
  }
  catch (failure) { reportFatal(failure, 'main') }
}
async function main() {
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
    onBootFailure: error => reportWindowFailure(error, 'web-boot'),
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
  window.webContents.on('preload-error', (_event, _path, error) => reportWindowFailure(error, 'renderer'))
  window.webContents.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
    if (mainFrame && code !== -3 && !window.isDestroyed()) reportWindowFailure(new Error(`Desktop page failed (${code}: ${description})`), 'renderer')
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason !== 'clean-exit' && !window.isDestroyed()) reportWindowFailure(new Error(`Desktop renderer exited: ${details.reason}`), 'renderer')
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
  if (startupFailure || isQuitting() || recovery.active || window.isDestroyed()) return
  const ready = await startOnce().then(() => true, () => false)
  if (!ready || startupFailure || isQuitting() || recovery.active || window.isDestroyed()) return
  // A Host can fail between reporting ready and the success receipt.
  if (!backend.host || backend.state.phase !== 'ready') {
    const failure = backend.state.phase === 'error' ? backend.state.failure : new Error('Desktop Host did not stay ready')
    await handleStartupFailure(failure)
    return
  }
  started = true
  await desktopReady(() => !startupFailure && !isQuitting() && !recovery.active
    && Boolean(backend.host) && backend.state.phase === 'ready')
  if (!startupFailure && !recovery.active && backend.host && backend.state.phase === 'ready') {
    presentInitialWindow()
    // waitForHost() can start the backend. Optional menu discovery must only
    // join the completed startup, never initiate it or delay window display.
    void bridge.probeUserGuide().catch(() => {})
  }
  if (process.env.DSH_DESKTOP_OPEN_DEVTOOLS === '1' && !window.isDestroyed()) window.webContents.openDevTools({ mode: 'detach' })
}
app.on('will-quit', () => { quit.dispose(); bridge?.dispose(); sidebarBrowser.close() })
void app.whenReady().then(main).catch(async error => {
  if (isQuitting() || recovery.active) return
  if (started) { reportFatal(error, 'main'); return }
  if (entered) { await handleStartupFailure(error); return }
  await showDesktopFailure(error, failure => reportFatal(failure, 'main'))
}).catch(error => reportFatal(error, 'main'))
