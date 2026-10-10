// One native dialog for all desktop entry points. A selection belongs only to
// the first caller: sharing its result would also share the caller's side effect.
export class DesktopDirectoryPicker {
  constructor({ getWindow, showOpenDialog }) {
    this.getWindow = getWindow
    this.showOpenDialog = showOpenDialog
  }
  pending = undefined
  disposed = false

  async pick(signal) {
    const window = this.getWindow()
    if (this.disposed || this.pending || signal?.aborted || !window || window.isDestroyed()) return null
    let abandon
    const canceled = new Promise(resolve => { abandon = () => resolve(null) })
    const request = { abandoned: false, cancel: () => { request.abandoned = true; abandon() } }
    this.pending = request
    const navigated = (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) request.cancel() }
    window.once('closed', request.cancel)
    window.webContents.on('did-start-navigation', navigated)
    signal?.addEventListener('abort', request.cancel, { once: true })
    const result = Promise.resolve().then(async () => {
      if (request.abandoned || window.isDestroyed()) return null
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
      const { canceled, filePaths } = await this.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] })
      return request.abandoned || window.isDestroyed() || window !== this.getWindow() || canceled ? null : filePaths[0] ?? null
    }).finally(() => {
      window.removeListener('closed', request.cancel)
      window.webContents.removeListener('did-start-navigation', navigated)
      signal?.removeEventListener('abort', request.cancel)
      if (this.pending === request) this.pending = undefined
    })
    request.settled = result.then(() => {}, () => {})
    // Electron's open dialog has no AbortSignal API. An abandoned caller gets
    // null immediately, but retain the lock until the OS sheet actually closes;
    // otherwise a reconnect could open a second sheet or adopt a stale result.
    return Promise.race([result, canceled])
  }

  dispose() {
    this.disposed = true
    this.pending?.cancel()
  }

  close() {
    this.dispose()
    // Keep the parent alive until AppKit finishes its sheet. Destroying it in
    // app.quit() while the open panel is active can stall native panel cleanup.
    return this.pending?.settled ?? Promise.resolve()
  }
}
