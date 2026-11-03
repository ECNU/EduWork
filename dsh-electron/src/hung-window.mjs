// A hung page leaves the window black or frozen with no other signal. After
// a grace period, log the memory picture (to tell a busy page from one that
// ran out of memory) and offer a reload. Agent tasks run in the Host, so
// reloading the page does not stop them.
export function watchHungWindow({ window, ask, log, metrics, systemMemory, graceMs = 30_000,
  setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer, asking = false, reloading = false, ownExit = false, unresponsive = false
  const mb = kb => `${Math.round((kb ?? 0) / 1024)}MB`
  const memory = () => {
    try {
      const pid = window.webContents.getOSProcessId()
      const all = metrics()
      const page = all.find(item => item.pid === pid)?.memory ?? {}
      const total = all.reduce((sum, item) => sum + (item.memory?.workingSetSize ?? 0), 0)
      const system = systemMemory()
      return `page ${mb(page.workingSetSize)} (peak ${mb(page.peakWorkingSetSize)}, private ${mb(page.privateBytes)}), all processes ${mb(total)}, system free ${mb(system.free)} of ${mb(system.total)}`
    } catch (error) { return `memory unavailable: ${error.message}` }
  }
  const hung = async () => {
    timer = undefined
    if (window.isDestroyed() || asking) return
    log(`[desktop] Desktop page still unresponsive after ${graceMs / 1000}s: ${memory()}`)
    asking = true
    try {
      if (!await ask()) {
        // Waiting again asks again if the page is still stuck after another grace period.
        if (unresponsive && !window.isDestroyed()) timer ??= setTimer(() => void hung(), graceMs)
        return
      }
      // The page may have recovered while the dialog was open.
      if (window.isDestroyed() || !unresponsive) return
      log('[desktop] Reloading the unresponsive desktop page')
      // A busy renderer never runs a plain reload; end it, then load again
      // once it has exited (a reload issued before that is lost).
      reloading = true
      unresponsive = false
      window.webContents.forcefullyCrashRenderer()
    } finally { asking = false }
  }
  window.on('unresponsive', () => {
    log('[desktop] Desktop page unresponsive')
    unresponsive = true
    timer ??= setTimer(() => void hung(), graceMs)
  })
  window.on('responsive', () => {
    log('[desktop] Desktop page responsive again')
    unresponsive = false
    if (timer) clearTimer(timer)
    timer = undefined
  })
  window.on('closed', () => { if (timer) clearTimer(timer); timer = undefined })
  window.webContents.on('render-process-gone', () => {
    if (!reloading) return
    reloading = false; ownExit = true
    if (!window.isDestroyed()) window.webContents.reload()
  })
  // The renderer exit caused by our own reload is not a failure. Register
  // failure handlers after this watch so this exit is already marked.
  return { ownExit: () => { const own = ownExit; ownExit = false; return own } }
}
