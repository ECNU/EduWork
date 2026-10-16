// Real Electron acceptance of the desktop pet window with the built-in skin and
// synthetic notification state. Run with Electron, not Node:
//   EDUWORK_TEST_EVIDENCE=<new directory> <Electron> dsh-electron/tests/desktop-pet.electron.mjs
// Clicks are synthetic renderer input; native click-through, focus and Spaces
// behavior are part of the manual desktop acceptance.
import { app, BrowserWindow, protocol, screen } from 'electron'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDesktopPet } from '../src/desktop-pet.mjs'
import { PET_SCHEME } from '../src/desktop-pet-core.mjs'

const evidence = process.env.EDUWORK_TEST_EVIDENCE
if (!evidence) throw new Error('Set EDUWORK_TEST_EVIDENCE to an isolated output directory')
const userData = mkdtempSync(join(tmpdir(), 'eduwork-pet-electron-'))
app.setPath('userData', userData)
protocol.registerSchemesAsPrivileged([{ scheme: PET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }])
const packageRoot = fileURLToPath(new URL('../../packages/dsh-desktop-pet/', import.meta.url))
const preload = fileURLToPath(new URL('../src/preload-pet.cjs', import.meta.url))
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check, label, timeout = 10_000) {
  for (const end = Date.now() + timeout; Date.now() < end; await wait(100)) if (await check()) return
  throw new Error(`Timed out: ${label}`)
}
const configure = (extra = {}) => ({ action: 'configure', enabled: true, skin: 'eduwork-page', frame: { width: 192, height: 208 }, size: 100, bubbles: true, sleep: true, ...extra })
const processes = () => app.getAppMetrics().filter(row => row.type !== 'Browser').map(row => row.type).sort()

async function run() {
  const opened = [], logs = [], report = { platform: process.platform, electron: process.versions.electron }
  const pet = createDesktopPet({ packageRoot, preload, stateFile: join(userData, 'desktop-pet.json'), locale: 'zh-CN',
    open: key => opened.push(key), contextMenu: () => [], changed() {}, log: message => logs.push(message) })
  const petWindow = () => BrowserWindow.getAllWindows().find(window => pet.owns(window))
  await wait(1000)
  const before = processes()
  await assert.rejects(pet.handle(configure({ skin: 'missing' })), /^Error: Unknown pet skin$/)
  assert.deepEqual(await pet.handle(configure()), { supported: true, shown: false })
  assert.equal(petWindow(), undefined, 'waits for the main window before showing')
  pet.start()
  await until(() => petWindow()?.isVisible(), 'pet shown')
  const window = petWindow(), bounds = window.getBounds(), area = screen.getDisplayMatching(bounds).workArea
  assert.equal(window.webContents.getURL(), `${PET_SCHEME}://pet/page/pet.html`)
  assert.equal(window.isAlwaysOnTop(), true)
  assert.equal(window.isFocusable(), false)
  assert.equal(window.isFocused(), false)
  assert.deepEqual([bounds.width, bounds.height], [220, 232])
  assert.ok(bounds.y + 64 >= area.y && bounds.y + 64 + 128 <= area.y + area.height, 'the pet is inside the work area')
  report.window = { bounds, workArea: area }
  const page = script => window.webContents.executeJavaScript(script)
  const center = { x: 110, y: 128 }
  await until(() => page(`document.getElementById('pet').getContext('2d').getImageData(${center.x} * devicePixelRatio, ${center.y} * devicePixelRatio, 1, 1).data[3] > 200`), 'skin drawn')
  assert.equal(await page(`document.getElementById('pet').getContext('2d').getImageData(2, 2, 1, 1).data[3]`), 0, 'transparent margin')
  report.files = await page(`Promise.all(['../skin/idle.svg', '../skin.js', '../index.js', '../../package.json', '../skin/%2e%2e%2fskin.json', '../skin/..%2f..%2fpackage.json'].map(path => fetch(path).then(response => response.status, () => 'blocked')))`)
  assert.deepEqual(report.files, [200, 200, 404, 404, 404, 404])

  // A completed result: "!" badge, generic bubble text (previews off), click opens it.
  pet.update({ items: new Map([['done-1', { key: 'done-1', kind: 'completed', sessionId: 'session-1', title: 'Private title', createdAt: Date.now() }]]),
    running: [], acknowledged: 0, preferences: { preview: false } })
  await until(() => page(`!document.getElementById('badge').hidden`), 'badge shown')
  report.badge = await page(`document.getElementById('badge').textContent`)
  report.bubble = await page(`document.getElementById('bubble').textContent`)
  assert.equal(report.badge, '!')
  assert.ok(!report.bubble.includes('Private'))
  for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) window.webContents.sendInputEvent({ type, ...center, button: 'left', clickCount: 1 })
  await until(() => opened.length === 1, 'click opened the item')
  assert.deepEqual(opened, ['done-1'])
  // Viewing the item in the app clears its badge and, at once, its announcement.
  pet.update({ items: new Map([['done-2', { key: 'done-2', kind: 'completed', sessionId: 'session-2', title: '', createdAt: Date.now() }]]),
    running: [], acknowledged: 0, preferences: { preview: false } })
  await until(() => page(`!document.getElementById('bubble').hidden`), 'second result announced')
  pet.update({ items: new Map(), running: [], acknowledged: 0, preferences: { preview: false } })
  await until(() => page(`document.getElementById('badge').hidden && document.getElementById('bubble').hidden`), 'badge and bubble cleared', 1000)

  // Another renderer with the same preload cannot drive the pet.
  const stranger = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true } })
  await stranger.loadURL('data:text/html,<p>stranger</p>')
  await stranger.webContents.executeJavaScript(`window.eduworkPet.open('done-1'); window.eduworkPet.ready(); window.eduworkPet.menu()`)
  await wait(500)
  stranger.destroy()
  assert.deepEqual(opened, ['done-1'])

  assert.deepEqual(await pet.handle({ action: 'reset-position' }), { supported: true })
  // Hiding from a menu turns the setting off; showing again turns it back on.
  await pet.handle(configure({ enabled: false }))
  assert.deepEqual([pet.available, pet.shown], [true, false])
  await pet.handle(configure())
  await until(() => petWindow()?.isVisible(), 'shown again')
  // A page failure closes the pet until the tray shows it again.
  petWindow().webContents.forcefullyCrashRenderer()
  await until(() => !petWindow() && !pet.shown, 'closed after a page failure')
  pet.retry()
  await until(() => petWindow()?.isVisible(), 'shown again after a failure')
  await pet.handle(configure({ size: 150 }))
  await until(() => petWindow()?.isVisible() && petWindow().getBounds().height === 296, 'resized')
  await pet.handle(configure({ enabled: false }))
  assert.equal(petWindow(), undefined)
  await until(() => processes().join() === before.join(), 'pet processes ended', 15_000)
  report.processes = { before, after: processes() }
  pet.close()
  pet.close()
  report.saved = JSON.parse(await readFile(join(userData, 'desktop-pet.json'), 'utf8'))
  report.logs = logs
  report.scope = 'Window properties, page loading, file access, synthetic click and IPC origin checks, hide/resize/disable lifecycle. Native click-through, focus, Spaces and real-pointer dragging are manual acceptance.'
  await mkdir(evidence, { recursive: true })
  await writeFile(join(evidence, 'desktop-pet.json'), JSON.stringify({ success: true, ...report }, null, 2))
}
// The pet is the only window for part of the run; keep the test app alive.
app.on('window-all-closed', () => {})
// Fail the run instead of leaving Electron's modal error dialog on screen.
for (const event of ['uncaughtException', 'unhandledRejection']) process.on(event, error => { console.error(error); app.exit(1) })
void app.whenReady().then(run).then(() => app.exit(0), error => { console.error(error); app.exit(1) })
