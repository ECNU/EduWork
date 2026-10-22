// The upstream BootPage hardcodes its wordmark before plugins load. Label it
// from the desktop identity at document start without copying or rewriting the
// published frontend. Scoped to the application's main frame.
if (process.isMainFrame && location.protocol === 'dsh-app:' && location.host === 'app') {
  const { ipcRenderer } = require('electron')
  let brand = ipcRenderer.sendSync('eduwork:boot-brand')
  if (typeof brand === 'string' && brand.length > 0) {
    let wordmark
    let observer
    const apply = () => {
      if (wordmark?.isConnected) { wordmark.textContent = brand; return }
      const root = document.querySelector('[data-dsh-boot]')
      if (root === null) return
      wordmark = [...root.querySelectorAll('div')]
        .find(element => element.childElementCount === 0 && element.textContent === 'HARNESS')
      if (!wordmark) return
      wordmark.textContent = brand
      observer?.disconnect()
      observer = undefined
    }
    const start = () => {
      observer = new MutationObserver(apply)
      observer.observe(document.documentElement, { childList: true, subtree: true })
      apply()
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
    else start()
    addEventListener('pagehide', () => { observer?.disconnect(); observer = undefined }, { once: true })
    ipcRenderer.on('eduwork:boot-brand', (_event, value) => {
      if (typeof value !== 'string' || value.length === 0) return
      brand = value
      if (wordmark?.isConnected) wordmark.textContent = brand
      else apply()
    })
  }
}
