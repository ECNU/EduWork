import { EventEmitter } from 'node:events'
import { ElectronBrowserRuntime } from './browser-runtime.mjs'

export const BROWSER_PANEL_CHANNEL = 'eduwork:browser-panel'
export const BROWSER_PANEL_CHANGED = 'eduwork:browser-panel-changed'
const validOwner = value => typeof value === 'string' && value.length > 0 && value.length <= 200
const httpURL = value => {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('Unsupported browser URL')
  return url.href
}

// Native presentation is owned by the shell; only the main application frame
// receives metadata and typed commands. CDP credentials stay Host-only.
export class BrowserPanel {
  constructor({ BrowserWindow, WebContentsView, ipcMain, getWindow, openExternal }) {
    Object.assign(this, { BrowserWindow, WebContentsView, ipcMain, getWindow, openExternal })
    this.pages = new Map()
    this.runtimes = new Map()
    this.activeOwner = null
    this.attached = null
    this.lease = null
    this.closed = false
    this.revision = 0
    ipcMain.handle(BROWSER_PANEL_CHANNEL, (event, request) => {
      const win = getWindow()
      if (!win || win.isDestroyed() || event.sender !== win.webContents
        || event.senderFrame !== win.webContents.mainFrame) throw Error('Rejected browser panel sender')
      const url = new URL(event.senderFrame.url)
      if (url.protocol !== 'dsh-app:' || url.host !== 'app') throw Error('Rejected browser panel origin')
      return this.command(request)
    })
  }
  snapshot(owner) {
    const surface = this.pages.get(owner)
    if (!surface || surface.isDestroyed()) return null
    const web = surface.webContents
    return { title: web.getTitle(), url: web.getURL(), revision: surface.revision,
      loading: web.isLoading(), back: web.navigationHistory.canGoBack(), forward: web.navigationHistory.canGoForward() }
  }
  changed(owner) {
    const win = this.getWindow()
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(BROWSER_PANEL_CHANGED, { owner, state: this.snapshot(owner) })
    }
  }
  runtimeFor(owner) {
    if (this.closed || !validOwner(owner)) throw Error('Browser session unavailable')
    let runtime = this.runtimes.get(owner)
    if (!runtime || runtime.closed) {
      runtime = new ElectronBrowserRuntime({ BrowserWindow: this.BrowserWindow, panel: this, owner })
      this.runtimes.set(owner, runtime)
    }
    return runtime
  }
  create({ partition, owner, mode }) {
    if (this.closed || !validOwner(owner)) throw Error('Browser session unavailable')
    if (this.pages.has(owner)) throw Error('A managed page already exists for this session')
    const view = new this.WebContentsView({ webPreferences: {
      partition, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, plugins: true,
    } })
    const surface = new EventEmitter()
    const web = view.webContents
    Object.assign(surface, { webContents: web, view, owner, revision: mode === 'visible' ? ++this.revision : 0,
      isDestroyed: () => web.isDestroyed(),
      loadURL: url => web.loadURL(url),
      focus: () => { if (this.attached === surface) web.focus() },
      destroy: () => { this.detach(surface); if (!web.isDestroyed()) web.close({ waitForBeforeUnload: false }) },
    })
    for (const event of ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated']) {
      web.on(event, () => this.changed(owner))
    }
    web.once('destroyed', () => {
      this.detach(surface)
      if (this.pages.get(owner) === surface) this.pages.delete(owner)
      surface.emit('closed')
      this.changed(owner)
    })
    this.pages.set(owner, surface)
    this.changed(owner)
    return surface
  }
  detach(surface = this.attached) {
    if (!surface || surface !== this.attached) return
    const win = this.getWindow()
    if (win && !win.isDestroyed()) win.contentView.removeChildView(surface.view)
    this.attached = null
    this.lease = null
  }
  present(surface, visible) {
    if (visible) surface.revision = ++this.revision
    else this.detach(surface)
    this.changed(surface.owner)
  }
  async openLink(url) {
    const owner = this.activeOwner
    if (!validOwner(owner)) throw Error('Open a conversation before browsing')
    const target = httpURL(url)
    await this.command({ action: 'open', owner, url: target, reveal: true })
  }
  async command(request) {
    if (this.closed || !request || typeof request !== 'object') throw Error('Browser panel unavailable')
    const { action, owner, bounds, url, lease } = request
    if (action === 'capabilities') return { embeddedBrowser: true }
    if (action === 'select') {
      if (owner !== null && !validOwner(owner)) throw Error('Invalid browser owner')
      if (owner !== this.activeOwner) this.detach()
      this.activeOwner = owner
      return this.snapshot(owner)
    }
    if (!validOwner(owner)) throw Error('Invalid browser owner')
    if (action === 'state') return this.snapshot(owner)
    if (action === 'close') {
      this.pages.get(owner)?.destroy()
      return
    }
    // A stale tab effect cannot hide the view now owned by another pane.
    if (action === 'hide') {
      if (this.attached?.owner === owner && this.lease === lease) this.detach()
      return
    }
    if (owner !== this.activeOwner) throw Error('Browser session is not active')
    if (action === 'external') {
      if (!this.openExternal) throw Error('External browser unavailable')
      return this.openExternal(httpURL(url ?? this.pages.get(owner)?.webContents.getURL()))
    }
    if (action === 'open') {
      const target = httpURL(url), runtime = this.runtimeFor(owner)
      let surface = this.pages.get(owner)
      if (!surface || surface.isDestroyed()) surface = runtime.get(await runtime.create({ purpose: 'managed', mode: 'background' }))
      if (request.reveal === true) this.present(surface, true)
      await surface.webContents.loadURL(target)
      return this.snapshot(owner)
    }
    const surface = this.pages.get(owner)
    if (!surface || surface.isDestroyed()) throw Error('No browser page in this session')
    const web = surface.webContents
    if (action === 'bounds') {
      if (typeof lease !== 'string' || lease.length > 200) throw Error('Invalid browser presentation lease')
      const win = this.getWindow()
      if (!win || win.isDestroyed()) return
      const size = win.getContentSize()
      const scale = win.webContents.getZoomFactor?.() ?? 1
      if (!bounds || !['x','y','width','height'].every(key => Number.isFinite(bounds[key]))) throw Error('Invalid browser bounds')
      const x = Math.min(size[0], Math.max(0, Math.round(bounds.x * scale))), y = Math.min(size[1], Math.max(0, Math.round(bounds.y * scale)))
      const width = Math.max(0, Math.min(Math.round(bounds.width * scale), size[0] - x))
      const height = Math.max(0, Math.min(Math.round(bounds.height * scale), size[1] - y))
      if (width < 20 || height < 20) { this.detach(surface); return }
      if (this.attached !== surface) { this.detach(); win.contentView.addChildView(surface.view); this.attached = surface }
      this.lease = lease
      surface.view.setBounds({ x, y, width, height })
      return
    }
    if (action === 'navigate') return web.loadURL(httpURL(url))
    if (action === 'back') { if (web.navigationHistory.canGoBack()) web.navigationHistory.goBack(); return }
    if (action === 'forward') { if (web.navigationHistory.canGoForward()) web.navigationHistory.goForward(); return }
    if (action === 'reload') { web.reload(); return }
    if (action === 'stop') { web.stop(); return }
    throw Error('Unsupported browser panel action')
  }
  close() {
    if (this.closed) return
    this.closed = true
    this.detach()
    for (const runtime of this.runtimes.values()) runtime.close()
    this.runtimes.clear()
    for (const surface of this.pages.values()) surface.destroy()
    this.pages.clear()
    this.ipcMain.removeHandler(BROWSER_PANEL_CHANNEL)
  }
}
