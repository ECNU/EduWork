// The rc.2 desktop primitives own native behavior. Product hooks retain edition
// configuration, portable directories, secure credentials, updates and attention.
import { app, dialog, protocol, powerMonitor } from 'electron'
import { fileURLToPath } from 'node:url'
import { DesktopBackendController } from './backend-controller.ts'
import { DesktopFatalRecovery } from './fatal-recovery.ts'
import { DesktopQuitConfirmation } from './quit-confirmation.mjs'
import { claimDesktopSingleInstance } from './single-instance.ts'
import { writeCrashReport, pruneCrashReports } from './crash-report.ts'
import { createWindow } from './main.ts'
import { SCHEME } from './ipc.ts'
import { resolveDesktopLocale } from './locale.ts'
import { readDesktopLoginShellEnvironment, resolveDesktopLoginShellConfig } from './login-shell-environment.ts'
import { DesktopHostProcess, staticDesktopResponse } from './eduwork-host-process.mjs'
import { installNativeDesktopBridge } from './native-desktop-bridge.mjs'
import { redactDiagnostic } from './diagnostics.mjs'
import { showDesktopWindow } from './window-visibility.mjs'
import { PET_SCHEME } from './desktop-pet-core.mjs'
import { shouldPresentMainWindow } from './startup-presentation.mjs'
import { configureEduworkPaths, installEduworkFromDmg, prepareEduworkDesktop, nativeBootstrap, desktopReady, desktopWebRoot,
  desktopStartupWindowPresent, trackHost, desktopHostLog, isQuitting, attachDesktopWindow, configureWindowNavigation,
  showDesktopFailure, checkProductUpdates, setDesktopQuitGuard, restartDesktop, pickDesktopDirectory } from './product.mjs'

configureEduworkPaths()
// Electron accepts one privileged-scheme registration; the pet page scheme is
// served only in the desktop pet's own session.
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true,
} }, { scheme: PET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }])
let mainWindow, bridge, product, entered = false, started = false, sessionEnding = false, recoveryExit = false
let startupTask, startupFailure, startupFailureShown = false, initialPresentationDone = false
let hostEnvironment = process.env
const loginShellRead = new AbortController()
app.on('will-quit', () => loginShellRead.abort())
const locale = () => bridge?.locale() ?? resolveDesktopLocale(app.getLocale())
const backend = new DesktopBackendController(onFailure => new DesktopHostProcess(product.node, product.profile, undefined,
  { bootstrap: nativeBootstrap(), onLog: desktopHostLog, onFailure, environment: hostEnvironment }), state => {
  if (state.phase === 'error' && started && !isQuitting()) reportFatal(state.failure, 'host')
})
// Keep the product's resource teardown, with the official controller as its one
// Host owner (including a failed or still-starting child).
trackHost({ stop: () => backend.close() })
const quit = new DesktopQuitConfirmation({ locale, inspect: () => backend.host?.inspectQuit(),
  show: options => dialog.showMessageBox(options), focus: () => { if (process.platform === 'darwin') app.focus({ steal: true }) } })
setDesktopQuitGuard(() => recoveryExit || sessionEnding ? Promise.resolve(true) : quit.confirm())
const recovery = new DesktopFatalRecovery({
  messages: () => locale().messages,
  show: options => dialog.showMessageBox(options),
  stop: () => backend.close(),
  disablePlugins: async () => { throw new Error('Required distribution plugins cannot be disabled') },
  exit: () => { recoveryExit = true; app.quit() },
  restart: () => { recoveryExit = true; restartDesktop() },
  writeReport: (error, source) => writeCrashReport(app.getPath('logs'), {
    source, phase: started ? 'running' : 'startup', error, rendererConsole: [], time: new Date(),
    app: { name: app.getName(), version: app.getVersion(), platform: process.platform, arch: process.arch,
      electron: process.versions.electron, node: process.versions.node, locale: locale().id },
  }),
})
function reportFatal(error, source) {
  if (isQuitting()) return
  // Do not persist arbitrary Host error properties, renderer content or cookies.
  const safe = new Error(redactDiagnostic(error instanceof Error ? error.message : String(error)))
  desktopHostLog(`[desktop:${source}] ${safe.message}\n`)
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
  })
}
// One startup attempt serves the main launch and every early boot/locale request.
function startOnce() { return startupTask ??= startBackend() }
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
  try { await showDesktopFailure(error) }
  catch (failure) { reportFatal(failure, 'main') }
}
async function main() {
  if (await installEduworkFromDmg() || isQuitting()) return
  if (!claimDesktopSingleInstance(app, () => showDesktopWindow(mainWindow))) return
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
    pickDirectory: pickDesktopDirectory,
    bootBrand: () => app.getName(),
  })
  const webRoot = desktopWebRoot()
  protocol.handle(SCHEME, request => {
    const staticResponse = staticDesktopResponse(request, webRoot)
    if (staticResponse) return staticResponse
    const host = backend.host
    return host ? host.fetch(request) : Promise.resolve(new Response(null, { status: 503 }))
  })
  powerMonitor.on('shutdown', () => { sessionEnding = true })

  mainWindow = createWindow(fileURLToPath(new URL('./preload-app.cjs', import.meta.url)), false, true)
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

  // The static page paints the upstream BootPage without the Host, so show
  // the real window while configuration and the Host start in parallel. A
  // first-run download or migration window remains the visible startup surface.
  const presentInitialWindow = (startupWindowHidden = false) => {
    if (!shouldPresentMainWindow({
      presented: initialPresentationDone,
      startupFailure: Boolean(startupFailure),
      quitting: isQuitting(),
      recoveryActive: recovery.active,
      destroyed: window.isDestroyed(),
      startupWindowPresent: desktopStartupWindowPresent(),
      startupWindowHidden,
    })) return
    initialPresentationDone = true
    window.show()
  }
  const pageLoaded = window.loadURL(`${SCHEME}://app/index.html`)
  void pageLoaded.then(() => presentInitialWindow()).catch(() => {})
  const ready = await startOnce().then(() => true, error => { void handleStartupFailure(error); return false })
  try { await pageLoaded } catch (error) {
    // A startup failure closes this window and aborts its navigation.
    if (startupFailure || isQuitting()) return
    throw error
  }
  if (!ready || isQuitting() || recovery.active || window.isDestroyed()) return
  // A Host can fail between reporting ready and the success receipt.
  if (!backend.host || backend.state.phase !== 'ready') {
    const failure = backend.state.phase === 'error' ? backend.state.failure : new Error('Desktop Host did not stay ready')
    await handleStartupFailure(failure)
    return
  }
  started = true
  const completion = await desktopReady(() => !isQuitting() && !recovery.active && Boolean(backend.host) && backend.state.phase === 'ready')
  // A deferred show waits until the first-run download or migration window is
  // gone, and inherits a hidden dedicated window instead of overriding it. If
  // the main window was already visible before the handoff, return to it.
  if (backend.host && backend.state.phase === 'ready') {
    if (completion?.restoreMainWindow && !isQuitting() && !recovery.active && !window.isDestroyed()) {
      initialPresentationDone = true
      window.show()
    } else presentInitialWindow(completion?.startupWindowHidden === true)
  }
  if (process.env.DSH_DESKTOP_OPEN_DEVTOOLS === '1' && !window.isDestroyed()) window.webContents.openDevTools({ mode: 'detach' })
}
app.on('will-quit', () => { quit.dispose(); bridge?.dispose() })
void app.whenReady().then(main).catch(async error => {
  if (isQuitting() || recovery.active) return
  if (entered) { reportFatal(error, 'main'); return }
  await showDesktopFailure(error)
}).catch(error => reportFatal(error, 'main'))
