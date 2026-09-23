// Only the trusted main renderer may forward the two supported visual styles.
if (process.platform === 'darwin' && process.isMainFrame) {
  const { ipcRenderer } = require('electron')
  const observe = () => {
    if (location.protocol !== 'dsh-app:' || location.host !== 'app') return
    let previous
    const update = () => {
      const style = document.documentElement.dataset.chatecnuVisualStyle
      if (!['dsh', 'ecnu-liwa'].includes(style) || style === previous) return
      previous = style
      ipcRenderer.send('eduwork:visual-style', style)
    }
    new MutationObserver(update).observe(document.documentElement, { attributes: true, attributeFilter: ['data-chatecnu-visual-style'] })
    update()
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe, { once: true })
  else observe()
}
