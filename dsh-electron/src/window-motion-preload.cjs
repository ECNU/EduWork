if (process.isMainFrame) {
  const installWindowMotion = () => {
    if (location.protocol !== 'dsh-app:' || location.host !== 'app') return
    const { ipcRenderer } = require('electron')
    const root = document.documentElement
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    const style = document.createElement('style')
    style.textContent = `
      html[data-eduwork-resizing] [data-animating],html[data-eduwork-resizing] [data-side]{transition:none!important}
      html[data-eduwork-motion]{width:var(--eduwork-motion-width)!important;height:var(--eduwork-motion-height)!important;overflow:hidden!important}
      html[data-eduwork-motion] body{pointer-events:none}
    `
    document.head.append(style)
    const viewport = () => ({ width: innerWidth, height: innerHeight })
    let layout = viewport(), target = layout, timer, frame, fullscreen = false, draggingUntil = 0, disposed = false
    // Resize the layout surface only. Never scale the document: glyphs,
    // icons and controls must retain their physical size in every frame.
    const draw = size => {
      layout = size
      root.style.setProperty('--eduwork-motion-width', `${size.width}px`)
      root.style.setProperty('--eduwork-motion-height', `${size.height}px`)
    }
    const finish = () => {
      clearTimeout(timer)
      cancelAnimationFrame(frame)
      root.removeAttribute('data-eduwork-motion')
      root.removeAttribute('data-eduwork-resizing')
      for (const name of ['width', 'height']) root.style.removeProperty(`--eduwork-motion-${name}`)
      layout = viewport()
    }
    const settle = () => {
      if (disposed) return
      fullscreen = false
      if (reduced.matches || document.hidden) { finish(); return }
      root.setAttribute('data-eduwork-motion', 'layout')
      const from = layout, start = performance.now()
      const tick = now => {
        if (disposed) return
        const progress = Math.min(1, (now - start) / 140)
        const eased = 1 - Math.pow(1 - progress, 3)
        draw({ width: from.width + (target.width - from.width) * eased, height: from.height + (target.height - from.height) * eased })
        if (progress < 1) frame = requestAnimationFrame(tick)
        else finish()
      }
      frame = requestAnimationFrame(tick)
    }
    const waitForNative = () => {
      clearTimeout(timer)
      // Fullscreen has a native completion event, especially on macOS. Also
      // release on a bounded watchdog if the completion event is lost.
      timer = setTimeout(settle, fullscreen ? 1500 : 160)
    }
    const resize = () => {
      const next = viewport()
      if (next.width <= 0 || next.height <= 0) return
      if (reduced.matches || document.hidden) { finish(); return }
      const moving = root.hasAttribute('data-eduwork-motion')
      const jump = Math.abs(next.width - layout.width) > 96 || Math.abs(next.height - layout.height) > 96
      target = next
      root.setAttribute('data-eduwork-resizing', '')
      if (moving || (jump && performance.now() >= draggingUntil)) {
        cancelAnimationFrame(frame)
        root.setAttribute('data-eduwork-motion', 'native')
        draw(layout)
        waitForNative()
      } else {
        layout = next
        clearTimeout(timer)
        timer = setTimeout(finish, 160)
      }
    }
    const motion = (_event, phase) => {
      if (phase === 'drag') {
        draggingUntil = performance.now() + 200
        if (root.hasAttribute('data-eduwork-motion')) finish()
      } else if (phase === 'fullscreen-start') {
        fullscreen = true
        if (!reduced.matches && !document.hidden) {
          root.setAttribute('data-eduwork-resizing', '')
          root.setAttribute('data-eduwork-motion', 'native')
          draw(layout)
          waitForNative()
        }
      } else if (phase === 'fullscreen-end') {
        fullscreen = false
        if (root.hasAttribute('data-eduwork-motion')) waitForNative()
      } else if (phase === 'native') {
        draggingUntil = 0
        // This can arrive after resize. Extend the hold without restarting a
        // settled/minimized window when its viewport did not change.
        if (root.hasAttribute('data-eduwork-motion')) waitForNative()
      }
    }
    const visibility = () => { if (document.hidden) { fullscreen = false; finish() } }
    const preference = () => { if (reduced.matches) finish() }
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', visibility)
    reduced.addEventListener('change', preference)
    ipcRenderer.on('eduwork:window-motion', motion)
    window.addEventListener('pagehide', () => {
      disposed = true
      finish()
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', visibility)
      reduced.removeEventListener('change', preference)
      ipcRenderer.removeListener('eduwork:window-motion', motion)
      style.remove()
    }, { once: true })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installWindowMotion, { once: true })
  else installWindowMotion()
}
