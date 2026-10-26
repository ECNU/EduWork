// A renderer that runs out of memory leaves only its exit reason. Keep a short
// in-memory history of process and system memory, log when the page grows past
// a threshold or the system runs low, and write the history when the page
// exits abnormally or hangs, so a report shows what led up to it.
export function watchMemory({ window, log, metrics, systemMemory, everyMs = 15_000, keep = 20,
  pageWarnKB = 1536 * 1024, freeWarnKB = 512 * 1024, now = Date.now,
  setTimer = setInterval, clearTimer = clearInterval }) {
  const samples = []
  let pageHigh = false, freeLow = false
  const mb = kb => `${Math.round((kb ?? 0) / 1024)}MB`
  const sample = () => {
    if (window.isDestroyed()) return
    try {
      const pid = window.webContents.getOSProcessId()
      const all = metrics()
      const system = systemMemory()
      const row = { time: now(), page: all.find(item => item.pid === pid)?.memory?.workingSetSize ?? 0,
        all: all.reduce((sum, item) => sum + (item.memory?.workingSetSize ?? 0), 0),
        free: system.free ?? 0, total: system.total ?? 0 }
      samples.push(row)
      if (samples.length > keep) samples.shift()
      // Log a threshold once per crossing, not on every sample.
      if (row.page >= pageWarnKB !== pageHigh) {
        pageHigh = !pageHigh
        if (pageHigh) log(`[desktop:memory] Desktop page uses ${mb(row.page)} (all processes ${mb(row.all)}, system free ${mb(row.free)} of ${mb(row.total)})`)
      }
      if (row.free <= freeWarnKB !== freeLow) {
        freeLow = !freeLow
        if (freeLow) log(`[desktop:memory] System memory low: free ${mb(row.free)} of ${mb(row.total)} (page ${mb(row.page)}, all processes ${mb(row.all)})`)
      }
    } catch { /* Metrics are diagnostic only. */ }
  }
  // The page process may already be gone; report the history as recorded.
  const dump = reason => {
    if (!samples.length) return
    const last = now()
    log(`[desktop:memory] Memory before ${reason} (seconds ago: page / all processes / system free of total):\n`
      + samples.map(row => `  -${Math.round((last - row.time) / 1000)}s ${mb(row.page)} / ${mb(row.all)} / ${mb(row.free)} of ${mb(row.total)}`).join('\n'))
  }
  const timer = setTimer(sample, everyMs)
  timer?.unref?.()
  sample()
  window.on('closed', () => clearTimer(timer))
  return { dump, samples }
}
