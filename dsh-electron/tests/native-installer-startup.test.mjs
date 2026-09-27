import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { registerHooks } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DesktopExit } from '../src/desktop-exit.mjs'
import { DesktopLifecycle } from '../src/lifecycle.mjs'

// Exercise the built rc.2 entry and its actual single-instance, quit and backend
// controllers. Only Electron, product preparation and the Host are substituted.
const source = process.env.EDUWORK_TEST_NATIVE_SHELL && pathToFileURL(resolve(process.env.EDUWORK_TEST_NATIVE_SHELL, 'src') + '/')
const electron = 'data:text/javascript,export {}'
registerHooks({ resolve(specifier, context, next) {
  return specifier === 'electron' ? { url: electron, shortCircuit: true } : next(specifier, context)
} })
for (const scenario of ['installed', 'moved', 'cancelled', 'second-instance', 'quit-during-cleanup']) {
  test(`native installer startup: ${scenario}`, { skip: !source }, async t => {
    const calls = [], app = new EventEmitter(), lifecycle = new DesktopLifecycle()
    let guard = async () => true, completed
    const done = new Promise(resolve => { completed = resolve })
    const exit = new DesktopExit({ confirm: () => guard(), close: () => lifecycle.close(),
      relaunch: () => assert.fail('Installer restart belongs to Electron'), quit: () => app.quit(), failed: assert.fail })
    app.getPath = () => '/unused'
    app.getLocale = () => 'en'
    app.requestSingleInstanceLock = () => { calls.push('lock'); return scenario !== 'second-instance' }
    app.whenReady = async () => { calls.push('ready') }
    app.quit = () => {
      if (!exit.complete) { void exit.request(); return }
      calls.push('quit'); app.emit('will-quit'); completed()
    }
    t.mock.module(electron, { exports: { app, dialog: { showMessageBox: () => assert.fail('No tasks exist during installation') },
      protocol: { registerSchemesAsPrivileged() {}, handle() {} }, powerMonitor: new EventEmitter() } })
    const mock = (file, exports) => t.mock.module(new URL(file, source).href, { exports })
    mock('product.mjs', {
      configureEduworkPaths() {}, installEduworkFromDmg: async () => {
        calls.push('installer')
        if (scenario === 'quit-during-cleanup') { app.quit(); await exit.pending }
        if (scenario === 'cancelled' || scenario === 'moved') { app.quit(); return true }
        return false
      }, prepareEduworkDesktop: async () => { calls.push('prepare'); return {} },
      nativeBootstrap() {}, desktopReady: async () => { calls.push('desktop-ready'); completed() },
      trackHost: host => lifecycle.trackHost(host), desktopHostLog() {}, isQuitting: () => lifecycle.closing,
      attachDesktopWindow() {}, configureWindowNavigation() {}, showDesktopFailure: assert.fail,
      checkProductUpdates() {}, setDesktopQuitGuard: value => { guard = value }, restartDesktop: () => exit.restart(),
    })
    mock('eduwork-host-process.mjs', { DesktopHostProcess: class {
      async start() { calls.push('host') }
      async stop() { calls.push('stop') }
    } })
    mock('native-desktop-bridge.mjs', { installNativeDesktopBridge: () => ({ attach() {}, dispose() {} }) })
    mock('crash-report.ts', { pruneCrashReports: async () => {}, writeCrashReport: assert.fail })
    mock('main.ts', { createWindow: () => {
      calls.push('window')
      return Object.assign(new EventEmitter(), { webContents: new EventEmitter(), loadURL: async () => {}, isDestroyed: () => false, show() {} })
    } })
    await import(new URL(`native-desktop.mjs?scenario=${scenario}`, source))
    await Promise.race([done, new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Startup did not settle')), 3000)
      t.after(() => clearTimeout(timer))
    })])
    if (scenario === 'installed') {
      assert.deepEqual(calls, ['lock', 'ready', 'installer', 'prepare', 'host', 'window', 'desktop-ready'])
    } else if (scenario === 'second-instance') {
      assert.deepEqual(calls, ['lock', 'quit'])
    } else {
      assert.deepEqual(calls, ['lock', 'ready', 'installer', 'quit'])
      assert.equal(exit.complete, true)
    }
  })
}
