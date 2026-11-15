// Only the loading spinner needs an elapsed-time hint. The same BootPage can
// also display an error or recovery instructions after the spinner is gone.
if (process.isMainFrame && location.protocol === 'dsh-app:' && location.host === 'app') {
  const { ipcRenderer } = require('electron')
  const started = Date.now()
  let interval, hint, message
  const stop = () => { clearInterval(interval); hint?.remove() }
  const update = () => {
    if (!document.querySelector('[data-dsh-boot] [data-dsh-boot-spinner]')) { stop(); return }
    if (!hint) {
      try { message = ipcRenderer.sendSync('eduwork:boot-hint') } catch { return }
      if (typeof message !== 'string' || !message) return
      hint = document.createElement('p')
      hint.style.cssText = 'position:fixed;left:20px;right:20px;bottom:16px;margin:0;text-align:center;font-size:13px;color:inherit;overflow-wrap:anywhere;pointer-events:none'
      document.body.append(hint)
      interval = setInterval(update, 1000)
    }
    hint.textContent = message.replace('{seconds}', String(Math.floor((Date.now() - started) / 1000)))
  }
  const first = setTimeout(update, 30_000)
  addEventListener('pagehide', () => { clearTimeout(first); stop() }, { once: true })
}
