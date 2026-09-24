export function showDesktopWindow(window) {
  if (!window || window.isDestroyed()) return false
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  return true
}

export function attachAppActivation({ app, windows, platform = process.platform }) {
  if (platform !== 'darwin') return () => {}
  const activate = () => {
    for (const window of windows()) if (showDesktopWindow(window)) return
  }
  app.on('activate', activate)
  return () => app.removeListener('activate', activate)
}

export function attachWindowVisibility({ app, window, platform = process.platform, isQuitting, shouldExit, hasTray }) {
  const show = () => showDesktopWindow(window)
  window.on('close', event => {
    if (isQuitting()) return
    if (shouldExit()) {
      event.preventDefault()
      app.quit()
      return
    }
    if (platform === 'darwin' || hasTray()) {
      event.preventDefault()
      window.hide()
    }
  })
  return show
}
