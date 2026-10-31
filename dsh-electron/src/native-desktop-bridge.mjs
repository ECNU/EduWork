import { app, dialog, ipcMain, Menu, nativeTheme, session } from 'electron'
import { DESKTOP_IPC, assertDesktopSender } from './ipc.ts'
import { DesktopBrowserGuests } from './browser-guests.ts'
import { installMicrophonePermissions } from './microphone-permissions.ts'
import { installDesktopShortcuts } from './keyboard.ts'
import { resolveDesktopStartupLocale } from './locale.ts'
import { desktopEditMenu, desktopViewMenu, setDesktopApplicationMenu } from './desktop-menu.mjs'

export const USER_GUIDE_ROUTE = '/eduwork-user-guide'
export const USER_GUIDE_EVENT = 'eduwork:open-user-guide'

// Only main-process collaborators cross this composition boundary. Host launch
// credentials never become a renderer API or a browser guest's session cookie.
export function installNativeDesktopBridge({ getHost, waitForHost, getWindow, reportFatal, onBootFailure, checkUpdates, pickDirectory, bootBrand }) {
  const languages = app.getPreferredSystemLanguages()
  let locale = resolveDesktopStartupLocale(null, languages)
  const owner = event => {
    const window = getWindow()
    assertDesktopSender(event, ['app'])
    if (!window || window.isDestroyed() || event.sender !== window.webContents
      || event.senderFrame !== window.webContents.mainFrame) throw new Error('Rejected desktop command')
    return window
  }
  const guests = new DesktopBrowserGuests(() => getHost()?.origin)
  // Boot and locale requests start before the Host exists now. They join the
  // one startup attempt, then revalidate that the waiting frame still owns it.
  const currentHost = async event => {
    owner(event)
    if (waitForHost) await waitForHost()
    owner(event)
    const host = getHost()
    if (!host) throw new Error('Desktop Host is unavailable')
    return host
  }
  // An edition plugin may serve a user guide at USER_GUIDE_ROUTE; the page opens
  // it on the USER_GUIDE_EVENT window event. The item appears only once the Host
  // has confirmed the route, so editions without a guide show no dead entry.
  let userGuide = false
  const chinese = () => /[\u4e00-\u9fff]/u.test(locale.messages.quit ?? '')
  const openUserGuide = () => {
    const window = getWindow()
    if (!window || window.isDestroyed()) return
    window.show(); window.focus()
    void window.webContents.executeJavaScript(`window.dispatchEvent(new Event(${JSON.stringify(USER_GUIDE_EVENT)}))`).catch(() => {})
  }
  const applicationItems = () => [
    { role: 'about', label: locale.messages.aboutMenu.replaceAll('DeepSeek Harness', app.getName()) },
    { type: 'separator' },
    ...(userGuide ? [{ label: locale.messages.userGuide ?? (chinese() ? '使用教程' : 'User Guide'), click: openUserGuide }] : []),
    { label: locale.messages.checkUpdatesMenu, click: () => void Promise.resolve().then(checkUpdates).catch(error => dialog.showErrorBox(app.getName(), error.message)) },
    { type: 'separator' },
    ...(process.platform === 'darwin' ? [
      { role: 'hide', label: locale.messages.hideApplication.replaceAll('DeepSeek Harness', app.getName()) },
      { role: 'hideOthers', label: locale.messages.hideOtherApplications },
      { role: 'unhide', label: locale.messages.showAllApplications },
      { type: 'separator' },
    ] : []),
    { role: 'quit', label: locale.messages.quit },
  ]
  const refreshMenu = () => setDesktopApplicationMenu(Menu.buildFromTemplate([
    { label: app.getName(), submenu: applicationItems() },
    shortcuts.fileMenu(locale.messages), desktopEditMenu(locale), desktopViewMenu(locale),
    ...(process.platform === 'darwin' ? [{ role: 'windowMenu' }] : []),
  ]))
  const shortcuts = installDesktopShortcuts(getWindow, app.getPath('userData'),
    process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux', refreshMenu,
    () => ({ revision: 0, blocked: false }))
  ipcMain.handle(DESKTOP_IPC.directoryPick, event => { owner(event); return pickDirectory() })
  installMicrophonePermissions(session.defaultSession, () => getWindow()?.webContents)
  ipcMain.handle(DESKTOP_IPC.boot, async event => {
    const host = await currentHost(event)
    return host.boot()
  })
  ipcMain.handle(DESKTOP_IPC.bootFailed, (event, message) => {
    owner(event)
    if (typeof message !== 'string') throw new Error('Invalid boot diagnostic')
    const error = new Error(message.slice(0, 4000))
    if (onBootFailure) { onBootFailure(error); return }
    reportFatal(error, 'web-boot')
  })
  ipcMain.on('eduwork:boot-brand', event => {
    // Product name and a packaged PNG only; never expose Host state or paths.
    let value = ''
    try {
      const window = getWindow()
      if (window && !window.isDestroyed() && event.sender === window.webContents
        && event.senderFrame === event.sender.mainFrame && typeof bootBrand === 'function') value = bootBrand()
    } catch { /* A label failure must never block the page. */ }
    event.returnValue = value
  })
  ipcMain.handle(DESKTOP_IPC.browserAcquire, (event, workspace) => { owner(event); return guests.acquire(event.sender, workspace) })
  ipcMain.handle(DESKTOP_IPC.browserRelease, (event, lease) => { owner(event); return guests.release(event.sender, lease) })
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['ws://127.0.0.1/*'] }, (details, callback) => {
    callback(getHost()?.socketHeaders(details, getWindow()?.webContents.id) ?? {})
  })
  ipcMain.handle(DESKTOP_IPC.localeBootstrap, async event => {
    const host = await currentHost(event)
    const preference = await host.readLocalePreference()
    locale = resolveDesktopStartupLocale(preference, languages)
    refreshMenu()
    return { languages, preference }
  })
  ipcMain.on(DESKTOP_IPC.localeChanged, (event, next) => {
    try { owner(event) } catch { return }
    if (typeof next !== 'string') return
    locale = resolveDesktopStartupLocale(next, languages)
    refreshMenu()
  })
  ipcMain.on(DESKTOP_IPC.nativeThemeSet, (event, source) => {
    try { owner(event) } catch { return }
    if (['light', 'dark', 'system'].includes(source)) nativeTheme.themeSource = source
  })
  // The product's update settings remain authoritative. This upstream header
  // action opens that existing updater; it does not start a second installer.
  ipcMain.handle(DESKTOP_IPC.updatesStatus, event => { owner(event); return { phase: 'idle' } })
  ipcMain.handle(DESKTOP_IPC.updatesOpen, event => { owner(event); return checkUpdates() })
  if (process.platform === 'win32') {
    ipcMain.on(DESKTOP_IPC.windowsAppearance, (event, language, color, symbolColor) => {
      let window
      try { window = owner(event) } catch { return }
      if (typeof language === 'string' && /^[a-zA-Z]+(?:-[a-zA-Z0-9]+)*$/u.test(language)) {
        const next = resolveDesktopStartupLocale(language, languages)
        if (next.id !== locale.id) { locale = next; refreshMenu() }
      }
      const validColor = value => typeof value === 'string' && /^(?:#[\da-f]{3,8}|rgba?\([\d.,%\s]+\))$/iu.test(value)
      if (validColor(color) && validColor(symbolColor)) window.setTitleBarOverlay({ color, symbolColor })
    })
    ipcMain.handle(DESKTOP_IPC.windowsMenu, (event, name, x, y) => {
      const window = owner(event)
      if (!['application', 'edit'].includes(name) || !Number.isFinite(x) || !Number.isFinite(y)
        || x < 0 || y < 0 || x > 100000 || y > 100000) throw new Error('Invalid menu request')
      const items = name === 'application' ? applicationItems() : [
        ['undo', 'Z'], ['redo', 'Y'], null,
        ['cut', 'X'], ['copy', 'C'], ['paste', 'V'], ['delete', 'Delete'], null, ['selectAll', 'A'],
      ].map(item => item ? {
        label: locale.messages[item[0]],
        ...(item[0] === 'delete' ? {} : { accelerator: `Ctrl+${item[1]}` }),
        click: () => shortcuts.sendEditingKey(item[1], item[0] === 'delete' ? [] : ['control']),
      } : { type: 'separator' })
      const zoom = window.webContents.getZoomFactor()
      return new Promise(resolve => Menu.buildFromTemplate(items).popup({ window, x: Math.round(x * zoom), y: Math.round(y * zoom), callback: resolve }))
    })
  }
  refreshMenu()
  return {
    // locale.ts also runs in the sandboxed preload: brand only at this
    // main-process boundary, never import electron.app into shared locale code.
    locale: () => ({ ...locale, messages: Object.fromEntries(Object.entries(locale.messages)
      .map(([key, value]) => [key, value.replaceAll('DeepSeek Harness', app.getName())])) }),
    async probeUserGuide() {
      if (waitForHost) await waitForHost()
      const response = await getHost()?.fetch(new Request(`app://app${USER_GUIDE_ROUTE}/`, { method: 'HEAD' })).catch(() => null)
      const available = response?.ok === true
      if (available !== userGuide) { userGuide = available; refreshMenu() }
      return available
    },
    attach(window) { guests.bind(window, (guest, lease) => shortcuts.attachGuest(window, guest, lease)); shortcuts.attach(window) },
    dispose() { shortcuts.dispose() },
  }
}
