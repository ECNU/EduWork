// The upstream BootPage hardcodes its wordmark before plugins load. Brand it
// from the desktop identity at document start without copying or rewriting the
// published frontend. Scoped to the application's main frame.
if (process.isMainFrame && location.protocol === 'dsh-app:' && location.host === 'app') {
  const { ipcRenderer } = require('electron')
  const initial = ipcRenderer.sendSync('eduwork:boot-brand')
  let brand = typeof initial === 'string' ? { name: initial } : initial
  if (typeof brand?.name === 'string' && brand.name.length > 0) {
    let wordmark
    let observer
    const paint = () => {
      wordmark.textContent = brand.name
      // Decorate the existing wordmark instead of adding sibling nodes: the
      // official failure/progress renderer replaces the card's children. A
      // background is decorative and preserves its text and accessible name.
      const logo = typeof brand.logo === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/u.test(brand.logo)
      wordmark.style.backgroundImage = logo ? `url("${brand.logo}")` : ''
      wordmark.style.backgroundRepeat = logo ? 'no-repeat' : ''
      wordmark.style.backgroundPosition = logo ? 'center top' : ''
      wordmark.style.backgroundSize = logo ? '48px 48px' : ''
      wordmark.style.paddingTop = logo ? '64px' : ''
      wordmark.style.minWidth = logo ? '48px' : ''
      wordmark.style.textAlign = logo ? 'center' : ''
    }
    const apply = () => {
      if (wordmark?.isConnected) { paint(); return }
      const root = document.querySelector('[data-dsh-boot]')
      if (root === null) return
      wordmark = [...root.querySelectorAll('div')]
        .find(element => element.childElementCount === 0 && element.textContent === 'HARNESS')
      if (!wordmark) return
      paint()
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
      const next = typeof value === 'string' ? { ...brand, name: value } : value
      if (typeof next?.name !== 'string' || next.name.length === 0) return
      brand = next
      apply()
    })
  }
}
