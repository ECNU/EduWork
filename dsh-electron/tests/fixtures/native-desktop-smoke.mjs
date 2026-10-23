import { app, BrowserWindow, Menu, clipboard, dialog, nativeTheme, protocol, session, webContents } from 'electron'
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { installNativeDesktopBridge } from 'fixture-bridge'
import { staticDesktopResponse } from 'fixture-static'
import { DesktopDirectoryPicker } from '../../src/directory-picker.mjs'
import { createWindow } from 'fixture-window'
import { DesktopBackendController } from 'fixture-backend'
import { DesktopQuitConfirmation } from 'fixture-quit'
import { DesktopFatalRecovery } from 'fixture-recovery'
import { resolveDesktopLocale } from 'fixture-locale'
import { installMicrophonePermissions } from 'fixture-permissions'
import { removeWindowMenu } from 'fixture-menu'
const output = process.env.EDUWORK_PROBE_OUTPUT, results = [], limitations = []
app.setPath('userData', join(output, 'browser-data'))
protocol.registerSchemesAsPrivileged([{ scheme: 'dsh-app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }])
const timer = setTimeout(() => finish(new Error('Electron smoke deadline exceeded')), 90000)
let finished = false, server, hostServer, bridge
function finish(error) {
  if (finished) return
  finished = true
  clearTimeout(timer)
  writeFileSync(join(output, 'report.json'), JSON.stringify({ ok: !error, electron: process.versions.electron, platform: process.platform, results, limitations, error: error ? error.stack ?? String(error) : undefined }, null, 2))
  bridge?.dispose()
  for (const window of BrowserWindow.getAllWindows()) window.destroy()
  server?.close()
  hostServer?.close()
  app.exit(error ? 1 : 0)
}
const tick = () => new Promise(resolve => setTimeout(resolve, 100))
async function until(predicate) { for (let n = 0; n < 100; n++) { if (await predicate()) return; await tick() }; throw new Error('Condition did not become true') }
app.whenReady().then(async () => {
  let mainWindow, pickerCalls = 0, pickerResolve, failure, bootFailure
  const preload = process.env.EDUWORK_PROBE_PRELOAD
  let hostRequests = 0, staticHostReady = false
  let hostWait = async () => {}
  hostServer = createServer((_req, res) => { hostRequests++; res.end('private Host fixture') })
  await new Promise(resolve => hostServer.listen(0, '127.0.0.1', resolve))
  const hostOrigin = `http://127.0.0.1:${hostServer.address().port}`
  const host = { origin: hostOrigin, boot: () => ({ injections: [], streamBaseUrl: hostOrigin }),
    socketHeaders: () => ({}), readLocalePreference: async () => 'zh' }
  const webRoot = join(output, 'web')
  await mkdir(join(webRoot, 'assets'), { recursive: true })
  await writeFile(join(webRoot, 'index.html'), `<!doctype html><html lang="zh"><head>
    <style>[data-dsh-boot-spinner]{animation:fixture-spin .8s linear infinite}@keyframes fixture-spin{to{transform:rotate(360deg)}}</style>
  </head><body>
    <div data-shell-overlay></div><h1>Fixture</h1>
    <div data-dsh-boot><div><div>HARNESS</div><div data-dsh-boot-spinner></div><div>Loading plugins…</div></div></div>
  </body></html>`)
  await writeFile(join(webRoot, 'assets', 'marker.txt'), 'static-before-host')
  const picker = new DesktopDirectoryPicker({ getWindow: () => mainWindow, showOpenDialog: (...args) => dialog.showOpenDialog(...args) })
  bridge = installNativeDesktopBridge({ getHost: () => host, waitForHost: () => hostWait(), getWindow: () => mainWindow,
    reportFatal: error => { failure = error.message }, onBootFailure: error => { bootFailure = error.message },
    checkUpdates: async () => ({}), pickDirectory: signal => picker.pick(signal),
    bootBrand: () => 'Synthetic EduWork' })
  // Exercise real native windows before/after application-menu refresh, including
  // the separate recovery-window path. Alt must not resurrect a removed menu.
  const progress = new BrowserWindow({ show: false, width: 580, height: 280 })
  removeWindowMenu(progress)
  const recoveryWindow = new BrowserWindow({ show: false, width: 660, height: 470 })
  removeWindowMenu(recoveryWindow)
  protocol.handle('dsh-app', request => {
    const asset = staticDesktopResponse(request, webRoot)
    if (asset) return asset
    return staticHostReady
      ? new Response('host:' + new URL(request.url).pathname, { headers: { 'content-type': 'text/plain' } })
      : new Response(null, { status: 503 })
  })
  mainWindow = createWindow(preload, false, true)
  bridge.attach(mainWindow)
  await mainWindow.loadURL('dsh-app://app/index.html')
  const evaluate = code => mainWindow.webContents.executeJavaScript(code, true)
  const contract = await evaluate(`({platform:document.documentElement.dataset.platform,browser:typeof dshDesktop.browser.acquire,keyboard:typeof dshDesktop.keyboard.subscribe,shortcuts:typeof dshDesktop.shortcuts.get,locale:typeof __DSH_LOCALE__.read,paths:typeof __DSH_HOST_PATHS__.pathFor,account:typeof window.dshPlatform})`)
  assert.deepEqual(contract, { platform: process.platform, browser: 'function', keyboard: 'function', shortcuts: 'function', locale: 'function', paths: 'function', account: 'undefined' })
  const staticChecks = await evaluate(`Promise.all([
    fetch('/assets/marker.txt').then(response => response.text()),
    fetch('/api/settings/describe').then(response => response.status),
    fetch('/index.html', { method: 'POST' }).then(response => response.status),
  ])`)
  assert.deepEqual(staticChecks, ['static-before-host', 503, 405])
  staticHostReady = true
  assert.equal(await evaluate(`fetch('/api/settings/describe').then(response => response.text())`), 'host:/api/settings/describe')
  results.push('shell static document and assets load before the Host; API stays behind readiness; POST is rejected')
  await until(async () => (await evaluate(`document.querySelector('[data-dsh-boot] > div > div')?.textContent`)) === 'Synthetic EduWork')
  mainWindow.webContents.send('eduwork:boot-brand', 'Updated Brand')
  await until(async () => (await evaluate(`document.querySelector('[data-dsh-boot] > div > div')?.textContent`)) === 'Updated Brand')
  await mainWindow.loadURL('dsh-app://app/index.html')
  await until(async () => (await evaluate(`document.querySelector('[data-dsh-boot] > div > div')?.textContent`)) === 'Synthetic EduWork')
  mainWindow.webContents.debugger.attach('1.3')
  try {
    await mainWindow.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-dsh-boot-spinner]')).animationName`), 'none')
    await mainWindow.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-dsh-boot-spinner]')).animationName`), 'fixture-spin')
  } finally { mainWindow.webContents.debugger.detach() }
  results.push('upstream BootPage wordmark follows the desktop identity, including reloads, and honors reduced motion')
  let releaseHost
  hostWait = () => new Promise(resolve => { releaseHost = resolve })
  let bootSettled = false
  const pendingBoot = evaluate(`dshDesktopBoot.ready().then(value => ({ value }), error => ({ error: error.message }))`)
    .finally(() => { bootSettled = true })
  await tick(); await tick()
  assert.equal(bootSettled, false)
  releaseHost()
  assert.deepEqual(await pendingBoot, { value: { injections: [], streamBaseUrl: hostOrigin } })
  hostWait = async () => { throw new Error('synthetic startup failure') }
  assert.match(await evaluate(`dshDesktopBoot.ready().then(() => null, error => error.message)`), /synthetic startup failure$/)
  hostWait = async () => {}
  results.push('boot IPC joins the pending startup, returns the ready Host and propagates failure')
  assert.equal((await evaluate('__DSH_LOCALE__.read()')).preference, 'zh')
  const nativeMenu = () => Menu.getApplicationMenu()
  assert.deepEqual(nativeMenu().items.slice(-2).map(item => item.label), ['编辑', '视图'])
  assert.equal(nativeMenu().items[0].submenu.items[0].label, '检查更新…')
  assert.ok(nativeMenu().items.find(item => item.role === 'editmenu').submenu.items.some(item => item.role === 'copy'))
  if (process.platform === 'win32') {
    assert.deepEqual(await evaluate(`Array.from(document.querySelector('[data-windows-menu]').shadowRoot.querySelectorAll('button'),element=>element.textContent)`), ['应用', '编辑'])
    await evaluate(`document.documentElement.lang='en'`)
    await until(async () => (await evaluate(`document.querySelector('[data-windows-menu]').shadowRoot.querySelector('button').textContent`)) === 'Application')
    results.push('sandboxed Windows caption menu mounts and responds to language changes')
  }
  await evaluate(`document.documentElement.lang='en'; __DSH_LOCALE__.onChange('en')`)
  await until(() => nativeMenu().items.at(-1).label === 'View')
  assert.equal(nativeMenu().items[0].submenu.items[0].label, 'Check for Updates…')
  assert.equal(nativeMenu().items.at(-2).label, 'Edit')
  if (process.platform !== 'darwin') {
    for (const window of [progress, recoveryWindow]) {
      assert.equal(window.isMenuBarVisible(), false)
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Alt' })
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Alt' })
      assert.equal(window.isMenuBarVisible(), false)
    }
  }
  progress.destroy(); recoveryWindow.destroy()
  results.push('startup/recovery windows stay menu-free through locale refresh; native Edit/View and update labels follow locale')
  await evaluate(`document.documentElement.setAttribute('data-ds-theme-source','dark')`)
  await until(() => nativeTheme.themeSource === 'dark')
  results.push('built preload and theme synchronization')
  mainWindow.show(); mainWindow.focus()
  await until(() => mainWindow.isFocused())
  // Service-session CI runners may not expose an OS clipboard. Establish that
  // native Electron can round-trip first; only then judge the browser bridge.
  await clipboard.writeText('eduwork native clipboard baseline')
  await tick()
  const nativeClipboardAvailable = (await clipboard.readText()) === 'eduwork native clipboard baseline'
  await evaluate(`navigator.clipboard.writeText('eduwork desktop fixture')`)
  if (nativeClipboardAvailable) {
    await until(async () => (await clipboard.readText()) === 'eduwork desktop fixture')
    results.push('browser clipboard write round-trips through the system clipboard')
  } else limitations.push('System clipboard readback unavailable to native Electron in this session; browser write authorization succeeded, OS round-trip not verified')
  results.push('built preload: browser, desktop keyboard, locale, file paths and native theme')
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
  // All desktop callers share one dialog, with the result owned by the first caller.
  const originalPicker = dialog.showOpenDialog
  dialog.showOpenDialog = async () => { pickerCalls++; return new Promise(resolve => { pickerResolve = resolve }) }
  const picked = evaluate('Promise.all([__DSH_DIRECTORY_PICKER__.pick(),__DSH_DIRECTORY_PICKER__.pick()])')
  await until(() => pickerCalls > 0)
  pickerResolve({ canceled: false, filePaths: [output] })
  assert.deepEqual(await picked, [output, null]); assert.equal(pickerCalls, 1)
  dialog.showOpenDialog = originalPicker
  results.push('directory picker rejects concurrent requests without duplicating the selection')
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
  assert.equal(permissionFixture.checks(mainWindow.webContents, 'clipboard-sanitized-write', 'dsh-app://app', { isMainFrame: true }), true)
  assert.equal(permissionFixture.checks(mainWindow.webContents, 'clipboard-sanitized-write', protectedURL, { isMainFrame: false }), false)
  assert.equal(permissionFixture.checks(mainWindow.webContents, 'media', protectedURL, { isMainFrame: false, mediaType: 'audio' }), false)
  assert.equal(permissionFixture.checks(mainWindow.webContents, 'media', 'dsh-app://app', { isMainFrame: true, mediaType: 'video' }), false)
  assert.equal(permissionFixture.checks(mainWindow.webContents, 'geolocation', 'dsh-app://app', { isMainFrame: true }), false)
  let allowed
  permissionFixture.requests(mainWindow.webContents, 'media', value => { allowed = value }, { isMainFrame: false, requestingUrl: protectedURL, mediaTypes: ['audio'] })
  assert.equal(allowed, false)
  results.push('permission policy denies foreign-frame microphone, camera and geolocation (synthetic requests)')
  await evaluate(`dshDesktopBoot.failed('synthetic boot failure')`)
  assert.equal(bootFailure, 'synthetic boot failure')
  assert.equal(failure, undefined)
  results.push('frontend boot failure reaches the dedicated startup recovery once')
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
