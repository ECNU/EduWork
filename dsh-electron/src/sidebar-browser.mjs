// A conversation's own Agent drives the browser tabs in that conversation's
// right Sidebar, where the user watches and can take over. The Host gets one
// loopback endpoint behind a secret; each conversation is a CDP "browser" at
// <endpoint>/<session id> whose pages are the Sidebar guests the application
// renderer reports for it, relayed through webContents.debugger as in
// automation-browser.mjs. Page sessions cannot reach other targets, and
// keyboard input goes to the focused frame's own widget: Chromium otherwise
// routes a guest's CDP keys to whatever the application window has focused.
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { webContents } from 'electron'
import { WebSocketServer } from 'ws'

export const SIDEBAR_BROWSER_ENV = 'EDUWORK_SIDEBAR_BROWSER_SECRET'
export const SIDEBAR_BROWSER_IPC = { bind: 'eduwork:sidebar-browser:bind', opened: 'eduwork:sidebar-browser:opened', request: 'eduwork:sidebar-browser:request' }

const OPEN_TIMEOUT_MS = 20_000
// Domains Playwright uses on a page. The rest reach past the page: other
// targets, the workspace's shared storage, downloads or certificate checks.
// The blocked methods do too: cookies belong to the whole shared partition.
const pageDomains = new Set(['Accessibility', 'CSS', 'DOM', 'Debugger', 'Emulation', 'Fetch', 'HeapProfiler', 'IO', 'Input', 'Inspector', 'Log', 'Network', 'Overlay', 'Page', 'Profiler', 'Runtime'])
const pageBlocked = new Set(['Page.setDownloadBehavior', 'Network.clearBrowserCache', 'Network.clearBrowserCookies', 'Network.deleteCookies', 'Network.getAllCookies',
  'Network.getCookies', 'Network.loadNetworkResource', 'Network.setCookie', 'Network.setCookieControls', 'Network.setCookies'])
const allowedOnPage = method => method === 'Target.setAutoAttach' || pageDomains.has(method.slice(0, method.indexOf('.'))) && !pageBlocked.has(method)
// Commands that show the user what the Agent is doing on a page.
const visibleOnPage = new Set(['Input.dispatchMouseEvent', 'Input.dispatchKeyEvent', 'Input.insertText', 'Page.navigate', 'Page.reload', 'Page.navigateToHistoryEntry', 'Page.captureScreenshot', 'Page.bringToFront'])
const validId = value => typeof value === 'string' && /^[\w-]{1,200}$/u.test(value)
const id = () => randomUUID().replaceAll('-', '').toUpperCase()
const failure = (message, code = -32000) => Object.assign(new Error(message), { code })

// Electron's key names for CDP's DOM key values where they differ.
const electronKeys = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', ' ': 'Space' }
const modifierNames = [[1, 'alt'], [2, 'control'], [4, 'meta'], [8, 'shift']]

const newTabPage = language => {
  const title = /^zh/iu.test(language ?? '') ? '新标签页' : 'New Tab'
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><meta name="color-scheme" content="light dark">`
}

/**
 * @param getWindow - the application window whose Sidebar the Agents use.
 * @param idleMs - an Agent pauses between tool calls; after this long its tabs
 *   stop painting in the background and the window throttles again.
 */
export function createSidebarBrowser({ getWindow, idleMs = 15_000 }) {
  const secret = randomBytes(24).toString('hex')
  const groups = new Map()  // session id -> one conversation's endpoint
  const pages = new Map()   // guest webContents id -> page
  const opening = new Map() // open request id -> { resolve, reject, timer }
  const arrivals = new Map() // `${session} ${tab}` -> resolve(page)
  const binding = new Set() // guest ids whose target id is being read
  let server, newTabUrl, active = 0, presses = 0

  const tell = message => {
    const window = getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(SIDEBAR_BROWSER_IPC.request, message)
  }
  const group = sessionId => {
    let value = groups.get(sessionId)
    if (!value) groups.set(sessionId, value = { sessionId, pages: new Map(), sessions: new Map(), children: new Map(), autoAttach: false, discover: false })
    return value
  }
  const send = (target, message) => { if (target.client?.readyState === 1) target.client.send(JSON.stringify(message)) }
  const info = page => ({
    targetId: page.targetId, type: 'page', title: page.guest.isDestroyed() ? '' : page.guest.getTitle(),
    url: page.guest.isDestroyed() ? '' : page.guest.getURL() || 'about:blank', attached: page.sessions.size > 0,
    canAccessOpener: false, browserContextId: page.group.sessionId,
  })
  const pageOf = (target, targetId) => {
    const page = target.pages.get(targetId)
    if (!page) throw failure('No target with given id found')
    return page
  }
  const attachSession = page => {
    if (!page.attached) { page.guest.debugger.attach('1.3'); page.attached = true }
    const sessionId = id()
    page.group.sessions.set(sessionId, page)
    page.sessions.add(sessionId)
    send(page.group, { method: 'Target.attachedToTarget', params: { sessionId, targetInfo: info(page), waitingForDebugger: false } })
    return sessionId
  }
  const detachPage = page => {
    for (const sessionId of page.sessions) page.group.sessions.delete(sessionId)
    for (const sessionId of page.frames.values()) page.group.children.delete(sessionId)
    page.sessions.clear()
    page.frames.clear()
    if (page.attached && !page.guest.isDestroyed()) page.guest.debugger.detach()
    page.attached = false
  }

  // While an Agent works in a conversation, its tabs keep rendering even in
  // the background and the window keeps painting when covered or hidden:
  // Playwright waits for animation frames before it clicks. The tab it acts
  // on visibly comes forward for the user. The Agent rests once nothing is in
  // flight for idleMs, since a command itself may wait for the page to paint.
  const throttle = () => {
    const window = getWindow()
    if (window && !window.isDestroyed()) window.webContents.setBackgroundThrottling(active === 0)
  }
  const touch = (target, page, visible) => {
    if (!target.active) {
      target.active = true
      if (active++ === 0) throttle()
      tell({ type: 'show', sessionId: target.sessionId })
    }
    if (!visible || page === target.current) return
    target.current = page
    // The Sidebar opens once per connection; afterwards the user decides.
    tell({ type: 'show', sessionId: target.sessionId, tabId: page.tabId, expand: !target.expanded })
    target.expanded = true
  }
  const rest = target => {
    clearTimeout(target.idle)
    if (!target.active) return
    target.active = false
    target.current = undefined
    if (--active === 0) throttle()
    tell({ type: 'idle', sessionId: target.sessionId })
  }
  const disconnect = target => {
    for (const page of target.pages.values()) detachPage(page)
    target.client = undefined
    target.autoAttach = target.discover = target.expanded = false
    rest(target)
  }

  // The renderer opens a Sidebar tab in that conversation; its guest arrives
  // through bind. A blank target shows a local page until the Agent navigates.
  // The Sidebar loads that page itself as the guest gets ready, just before
  // the renderer reports the guest, and reports the page failed when another
  // navigation aborts the load: the tab is handed out once the load ends.
  const awaitTab = async (sessionId, tabId) => {
    const page = [...pages.values()].find(page => page.group.sessionId === sessionId && page.tabId === tabId)
      ?? await new Promise(resolve => arrivals.set(`${sessionId} ${tabId}`, resolve))
    if (page.guest.isLoading()) await once(page.guest, 'did-stop-loading')
    return page
  }
  async function open(target, url) {
    const request = id()
    const work = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { opening.delete(request); reject(failure('The Sidebar did not open the new tab in time')) }, OPEN_TIMEOUT_MS)
      opening.set(request, { resolve, reject, timer })
    })
    tell({ type: 'open', id: request, sessionId: target.sessionId, url: /^https?:/u.test(url ?? '') ? url : newTabUrl })
    const tabId = await work
    let timer
    try {
      return await Promise.race([awaitTab(target.sessionId, tabId), new Promise((_, reject) => {
        timer = setTimeout(() => reject(failure('The new Sidebar tab did not load in time')), OPEN_TIMEOUT_MS)
      })])
    } finally {
      clearTimeout(timer)
      arrivals.delete(`${target.sessionId} ${tabId}`)
    }
  }
  const close = page => tell({ type: 'close', sessionId: page.group.sessionId, tabId: page.tabId })

  async function browserCommand(target, socket, method, params) {
    switch (method) {
      case 'Browser.getVersion': return { protocolVersion: '1.3', product: `Chrome/${process.versions.chrome}`, revision: '', userAgent: '', jsVersion: process.versions.v8 }
      case 'Browser.close': socket.close(); return {}
      case 'Browser.getWindowForTarget': return { windowId: 1, bounds: { left: 0, top: 0, width: 0, height: 0, windowState: 'normal' } }
      // The Sidebar's own policy already denies downloads and permissions.
      case 'Browser.setDownloadBehavior': case 'Browser.grantPermissions': case 'Browser.resetPermissions': return {}
      case 'Target.setAutoAttach':
        target.autoAttach = params.autoAttach
        if (target.autoAttach) for (const page of target.pages.values()) if (page.sessions.size === 0) attachSession(page)
        return {}
      case 'Target.setDiscoverTargets':
        target.discover = params.discover
        if (target.discover) for (const page of target.pages.values()) send(target, { method: 'Target.targetCreated', params: { targetInfo: info(page) } })
        return {}
      case 'Target.getTargetInfo': return { targetInfo: params.targetId ? info(pageOf(target, params.targetId)) : { targetId: 'browser', type: 'browser', title: '', url: '', attached: true, canAccessOpener: false } }
      case 'Target.getTargets': return { targetInfos: [...target.pages.values()].map(info) }
      case 'Target.getBrowserContexts': return { browserContextIds: [] }
      case 'Target.createTarget': return { targetId: (await open(target, params.url)).targetId }
      case 'Target.closeTarget': close(pageOf(target, params.targetId)); return { success: true }
      case 'Target.activateTarget': touch(target, pageOf(target, params.targetId), true); return {}
      case 'Target.attachToTarget': return { sessionId: attachSession(pageOf(target, params.targetId)) }
      case 'Target.detachFromTarget': {
        const page = target.sessions.get(params.sessionId)
        target.sessions.delete(params.sessionId)
        page?.sessions.delete(params.sessionId)
        return {}
      }
      // The user's cookies stay theirs.
      case 'Storage.getCookies': return { cookies: [] }
    }
    throw failure(`'${method}' wasn't found`, -32601)
  }

  // A cross-site iframe owns its own widget; follow focus down to it.
  async function keyboardSession(page) {
    const command = (method, params, sessionId) => page.guest.debugger.sendCommand(method, params, sessionId)
    for (let sessionId; ;) {
      const { result } = await command('Runtime.evaluate', { expression: 'document.activeElement', objectGroup: 'eduwork-keyboard' }, sessionId)
      const frameId = result.className === 'HTMLIFrameElement'
        ? (await command('DOM.describeNode', { objectId: result.objectId }, sessionId)).node.frameId : undefined
      await command('Runtime.releaseObjectGroup', { objectGroup: 'eduwork-keyboard' }, sessionId)
      const child = page.frames.get(frameId)
      if (child === undefined) return sessionId
      sessionId = child
    }
  }
  async function keyboard(page, method, params) {
    const frame = await keyboardSession(page)
    if (frame !== undefined) return page.guest.debugger.sendCommand(method, params, frame)
    const { guest } = page
    if (method === 'Input.insertText') { guest.insertText(params.text); return {} }
    const modifiers = modifierNames.filter(([bit]) => params.modifiers & bit).map(([, name]) => name)
    if (params.type === 'char') { guest.sendInputEvent({ type: 'char', keyCode: params.text, modifiers }); return {} }
    guest.sendInputEvent({ type: params.type === 'keyUp' ? 'keyUp' : 'keyDown', keyCode: electronKeys[params.key] ?? params.key ?? params.code, modifiers })
    if (params.type === 'keyDown' && params.text) guest.sendInputEvent({ type: 'char', keyCode: params.text, modifiers })
    return {}
  }

  async function pageCommand(page, method, params) {
    if (method === 'Input.insertText' || method === 'Input.dispatchKeyEvent') return keyboard(page, method, params)
    switch (method) {
      case 'Input.dispatchMouseEvent': {
        // A press focuses the guest's element in the application window.
        if (params.type !== 'mousePressed') return page.guest.debugger.sendCommand(method, params)
        const press = ++presses
        tell({ type: 'press', id: press, sessionId: page.group.sessionId, tabId: page.tabId })
        try { return await page.guest.debugger.sendCommand(method, params) } finally { tell({ type: 'pressed', id: press }) }
      }
      case 'Page.bringToFront': return {}
      case 'Page.close': close(page); return {}
      case 'Browser.getWindowForTarget': return { windowId: 1, bounds: { left: 0, top: 0, width: 0, height: 0, windowState: 'normal' } }
    }
    return undefined
  }

  // Answers go to the connection that asked, even after a newer one replaced it.
  async function dispatch(target, socket, { id: messageId, method, params = {}, sessionId }) {
    const reply = value => { if (socket.readyState === 1) socket.send(JSON.stringify({ id: messageId, ...sessionId === undefined ? {} : { sessionId }, ...value })) }
    try {
      if (sessionId === undefined) { touch(target); return reply({ result: await browserCommand(target, socket, method, params) }) }
      const page = target.sessions.get(sessionId)
      const carrier = page ?? target.children.get(sessionId)
      if (!carrier) throw failure('Session with given id not found.')
      touch(target, carrier, visibleOnPage.has(method))
      const result = page && await pageCommand(page, method, params)
      if (result !== undefined) return reply({ result })
      if (!allowedOnPage(method)) throw failure(`'${method}' is not available in the Sidebar browser`, -32601)
      reply({ result: await carrier.guest.debugger.sendCommand(method, params, page ? undefined : sessionId) })
    } catch (error) {
      reply({ error: { code: error.code ?? -32000, message: error.message } })
    }
  }

  const sessionOf = url => {
    const match = /^\/([0-9a-f]{48})\/([\w-]{1,200})$/u.exec(url ?? '')
    return match && timingSafeEqual(Buffer.from(match[1]), Buffer.from(secret)) ? match[2] : undefined
  }

  return {
    /** @returns the Host environment naming this window's endpoint. */
    async listen() {
      server ??= await new Promise((resolve, reject) => {
        const http = createServer((request, response) => {
          if (request.method === 'GET' && request.url === '/new-tab') response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(newTabPage(request.headers['accept-language']))
          else response.writeHead(404).end()
        })
        // A browser page's WebSocket always carries an Origin; the Host's client does not.
        const sockets = new WebSocketServer({ server: http, verifyClient: ({ origin, req }) => origin === undefined && sessionOf(req.url) !== undefined })
        sockets.on('connection', (socket, request) => {
          const target = group(sessionOf(request.url))
          // A resumed conversation's new Agent replaces its predecessor's connection.
          if (target.client) { const previous = target.client; disconnect(target); previous.terminate() }
          target.client = socket
          let busy = 0
          socket.on('message', async data => {
            let message
            try { message = JSON.parse(data) } catch { return }
            clearTimeout(target.idle)
            busy++
            await dispatch(target, socket, message)
            if (--busy === 0 && target.client === socket) target.idle = setTimeout(() => rest(target), idleMs)
          })
          socket.on('close', () => { if (target.client === socket) disconnect(target) })
        })
        http.once('error', reject)
        http.listen(0, '127.0.0.1', () => resolve(http))
      })
      const { port } = server.address()
      newTabUrl = `http://127.0.0.1:${port}/new-tab`
      return { [SIDEBAR_BROWSER_ENV]: `ws://127.0.0.1:${port}/${secret}` }
    },

    /**
     * The renderer reports which conversation and tab a Sidebar guest shows.
     * @param window - the verified application window that sent it.
     */
    async bind(window, guestId, sessionId, tabId) {
      const guest = Number.isSafeInteger(guestId) ? webContents.fromId(guestId) : undefined
      if (!guest || guest.getType() !== 'webview' || guest.hostWebContents !== window.webContents || !validId(sessionId) || !validId(tabId)) {
        throw new Error('Rejected Sidebar browser guest')
      }
      if (binding.has(guest.id) || pages.has(guest.id)) return
      binding.add(guest.id)
      // A guest's own target id, so frame ids match what Playwright sees.
      let targetId
      try {
        guest.debugger.attach('1.3')
        targetId = (await guest.debugger.sendCommand('Target.getTargetInfo')).targetInfo.targetId
      } finally {
        binding.delete(guest.id)
        if (!guest.isDestroyed() && guest.debugger.isAttached()) guest.debugger.detach()
      }
      if (guest.isDestroyed()) return
      const target = group(sessionId)
      const page = { guest, group: target, tabId, targetId, sessions: new Set(), frames: new Map(), attached: false }
      pages.set(guest.id, page)
      guest.debugger.on('message', (_event, method, params, child) => {
        if (!target.client || !page.attached) return
        if (method === 'Target.attachedToTarget') { target.children.set(params.sessionId, page); page.frames.set(params.targetInfo.targetId, params.sessionId) }
        if (method === 'Target.detachedFromTarget') { target.children.delete(params.sessionId); page.frames.delete(params.targetId) }
        if (child) send(target, { method, params, sessionId: child })
        else for (const sessionId of page.sessions) send(target, { method, params, sessionId })
      })
      guest.debugger.on('detach', () => {
        for (const sessionId of page.sessions) send(target, { method: 'Target.detachedFromTarget', params: { sessionId, targetId: page.targetId } })
        page.attached = false
        detachPage(page)
      })
      // The local new-tab page is not a history entry the user can return to.
      guest.on('did-navigate', (_event, url) => {
        if (url !== newTabUrl && guest.navigationHistory.getEntryAtIndex(0)?.url === newTabUrl) guest.navigationHistory.clear()
      })
      guest.once('destroyed', () => {
        pages.delete(guest.id)
        target.pages.delete(page.targetId)
        for (const sessionId of page.sessions) {
          target.sessions.delete(sessionId)
          send(target, { method: 'Target.detachedFromTarget', params: { sessionId, targetId: page.targetId } })
        }
        for (const sessionId of page.frames.values()) target.children.delete(sessionId)
        if (target.discover) send(target, { method: 'Target.targetDestroyed', params: { targetId: page.targetId } })
        if (target.current === page) target.current = undefined
      })
      target.pages.set(page.targetId, page)
      if (target.client) {
        if (target.discover) send(target, { method: 'Target.targetCreated', params: { targetInfo: info(page) } })
        if (target.autoAttach) attachSession(page)
      }
      arrivals.get(`${sessionId} ${tabId}`)?.(page)
    },

    /** The renderer's answer to an open request: the new tab, or why not. */
    opened(request, result) {
      const pending = opening.get(request)
      if (!pending) return
      opening.delete(request)
      clearTimeout(pending.timer)
      if (validId(result?.tabId)) pending.resolve(result.tabId)
      else pending.reject(failure(typeof result?.error === 'string' ? result.error.slice(0, 500) : 'The Sidebar could not open a tab'))
    },

    close() {
      for (const target of groups.values()) { clearTimeout(target.idle); target.client?.terminate() }
      server?.close()
    },
  }
}
