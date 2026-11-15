import { app, BrowserWindow, Menu, clipboard, dialog, nativeTheme, protocol, session, webContents } from 'electron'
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { installNativeDesktopBridge } from 'fixture-bridge'
import { createUpdateObserver } from 'fixture-updates'
import { staticDesktopResponse } from 'fixture-static'
import { DesktopDirectoryPicker } from '../../src/directory-picker.mjs'
import { DesktopExit } from '../../src/desktop-exit.mjs'
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
  const report = error => writeFileSync(join(output, 'report.json'), JSON.stringify({ ok: !error, electron: process.versions.electron, platform: process.platform, results, limitations, error: error ? error.stack ?? String(error) : undefined }, null, 2))
  bridge?.dispose()
  server?.close()
  hostServer?.close()
  if (error) { report(error); app.exit(1); return }
  // Empty preparation teardown must still complete Electron's native quit.
  const exit = new DesktopExit({ confirm: async () => true, close: async () => {},
    quit: () => app.quit(), relaunch: assert.fail, failed: error => { report(error); app.exit(1) } })
  const deadline = setTimeout(() => { report(Error('Native quit did not reach will-quit')); app.exit(1) }, 5000)
  app.on('before-quit', event => { if (exit.complete) return; event.preventDefault(); void exit.request() })
  app.once('will-quit', () => {
    clearTimeout(deadline)
    results.push('native quit completes after immediate asynchronous preparation cleanup')
    report()
  })
  app.quit()
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
  const downloads = join(output, 'downloads')
  await mkdir(downloads, { recursive: true }); app.setPath('downloads', downloads)
  const borrowedPath = join(output, 'borrowed.txt'), borrowedBytes = Buffer.from('Synthetic drag resource')
  await writeFile(borrowedPath, borrowedBytes)
  host.resolveDragResource = async address => address === 'fixture:borrowed'
    ? { path: borrowedPath, size: borrowedBytes.length, sha256: createHash('sha256').update(borrowedBytes).digest('hex') } : null
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
  const bootLogo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII='
  const preparationMessage = '首次启动，正在下载并校验发行配置… <synthetic>'
  let bootBrand = { name: 'Synthetic EduWork', logo: bootLogo, message: preparationMessage }
  let updateState = 'up_to_date'
  const updateObserver = createUpdateObserver({
    readStatus: async () => ({ shell: 'electron', version: '0.4.10', phase: updateState,
      update: { enabled: true, state: updateState,
        ...(updateState === 'available' || updateState === 'ready' ? { latestVersion: '0.4.11' } : {}),
        ...(updateState === 'error' ? { failedOperation: 'download', error: 'synthetic download failure' } : {}) },
      contentUpdate: { enabled: false, state: 'current' } }),
    idleInterval: 50, busyInterval: 50,
  })
  bridge = installNativeDesktopBridge({ getHost: () => host, waitForHost: () => hostWait(), getWindow: () => mainWindow,
    reportFatal: error => { failure = error.message }, onBootFailure: error => { bootFailure = error.message },
    checkUpdates: async () => {
      mainWindow.show(); mainWindow.focus()
      await mainWindow.webContents.executeJavaScript("window.dispatchEvent(new Event('eduwork:open-updates'));")
    },
    updates: updateObserver, pickDirectory: signal => picker.pick(signal),
    bootBrand: () => bootBrand })
  const visibilityRoles = () => Menu.getApplicationMenu().items[0].submenu.items
    .map(item => item.role).filter(role => ['hide', 'hideothers', 'unhide'].includes(role))
  const expectedVisibilityRoles = process.platform === 'darwin' ? ['hide', 'hideothers', 'unhide'] : []
  assert.deepEqual(visibilityRoles(), expectedVisibilityRoles, 'application visibility commands must be ready before Host boot')
  assert.equal(Menu.getApplicationMenu().items.some(item => item.role === 'windowmenu'), process.platform === 'darwin')
  assert.equal(Menu.getApplicationMenu().items[0].submenu.items[0].role, 'about')
  assert.ok(Menu.getApplicationMenu().items.find(item => item.role === 'viewmenu').submenu.items
    .some(item => item.role === 'toggledevtools' && item.accelerator === 'F12'))
  // Exercise real native windows before/after application-menu refresh, including
  // the separate recovery-window path. Alt must not resurrect a removed menu.
  const recoveryWindow = new BrowserWindow({ show: false, width: 660, height: 470 })
  removeWindowMenu(recoveryWindow)
  protocol.handle('dsh-app', request => {
    const asset = staticDesktopResponse(request, webRoot)
    if (asset) return asset
    return staticHostReady
      ? new Response('host:' + new URL(request.url).pathname, { headers: { 'content-type': 'text/plain' } })
      : new Response(null, { status: 503 })
  })
  mainWindow = createWindow(preload, false, true, () => bridge.locale())
  bridge.attach(mainWindow)
  await mainWindow.loadURL('dsh-app://app/index.html')
  const evaluate = code => mainWindow.webContents.executeJavaScript(code, true)
  const contract = await evaluate(`({platform:document.documentElement.dataset.platform,browser:typeof dshDesktop.browser.acquire,keyboard:typeof dshDesktop.keyboard.subscribe,shortcuts:typeof dshDesktop.shortcuts.get,locale:typeof __DSH_LOCALE__.read,paths:typeof __DSH_HOST_PATHS__.pathFor,account:typeof window.dshPlatform})`)
  assert.deepEqual(contract, { platform: process.platform, browser: 'function', keyboard: 'function', shortcuts: 'function', locale: 'function', paths: 'function', account: 'undefined' })
  const updateContract = await evaluate(`(async () => {
    window.updateEvents = []
    const off = dshDesktop.updates.subscribe(state => updateEvents.push(state))
    return { initial: await dshDesktop.updates.status(), unsubscribe: typeof off }
  })()`)
  assert.deepEqual(updateContract, { initial: { phase: 'idle' }, unsubscribe: 'function' })
  updateState = 'available'
  await evaluate('updateEvents.length = 0')
  await until(async () => (await evaluate('updateEvents.at(-1)?.phase')) === 'available')
  assert.deepEqual(await evaluate('updateEvents.at(-1)'), { phase: 'available', version: '0.4.11' })
  assert.deepEqual(await evaluate('dshDesktop.updates.status()'), { phase: 'available', version: '0.4.11' })
  results.push('built preload reads and subscribes to production update presentations')
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
  const brandStyle = () => evaluate(`(() => {
    const node = document.querySelector('[data-dsh-boot] > div > div'), css = getComputedStyle(node)
    return { image: css.backgroundImage, size: css.backgroundSize, padding: css.paddingTop, children: node.childElementCount }
  })()`)
  assert.deepEqual(await brandStyle(), { image: `url("${bootLogo}")`, size: '48px 48px', padding: '64px', children: 0 })
  const bootHint = () => evaluate(`(() => {
    const hint = document.querySelector('[data-dsh-boot-spinner]').nextElementSibling
    return { text: hint.textContent, role: hint.getAttribute('role'), children: hint.childElementCount }
  })()`)
  assert.deepEqual(await bootHint(), { text: preparationMessage, role: 'status', children: 0 })
  mainWindow.webContents.send('eduwork:boot-brand', { ...bootBrand, message: '' })
  await until(async () => (await bootHint()).text === 'Loading plugins…')
  mainWindow.webContents.send('eduwork:boot-brand', { ...bootBrand, message: '正在迁移旧版历史数据…' })
  await until(async () => (await bootHint()).text === '正在迁移旧版历史数据…')
  // BootPage reuses this node when progress becomes a failure report. Branding
  // must survive without replacing official content or injecting extra nodes.
  await evaluate(`{
    const card = document.querySelector('[data-dsh-boot] > div'), wordmark = card.firstElementChild
    const report = document.createElement('div'); report.textContent = 'Failed to load plugins'
    card.replaceChildren(wordmark, report)
  }`)
  assert.equal((await brandStyle()).image, `url("${bootLogo}")`)
  assert.equal(await evaluate(`document.querySelector('[data-dsh-boot] > div').lastElementChild.textContent`), 'Failed to load plugins')
  mainWindow.webContents.send('eduwork:boot-brand', 'Updated Brand')
  await until(async () => (await evaluate(`document.querySelector('[data-dsh-boot] > div > div')?.textContent`)) === 'Updated Brand')
  assert.equal((await brandStyle()).image, `url("${bootLogo}")`)
  assert.equal(await evaluate(`document.querySelector('[data-dsh-boot] > div').lastElementChild.textContent`), 'Failed to load plugins')
  mainWindow.webContents.send('eduwork:boot-brand', { name: 'Without logo', logo: '' })
  await until(async () => (await brandStyle()).image === 'none')
  assert.equal((await brandStyle()).padding, '0px')
  mainWindow.webContents.send('eduwork:boot-brand', { name: 'No remote logo', logo: 'https://invalid.example/logo.png' })
  await until(async () => (await evaluate(`document.querySelector('[data-dsh-boot] > div > div')?.textContent`)) === 'No remote logo')
  assert.equal((await brandStyle()).image, 'none')
  bootBrand = 'Text-only fallback'
  await mainWindow.loadURL('dsh-app://app/index.html')
  await until(async () => (await evaluate(`document.querySelector('[data-dsh-boot] > div > div')?.textContent`)) === 'Text-only fallback')
  assert.equal((await brandStyle()).image, 'none')
  bootBrand = { name: 'Synthetic EduWork', logo: bootLogo }
  await mainWindow.loadURL('dsh-app://app/index.html')
  await until(async () => (await evaluate(`document.querySelector('[data-dsh-boot] > div > div')?.textContent`)) === 'Synthetic EduWork')
  assert.equal((await brandStyle()).image, `url("${bootLogo}")`)
  mainWindow.webContents.debugger.attach('1.3')
  try {
    const themeState = () => evaluate(`({dark:document.body.hasAttribute('data-ds-dark-theme'),scheme:document.documentElement.style.colorScheme})`)
    for (const scheme of ['light', 'dark']) {
      await mainWindow.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })
      await until(async () => (await themeState()).scheme === scheme)
      assert.equal((await themeState()).dark, scheme === 'dark')
    }
    await evaluate(`document.body.removeAttribute('data-ds-dark-theme'); document.documentElement.dataset.dsThemeSource = 'light'`)
    await until(async () => (await themeState()).scheme === '')
    for (const scheme of ['light', 'dark']) {
      await mainWindow.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })
      await tick(); await tick()
      assert.deepEqual(await themeState(), { dark: false, scheme: '' }, 'upstream owns theme after initialization, including an explicit light preference')
    }
    await mainWindow.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-dsh-boot-spinner]')).animationName`), 'none')
    await mainWindow.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-dsh-boot-spinner]')).animationName`), 'fixture-spin')
  } finally { mainWindow.webContents.debugger.detach() }
  results.push('BootPage preparation status is text-only and clears without replacing failure content; system appearance yields to upstream theme; branding and reduced motion survive reload')
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
  assert.deepEqual(visibilityRoles(), expectedVisibilityRoles, 'locale refresh must preserve application visibility commands')
  results.push('application visibility commands match the platform before Host boot and after locale refresh')
  const nativeMenu = () => Menu.getApplicationMenu()
  if (process.platform === 'darwin') {
    assert.ok(nativeMenu().items[0].submenu.items.find(item => item.role === 'hide').label.includes(app.getName()))
  }
  assert.equal(nativeMenu().items.find(item => item.role === 'editmenu').label, '编辑')
  assert.equal(nativeMenu().items.find(item => item.role === 'viewmenu').label, '视图')
  assert.ok(nativeMenu().items[0].submenu.items.some(item => item.label === '检查更新…'))
  assert.equal(nativeMenu().items[0].submenu.items[0].label, `关于 ${app.getName()}`)
  assert.ok(nativeMenu().items.find(item => item.role === 'editmenu').submenu.items.some(item => item.role === 'copy'))
  if (process.platform === 'win32') {
    mainWindow.show(); mainWindow.focus()
    await until(() => mainWindow.isFocused())
    assert.deepEqual(await evaluate(`Array.from(document.querySelector('[data-windows-menu]').shadowRoot.querySelectorAll('button'),element=>element.textContent)`), ['应用', '编辑'])
    await evaluate(`document.documentElement.lang='en'`)
    await until(async () => (await evaluate(`document.querySelector('[data-windows-menu]').shadowRoot.querySelector('button').textContent`)) === 'Application')
    // Document lang only drives the renderer caption; the shell menu follows localeChanged.
    assert.equal(nativeMenu().items.find(item => item.role === 'editmenu').label, '编辑')
    await evaluate(`__DSH_LOCALE__.onChange('en')`)
    await until(() => nativeMenu().items.find(item => item.role === 'editmenu').label === 'Edit')
    await evaluate(`document.body.insertAdjacentHTML('beforeend','<input id="edit-fixture" value="ab">'); const input=document.querySelector('#edit-fixture');input.focus();input.setSelectionRange(1,2);window.editKeys=[];input.addEventListener('keydown',event=>editKeys.push({key:event.key,ctrl:event.ctrlKey}))`)
    const buildMenu = Menu.buildFromTemplate
    let editItems
    Menu.buildFromTemplate = items => ({ popup: options => { editItems = items; options.callback() } })
    try {
      await evaluate(`document.querySelector('[data-windows-menu]').shadowRoot.querySelectorAll('button')[1].click()`)
      await until(() => editItems !== undefined)
    } finally { Menu.buildFromTemplate = buildMenu }
    const commands = editItems.filter(item => item.type !== 'separator')
    assert.deepEqual(commands.map(item => item.label), ['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Delete', 'Select All'])
    assert.equal(commands.find(item => item.label === 'Copy').accelerator, 'Ctrl+C')
    commands.find(item => item.label === 'Delete').click()
    await until(async () => (await evaluate('editKeys.length')) === 1)
    assert.deepEqual(await evaluate('editKeys[0]'), { key: 'Delete', ctrl: false })
    assert.equal(await evaluate(`document.querySelector('#edit-fixture').value`), 'a')
    results.push('sandboxed Windows caption menu mounts and responds to language changes')
  }
  await evaluate(`document.documentElement.lang='en'; __DSH_LOCALE__.onChange('en')`)
  await until(() => nativeMenu().items.find(item => item.role === 'viewmenu').label === 'View')
  assert.ok(nativeMenu().items[0].submenu.items.some(item => item.label === 'Check for Updates…'))
  assert.equal(nativeMenu().items.find(item => item.role === 'editmenu').label, 'Edit')
  assert.equal(nativeMenu().items[0].submenu.items[0].label, `About ${app.getName()}`)
  // Exercise the real bridge and renderer event with a synthetic guide route.
  // An absent or failed route must leave the existing application menu intact.
  const applicationLabels = () => nativeMenu().items[0].submenu.items.map(item => item.label)
  const withoutGuide = applicationLabels()
  let guideStatus = 404, guideFetchError = false, guideRequests = 0
  host.fetch = async request => {
    guideRequests++
    assert.equal(request.method, 'HEAD')
    assert.equal(request.url, 'app://app/eduwork-user-guide/')
    if (guideFetchError) throw new Error('synthetic guide route failure')
    return new Response(null, { status: guideStatus })
  }
  assert.equal(await bridge.probeUserGuide(), false)
  assert.deepEqual(applicationLabels(), withoutGuide)
  guideStatus = 200
  assert.equal(await bridge.probeUserGuide(), true)
  const guideItem = nativeMenu().items[0].submenu.items.find(item => item.label === 'User Guide')
  assert.ok(guideItem)
  assert.equal(applicationLabels().indexOf('User Guide') + 1, applicationLabels().indexOf('Check for Updates…'))
  await evaluate(`window.guideOpened = 0; window.addEventListener('eduwork:open-user-guide', () => window.guideOpened++)`)
  mainWindow.hide()
  guideItem.click()
  await until(async () => (await evaluate('window.guideOpened')) === 1)
  assert.equal(mainWindow.isVisible(), true)
  guideFetchError = true
  assert.equal(await bridge.probeUserGuide(), false)
  assert.deepEqual(applicationLabels(), withoutGuide)
  assert.equal(guideRequests, 3)
  delete host.fetch
  results.push('optional guide route controls the native menu; click shows the window and dispatches its fixed renderer event; route failures preserve the existing menu')
  if (process.platform !== 'darwin') {
    assert.equal(recoveryWindow.isMenuBarVisible(), false)
    recoveryWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Alt' })
    recoveryWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Alt' })
    assert.equal(recoveryWindow.isMenuBarVisible(), false)
  }
  recoveryWindow.destroy()
  results.push('recovery stays menu-free through locale refresh; native Edit/View and update labels follow locale')
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
  assert.equal(denied, true)
  const deniedUpdates = await foreign.webContents.executeJavaScript(`Promise.all([
    dshDesktop.updates.status().then(()=>false,()=>true),
    dshDesktop.updates.open().then(()=>false,()=>true),
  ])`)
  assert.deepEqual(deniedUpdates, [true, true]); foreign.destroy()
  const nonApp = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true } })
  await nonApp.loadURL('about:blank')
  assert.equal(await nonApp.webContents.executeJavaScript(`typeof dshDesktop.updates`), 'undefined'); nonApp.destroy()
  results.push('same-origin foreign window cannot read/open updates; non-app main frame has no update API')
  if (await evaluate(`typeof dshDesktop.fileDrag === 'object'`)) {
    // Exercise the actual preload and native handlers without starting an OS
    // drag gesture or writing to the user's Downloads directory.
    const saved = await evaluate(`dshDesktop.fileActions.save({url:'data:text/plain,synthetic%20download',name:'fixture.txt',mediaType:'text/plain',mode:'download'})`)
    assert.equal(saved.status, 'saved')
    assert.equal(await readFile(saved.path, 'utf8'), 'synthetic download')
    assert.equal(await evaluate(`dshDesktop.fileActions.readClipboardImage(${JSON.stringify(hostOrigin+'/private')}).then(()=>false,()=>true)`), true)
    assert.equal(hostRequests, 0)
    const prepared = await evaluate(`dshDesktop.fileDrag.prepare({kind:'resource',address:'fixture:borrowed',name:'borrowed.txt',mediaType:'text/plain'},'resource-1')`)
    assert.equal(typeof prepared, 'string')
    const deniedResource = await evaluate(`dshDesktop.fileDrag.prepare({kind:'resource',address:'fixture:denied',name:'borrowed.txt',mediaType:'text/plain'},'resource-2')`)
    assert.equal(deniedResource, undefined)
    await evaluate(`dshDesktop.fileDrag.release(${JSON.stringify(prepared)})`)
    await bridge.disposeFileDrags()
    assert.deepEqual(await readFile(borrowedPath), borrowedBytes, 'borrowed user files survive drag cleanup')
    results.push('native file save, Host image-read rejection, authorized resource preparation and borrowed-file cleanup')
    limitations.push('OS drag-and-drop gestures into external applications require separate manual platform acceptance')
  }
  // A same-window reload starts a new document; the main process must rebind
  // instead of keeping the old document's delivery state.
  updateState = 'checking'
  await mainWindow.loadURL('dsh-app://app/index.html')
  await until(async () => (await evaluate(`typeof dshDesktop?.updates?.status`)) === 'function')
  const reloadedUpdates = await evaluate(`(async () => {
    window.updateEvents = []
    dshDesktop.updates.subscribe(state => updateEvents.push(state))
    return dshDesktop.updates.status()
  })()`)
  assert.deepEqual(reloadedUpdates, { phase: 'checking' })
  updateState = 'available'
  await evaluate('updateEvents.length = 0')
  await until(async () => (await evaluate('updateEvents.at(-1)?.phase')) === 'available')
  assert.deepEqual(await evaluate('updateEvents.at(-1)'), { phase: 'available', version: '0.4.11' })
  results.push('reload rebinds update status and subscription for the new document')
  if (process.env.EDUWORK_PROBE_OFFICIAL_UI && process.env.EDUWORK_PROBE_WORKBENCH_UPDATES) {
    const officialScript = await readFile(process.env.EDUWORK_PROBE_OFFICIAL_UI, 'utf8')
    const workbenchScript = await readFile(process.env.EDUWORK_PROBE_WORKBENCH_UPDATES, 'utf8')
    const rawAvailable = { shell: 'electron', update: { enabled: true, state: 'available', latestVersion: '0.4.11' },
      contentUpdate: { enabled: false, state: 'current' } }
    await evaluate(officialScript)
    await evaluate(workbenchScript)
    await evaluate(`(() => {
      const U = window.OfficialUpdateUI, W = window.WorkbenchUpdates
      const translate = dict => (key, params) => Object.entries(params || {}).reduce((message, [name, value]) => message.replaceAll('{' + name + '}', String(value)), dict[key] || key)
      window.__integrationRawStatus = ${JSON.stringify(rawAvailable)}
      const source = new U.DesktopUpdateSource(dshDesktop.updates)
      const t = translate(U.zh)
      const officialHost = document.createElement('div'); officialHost.id = 'official-update-host'; document.body.prepend(officialHost)
      const officialRoot = U.createRoot(officialHost)
      function App() {
        const view = U.useSyncExternalStore(source.store.subscribe, source.store.getSnapshot)
        return U.React.createElement(U.DesktopUpdateIndicator, { wide: true, hidden: false, t, view, onOpen: () => source.open() })
      }
      officialRoot.render(U.React.createElement(App))
      const controller = W.createUpdateController(async action => window.__integrationRawStatus)
      const workbenchHost = document.createElement('div'); workbenchHost.id = 'workbench-update-host'; document.body.append(workbenchHost)
      const workbenchRoot = W.createRoot(workbenchHost)
      workbenchRoot.render(W.React.createElement(W.UpdateFooter, { controller, wide: true }))
      window.integration = { source, controller, officialRoot, workbenchRoot,
        setRaw: async raw => { window.__integrationRawStatus = raw; await controller.run('check-updates') } }
    })()`)
    const officialLabel = () => evaluate(`document.querySelector('#official-update-host button')?.getAttribute('aria-label')`)
    const dialogCount = () => evaluate(`document.querySelectorAll('[role="dialog"][aria-label="更新"]').length`)
    const dialogText = () => evaluate(`document.querySelector('[role="dialog"][aria-label="更新"]')?.textContent || ''`)
    const setRaw = raw => evaluate(`window.integration.setRaw(${JSON.stringify(raw)})`)
    const clickOfficial = async label => {
      await until(async () => (await officialLabel()) === label)
      await evaluate(`(() => { const button = document.querySelector('#official-update-host button'); button.focus(); button.click() })()`)
      await until(async () => (await dialogCount()) === 1)
    }
    const closeByEscape = async () => {
      await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
      await until(async () => (await dialogCount()) === 0)
    }
    const waitForController = async () => {
      await until(async () => (await evaluate(`window.integration.controller.getSnapshot().working`)) === '')
    }
    await until(async () => (await evaluate(`Boolean(window.integration.controller.getSnapshot().status)`)))
    await clickOfficial('新版本')
    await waitForController()
    assert.match(await dialogText(), /下载更新/)
    assert.equal(await evaluate(`document.activeElement?.getAttribute('aria-label')`), '新版本')
    await closeByEscape()
    assert.equal(await evaluate(`document.activeElement?.getAttribute('aria-label')`), '新版本')
    await clickOfficial('新版本')
    assert.equal(await dialogCount(), 1)
    await closeByEscape()
    updateState = 'error'
    await setRaw({ shell: 'electron', update: { enabled: true, state: 'error', error: 'synthetic download failure' },
      contentUpdate: { enabled: false, state: 'current' } })
    await clickOfficial('重试更新')
    await waitForController()
    assert.match(await dialogText(), /synthetic download failure/)
    await closeByEscape()
    updateState = 'ready'
    await setRaw({ shell: 'electron', update: { enabled: true, state: 'ready', latestVersion: '0.4.11' },
      contentUpdate: { enabled: false, state: 'current' } })
    await clickOfficial('安装并重启')
    await waitForController()
    assert.match(await dialogText(), /立即重启更新/)
    await closeByEscape()
    await evaluate(`window.integration.controller.dispose(); window.integration.source.dispose(); window.integration.officialRoot.unmount(); window.integration.workbenchRoot.unmount()`)
    results.push('official indicator click opens the compiled workbench panel through real preload/IPC')
  }
  server = createServer((req, res) => {
    if (req.url === '/never') return
    res.setHeader('content-type', 'text/html'); res.setHeader('X-Frame-Options', 'SAMEORIGIN'); res.setHeader('Content-Security-Policy', "frame-ancestors 'self'")
    res.end(req.url === '/stalled' ? '<!doctype html><title>stalled fixture</title><img src="/never">'
      : '<!doctype html><html><title>protected fixture</title><body>Native browser works</body></html>')
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
  // The page sets no background: the guest paints white, as in Chrome, rather than see-through.
  assert.deepEqual([...(await guest.capturePage({ x: 0, y: 0, width: 1, height: 1 })).toBitmap().subarray(0, 4)], [255, 255, 255, 255])
  results.push('leased native guest opens a CSP/XFO-protected page, opaque and without desktop privileges')
  // The Sidebar reports any rejected load as a failed page.
  const load = url => evaluate(`fixtureGuest.loadURL(${JSON.stringify(url)}).then(() => 'ended', () => 'failed')`)
  const stalled = load(`${protectedURL}stalled`)
  await until(() => guest.getTitle() === 'stalled fixture')
  assert.deepEqual(await Promise.all([stalled, load(protectedURL)]), ['ended', 'ended'])
  results.push('leaving a page that never finishes loading fails neither its load nor the next')
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
  let inspections = 0, cleaned = 0, focused = 0
  const quitOptions = { locale: () => resolveDesktopLocale('zh'), platform: 'win32', icon: {},
    inspect: async () => { inspections++; return { activeTasks: false, scheduledTasks: true } },
    show: async options => {
      assert.equal(options.type, 'none'); assert.equal(options.icon, quitOptions.icon)
      assert.deepEqual(options.buttons, ['退出', '取消'])
      assert.match(options.detail, /定时任务/)
      assert.equal(options.defaultId, 0); assert.equal(options.cancelId, 1)
      return { response: 1 }
    }, focus: () => { focused++ } }
  const guard = new DesktopQuitConfirmation(quitOptions)
  const exit = new DesktopExit({ confirm: () => guard.confirm(), close: async () => { cleaned++ }, quit() {}, relaunch: assert.fail, failed: assert.fail })
  const firstQuit = exit.request()
  assert.equal(exit.request(), firstQuit)
  await firstQuit; assert.equal(cleaned, 0)
  quitOptions.show = async () => ({ response: 0 })
  await exit.request(); assert.equal(cleaned, 1); assert.equal(inspections, 2)
  quitOptions.inspect = () => undefined
  quitOptions.show = assert.fail
  assert.equal(await guard.confirm(), true)
  quitOptions.inspect = async () => ({ activeTasks: false, scheduledTasks: false })
  assert.equal(await guard.confirm(), true)
  const warnings = [], warn = console.warn
  console.warn = (...args) => warnings.push(args)
  try {
    quitOptions.inspect = async () => { throw Error('synthetic private value') }
    quitOptions.show = async prompt => { assert.match(prompt.detail, /中断/); return { response: 1 } }
    assert.equal(await guard.confirm(), false)
  } finally { console.warn = warn }
  assert.deepEqual(warnings, [['desktop quit: task inspection unavailable']])
  const pendingAnswer = Promise.withResolvers(), opened = Promise.withResolvers()
  quitOptions.inspect = async () => ({ activeTasks: true, scheduledTasks: false })
  quitOptions.show = () => { opened.resolve(); return pendingAnswer.promise }
  const pendingQuit = guard.confirm()
  assert.equal(guard.confirm(), pendingQuit)
  await opened.promise; guard.dispose(); pendingAnswer.resolve({ response: 0 })
  assert.equal(await pendingQuit, false); assert.equal(await guard.confirm(), false); assert.equal(focused, 1)
  results.push('production upstream quit confirmation retains cancellation, idle checks, deduplication, disposal and safe diagnostics')
  let recoveryCalls = 0, recoveryStops = 0
  const recovery = new DesktopFatalRecovery({ messages: () => resolveDesktopLocale('zh').messages,
    show: async options => { assert.equal(options.buttons.length, 2); recoveryCalls++; return { response: 0 } },
    stop: async () => { recoveryStops++ }, disablePlugins: async () => { throw new Error('must not disable distribution') },
    exit: () => {}, restart: () => {}, writeReport: async () => undefined })
  await Promise.all([recovery.report(new Error('synthetic'), 'host'), recovery.report(new Error('duplicate'), 'renderer')])
  assert.equal(recoveryCalls, 1); assert.equal(recoveryStops, 1)
  if (await evaluate(`typeof dshDesktop.fileActions === 'object'`)) {
    let openedReport, reportDialogs = 0
    const diagnostics = new DesktopFatalRecovery({ messages: () => resolveDesktopLocale('zh').messages,
      show: async options => { assert.equal(options.buttons.length, 3); return { response: reportDialogs++ === 0 ? 2 : 0 } },
      stop: async () => {}, disablePlugins: assert.fail, exit() {}, restart: assert.fail,
      writeReport: async () => borrowedPath, revealReport: async path => { openedReport = path } })
    await diagnostics.report(new Error('synthetic report'), 'host')
    assert.equal(openedReport, borrowedPath); assert.equal(reportDialogs, 2)
    results.push('official diagnostic-report action retains exit/restart without disabling distribution plugins')
  }
  results.push('official Host failure cleanup, cancellable active/scheduled-task quit and deduplicated recovery')
  updateObserver.dispose()
  assert.equal(await evaluate(`dshDesktop.updates.status().then(()=>false,()=>true)`), true)
  results.push('disposed update observation stops serving status')
  finish()
}).catch(finish)
