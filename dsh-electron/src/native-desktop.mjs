// The rc.2 desktop primitives own native behavior. Product hooks retain edition
// configuration, portable directories, secure credentials, updates and attention.
import { app, dialog, protocol, powerMonitor } from 'electron'
import { fileURLToPath } from 'node:url'
import { DesktopBackendController } from './backend-controller.ts'
import { DesktopFatalRecovery } from './fatal-recovery.ts'
import { DesktopQuitConfirmation } from './quit-confirmation.ts'
import { claimDesktopSingleInstance } from './single-instance.ts'
import { writeCrashReport, pruneCrashReports } from './crash-report.ts'
import { createWindow } from './main.ts'
import { SCHEME } from './ipc.ts'
import { resolveDesktopLocale } from './locale.ts'
import { DesktopHostProcess } from './eduwork-host-process.mjs'
import { installNativeDesktopBridge } from './native-desktop-bridge.mjs'
import { redactDiagnostic } from './diagnostics.mjs'
import { showDesktopWindow } from './window-visibility.mjs'
import { configureEduworkPaths, prepareEduworkDesktop, nativeBootstrap, desktopReady,
  trackHost, desktopHostLog, isQuitting, attachDesktopWindow, configureWindowNavigation,
  showDesktopFailure, checkProductUpdates, setDesktopQuitGuard, restartDesktop } from './product.mjs'

configureEduworkPaths()
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true,
} }])
let mainWindow, bridge, product, entered = false, sessionEnding = false, recoveryExit = false
const locale = () => bridge?.locale() ?? resolveDesktopLocale(app.getLocale())
const backend = new DesktopBackendController(onFailure => new DesktopHostProcess(product.node, product.profile, undefined,
  { bootstrap: nativeBootstrap(), onLog: desktopHostLog, onFailure }), state => {
  if (state.phase === 'error' && entered && !isQuitting()) reportFatal(state.failure, 'host')
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
    source, phase: entered ? 'running' : 'startup', error, rendererConsole: [], time: new Date(),
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
async function main() {
  void pruneCrashReports(app.getPath('logs')).catch(() => {})
  bridge = installNativeDesktopBridge({ getHost: () => backend.host, getWindow: () => mainWindow, reportFatal, checkUpdates: checkProductUpdates })
  protocol.handle(SCHEME, request => backend.host?.fetch(request) ?? new Response(null, { status: 503 }))
  powerMonitor.on('shutdown', () => { sessionEnding = true })
  await backend.start(async () => { product = await prepareEduworkDesktop() })
  if (isQuitting()) return
  mainWindow = createWindow(fileURLToPath(new URL('./preload-app.cjs', import.meta.url)), false, true)
  const window = mainWindow
  bridge.attach(window)
  configureWindowNavigation(window)
  await attachDesktopWindow(window)
  window.on('session-end', () => { sessionEnding = true })
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
  await window.loadURL(`${SCHEME}://app/index.html`)
  if (isQuitting() || recovery.active || window.isDestroyed()) return
  await desktopReady()
  window.show()
  if (process.env.DSH_DESKTOP_OPEN_DEVTOOLS === '1') window.webContents.openDevTools({ mode: 'detach' })
}
app.on('will-quit', () => { quit.dispose(); bridge?.dispose() })
if (claimDesktopSingleInstance(app, () => showDesktopWindow(mainWindow))) {
  void app.whenReady().then(main).catch(async error => {
    if (isQuitting() || recovery.active) return
    if (entered) { reportFatal(error, 'main'); return }
    await showDesktopFailure(error)
  }).catch(error => reportFatal(error, 'main'))
}
