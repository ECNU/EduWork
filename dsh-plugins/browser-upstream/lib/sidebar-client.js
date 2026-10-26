// The application page's half of the Agent's Sidebar browser
// (dsh-electron/src/sidebar-browser.mjs). It reports which conversation and
// tab each browser guest shows, opens and closes tabs for the Agent, keeps a
// working conversation's tabs painting behind what the user sees, and marks
// the tab the Agent acts on. The Web client has no bridge and skips all of it.
const FRAME = 'webview[data-sidebar-browser-frame="webview"]'
const SESSION = 'data-sidebar-right-session'
const TAB = 'data-sidebar-right-tab'
const OPEN = 'data-sidebar-right-open'
const DOCK = '[data-dockkit-host="dock"]'
const RENDER = 'data-eduwork-agent-render'
const ACTING = 'data-eduwork-agent-acting'

// A guest under a hidden ancestor, or in a collapsed Sidebar's docked cell
// (moved past the window edge and invisible), stops painting, and Playwright
// then waits for its frames forever. Inside the window, below everything and
// all but transparent, it keeps painting at the size it has on screen; fully
// transparent, the compositor stops drawing it after the next layout change.
const css = `
[${RENDER}] {
  display: flex !important; position: fixed !important; left: 0 !important; top: 0 !important;
  width: var(--dsh-sidebar-width, 576px) !important; height: 100vh !important;
  transform: none !important; visibility: visible !important;
  opacity: 0.01 !important; pointer-events: none !important; z-index: -1 !important;
}
[${ACTING}]::after {
  content: ''; position: absolute; inset: 0; z-index: 1; pointer-events: none;
  border: 2px solid #2f6fed;
}
[${ACTING}]::before {
  content: attr(${ACTING}); position: absolute; top: 8px; left: 50%; transform: translateX(-50%); z-index: 2;
  pointer-events: none; white-space: nowrap; padding: 2px 10px; border-radius: 10px;
  background: #2f6fed; color: #fff; font: 500 12px/18px system-ui, sans-serif;
}
`

/**
 * @param bridge - window.eduworkSidebarBrowser from the desktop preload.
 * @param sidebar - ctx.sidebarRight.
 * @param label - text of the marker on the tab the Agent acts on.
 * @returns disconnects from the main process and clears every mark.
 */
export function connectSidebarBrowser({ bridge, sidebar, document, label }) {
  const working = new Set()
  const watched = new WeakSet()
  const acting = new Map() // session id -> the marked tab content
  let pressing // overlapping presses: where focus was before the first
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)

  const sessionOf = element => element.closest(`[${SESSION}]`)?.getAttribute(SESSION)
  const inSession = sessionId => `[${SESSION}="${CSS.escape(sessionId)}"]`
  const frameOf = (sessionId, tabId) => document.querySelector(`${inSession(sessionId)} [${TAB}="${CSS.escape(tabId)}"] ${FRAME}`)
  const bind = frame => {
    const tabId = frame.closest(`[${TAB}]`)?.getAttribute(TAB)
    const sessionId = sessionOf(frame)
    let guestId
    try { guestId = frame.getWebContentsId() } catch { return } // before dom-ready
    if (tabId && sessionId) bridge.bind(guestId, sessionId, tabId)
  }
  const watch = () => {
    for (const frame of document.querySelectorAll(FRAME)) {
      if (watched.has(frame)) continue
      watched.add(frame)
      frame.addEventListener('dom-ready', () => bind(frame), { once: true })
      bind(frame)
    }
  }
  // Tab and conversation switches toggle `hidden`, and collapsing the Sidebar
  // its panel's open mark; re-mark after each.
  const offScreen = element => element.hidden || element.matches(DOCK) && !element.closest(`[${SESSION}][${OPEN}]`)
  const paint = () => {
    for (const element of document.querySelectorAll(`[${RENDER}]`)) element.removeAttribute(RENDER)
    for (const frame of document.querySelectorAll(FRAME)) {
      if (!working.has(sessionOf(frame))) continue
      for (let element = frame.parentElement; element && element !== document.body; element = element.parentElement) {
        if (offScreen(element)) element.setAttribute(RENDER, '')
      }
    }
  }
  const observer = new MutationObserver(() => {
    watch()
    if (working.size > 0) paint()
  })
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', OPEN] })

  // Focus that an Agent's click or tab switch pulls into the elements it acts
  // on goes back to where it was, such as a message being typed or a page in
  // another conversation. Focus the user put there, or moved meanwhile, stays.
  const returnFocus = (previous, regions) => {
    const inRegion = element => regions.some(region => region?.contains(element))
    if (regions.every(region => region?.contains(previous))) return
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const now = document.activeElement
      if (now === previous || !inRegion(now) && now !== document.body) return
      if (previous.isConnected && previous !== document.body) previous.focus({ preventScroll: true })
      else now.blur()
    }))
  }
  const unmark = sessionId => {
    acting.get(sessionId)?.removeAttribute(ACTING)
    acting.delete(sessionId)
  }
  const mark = (sessionId, tabId) => {
    unmark(sessionId)
    const element = frameOf(sessionId, tabId)?.parentElement
    if (!element) return
    element.setAttribute(ACTING, label())
    acting.set(sessionId, element)
  }

  const handlers = {
    open({ id, sessionId, url }) {
      // The Sidebar first loads a tab when the user sees it.
      if (sidebar.mounted.getSnapshot() !== sessionId) {
        bridge.opened(id, { error: 'The user is viewing another conversation, so a new sidebar tab cannot load now. Keep working in this conversation\'s open tabs, or ask the user to return to this conversation and try again.' })
        return
      }
      const before = new Set(sidebar.tabsIn(sessionId).map(tab => tab.id))
      sidebar.openTabIn(sessionId, 'browser', { params: { url } })
      const tab = sidebar.tabsIn(sessionId).find(tab => !before.has(tab.id))
      bridge.opened(id, tab ? { tabId: tab.id } : { error: 'The sidebar did not open a tab' })
    },
    close({ sessionId, tabId }) { sidebar.closeIn(sessionId, tabId) },
    show({ sessionId, tabId, expand }) {
      working.add(sessionId)
      paint()
      if (tabId === undefined) return
      mark(sessionId, tabId)
      if (sidebar.mounted.getSnapshot() !== sessionId) return
      const previous = document.activeElement
      if (expand && !sidebar.isExpanded()) sidebar.toggleExpanded()
      if (sidebar.active()?.id !== tabId) sidebar.focus(tabId)
      returnFocus(previous, [document.querySelector(inSession(sessionId))])
    },
    idle({ sessionId }) {
      working.delete(sessionId)
      paint()
      unmark(sessionId)
    },
    // Around an Agent's mouse press, which focuses its guest.
    press({ id, sessionId, tabId }) {
      pressing ??= { previous: document.activeElement, frames: [], pending: new Set() }
      pressing.pending.add(id)
      pressing.frames.push(frameOf(sessionId, tabId))
    },
    pressed({ id }) {
      if (!pressing?.pending.delete(id) || pressing.pending.size > 0) return
      returnFocus(pressing.previous, pressing.frames)
      pressing = undefined
    },
  }
  const unsubscribe = bridge.onRequest(message => handlers[message.type]?.(message))
  watch()
  return () => {
    unsubscribe()
    observer.disconnect()
    for (const element of document.querySelectorAll(`[${RENDER}], [${ACTING}]`)) { element.removeAttribute(RENDER); element.removeAttribute(ACTING) }
    style.remove()
  }
}
