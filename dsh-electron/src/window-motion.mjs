// Keep OS animations enabled; the renderer eases its layout only afterwards.
export function attachWindowMotion(window) {
  const send = phase => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return
    try {
      const url = new URL(window.webContents.getURL())
      if (url.protocol === 'dsh-app:' && url.host === 'app') window.webContents.send('eduwork:window-motion', phase)
    } catch { /* No application document during startup/navigation. */ }
  }
  const listeners = new Map([
    ['will-resize', () => send('drag')],
    ['maximize', () => send('native')],
    ['unmaximize', () => send('native')],
    ['restore', () => send('native')],
    ['will-enter-full-screen', () => send('fullscreen-start')],
    ['will-leave-full-screen', () => send('fullscreen-start')],
    ['enter-full-screen', () => send('fullscreen-end')],
    ['leave-full-screen', () => send('fullscreen-end')],
  ])
  const dispose = () => {
    for (const [name, listener] of listeners) window.removeListener(name, listener)
    window.removeListener('closed', dispose)
  }
  for (const [name, listener] of listeners) window.on(name, listener)
  window.once('closed', dispose)
  return dispose
}
