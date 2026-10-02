import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { registerHooks } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Run the adapted legacy entry and its real single-instance controller up to
// product preparation. Electron and services beyond that boundary are mocked.
const source = process.env.EDUWORK_TEST_LEGACY_SHELL && pathToFileURL(resolve(process.env.EDUWORK_TEST_LEGACY_SHELL, 'src') + '/')
const electron = 'data:text/javascript,export {}'
registerHooks({ resolve(specifier, context, next) {
  return specifier === 'electron' ? { url: electron, shortCircuit: true } : next(specifier, context)
} })
for (const scenario of ['installed', 'moved', 'second-instance']) {
  test(`legacy installer startup: ${scenario}`, { skip: !source }, async t => {
    const calls = [], app = new EventEmitter(), stopped = new Error('Stop at product preparation')
    let completed
    const done = new Promise(resolve => { completed = resolve })
    const diagnostic = process.env.DSH_DESKTOP_DIAGNOSTIC_FILE
    delete process.env.DSH_DESKTOP_DIAGNOSTIC_FILE
    t.after(() => { if (diagnostic !== undefined) process.env.DSH_DESKTOP_DIAGNOSTIC_FILE = diagnostic })
    app.requestSingleInstanceLock = () => { calls.push('lock'); return scenario !== 'second-instance' }
    app.whenReady = async () => { calls.push('ready') }
    app.quit = () => { calls.push('quit'); completed() }
    t.mock.method(console, 'error', error => assert.equal(error, stopped))
    t.mock.module(electron, { exports: { app, BrowserWindow: class {}, dialog: {}, ipcMain: {}, Menu: {},
      protocol: { registerSchemesAsPrivileged() {} } } })
    const mock = (file, exports) => t.mock.module(new URL(file, source).href, { exports })
    mock('product.mjs', {
      configureEduworkPaths() {}, installEduworkFromDmg: async () => {
        calls.push('installer')
        if (scenario === 'moved') { app.quit(); return true }
        return false
      }, prepareEduworkDesktop: async () => { calls.push('prepare'); throw stopped },
      nativeBootstrap() {}, desktopReady() {}, trackHost() {}, desktopHostLog() {}, isQuitting: () => false,
      attachDesktopWindow() {}, configureWindowNavigation() {}, checkProductUpdates() {},
      showDesktopFailure: async error => { assert.equal(error, stopped); completed() },
    })
    mock('paths.ts', { resolveDesktopPaths: assert.fail })
    mock('project-manager.ts', { DesktopProjectManager: class {} })
    mock('eduwork-host-process.mjs', { DesktopHostProcess: class {} })
    mock('ipc.ts', { DESKTOP_IPC: {} })
    mock('locale.ts', { formatDesktopMessage: assert.fail, resolveDesktopLocale: assert.fail })
    mock('update-coordinator.ts', { DesktopUpdateCoordinator: class {} })
    mock('media-transport.mjs', { fetchDesktopProtocolResponse: assert.fail })
    await import(new URL(`main.ts?scenario=${scenario}`, source))
    await Promise.race([done, new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Startup did not settle')), 3000)
      t.after(() => clearTimeout(timer))
    })])
    assert.deepEqual(calls, scenario === 'installed' ? ['ready', 'installer', 'lock', 'prepare']
      : scenario === 'second-instance' ? ['ready', 'installer', 'lock', 'quit'] : ['ready', 'installer', 'quit'])
  })
}
