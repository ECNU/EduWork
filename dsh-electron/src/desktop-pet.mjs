// The desktop pet window. Pet behavior lives in the product's pet plugin; the
// shell owns only this window: always on top, never focused, click-through
// outside the pet, placed and remembered here. The page runs sandboxed in its
// own session and talks to this module through a fixed preload API.
import { BaseWindow, BrowserWindow, Menu, ipcMain, powerMonitor, screen, session } from 'electron'
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, sep } from 'node:path'
import { PET_SCHEME, petGeometry, petStatus, placePet, restorePetPosition, savedPetPosition, untuckPetPosition, validatePetRequest } from './desktop-pet-core.mjs'

const PAGE = `${PET_SCHEME}://pet/page/pet.html`
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' }
const PAGE_TYPES = ['.html', '.js', '.css'], SKIN_TYPES = ['.json', '.svg', '.png', '.webp']
const AWAY_SECONDS = 300
const inside = (root, path) => { const rel = relative(root, path); return rel !== '' && !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep) }

/**
 * @param {object} options
 * @param {string} options.packageRoot installed @eduwork/dsh-desktop-pet in the product
 * @param {string} options.preload preload-pet.cjs
 * @param {string} options.stateFile remembered position
 * @param {(window: BrowserWindow) => void} [options.preventActivation] macOS: keep clicks from activating the app
 * @param {(key: string) => void} options.open open a pending notification item
 * @param {() => object[]} options.contextMenu right-click menu template
 * @param {() => void} options.changed visibility changed (tray label)
 */
export function createDesktopPet({ packageRoot, preload, stateFile, locale, platform = process.platform, preventActivation, open, contextMenu, changed, log }) {
  const mac = platform === 'darwin', partition = session.fromPartition('eduwork-pet')
  let settings = null, started = false, failed = false, closed = false
  let window, built = '', ready = false, geometry, placed, skinRoot, status = null, away = false, locked = false
  let pointerTimer, dragTimer, presenceTimer, topmostTimer, interactive = false
  let saved = null
  try { saved = JSON.parse(readFileSync(stateFile, 'utf8')) } catch { /* First run or an unreadable file: use the default corner. */ }

  partition.protocol.handle(PET_SCHEME, async request => {
    const url = new URL(request.url), path = decodeURIComponent(url.pathname), type = extname(path).toLowerCase()
    // Only the page, its two shared modules and the selected skin are readable.
    const [root, rest, types] = path.startsWith('/skin/') ? [skinRoot, path.slice(6), SKIN_TYPES]
      : path.startsWith('/page/') || ['/skin.js', '/pet-state.js'].includes(path) ? [join(packageRoot, 'lib'), path.slice(1), PAGE_TYPES] : []
    const file = root && join(root, rest)
    if (url.host !== 'pet' || request.method !== 'GET' || !file || !types.includes(type) || !inside(root, file)) return new Response(null, { status: 404 })
    try { return new Response(await readFile(file), { headers: { 'content-type': MIME[type], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } }) }
    catch { return new Response(null, { status: 404 }) }
  })
  const send = (channel, value) => { if (window && ready) window.webContents.send(`eduwork-pet:${channel}`, value) }
  const displays = () => screen.getAllDisplays()

  function move(next) {
    placed = next
    window.setPosition(placed.x, placed.y)
    send('placement', { tucked: placed.tucked, bubble: placed.bubble })
  }
  const place = (target, options) => move(placePet(target, geometry, displays(), options))
  function remember() {
    saved = savedPetPosition(placed, displays())
    void mkdir(dirname(stateFile), { recursive: true }).then(() => writeFile(stateFile, JSON.stringify(saved))).catch(error => log(`position not saved: ${error.message}`))
  }
  const restore = () => move(restorePetPosition(saved, geometry, displays(), screen.getPrimaryDisplay()))

  // Forwarded mouse moves can miss a quick first click; the cursor is also read
  // here, every 50 ms near the pet and every 500 ms otherwise.
  let wasInside = false
  function poll() {
    const cursor = screen.getCursorScreenPoint(), bounds = window.getBounds()
    const near = cursor.x >= bounds.x - 48 && cursor.x < bounds.x + bounds.width + 48 && cursor.y >= bounds.y - 48 && cursor.y < bounds.y + bounds.height + 48
    const now = cursor.x >= bounds.x && cursor.x < bounds.x + bounds.width && cursor.y >= bounds.y && cursor.y < bounds.y + bounds.height
    if (!dragTimer && (now || wasInside)) send('pointer', { inside: now, x: cursor.x - bounds.x, y: cursor.y - bounds.y })
    wasInside = now
    pointerTimer = setTimeout(poll, near ? 50 : 500)
  }
  function presence() {
    clearTimeout(presenceTimer)
    const next = locked || powerMonitor.getSystemIdleTime() >= AWAY_SECONDS
    if (next !== away) { away = next; send('presence', { away }) }
    // Poll quickly while away so the pet wakes up as soon as the user returns.
    presenceTimer = setTimeout(presence, away ? 2_000 : 30_000)
  }
  const lock = () => { locked = true; presence() }, unlock = () => { locked = false; presence() }
  const displaysChanged = () => { if (window && ready) restore() }

  function create() {
    geometry = petGeometry(settings.frame, settings.size)
    skinRoot = join(packageRoot, 'skins', settings.skin)
    ready = false
    window = new BrowserWindow({ width: geometry.window.width, height: geometry.window.height, show: false, frame: false, transparent: true,
      backgroundColor: '#00000000', resizable: false, minimizable: false, maximizable: false, fullscreenable: false, hasShadow: false,
      skipTaskbar: true, alwaysOnTop: true, focusable: false,
      // A panel is the only window type shown above other apps' full-screen spaces.
      // The empty bubble margin may reach under the menu bar; without
      // enableLargerThanScreen macOS pushes a frameless window below it.
      ...mac ? { type: 'panel', hiddenInMissionControl: true, enableLargerThanScreen: true } : {},
      webPreferences: { preload, partition: 'eduwork-pet', sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false, devTools: false } })
    const own = window
    preventActivation?.(own)
    own.setAlwaysOnTop(true, mac ? 'floating' : 'screen-saver')
    own.setIgnoreMouseEvents(true, { forward: true })
    interactive = false
    own.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    own.webContents.on('will-navigate', event => event.preventDefault())
    own.webContents.on('render-process-gone', (_event, details) => { if (window === own) fail(`page exited: ${details.reason}`) })
    own.webContents.once('did-finish-load', () => own.webContents.send('eduwork-pet:init', {
      layout: geometry, settings: { bubbles: settings.bubbles, sleep: settings.sleep }, locale }))
    own.on('closed', () => { if (window === own) teardown() })
    void own.loadURL(PAGE).catch(error => { if (window === own) fail(`page did not load: ${error.message}`) })
  }
  // The page reports its first frame; show only then, without taking focus.
  function shown() {
    ready = true
    restore()
    window.showInactive()
    // macOS adjusts an off-screen position when showing; apply it again.
    window.setPosition(placed.x, placed.y)
    send('presence', { away })
    if (status) send('status', status)
    poll()
    powerMonitor.on('lock-screen', lock); powerMonitor.on('unlock-screen', unlock)
    presence()
    for (const name of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(name, displaysChanged)
    // Other always-on-top windows can cover the pet on Windows.
    if (platform === 'win32') topmostTimer = setInterval(() => window.moveTop(), 10_000)
  }
  function teardown() {
    clearTimeout(pointerTimer); clearInterval(dragTimer); clearTimeout(presenceTimer); clearInterval(topmostTimer)
    dragTimer = undefined
    powerMonitor.removeListener('lock-screen', lock); powerMonitor.removeListener('unlock-screen', unlock)
    for (const name of ['display-added', 'display-removed', 'display-metrics-changed']) screen.removeListener(name, displaysChanged)
    window = undefined
    ready = false
  }
  function destroy() {
    const own = window
    if (!own) return
    teardown()
    own.destroy()
  }
  function fail(message) {
    log(message)
    destroy()
    // Stay closed until the settings change or the tray shows it again; never retry in a loop.
    failed = true
    changed()
  }
  function sync() {
    const wanted = started && !closed && !failed && settings?.enabled === true
    if (!wanted) { destroy(); return }
    // Skin and size change the window itself; other settings go to the page.
    const shape = `${settings.skin}:${settings.size}:${settings.frame.width}x${settings.frame.height}`
    if (window && built !== shape) destroy()
    if (window) { send('settings', { bubbles: settings.bubbles, sleep: settings.sleep }); return }
    built = shape
    create()
  }

  const owned = event => window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === PAGE
  const handlers = {
    ready() { if (!ready) shown() },
    failed(message) { fail(`page failed: ${String(message).slice(0, 300)}`) },
    interactive(value) {
      if (!ready || dragTimer || typeof value !== 'boolean' || value === interactive) return
      interactive = value
      window.setIgnoreMouseEvents(!value, { forward: true })
    },
    'drag-start'(offset) {
      if (!ready || dragTimer || !Number.isFinite(offset?.x) || !Number.isFinite(offset?.y)) return
      // Real pointers report fractional DIP; window positions are integers.
      const grab = { x: Math.round(offset.x), y: Math.round(offset.y) }
      let last
      dragTimer = setInterval(() => {
        const cursor = screen.getCursorScreenPoint(), x = Math.round(cursor.x) - grab.x, y = Math.round(cursor.y) - grab.y
        if (last?.x === x && last?.y === y) return
        if (last && x !== last.x) send('drag-direction', Math.sign(x - last.x))
        last = { x, y }
        window.setPosition(x, y)
      }, 16)
    },
    'drag-end'() {
      if (!dragTimer) return
      clearInterval(dragTimer)
      dragTimer = undefined
      const [x, y] = window.getPosition()
      place({ x, y })
      remember()
    },
    untuck() {
      if (!ready || !placed.tucked) return
      move(untuckPetPosition(placed, geometry, displays()))
      remember()
    },
    open(key) { if (ready && typeof key === 'string' && key.length <= 600) open(key) },
    menu() {
      if (!ready) return
      const menu = Menu.buildFromTemplate(contextMenu())
      if (platform !== 'win32') return menu.popup({ window })
      // Windows closes a popup menu on an outside click only while its window is active. A
      // short-lived owner takes activation and returns it to the previous app when destroyed;
      // destroying it inside the callback crashes Electron after an outside click.
      const { x, y } = screen.getCursorScreenPoint()
      const owner = new BaseWindow({ x, y, width: 1, height: 1, frame: false, transparent: true, skipTaskbar: true, show: false })
      owner.show(); owner.focus()
      menu.popup({ window: owner, callback: () => setTimeout(() => owner.destroy()) })
    },
  }
  const listeners = Object.entries(handlers).map(([name, handle]) => {
    const listener = (event, value) => { if (owned(event)) handle(value) }
    ipcMain.on(`eduwork-pet:${name}`, listener)
    return [`eduwork-pet:${name}`, listener]
  })

  return {
    /** Authenticated Host requests from the pet plugin, through desktop-services. */
    async handle(body) {
      body = validatePetRequest(body)
      if (body.action === 'reset-position') {
        saved = null
        if (window && ready) { restore(); remember() }
        return { supported: true }
      }
      if (body.enabled && !await stat(join(packageRoot, 'skins', body.skin, 'skin.json')).then(info => info.isFile(), () => false)) throw new Error('Unknown pet skin')
      settings = { ...body }
      failed = false
      sync()
      changed()
      return { supported: true, shown: Boolean(window) }
    },
    update(notifications) {
      status = petStatus(notifications)
      send('status', status)
    },
    /** Called once the main window is ready; earlier requests are kept. */
    start() { started = true; sync() },
    /** Whether the pet plugin is running and has told the shell its settings. */
    get available() { return settings !== null },
    get enabled() { return settings?.enabled === true },
    get shown() { return settings?.enabled === true && !failed },
    /** Show again after a page failure; the enabled setting itself stays with the plugin. */
    retry() { failed = false; sync(); changed() },
    owns(other) { return Boolean(window) && other === window },
    // Both the quit flow and the main window's `closed` event call this.
    close() {
      if (closed) return
      closed = true
      destroy()
      for (const [channel, listener] of listeners) ipcMain.removeListener(channel, listener)
      partition.protocol.unhandle(PET_SCHEME)
    },
  }
}
