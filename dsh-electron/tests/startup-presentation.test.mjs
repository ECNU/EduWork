import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { shouldPresentMainWindow } from '../src/startup-presentation.mjs'
import { attachAppActivation, showDesktopWindows } from '../src/window-visibility.mjs'

const allowed = { presented: false, startupFailure: false, quitting: false, recoveryActive: false, destroyed: false, startupWindowPresent: false }

test('initial presentation respects prior presentation, recovery and shutdown', () => {
  assert.equal(shouldPresentMainWindow(allowed), true)
  for (const key of Object.keys(allowed)) assert.equal(shouldPresentMainWindow({ ...allowed, [key]: true }), false, key)
})

function startupHarness() {
  const source = readFileSync(new URL('../src/product.mjs', import.meta.url), 'utf8')
  const progressStart = source.indexOf('function showStartupProgress(')
  const messageStart = source.indexOf('function showDesktopMessageBox(')
  const readyStart = source.indexOf('export async function desktopReady(')
  const readyEnd = source.indexOf('\n}\n', readyStart)
  const activationStart = source.indexOf('const activationWindows =')
  const activationEnd = source.indexOf('export function configureEduworkPaths()', activationStart)
  assert.ok(progressStart >= 0 && messageStart > progressStart && readyEnd > readyStart)
  class FakeWindow extends EventEmitter {
    static windows = []
    static getAllWindows() { return this.windows.filter(window => !window.destroyed) }
    constructor({ pet = false } = {}) {
      super()
      this.pet = pet; this.visible = false; this.destroyed = false; this.showCalls = 0; this.minimized = false; this.focused = false
      this.loading = false; this.messages = []
      this.webContents = Object.assign(new EventEmitter(), {
        isLoadingMainFrame: () => this.loading,
        send: (...args) => this.messages.push(args),
      })
      FakeWindow.windows.push(this)
    }
    show() { this.visible = true; this.showCalls++; this.emit('show') }
    hide() { this.visible = false }
    isVisible() { return this.visible }
    isDestroyed() { return this.destroyed }
    destroy() { this.destroyed = true; this.visible = false }
    isMinimized() { return this.minimized }
    restore() { this.minimized = false }
    focus() { this.focused = true }
  }
  const app = new EventEmitter()
  const build = new Function('BrowserWindow', 'app', 'contentUpdates', 'writeMigrationHealth', 'desktopPet', 'portableUpdates', 'showDesktopWindows',
    `let progressWindow, mainWindow, mainWindowPresented = false, startupMessage = '', migrationLaunch = null, updateCompleted = false
    let quitting = false, desktopFailureShown = false
    const isQuitting = () => quitting
    const desktopBootBrand = () => ({ name: 'Fixture', message: startupMessage })
    ${source.slice(activationStart, activationEnd).replace('export ', '')}
    ${source.slice(progressStart, messageStart)}
    ${source.slice(readyStart, readyEnd + 2).replace('export ', '')}
    return {
      setMain(window) { mainWindow = window; window.on('show', () => { mainWindowPresented = true }) },
      setRecovery(window) { progressWindow = window; desktopFailureShown = true },
      quit() { quitting = true },
      showStartupProgress, desktopReady, showDesktop, activationWindows,
    }`)
  const harness = build(FakeWindow, app, { ready: async () => {} }, async () => {},
    { start() {}, owns: window => window.pet }, { action: () => Promise.resolve() }, showDesktopWindows)
  const main = new FakeWindow()
  harness.setMain(main)
  attachAppActivation({ app, windows: harness.activationWindows, platform: 'darwin' })
  return { harness, main, FakeWindow, activate: () => app.emit('activate') }
}

test('preparation uses the main BootPage and clears its status without presenting it again', async () => {
  const { harness, main, FakeWindow } = startupHarness()
  harness.showStartupProgress('download')
  assert.equal(main.visible, true)
  assert.equal(main.messages.at(-1)[1].message, 'download')
  harness.showStartupProgress('migration')
  assert.equal(main.messages.at(-1)[1].message, 'migration')
  assert.equal(main.showCalls, 1)
  assert.equal(FakeWindow.windows.length, 1)
  main.hide()
  await harness.desktopReady()
  assert.equal(main.messages.at(-1)[1].message, '')
  assert.equal(main.visible, false)
  assert.equal(main.showCalls, 1)
})

test('a late preparation message preserves a main window the user already hid', () => {
  const { harness, main } = startupHarness()
  main.show(); main.hide()
  harness.showStartupProgress('download')
  assert.equal(main.visible, false)
  assert.equal(main.showCalls, 1)
})

for (const stop of ['none', 'quit', 'recovery', 'destroy']) {
  test(`preparation waits for document load and respects ${stop}`, () => {
    const { harness, main, FakeWindow } = startupHarness()
    main.loading = true
    harness.showStartupProgress('download')
    assert.equal(main.visible, false)
    if (stop === 'quit') harness.quit()
    if (stop === 'recovery') harness.setRecovery(new FakeWindow())
    if (stop === 'destroy') main.destroy()
    main.webContents.emit('did-finish-load')
    assert.equal(main.showCalls, stop === 'none' ? 1 : 0)
  })
}

for (const entry of ['Dock', 'relaunch']) {
  test(`${entry} restores preparation in the same main window and excludes the pet`, async () => {
    const { harness, main, FakeWindow, activate } = startupHarness()
    const pet = new FakeWindow({ pet: true })
    const restore = entry === 'Dock' ? activate : harness.showDesktop
    restore()
    assert.equal(main.visible, false)
    harness.showStartupProgress('download')
    main.hide(); main.minimized = true
    restore()
    assert.equal(main.visible, true)
    assert.equal(main.minimized, false)
    assert.equal(main.focused, true)
    await harness.desktopReady()
    assert.equal(main.showCalls, 2)
    assert.equal(pet.visible, false)
  })
}

test('recovery activation takes precedence over the incomplete main window', () => {
  const { harness, main, FakeWindow } = startupHarness()
  harness.showStartupProgress('download'); main.hide()
  const recovery = new FakeWindow()
  harness.setRecovery(recovery)
  recovery.minimized = true
  assert.equal(harness.showDesktop(), true)
  assert.equal(recovery.visible, true)
  assert.equal(recovery.minimized, false)
  assert.equal(main.visible, false)
})

test('startup recovery drops the tray before the stale BootPage window', () => {
  const source = readFileSync(new URL('../src/product.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('export async function showDesktopFailure')
  const end = source.indexOf('\n}\n', start)
  assert.ok(start >= 0 && end > start)
  const failure = source.slice(start, end)
  assert.match(failure, /tray\.destroy\(\)/)
  assert.ok(failure.indexOf('tray.destroy()') < failure.indexOf('mainWindow.destroy()'))
})
