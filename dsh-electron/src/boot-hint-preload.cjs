// A Host can wait minutes on a plugin (for example one polling a QR login)
// while the upstream BootPage only spins. After 30 s show the elapsed time and
// where the log is below it. Scoped to the application's main frame.
if (process.isMainFrame && location.protocol === 'dsh-app:' && location.host === 'app') {
  const { ipcRenderer } = require('electron')
  const started = Date.now()
  let seen = false, hint, message
  const timer = setInterval(() => {
    const root = document.querySelector('[data-dsh-boot]')
    if (!root) { if (seen) { clearInterval(timer); hint?.remove() } return }
    seen = true
    const seconds = Math.round((Date.now() - started) / 1000)
    if (seconds < 30) return
    if (!hint) {
      try { message = ipcRenderer.sendSync('eduwork:boot-hint') } catch { message = '' }
      if (typeof message !== 'string' || message.length === 0) { clearInterval(timer); return }
      hint = document.createElement('p')
      hint.style.cssText = 'position:fixed;left:20px;right:20px;bottom:16px;margin:0;text-align:center;font-size:13px;color:#6b7280;word-break:break-all'
      document.body.append(hint)
    }
    hint.textContent = `已等待 ${seconds} 秒。${message}`
  }, 1000)
  addEventListener('pagehide', () => clearInterval(timer), { once: true })
}
