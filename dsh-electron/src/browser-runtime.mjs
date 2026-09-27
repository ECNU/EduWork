// Browser surfaces belong to the shell. Remote pages never receive a preload,
// Node integration, or the application's session partition.
export class ElectronBrowserRuntime {
  constructor({ BrowserWindow, panel, owner }) {
    Object.assign(this, { panel, owner })
    this.BrowserWindow = BrowserWindow
    this.windows = new Map()
    this.sessions = new Set()
    this.pending = new Set()
    this.closed = false
    this.preventDownload = event => event.preventDefault()
  }
  async create({ mode = 'background', purpose = 'managed', partition } = {}) {
    if (this.closed) throw Error('Browser runtime is closed')
    if (!['background', 'visible'].includes(mode) || !['managed', 'render'].includes(purpose)) throw Error('Invalid browser surface')
    const window = purpose === 'managed' && this.panel && this.owner
      ? this.panel.create({ partition: partition ?? 'persist:eduwork-managed-browser', owner: this.owner, mode })
      : new this.BrowserWindow({ width: 1440, height: 960, show: mode === 'visible',
      webPreferences: { partition: partition ?? (purpose === 'managed' ? 'persist:eduwork-managed-browser' : 'eduwork-render'),
        sandbox: true, contextIsolation: true, nodeIntegration: false,
        backgroundThrottling: false, offscreen: mode === 'background' } })
    window.removeMenu?.()
    this.pending.add(window)
    window.on('closed', () => this.pending.delete(window))
    const web = window.webContents
    if (!this.sessions.has(web.session)) {
      web.session.setPermissionRequestHandler((_web, _permission, callback) => callback(false))
      web.session.setPermissionCheckHandler(() => false)
      web.session.on('will-download', this.preventDownload)
      this.sessions.add(web.session)
    }
    const navigation = (event, url) => {
      if (!/^https?:\/\//iu.test(url) && url !== 'about:blank') event.preventDefault()
    }
    web.on('will-navigate', navigation)
    web.on('will-redirect', navigation)
    web.setWindowOpenHandler(() => ({ action: 'deny' }))
    try {
      await window.loadURL('about:blank')
      web.debugger.attach('1.3')
      const { targetInfo } = await web.debugger.sendCommand('Target.getTargetInfo')
      web.debugger.detach()
      this.windows.set(targetInfo.targetId, window)
      this.pending.delete(window)
      window.on('closed', () => this.windows.delete(targetInfo.targetId))
      return targetInfo.targetId
    } catch (error) {
      if (!window.isDestroyed()) window.destroy()
      throw error
    }
  }
  present(id, visible) {
    const surface = this.get(id)
    if (!surface.view || !this.panel) throw Error('Embedded browser unavailable')
    this.panel.present(surface, visible)
  }
  get(id) {
    const window = this.windows.get(id)
    if (!window || window.isDestroyed()) throw Error('Unknown browser surface')
    return window
  }
  closeTarget(id) {
    const window = this.windows.get(id)
    if (!window) return false
    window.destroy()
    return true
  }
  close() {
    this.closed = true
    for (const window of this.pending) if (!window.isDestroyed()) window.destroy()
    this.pending.clear()
    for (const window of this.windows.values()) window.destroy()
    this.windows.clear()
    for (const session of this.sessions) session.removeListener('will-download', this.preventDownload)
    this.sessions.clear()
  }
}
