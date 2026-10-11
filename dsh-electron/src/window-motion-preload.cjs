// Native resize already animates the window. A simultaneous sidebar grid
// transition can lag behind its new viewport and produce a second layout jump.
if (process.isMainFrame) {
  const install = () => {
    if (location.protocol !== 'dsh-app:' || location.host !== 'app') return
    const root = document.documentElement
    const style = document.createElement('style')
    style.textContent = 'html[data-eduwork-resizing] [data-animating],html[data-eduwork-resizing] [data-animating] [data-side]{transition:none!important}'
    document.head.append(style)
    let timer
    const resize = () => {
      root.setAttribute('data-eduwork-resizing', '')
      clearTimeout(timer)
      timer = setTimeout(() => root.removeAttribute('data-eduwork-resizing'), 160)
    }
    window.addEventListener('resize', resize)
    window.addEventListener('pagehide', () => {
      window.removeEventListener('resize', resize)
      clearTimeout(timer)
      root.removeAttribute('data-eduwork-resizing')
      style.remove()
    }, { once: true })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true })
  else install()
}
