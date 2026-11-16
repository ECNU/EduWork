import { fileURLToPath } from 'node:url'

// Windows draws a 16px overlay. The 32px source cells contain labels 1–9 and 9+.
const badgePath = fileURLToPath(new URL('./taskbar-badges.png', import.meta.url))

export function createTaskbarIndicator({ platform, nativeImage, getDock, warn }) {
  let window, sprite, count = 0, flashing = false
  function writeBadge() {
    if (platform === 'darwin') {
      getDock()?.setBadge(count ? String(count) : '')
    } else if (platform === 'win32' && window && !window.isDestroyed()) {
      let badge = null
      if (count) {
        sprite ??= nativeImage.createFromPath(badgePath)
        badge = sprite.crop({ x: (Math.min(count, 10) - 1) * 32, y: 0, width: 32, height: 32 })
      }
      window.setOverlayIcon(badge, count ? String(count) : '')
    }
  }
  function applyBadge() {
    try { writeBadge() } catch (error) { warn(error) }
  }
  function stopFlash() {
    if (flashing && window && !window.isDestroyed()) window.flashFrame(false)
    flashing = false
  }
  return {
    attach(target) {
      if (platform !== 'win32') return
      window = target
      flashing = false
      // Explorer creates a new taskbar button when a tray-hidden window returns.
      target.on('show', () => { if (window === target) applyBadge() })
      target.on('focus', () => { if (window === target) stopFlash() })
      target.on('closed', () => { if (window === target) { window = undefined; flashing = false } })
      if (count) applyBadge()
    },
    update(status) {
      const changed = count !== status.count
      count = status.count
      if (changed) applyBadge()
      try {
        if (!count) stopFlash()
        else if (platform === 'win32' && status.notify && window && !window.isDestroyed()
          && (window.isVisible() || window.isMinimized()) && !window.isFocused()) {
          window.flashFrame(true)
          flashing = true
        }
      } catch (error) { warn(error) }
    },
  }
}
