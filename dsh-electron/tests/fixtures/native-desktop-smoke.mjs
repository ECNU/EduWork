import { app, BrowserWindow, clipboard, dialog, nativeTheme, protocol, session, webContents } from 'electron'
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { installNativeDesktopBridge } from 'fixture-bridge'
import { createWindow } from 'fixture-window'
import { DesktopBackendController } from 'fixture-backend'
import { DesktopQuitConfirmation } from 'fixture-quit'
import { DesktopFatalRecovery } from 'fixture-recovery'
import { resolveDesktopLocale } from 'fixture-locale'
import { installMicrophonePermissions } from 'fixture-permissions'
const output = process.env.EDUWORK_PROBE_OUTPUT, results = []
app.setPath('userData', join(output, 'browser-data'))
protocol.registerSchemesAsPrivileged([{ scheme: 'dsh-app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }])
const timer = setTimeout(() => finish(new Error('Electron smoke deadline exceeded')), 90000)
let finished = false, server, hostServer, bridge
function finish(error) {
  if (finished) return
  finished = true
  clearTimeout(timer)
  writeFileSync(join(output, 'report.json'), JSON.stringify({ ok: !error, electron: process.versions.electron, platform: process.platform, results, error: error ? error.stack ?? String(error) : undefined }, null, 2))
  bridge?.dispose()
  for (const window of BrowserWindow.getAllWindows()) window.destroy()
  server?.close()
  hostServer?.close()
  app.exit(error ? 1 : 0)
}
const tick = () => new Promise(resolve => setTimeout(resolve, 100))
async function until(predicate) { for (let n = 0; n < 100; n++) { if (await predicate()) return; await tick() }; throw new Error('Condition did not become true') }
app.whenReady().then(async () => {
  let mainWindow, pickerCalls = 0, pickerResolve, failure
  const preload = process.env.EDUWORK_PROBE_PRELOAD
  let hostRequests = 0
  hostServer = createServer((_req, res) => { hostRequests++; res.end('private Host fixture') })
  await new Promise(resolve => hostServer.listen(0, '127.0.0.1', resolve))
  const hostOrigin = `http://127.0.0.1:${hostServer.address().port}`
  const host = { origin: hostOrigin, boot: () => ({ injections: [], streamBaseUrl: hostOrigin }),
    socketHeaders: () => ({}), readLocalePreference: async () => 'zh' }
  bridge = installNativeDesktopBridge({ getHost: () => host, getWindow: () => mainWindow,
    reportFatal: error => { failure = error.message }, checkUpdates: async () => ({}) })
  protocol.handle('dsh-app', () => new Response('<!doctype html><html lang="zh"><body><div data-shell-overlay></div><h1>Fixture</h1></body></html>', { headers: { 'content-type': 'text/html' } }))
  mainWindow = createWindow(preload, false, true)
  bridge.attach(mainWindow)
  await mainWindow.loadURL('dsh-app://app/index.html')
  const evaluate = code => mainWindow.webContents.executeJavaScript(code, true)
  const contract = await evaluate(`({platform:document.documentElement.dataset.platform,browser:typeof dshDesktop.browser.acquire,keyboard:typeof dshDesktop.keyboard.subscribe,shortcuts:typeof dshDesktop.shortcuts.get,locale:typeof __DSH_LOCALE__.read,paths:typeof __DSH_HOST_PATHS__.pathFor,account:typeof window.dshPlatform})`)
  assert.deepEqual(contract, { platform: process.platform, browser: 'function', keyboard: 'function', shortcuts: 'function', locale: 'function', paths: 'function', account: 'undefined' })
  assert.equal((await evaluate('__DSH_LOCALE__.read()')).preference, 'zh')
  if (process.platform === 'win32') {
    assert.deepEqual(await evaluate(`Array.from(document.querySelector('[data-windows-menu]').shadowRoot.querySelectorAll('button'),element=>element.textContent)`), ['应用', '编辑'])
    await evaluate(`document.documentElement.lang='en'`)
    await until(async () => (await evaluate(`document.querySelector('[data-windows-menu]').shadowRoot.querySelector('button').textContent`)) === 'Application')
    results.push('sandboxed Windows caption menu mounts and responds to language changes')
  }
  await evaluate(`document.documentElement.setAttribute('data-ds-theme-source','dark')`)
  await until(() => nativeTheme.themeSource === 'dark')
  results.push('built preload and theme synchronization')
  mainWindow.show(); mainWindow.focus()
  await until(() => mainWindow.isFocused())
  await evaluate(`navigator.clipboard.writeText('eduwork desktop fixture')`)
  assert.equal(await clipboard.readText(), 'eduwork desktop fixture')
  results.push('built preload: browser, desktop keyboard, locale, file paths, native theme and clipboard')
  // Register a real binding, then deliver physical input through Electron's
  // before-input-event path and the built preload, not a synthetic IPC send.
  const shortcutPlatform = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux'
  const definitions = [{ id: 'browser.new', defaults: { [`desktop:${shortcutPlatform}`]: { code: 'KeyT', modifiers: ['primary'] } } }]
  const shortcuts = await evaluate(`dshDesktop.shortcuts.get(${JSON.stringify(definitions)})`)
  assert.equal(typeof shortcuts.revision, 'string')
  await evaluate(`window.shortcutInputs=[];dshDesktop.keyboard.subscribe(input=>shortcutInputs.push(input));document.body.tabIndex=0;document.body.focus()`)
  const modifiers = [process.platform === 'darwin' ? 'meta' : 'control']
  mainWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers })
  mainWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'T', modifiers })
  await until(async () => (await evaluate('shortcutInputs.length')) === 1)
  assert.equal(await evaluate('shortcutInputs[0].code'), 'KeyT')
  assert.equal(await evaluate('shortcutInputs[0].revision'), shortcuts.revision)
  results.push('official shortcut preferences and physical key delivery through the built preload')
  // Official picker joins concurrent requests instead of opening several dialogs.
  const originalPicker = dialog.showOpenDialog
  dialog.showOpenDialog = async () => { pickerCalls++; return new Promise(resolve => { pickerResolve = resolve }) }
  const picked = evaluate('Promise.all([__DSH_DIRECTORY_PICKER__.pick(),__DSH_DIRECTORY_PICKER__.pick()])')
  await until(() => pickerCalls > 0)
  pickerResolve({ canceled: false, filePaths: [output] })
  assert.deepEqual(await picked, [output, output]); assert.equal(pickerCalls, 1)
  dialog.showOpenDialog = originalPicker
  results.push('official directory picker deduplicates simultaneous requests')
  // Another renderer with the same origin still does not own privileged IPC.
  const foreign = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true } })
  await foreign.loadURL('dsh-app://app/index.html')
  const denied = await foreign.webContents.executeJavaScript(`dshDesktop.browser.acquire('foreign').then(()=>false,()=>true)`)
  assert.equal(denied, true); foreign.destroy()
  results.push('same-origin foreign window cannot acquire browser leases')
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html'); res.setHeader('X-Frame-Options', 'SAMEORIGIN'); res.setHeader('Content-Security-Policy', "frame-ancestors 'self'")
    res.end('<!doctype html><html><title>protected fixture</title><body>Native browser works</body></html>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const protectedURL = `http://127.0.0.1:${server.address().port}/`
  const reservation = await evaluate(`dshDesktop.browser.acquire('fixture-workspace')`)
  await evaluate(`window.fixtureGuest=document.createElement('webview');fixtureGuest.setAttribute('partition',${JSON.stringify(reservation.partition)});fixtureGuest.setAttribute('name',${JSON.stringify(reservation.lease)});fixtureGuest.src=${JSON.stringify('about:blank#' + reservation.lease)};fixtureGuest.dataset.sidebarBrowserFrame='';document.body.append(fixtureGuest);`)
  let guest
  await until(() => { guest = webContents.getAllWebContents().find(contents => contents.getType() === 'webview'); return guest?.getURL() === 'about:blank#' + reservation.lease })
  await tick()
  await guest.loadURL(protectedURL)
  assert.equal(await guest.executeJavaScript('document.title'), 'protected fixture')
  assert.deepEqual(await guest.executeJavaScript(`({bridge:typeof window.dshDesktop,require:typeof window.require})`), { bridge: 'undefined', require: 'undefined' })
  results.push('leased native guest opens a CSP/XFO-protected page without desktop privileges')
  await assert.rejects(guest.loadURL(`${hostOrigin}/private`))
  assert.equal(hostRequests, 0, 'guest must be rejected before contacting the live Host fixture')
  await evaluate(`dshDesktop.browser.release(${JSON.stringify(reservation.lease)})`)
  await until(() => guest.isDestroyed())
  results.push('guest blocks Host access and release destroys guest')
  // Synthetic permission handler calls validate frame/OS checks without ever
  // opening a real device. The handler itself is the compiled official module.
  const permissionFixture = { checks: null, requests: null,
    setPermissionCheckHandler(fn) { this.checks = fn }, setPermissionRequestHandler(fn) { this.requests = fn } }
  installMicrophonePermissions(permissionFixture, () => mainWindow.webContents)
  assert.equal(permissionFixture.checks(mainWindow.webContents, 'media', protectedURL, { isMainFrame: false, mediaType: 'audio' }), false)
  assert.equal(permissionFixture.checks(mainWindow.webContents, 'media', 'dsh-app://app', { isMainFrame: true, mediaType: 'video' }), false)
  assert.equal(permissionFixture.checks(mainWindow.webContents, 'geolocation', 'dsh-app://app', { isMainFrame: true }), false)
  let allowed
  permissionFixture.requests(mainWindow.webContents, 'media', value => { allowed = value }, { isMainFrame: false, requestingUrl: protectedURL, mediaTypes: ['audio'] })
  assert.equal(allowed, false)
  results.push('permission policy denies foreign-frame microphone, camera and geolocation (synthetic requests)')
  await evaluate(`dshDesktopBoot.failed('synthetic boot failure')`)
  assert.equal(failure, 'synthetic boot failure')
  results.push('frontend boot failure reaches recovery')
  // Exercise the upstream lifecycle and quit state machines with synthetic Hosts.
  let failHost, stopped = 0, state
  const backend = new DesktopBackendController(onFailure => { failHost = onFailure; return { start: async () => {}, stop: async () => { stopped++ } } }, next => { state = next })
  await backend.start(async () => {})
  failHost(new Error('synthetic host crash'))
  await until(() => stopped === 1)
  assert.equal(state.phase, 'error'); assert.equal(backend.host, undefined)
  await backend.close(); assert.equal(stopped, 1)
  let prompts = 0, answer = 1
  const confirmation = new DesktopQuitConfirmation({ locale: () => resolveDesktopLocale('zh'), inspect: async () => ({ activeTasks: true, scheduledTasks: true }),
    show: async () => { prompts++; return { response: answer } }, focus: () => {} })
  assert.equal(await confirmation.confirm(), false)
  answer = 0; assert.equal(await confirmation.confirm(), true); assert.equal(prompts, 2)
  let recoveryCalls = 0, recoveryStops = 0
  const recovery = new DesktopFatalRecovery({ messages: () => resolveDesktopLocale('zh').messages,
    show: async options => { assert.equal(options.buttons.length, 2); recoveryCalls++; return { response: 0 } },
    stop: async () => { recoveryStops++ }, disablePlugins: async () => { throw new Error('must not disable distribution') },
    exit: () => {}, restart: () => {}, writeReport: async () => undefined })
  await Promise.all([recovery.report(new Error('synthetic'), 'host'), recovery.report(new Error('duplicate'), 'renderer')])
  assert.equal(recoveryCalls, 1); assert.equal(recoveryStops, 1)
  results.push('official Host failure cleanup, cancellable active/scheduled-task quit and deduplicated recovery')
  finish()
}).catch(finish)
