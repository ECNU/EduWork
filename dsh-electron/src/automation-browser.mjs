// Playwright and Remotion launch this executable as their Chromium, so the
// product ships no second browser. Electron's own CDP cannot create targets or
// browser contexts, so the main process answers browser-level commands with
// windows and session partitions and relays each page through
// webContents.debugger. Playwright talks over --remote-debugging-pipe. Remotion
// only speaks WebSocket and gets a loopback endpoint behind a random path.
// Chromium's own debugging handlers are never started.
import { app, BrowserWindow, dialog, Menu, session } from 'electron'
import { randomBytes, randomUUID } from 'node:crypto'
import { Socket } from 'node:net'
import { join } from 'node:path'
import { WebSocketServer } from 'ws'

// Nothing launches the desktop app over a debugging pipe. A debugging port
// alone stays the developer's Electron inspector; Remotion marks automation.
export function automationBrowserMode(commandLine) {
  if (commandLine.hasSwitch('remote-debugging-pipe')) return 'pipe'
  if (commandLine.hasSwitch('remote-debugging-port') && commandLine.hasSwitch('enable-automation')) return 'websocket'
  return undefined
}

const allowedPermissions = new Set(['clipboard-sanitized-write', 'fullscreen'])
// What a visible page may ask its user for, as Chrome would prompt.
const askablePermissions = { 'clipboard-read': '读取剪贴板', geolocation: '获取你的位置', media: '使用摄像头或麦克风', notifications: '显示通知' }
const id = () => randomUUID().replaceAll('-', '').toUpperCase()

// Chrome's reduced user agent: no Electron or product tokens for sites to key on.
export function chromeUserAgent(platform = process.platform, chrome = process.versions.chrome) {
  const system = platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64'
  return `Mozilla/5.0 (${system}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome.split('.')[0]}.0.0.0 Safari/537.36`
}

export function runAutomationBrowser(mode) {
  const { commandLine } = app
  const headless = commandLine.hasSwitch('headless')
  const userData = commandLine.getSwitchValue('user-data-dir')
  for (const name of ['remote-debugging-pipe', 'remote-debugging-port', 'headless']) commandLine.removeSwitch(name)
  // Windows never yields a hidden window's existing surface, so Remotion would
  // wait forever for its first frame. Playwright passes this feature itself.
  commandLine.appendSwitch('enable-features', [commandLine.getSwitchValue('enable-features'), 'CDPScreenshotNewSurface'].filter(Boolean).join(','))
  // Never fall back to the desktop profile: it holds the user's own session.
  if (!userData) { process.stderr.write('Automation browser requires --user-data-dir\n'); app.exit(1); return }
  app.setPath('userData', userData)
  const userAgent = chromeUserAgent()
  app.userAgentFallback = userAgent
  app.on('window-all-closed', () => {})
  // Electron would present the first client certificate without asking.
  app.on('select-client-certificate', (event, _contents, _url, _list, callback) => { event.preventDefault(); callback() })

  const contexts = new Map(), targets = new Map(), sessions = new Map(), children = new Map(), streams = new Map()
  // Playwright may set a context's download behavior before that context exists.
  const downloadBehavior = new Map(), downloads = new Map()
  const defaultContext = id()
  let autoAttach = false, discover = false, send = () => {}, closing

  const prepare = (ses, contextId) => {
    ses.setUserAgent(userAgent)
    // A visible page asks its user and the answer holds for that site until the
    // browser closes. Background pages are denied, as in headless Chrome.
    const answers = new Map()
    ses.setPermissionRequestHandler((contents, permission, callback, { requestingUrl }) => {
      const { origin, host } = new URL(requestingUrl), key = `${origin} ${permission}`
      if (allowedPermissions.has(permission)) return callback(true)
      if (answers.has(key)) return callback(answers.get(key))
      const window = BrowserWindow.fromWebContents(contents)
      if (headless || !askablePermissions[permission] || !window?.isVisible()) return callback(false)
      void dialog.showMessageBox(window, { type: 'question', message: `${host} 想要${askablePermissions[permission]}`, buttons: ['允许', '拒绝'], defaultId: 1, cancelId: 1 })
        .then(({ response }) => { answers.set(key, response === 0); callback(response === 0) })
    })
    ses.setPermissionCheckHandler((_contents, permission, origin) => allowedPermissions.has(permission) || answers.get(`${origin} ${permission}`) === true)
    ses.setDevicePermissionHandler(() => false)
    // Downloads follow the client's Browser.setDownloadBehavior and report the
    // same events as Chrome. Anything but an explicit allow is cancelled.
    ses.on('will-download', (_event, item, contents) => {
      const { behavior, downloadPath, eventsEnabled } = downloadBehavior.get(contextId) ?? {}
      const guid = randomUUID()
      const progress = state => eventsEnabled && send({ method: 'Browser.downloadProgress', params: { guid, totalBytes: item.getTotalBytes(), receivedBytes: item.getReceivedBytes(), state } })
      if (eventsEnabled) {
        const page = [...targets.values()].find(page => page.window.webContents === contents)
        send({ method: 'Browser.downloadWillBegin', params: { frameId: page?.targetId, guid, url: item.getURL(), suggestedFilename: item.getFilename() } })
      }
      item.on('updated', () => progress('inProgress'))
      item.once('done', (_event, state) => { downloads.delete(guid); progress(state === 'completed' ? 'completed' : 'canceled') })
      if (behavior !== 'allow' && behavior !== 'allowAndName') return item.cancel()
      downloads.set(guid, item)
      item.setSavePath(join(downloadPath, behavior === 'allowAndName' ? guid : item.getFilename()))
    })
    return ses
  }
  const context = contextId => {
    const value = contexts.get(contextId ?? defaultContext)
    if (!value) throw new Error(`Failed to find browser context with id ${contextId}`)
    return value
  }
  const target = targetId => {
    const value = targets.get(targetId)
    if (!value) throw new Error('No target with given id found')
    return value
  }
  const info = page => {
    const contents = page.window.webContents
    return {
      targetId: page.targetId, type: 'page', title: contents.isDestroyed() ? '' : contents.getTitle(),
      url: contents.isDestroyed() ? '' : contents.getURL() || 'about:blank', attached: page.sessions.size > 0,
      canAccessOpener: page.openerId !== undefined, browserContextId: page.contextId, ...page.openerId ? { openerId: page.openerId } : {},
    }
  }
  const attach = page => {
    const sessionId = id()
    sessions.set(sessionId, page)
    page.sessions.add(sessionId)
    send({ method: 'Target.attachedToTarget', params: { sessionId, targetInfo: info(page), waitingForDebugger: false } })
    return sessionId
  }
  const reveal = window => {
    if (headless || window.isDestroyed()) return
    window.show()
    window.focus()
    if (process.platform === 'darwin') app.focus({ steal: true })
  }
  const windowOptions = ses => ({
    show: !headless, width: 1280, height: 800,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  })

  async function adopt(window, contextId, openerId) {
    const contents = window.webContents
    contents.debugger.attach('1.3')
    // Electron's window.prompt throws. Answer as Chrome does when the client
    // dismisses every dialog, which Playwright does without a handler.
    await contents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: 'window.prompt = () => null', runImmediately: true })
    const { targetInfo } = await contents.debugger.sendCommand('Target.getTargetInfo')
    const page = { targetId: targetInfo.targetId, window, contextId, openerId, sessions: new Set() }
    targets.set(page.targetId, page)
    contents.debugger.on('message', (_event, method, params, child) => {
      // Iframes and workers arrive through the page's own flattened auto-attach.
      if (method === 'Target.attachedToTarget') children.set(params.sessionId, page)
      if (method === 'Target.detachedFromTarget') children.delete(params.sessionId)
      if (child) send({ method, params, sessionId: child })
      else for (const sessionId of page.sessions) send({ method, params, sessionId })
    })
    contents.setWindowOpenHandler(() => ({ action: 'allow', overrideBrowserWindowOptions: windowOptions(contents.session) }))
    contents.on('did-create-window', popup => {
      void adopt(popup, contextId, page.targetId).then(opened => { if (autoAttach) attach(opened) })
    })
    // Show where a visible login page really is, not just its own title.
    window.on('page-title-updated', (event, title) => {
      event.preventDefault()
      const { host } = URL.parse(contents.getURL()) ?? {}
      window.setTitle(host ? `${title} — ${host}` : title)
    })
    window.on('closed', () => {
      targets.delete(page.targetId)
      for (const sessionId of page.sessions) {
        sessions.delete(sessionId)
        send({ method: 'Target.detachedFromTarget', params: { sessionId, targetId: page.targetId } })
      }
      if (discover) send({ method: 'Target.targetDestroyed', params: { targetId: page.targetId } })
    })
    if (discover) send({ method: 'Target.targetCreated', params: { targetInfo: info(page) } })
    return page
  }

  async function createPage(contextId, url = 'about:blank') {
    const window = new BrowserWindow(windowOptions(context(contextId).session))
    await window.loadURL('about:blank')
    const page = await adopt(window, contextId ?? defaultContext)
    if (autoAttach) attach(page)
    if (url !== 'about:blank') void window.loadURL(url).catch(() => {})
    return page
  }

  const bounds = window => {
    const { x, y, width, height } = window.getBounds()
    return { left: x, top: y, width, height, windowState: window.isMinimized() ? 'minimized' : window.isFullScreen() ? 'fullscreen' : 'normal' }
  }
  const setBounds = (window, { left, top, width, height }) => {
    const current = window.getBounds()
    window.setBounds({ x: left ?? current.x, y: top ?? current.y, width: width ?? current.width, height: height ?? current.height })
    return {}
  }

  // Page-session commands that webContents.debugger does not serve.
  async function pageCommand(page, method, params) {
    const { window } = page
    switch (method) {
      case 'Page.printToPDF': {
        const data = await window.webContents.printToPDF({
          landscape: params.landscape, displayHeaderFooter: params.displayHeaderFooter, printBackground: params.printBackground, scale: params.scale,
          pageSize: { width: params.paperWidth ?? 8.5, height: params.paperHeight ?? 11 },
          margins: { top: params.marginTop ?? 0, bottom: params.marginBottom ?? 0, left: params.marginLeft ?? 0, right: params.marginRight ?? 0 },
          pageRanges: params.pageRanges, headerTemplate: params.headerTemplate, footerTemplate: params.footerTemplate,
          preferCSSPageSize: params.preferCSSPageSize, generateTaggedPDF: params.generateTaggedPDF, generateDocumentOutline: params.generateDocumentOutline,
        })
        if (params.transferMode !== 'ReturnAsStream') return { data: data.toString('base64') }
        const handle = randomUUID()
        streams.set(handle, { data, offset: 0 })
        return { stream: handle }
      }
      case 'IO.read': {
        const stream = streams.get(params.handle)
        if (!stream) throw new Error('Invalid stream handle')
        const chunk = stream.data.subarray(stream.offset, stream.offset + (params.size ?? 1 << 20))
        stream.offset += chunk.length
        return { data: chunk.toString('base64'), base64Encoded: true, eof: stream.offset >= stream.data.length }
      }
      case 'IO.close': streams.delete(params.handle); return {}
      case 'Browser.getWindowForTarget': return { windowId: window.id, bounds: bounds(window) }
      case 'Browser.getWindowBounds': return { bounds: bounds(window) }
      case 'Browser.setWindowBounds': return setBounds(window, params.bounds)
      case 'Page.bringToFront': reveal(window); return {}
      case 'Page.close': setImmediate(() => window.destroy()); return {}
    }
    return undefined
  }

  async function browserCommand(method, params) {
    switch (method) {
      case 'Browser.getVersion': {
        const product = headless ? 'HeadlessChrome' : 'Chrome'
        return { protocolVersion: '1.3', product: `${product}/${process.versions.chrome}`, revision: '', userAgent: userAgent.replace('Chrome/', `${product}/`), jsVersion: process.versions.v8 }
      }
      case 'Browser.close': void close(); return {}
      case 'Browser.getWindowForTarget': { const { window } = target(params.targetId); return { windowId: window.id, bounds: bounds(window) } }
      case 'Browser.setWindowBounds': return setBounds(BrowserWindow.fromId(params.windowId), params.bounds)
      case 'Browser.setDownloadBehavior': downloadBehavior.set(params.browserContextId ?? defaultContext, params); return {}
      case 'Browser.cancelDownload': downloads.get(params.guid)?.cancel(); return {}
      // Site permissions are decided in prepare.
      case 'Browser.grantPermissions': case 'Browser.resetPermissions': return {}
      case 'Target.setAutoAttach':
        autoAttach = params.autoAttach
        if (autoAttach) for (const page of targets.values()) if (page.sessions.size === 0) attach(page)
        return {}
      case 'Target.setDiscoverTargets':
        discover = params.discover
        if (discover) for (const page of targets.values()) send({ method: 'Target.targetCreated', params: { targetInfo: info(page) } })
        return {}
      case 'Target.getTargetInfo': return { targetInfo: { targetId: 'browser', type: 'browser', title: '', url: '', attached: true, canAccessOpener: false } }
      case 'Target.getTargets': return { targetInfos: [...targets.values()].map(info) }
      case 'Target.createBrowserContext': {
        const contextId = id()
        contexts.set(contextId, { session: prepare(session.fromPartition(`automation-${contextId}`), contextId) })
        return { browserContextId: contextId }
      }
      case 'Target.disposeBrowserContext': {
        const { session: ses } = context(params.browserContextId)
        for (const page of [...targets.values()]) if (page.contextId === params.browserContextId) page.window.destroy()
        contexts.delete(params.browserContextId)
        await ses.clearStorageData()
        return {}
      }
      case 'Target.createTarget': return { targetId: (await createPage(params.browserContextId, params.url)).targetId }
      case 'Target.closeTarget': { const { window } = target(params.targetId); setImmediate(() => window.destroy()); return { success: true } }
      case 'Target.activateTarget': reveal(target(params.targetId).window); return {}
      case 'Target.attachToTarget': return { sessionId: attach(target(params.targetId)) }
      case 'Target.detachFromTarget': {
        const page = sessions.get(params.sessionId)
        sessions.delete(params.sessionId)
        page?.sessions.delete(params.sessionId)
        return {}
      }
      case 'Storage.getCookies': {
        const cookies = await context(params.browserContextId).session.cookies.get({})
        return { cookies: cookies.map(cookie => ({
          name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path, expires: cookie.session ? -1 : cookie.expirationDate,
          size: cookie.name.length + cookie.value.length, httpOnly: cookie.httpOnly, secure: cookie.secure, session: cookie.session,
          sameSite: { strict: 'Strict', lax: 'Lax', no_restriction: 'None' }[cookie.sameSite], priority: 'Medium', sourceScheme: cookie.secure ? 'Secure' : 'NonSecure',
        })) }
      }
      case 'Storage.setCookies': {
        const { cookies } = context(params.browserContextId).session
        for (const cookie of params.cookies) {
          const host = cookie.domain?.replace(/^\./u, '')
          await cookies.set({
            url: cookie.url ?? `http${cookie.secure ? 's' : ''}://${host}${cookie.path ?? '/'}`, name: cookie.name, value: cookie.value,
            domain: cookie.domain, path: cookie.path, secure: cookie.secure, httpOnly: cookie.httpOnly,
            expirationDate: cookie.expires > 0 ? cookie.expires : undefined,
            sameSite: { Strict: 'strict', Lax: 'lax', None: 'no_restriction' }[cookie.sameSite] ?? 'unspecified',
          })
        }
        return {}
      }
      case 'Storage.clearCookies': await context(params.browserContextId).session.clearStorageData({ storages: ['cookies'] }); return {}
    }
    throw Object.assign(new Error(`'${method}' wasn't found`), { code: -32601 })
  }

  async function dispatch({ id: messageId, method, params = {}, sessionId }) {
    const reply = value => send({ id: messageId, ...sessionId === undefined ? {} : { sessionId }, ...value })
    try {
      if (sessionId === undefined) return reply({ result: await browserCommand(method, params) })
      const page = sessions.get(sessionId)
      const result = page && await pageCommand(page, method, params)
      if (result !== undefined) return reply({ result })
      const carrier = page ?? children.get(sessionId)
      if (!carrier) throw new Error('Session with given id not found.')
      reply({ result: await carrier.window.webContents.debugger.sendCommand(method, params, page ? undefined : sessionId) })
    } catch (error) {
      reply({ error: { code: error.code ?? -32000, message: error.message } })
    }
  }

  // Cookies of the persistent profile must reach disk before the process ends.
  function close() {
    closing ??= (async () => {
      await Promise.all([...contexts.values()].map(({ session: ses }) => ses.cookies.flushStore().catch(() => {})))
      app.exit(0)
    })()
    return closing
  }

  const transport = mode === 'pipe' ? pipeTransport(dispatch, close) : websocketTransport(dispatch, close)
  send = transport.send
  void app.whenReady().then(async () => {
    if (process.platform === 'darwin') {
      app.dock?.hide()
      Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]))
    } else Menu.setApplicationMenu(null)
    contexts.set(defaultContext, { session: prepare(session.defaultSession, defaultContext) })
    // Chrome opens its startup pages unless told not to; callers wait for them.
    if (!commandLine.hasSwitch('no-startup-window')) {
      const urls = process.argv.slice(1).filter(arg => /^(?:about|https?|data):/u.test(arg))
      for (const url of urls.length ? urls : ['about:blank']) await createPage(defaultContext, url)
    }
    await transport.ready?.()
  })
}

// Playwright writes NUL-terminated JSON to fd 3 and reads replies from fd 4.
// These are libuv pipe handles: a blocking fs read on fd 3 would hold a
// threadpool slot and keep app.exit() from completing.
function pipeTransport(dispatch, close) {
  const input = new Socket({ fd: 3, readable: true, writable: false })
  const output = new Socket({ fd: 4, readable: false, writable: true })
  let pending = ''
  input.setEncoding('utf8')
  input.on('data', chunk => {
    pending += chunk
    for (let end = pending.indexOf('\0'); end >= 0; end = pending.indexOf('\0')) {
      const message = pending.slice(0, end)
      pending = pending.slice(end + 1)
      void dispatch(JSON.parse(message))
    }
  })
  input.on('close', () => void close())
  return { send: message => output.write(JSON.stringify(message) + '\0') }
}

// One local client: Remotion connects once to the address printed on stderr.
// The random path keeps other local processes and web pages out; any
// browser-originated request carries an Origin header and is refused.
function websocketTransport(dispatch, close) {
  const path = `/devtools/browser/${randomBytes(24).toString('hex')}`
  let client
  // A renderer whose parent died before connecting must not linger.
  const idle = setTimeout(() => void close(), 60_000)
  return {
    send: message => client?.send(JSON.stringify(message)),
    ready: () => new Promise((resolve, reject) => {
      const server = new WebSocketServer({ host: '127.0.0.1', port: 0, path, verifyClient: ({ origin }) => !client && origin === undefined })
      server.on('connection', socket => {
        client = socket
        clearTimeout(idle)
        socket.on('message', data => void dispatch(JSON.parse(data)))
        socket.on('close', () => void close())
      })
      server.once('error', reject)
      server.once('listening', () => {
        process.stderr.write(`\nDevTools listening on ws://127.0.0.1:${server.address().port}${path}\n`)
        resolve()
      })
    }),
  }
}
