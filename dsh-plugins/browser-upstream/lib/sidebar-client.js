// The application page's half of the Agent's Sidebar browser
// (dsh-electron/src/sidebar-browser.mjs). It reports which conversation and
// tab each browser guest shows, opens and closes tabs for the Agent, keeps a
// working conversation's tabs painting behind what the user sees, marks
// the tab the Agent acts on, which the user only watches until the Agent's
// turn ends, asks them something or they stop it, and shows pages at desktop
// width. The Web client has no bridge and skips all of it.
const FRAME = 'webview[data-sidebar-browser-frame="webview"]'
const SESSION = 'data-sidebar-right-session'
const TAB = 'data-sidebar-right-tab'
const OPEN = 'data-sidebar-right-open'
const DOCK = '[data-dockkit-host="dock"]'
const RENDER = 'data-eduwork-agent-render'
const BACKGROUND = 'data-eduwork-agent-background'
const ACTING = 'data-eduwork-agent-acting'
// At desktop width, a page whose tab is narrower than this lays out at this
// width, as on a desktop, and shows scaled down to fill its tab. Only the
// guest element's own inline style changes, so a guest DSH stops marking as a
// Sidebar page simply follows the Sidebar's width.
const DESKTOP = 1280
// The user sets it in this plugin's settings, which DSH names by the plugin's
// entry in the product's composition (config/distributions, pinned-browser.mjs).
export const SIDEBAR_SETTINGS = 'eduwork-browser'
const FITTED = ['flex', 'width', 'height', 'transform', 'transformOrigin', 'marginRight', 'marginBottom']

// A guest under a hidden ancestor, or in a collapsed Sidebar's docked cell
// (moved past the window edge and invisible), stops painting, and Playwright
// then waits for its frames forever. Inside the window, below everything and
// all but transparent, it keeps painting at the size it has on screen; fully
// transparent, the compositor stops drawing it after the next layout change.
const css = `
[${BACKGROUND}] { display: none }
[${RENDER}] {
  display: flex !important; position: fixed !important; left: 0 !important; top: 0 !important;
  width: var(--dsh-sidebar-width, 576px) !important; height: 100vh !important;
  transform: none !important; visibility: visible !important;
  opacity: 0.01 !important; pointer-events: none !important; z-index: -1 !important;
}
[${BACKGROUND}] webview { flex: 1 }
[${ACTING}]:not([hidden]) {
  position: absolute; inset: 0; z-index: 1; display: flex; justify-content: center; align-items: flex-start;
  border: 2px solid #2f6fed; cursor: not-allowed;
}
[${ACTING}] > span {
  display: flex; align-items: center; gap: 8px; margin-top: 6px; padding: 2px 3px 2px 10px; border-radius: 11px;
  white-space: nowrap; cursor: default; background: #2f6fed; color: #fff; font: 500 12px/18px system-ui, sans-serif;
}
[${ACTING}] button { all: unset; cursor: pointer; padding: 0 8px; border-radius: 8px; background: rgb(255 255 255 / 0.2) }
[${ACTING}] button:hover, [${ACTING}] button:focus-visible { background: rgb(255 255 255 / 0.35) }
`

/**
 * Whether the Agent waits on the user's answer: a question it asked in its
 * current turn has no result yet. A question that timed out has one, and the
 * Agent goes on, as it does whether or not the question's card is shown.
 * @param entries - the conversation's events, as its eventSource holds them.
 */
export function asksUser(entries) {
  const answered = new Set()
  for (let i = entries.length - 1; i >= 0; i--) {
    const { event } = entries[i]
    if (event.type === 'turn/start') return false
    if (event.type === 'tool/result') answered.add(event.data.message.toolCallId)
    if (event.type === 'tool/call' && event.data.name === 'ask_user_question' && !answered.has(event.data.callId)) return true
  }
  return false
}

/**
 * The Sidebar browser storage of a conversation's workspace, named as
 * ui-sidebar-browser's browserWorkspace names it once the workspace list has arrived.
 * @param list - ctx.workspaces.list.
 * @param signal - ends the wait.
 */
export async function workspaceStorage(list, sessionId, signal) {
  if (list.getSnapshot().phase !== 'ready') {
    await new Promise((resolve, reject) => {
      const stop = () => { unsubscribe(); signal.removeEventListener('abort', abort) }
      const abort = () => { stop(); reject(signal.reason) }
      const unsubscribe = list.subscribe(() => { if (list.getSnapshot().phase === 'ready') { stop(); resolve() } })
      signal.addEventListener('abort', abort, { once: true })
    })
  }
  const workspace = list.getSnapshot().items.find(item => item.sessionIds.includes(sessionId))
  return workspace === undefined ? `session:${sessionId}` : `cwd:${workspace.path}`
}

/**
 * @param bridge - window.eduworkSidebarBrowser from the desktop preload.
 * @param desktop - the desktop's Sidebar browser guests (dshDesktop.browser).
 * @param sidebar - ctx.sidebarRight.
 * @param storage - (session id, signal) => the Sidebar browser storage of the conversation's workspace.
 * @param conversation - a conversation's DSH session binding: its session, whether its turn runs, and cancel, and its events.
 * @param text - the marker's 'acting' and 'stop' labels.
 * @param desktopWidth - the user's setting, { getSnapshot, subscribe }: whether pages show at desktop width.
 * @returns disconnects from the main process and clears every mark.
 */
export function connectSidebarBrowser({ bridge, desktop, sidebar, document, storage, conversation, text, desktopWidth }) {
  const working = new Set()
  const watched = new WeakSet()
  const acting = new Map() // session id -> { tabId, lock, unsubscribe }
  const backgrounds = new Map() // tab id -> a page outside the Sidebar
  const opened = new Set() // conversations whose Sidebar opened for their Agent's connection
  const lifetimes = new Map() // session id -> its Agent's connection, which ends pending opens
  let pressing // overlapping presses: where focus was before the first
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)

  const sessionOf = element => element.closest(`[${SESSION}]`)?.getAttribute(SESSION)
  const inSession = sessionId => `[${SESSION}="${CSS.escape(sessionId)}"]`
  const frameOf = (sessionId, tabId) => backgrounds.get(tabId)?.frame
    ?? document.querySelector(`${inSession(sessionId)} [${TAB}="${CSS.escape(tabId)}"] ${FRAME}`)
  const bind = frame => {
    const tabId = frame.closest(`[${TAB}]`)?.getAttribute(TAB)
    const sessionId = sessionOf(frame)
    let guestId
    try { guestId = frame.getWebContentsId() } catch { return } // before dom-ready
    if (tabId && sessionId) bridge.bind(guestId, sessionId, tabId)
    bridge.width(guestId, desktopFor(frame))
  }

  // Each page's width: the user's setting, or their choice for its tab from
  // the page's menu, which lasts while the application runs.
  const chosen = new Map() // `${session id} ${tab id}` -> whether at desktop width
  const followed = new Map() // guest element -> { parent, width, height }: the tab it fills
  const keyOf = frame => {
    for (const [tabId, page] of backgrounds) if (page.frame === frame) return `${page.sessionId} ${tabId}`
    return `${sessionOf(frame)} ${frame.closest(`[${TAB}]`)?.getAttribute(TAB)}`
  }
  const desktopFor = frame => chosen.get(keyOf(frame)) ?? desktopWidth.getSnapshot()
  const fit = frame => {
    const { width, height } = followed.get(frame)
    if (!desktopFor(frame) || !(width < DESKTOP)) {
      for (const name of FITTED) frame.style[name] = ''
      return
    }
    // The guest element really is DESKTOP wide, scaled down from its top-left
    // corner to cover its tab exactly. Its margins take back all the room it
    // takes, so the tab's size never depends on it and can still shrink.
    const scale = width / DESKTOP, tall = height / scale
    Object.assign(frame.style, { flex: 'none', width: `${DESKTOP}px`, height: `${tall}px`, transform: `scale(${scale})`, transformOrigin: '0 0',
      marginRight: `${-DESKTOP}px`, marginBottom: `${-tall}px` })
  }
  // The main process shows the choice in the page's menu.
  const report = frame => {
    let guestId
    try { guestId = frame.getWebContentsId() } catch { return } // before dom-ready, which reports it
    bridge.width(guestId, desktopFor(frame))
  }
  const sizes = new ResizeObserver(entries => {
    for (const { target, contentRect } of entries) {
      const frame = [...followed].find(([, tab]) => tab.parent === target)?.[0]
      // A hidden tab keeps the layout it had.
      if (frame === undefined || contentRect.width === 0 || contentRect.height === 0) continue
      Object.assign(followed.get(frame), { width: contentRect.width, height: contentRect.height })
      fit(frame)
    }
  })
  // Fitted as soon as it is found, before its guest attaches and loads a page.
  const follow = frame => {
    const parent = frame.parentElement
    followed.set(frame, { parent })
    sizes.observe(parent)
    if (parent.clientWidth > 0 && parent.clientHeight > 0) {
      Object.assign(followed.get(frame), { width: parent.clientWidth, height: parent.clientHeight })
      fit(frame)
    }
  }
  // A guest element gone, with or without its tab, or moved into another tab
  // as DSH could move it, where it is found and followed anew.
  const unfollowGone = () => {
    for (const [frame, { parent }] of followed) {
      if (frame.isConnected && frame.parentElement === parent) continue
      sizes.unobserve(parent)
      followed.delete(frame)
    }
  }
  const refit = () => {
    for (const frame of followed.keys()) {
      if (followed.get(frame).width !== undefined) fit(frame)
      report(frame)
    }
  }
  const unwatchWidth = desktopWidth.subscribe(refit)

  const watch = () => {
    unfollowGone()
    for (const frame of document.querySelectorAll(FRAME)) {
      if (!followed.has(frame)) follow(frame)
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
    for (const page of backgrounds.values()) if (working.has(page.sessionId)) page.holder.setAttribute(RENDER, '')
  }
  const observer = new MutationObserver(() => {
    watch()
    if (working.size > 0) paint()
  })
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', OPEN] })

  // The Sidebar first loads a tab when the user sees its conversation. While
  // they do not, as when they use it from their phone, the Agent gets a page
  // out of sight instead: a guest the desktop sets up as it does the Sidebar's,
  // in the storage of the conversation's Sidebar tabs, so it shares their logins.
  const openBackground = async (sessionId, url) => {
    if (!lifetimes.has(sessionId)) lifetimes.set(sessionId, new AbortController())
    const { signal } = lifetimes.get(sessionId)
    const { lease, partition } = await desktop.acquire(await storage(sessionId, signal))
    // The Agent that asked may have left meanwhile.
    if (signal.aborted) {
      void desktop.release(lease)
      throw new Error('The Agent left before its page opened')
    }
    const tabId = `background-${lease}`
    const holder = document.createElement('div')
    holder.setAttribute(BACKGROUND, '')
    const frame = document.createElement('webview')
    frame.setAttribute('partition', partition)
    frame.setAttribute('allowpopups', '')
    frame.setAttribute('src', `about:blank#${lease}`)
    frame.addEventListener('dom-ready', () => {
      // A failed load shows on the page itself, where the Agent looks.
      frame.loadURL(url).catch(() => {})
      bridge.bind(frame.getWebContentsId(), sessionId, tabId)
      report(frame)
    }, { once: true })
    // Nobody waits for a popup: when it cannot open, the Agent just sees no new page.
    const unsubscribe = desktop.onOpenRequested(lease, link => openPage(sessionId, link).catch(() => {}))
    backgrounds.set(tabId, { sessionId, frame, holder, close() { unsubscribe(); holder.remove(); void desktop.release(lease) } })
    holder.append(frame)
    document.body.append(holder)
    paint()
    follow(frame)
    return tabId
  }
  const openPage = async (sessionId, url) => {
    if (sidebar.mounted.getSnapshot() !== sessionId) return openBackground(sessionId, url)
    const before = new Set(sidebar.tabsIn(sessionId).map(tab => tab.id))
    sidebar.openTabIn(sessionId, 'browser', { params: { url } })
    const tab = sidebar.tabsIn(sessionId).find(tab => !before.has(tab.id))
    if (!tab) throw new Error('The sidebar did not open a tab')
    return tab.id
  }
  const closeBackground = tabId => {
    backgrounds.get(tabId).close()
    backgrounds.delete(tabId)
  }

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
  // Where the user sees the conversation, its Sidebar opens once per
  // connection and shows the tab the Agent acts on.
  const reveal = (sessionId, tabId) => {
    const previous = document.activeElement
    if (!opened.has(sessionId) && !sidebar.isExpanded()) sidebar.toggleExpanded()
    opened.add(sessionId)
    if (sidebar.active()?.id !== tabId) sidebar.focus(tabId)
    returnFocus(previous, [document.querySelector(inSession(sessionId))])
  }
  const unwatchScreen = sidebar.mounted.subscribe(() => {
    const sessionId = sidebar.mounted.getSnapshot()
    const tabId = acting.get(sessionId)?.tabId
    if (tabId !== undefined && !backgrounds.has(tabId)) reveal(sessionId, tabId)
  })
  const unmark = sessionId => {
    const marked = acting.get(sessionId)
    if (!marked) return
    marked.lock.remove()
    marked.unsubscribe()
    acting.delete(sessionId)
  }
  // While the Agent's turn runs, the tab it acts on takes no input from the
  // user, who stops the turn to take over; the Agent's own input reaches the
  // guest directly. The tab is the user's again once the Agent rests from the
  // browser (idle), and while it waits on the user's answer to a question, to
  // sign in for one. An approval leaves it the Agent's: what is approved is to
  // happen to the page as it is.
  const mark = (sessionId, tabId) => {
    unmark(sessionId)
    const frame = frameOf(sessionId, tabId)
    const binding = conversation(sessionId)
    if (!frame || !binding) return
    const { session, eventSource } = binding
    const lock = document.createElement('div')
    lock.setAttribute(ACTING, '')
    const badge = document.createElement('span')
    const stop = document.createElement('button')
    stop.type = 'button'
    stop.textContent = text('stop')
    badge.append(text('acting'), stop)
    lock.append(badge)
    let stopping = false
    const update = () => {
      const { running } = session.getSnapshot()
      if (!running) stopping = false
      lock.hidden = stopping || !running || asksUser(eventSource.getSnapshot().entries)
      if (!lock.hidden && document.activeElement === frame) frame.blur()
    }
    stop.addEventListener('click', () => {
      stopping = true
      update()
      void session.cancel()
    })
    update()
    frame.parentElement.append(lock)
    const stops = [session.subscribe(update), eventSource.subscribe(update)]
    acting.set(sessionId, { tabId, lock, unsubscribe: () => { for (const stop of stops) stop() } })
  }

  const handlers = {
    async open({ id, sessionId, url }) {
      try { bridge.opened(id, { tabId: await openPage(sessionId, url) }) }
      catch (error) { bridge.opened(id, { error: error.message }) }
    },
    close({ sessionId, tabId }) {
      if (backgrounds.has(tabId)) closeBackground(tabId)
      else sidebar.closeIn(sessionId, tabId)
    },
    // Nothing else reaches a background page once its Agent has gone.
    ended({ sessionId }) {
      lifetimes.get(sessionId)?.abort()
      lifetimes.delete(sessionId)
      opened.delete(sessionId)
      for (const [tabId, page] of backgrounds) if (page.sessionId === sessionId) closeBackground(tabId)
    },
    show({ sessionId, tabId }) {
      working.add(sessionId)
      paint()
      if (tabId === undefined) return
      mark(sessionId, tabId)
      if (sidebar.mounted.getSnapshot() === sessionId && !backgrounds.has(tabId)) reveal(sessionId, tabId)
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
    // The user's choice from the page's menu.
    width({ guestId, desktop }) {
      const frame = [...followed.keys()].find(frame => { try { return frame.getWebContentsId() === guestId } catch { return false } })
      if (frame === undefined) return
      chosen.set(keyOf(frame), desktop)
      if (followed.get(frame).width !== undefined) fit(frame)
      report(frame)
    },
  }
  const unsubscribe = bridge.onRequest(message => handlers[message.type]?.(message))
  watch()
  return () => {
    for (const lifetime of lifetimes.values()) lifetime.abort()
    unsubscribe()
    unwatchScreen()
    unwatchWidth()
    observer.disconnect()
    sizes.disconnect()
    for (const frame of followed.keys()) for (const name of FITTED) frame.style[name] = ''
    for (const tabId of [...backgrounds.keys()]) closeBackground(tabId)
    for (const sessionId of [...acting.keys()]) unmark(sessionId)
    for (const element of document.querySelectorAll(`[${RENDER}]`)) element.removeAttribute(RENDER)
    style.remove()
  }
}
