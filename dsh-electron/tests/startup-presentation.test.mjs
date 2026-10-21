import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { shouldPresentMainWindow, startupWindowCompletion, startupWindowPresentation } from '../src/startup-presentation.mjs'

const allowed = { presented: false, startupFailure: false, quitting: false, recoveryActive: false, destroyed: false, startupWindowPresent: false, startupWindowHidden: false }

test('the main BootPage is shown only when no other startup surface or stop condition applies', () => {
  assert.equal(shouldPresentMainWindow(allowed), true)
  for (const key of Object.keys(allowed)) {
    assert.equal(shouldPresentMainWindow({ ...allowed, [key]: true }), false, key)
  }
})

test('startup window handoff covers download-first, main-first and hidden intent', () => {
  assert.deepEqual(startupWindowPresentation({ mainPresented: false, mainVisible: false }), { hideMain: false, showStartupWindow: true })
  assert.deepEqual(startupWindowPresentation({ mainPresented: true, mainVisible: true }), { hideMain: true, showStartupWindow: true })
  assert.deepEqual(startupWindowPresentation({ mainPresented: true, mainVisible: false }), { hideMain: false, showStartupWindow: false })
  const completion = overrides => startupWindowCompletion({ hadStartupWindow: true, mainHiddenForStartup: false,
    startupWindowHidden: false, mainPresented: false, mainVisible: false, ...overrides })
  assert.deepEqual(completion({ hadStartupWindow: false }), { startupWindowHidden: false, restoreMainWindow: false })
  assert.deepEqual(completion({}), { startupWindowHidden: false, restoreMainWindow: false })
  assert.deepEqual(completion({ mainPresented: true }), { startupWindowHidden: false, restoreMainWindow: true })
  assert.deepEqual(completion({ mainHiddenForStartup: true, mainPresented: true }), { startupWindowHidden: false, restoreMainWindow: true })
  assert.deepEqual(completion({ mainPresented: true, mainVisible: true }), { startupWindowHidden: false, restoreMainWindow: false })
  assert.deepEqual(completion({ startupWindowHidden: true, mainPresented: true }), { startupWindowHidden: true, restoreMainWindow: false })
})

test('legacy npm builds append motion support but not the native brand IPC preload', () => {
  const source = readFileSync(new URL('../scripts/build-shell.mjs', import.meta.url), 'utf8')
  const start = source.indexOf("if (file === 'apps/desktop/src/preload-app.ts')")
  const end = source.indexOf("if (!native && file === 'apps/desktop/src/locale.ts')", start)
  assert.ok(start >= 0 && end > start, 'preload append boundary changed')
  const append = source.slice(start, end)
  assert.match(append, /boot-motion-preload\.cjs/)
  const guard = append.indexOf('if (native)')
  assert.ok(guard >= 0, 'brand preload must be native-only')
  assert.ok(guard < append.indexOf('boot-brand-preload.cjs'), 'brand preload is appended before its native guard')
})

test('startup completion records a hidden dedicated window before destroying it', () => {
  const source = readFileSync(new URL('../src/product.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('export async function desktopReady')
  const end = source.indexOf('\n}\n', start)
  assert.ok(start >= 0 && end > start, 'desktopReady boundary changed')
  const ready = source.slice(start, end)
  assert.match(ready, /!progressWindow\.isVisible\(\)/)
  assert.ok(ready.indexOf('isVisible()') < ready.indexOf('progressWindow.destroy()'), 'hidden state must be captured before destruction')
  assert.match(ready, /hadStartupWindow/)
  assert.match(ready, /mainPresented: mainWindowPresented/)
  assert.match(ready, /mainVisible/)
  assert.match(ready, /startupWindowCompletion/)
  assert.match(ready, /return completion/)
})

function startupHarness() {
  const source = readFileSync(new URL('../src/product.mjs', import.meta.url), 'utf8')
  const appearanceStart = source.indexOf('function startupAppearance()')
  const createStart = source.indexOf('function createProgressWindow(')
  const messageStart = source.indexOf('function showDesktopMessageBox(')
  const readyStart = source.indexOf('export async function desktopReady(')
  const readyEnd = source.indexOf('\n}\n', readyStart)
  assert.ok(appearanceStart >= 0 && createStart > appearanceStart && messageStart > createStart && readyStart > messageStart && readyEnd > readyStart,
    'production startup window boundaries changed')
  class FakeWindow {
    constructor(options = {}) { this.options = options; this.visible = false; this.destroyed = false; this.showCalls = 0; this.hideCalls = 0; this.webContents = {} }
    show() { this.visible = true; this.showCalls++ }
    hide() { this.visible = false; this.hideCalls++ }
    isVisible() { return this.visible }
    isDestroyed() { return this.destroyed }
    destroy() { this.destroyed = true; this.visible = false }
    loadURL() { return Promise.resolve() }
  }
  const app = { getAppPath: () => '/app', dock: { setIcon() {} }, getPath: () => '/userData' }
  const processFixture = { platform: 'darwin' }
  const build = new Function('BrowserWindow', 'process', 'join', 'readFileSync', 'savedEduworkStyle', 'attachWindowVisibility',
    'startupPage', 'removeWindowMenu', 'desktopHostLog', 'startupWindowPresentation', 'startupWindowCompletion',
    'app', 'settings', 'paths', 'isQuitting', 'tray', 'contentUpdates', 'writeMigrationHealth', 'desktopPet', 'portableUpdates',
    `let progressWindow, mainWindow, mainWindowPresented = false, mainWindowHiddenForStartup = false, migrationLaunch = null, updateCompleted = false
    ${source.slice(appearanceStart, createStart)}
    ${source.slice(createStart, messageStart)}
    ${source.slice(readyStart, readyEnd + 2).replace('export ', '')}
    return {
      main: null,
      setMain(window) { mainWindow = window; mainWindowPresented = false; mainWindowHiddenForStartup = false },
      markPresented() { mainWindowPresented = true },
      createProgressWindow,
      desktopReady,
      state: () => ({ mainWindowPresented, mainWindowHiddenForStartup, progressWindow }),
    }`)
  const harness = build(FakeWindow, processFixture, joinPath, () => Buffer.from('icon'), () => 'ecnu-liwa',
    () => {}, () => '<html></html>', () => {}, () => {}, startupWindowPresentation, startupWindowCompletion,
    app, { productName: 'Fixture' }, { icon: '/icon.png' }, () => false, undefined,
    { ready: async () => {} }, async () => {}, { start() {} }, { action: () => Promise.resolve() })
  const main = new FakeWindow()
  harness.main = main
  harness.setMain(main)
  return { harness, main, FakeWindow }
}
const joinPath = (base, ...parts) => [base, ...parts].join('/').replaceAll('//', '/')

test('production window handoff preserves an active restore of a hidden download window', async () => {
  const { harness, main } = startupHarness()
  main.visible = true
  harness.markPresented()
  main.visible = false // The user hid the main window before the download arrived.
  const download = harness.createProgressWindow('download')
  assert.equal(download.visible, false, 'the late download window inherits the hidden main window')
  assert.equal(harness.state().mainWindowHiddenForStartup, false)
  download.show() // The user restores it from the Dock.
  const completion = await harness.desktopReady()
  assert.equal(completion.startupWindowHidden, false)
  assert.equal(completion.restoreMainWindow, true, 'the active restore must keep a visible window after the download closes')
  assert.equal(download.destroyed, true)
  if (completion.restoreMainWindow) main.show() // The native presentation branch restores the main window.
  assert.equal(main.visible, true)
})

test('production window handoff restores a main window hidden for a visible download', async () => {
  const { harness, main } = startupHarness()
  main.visible = true
  harness.markPresented()
  const download = harness.createProgressWindow('download')
  assert.equal(main.hideCalls, 1)
  assert.equal(download.visible, true)
  assert.equal(harness.state().mainWindowHiddenForStartup, true)
  const completion = await harness.desktopReady()
  assert.equal(completion.startupWindowHidden, false)
  assert.equal(completion.restoreMainWindow, true)
  assert.equal(download.destroyed, true)
})

test('production window handoff keeps the main window hidden when the download is hidden', async () => {
  const { harness, main } = startupHarness()
  main.visible = true
  harness.markPresented()
  const download = harness.createProgressWindow('download')
  download.hide()
  const completion = await harness.desktopReady()
  assert.equal(completion.startupWindowHidden, true)
  assert.equal(completion.restoreMainWindow, false)
})

test('startup window handoff is wired into the production window and presentation logic', () => {
  const source = readFileSync(new URL('../src/product.mjs', import.meta.url), 'utf8')
  const create = source.slice(source.indexOf('function createProgressWindow'), source.indexOf('function showDesktopMessageBox'))
  assert.match(create, /startupWindowPresentation/)
  assert.match(create, /mainWindow\.hide\(\)/)
  assert.match(create, /show: false/)
  assert.match(create, /if \(presentation\.showStartupWindow\) progressWindow\.show\(\)/)
  const attach = source.slice(source.indexOf('export async function attachDesktopWindow'), source.indexOf('const show = attachWindowVisibility'))
  assert.match(attach, /mainWindowPresented = false/)
  assert.match(attach, /window\.on\('show', \(\) => \{ mainWindowPresented = true \}\)/)
  const native = readFileSync(new URL('../src/native-desktop.mjs', import.meta.url), 'utf8')
  assert.match(native, /completion\?\.restoreMainWindow/)
})

test('startup recovery drops the tray before the stale BootPage window', () => {
  const source = readFileSync(new URL('../src/product.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('export async function showDesktopFailure')
  const end = source.indexOf('\n}\n', start)
  assert.ok(start >= 0 && end > start, 'showDesktopFailure boundary changed')
  const failure = source.slice(start, end)
  assert.match(failure, /tray\.destroy\(\)/)
  assert.ok(failure.indexOf('tray.destroy()') < failure.indexOf('mainWindow.destroy()'), 'tray must not outlive the main window')
})
