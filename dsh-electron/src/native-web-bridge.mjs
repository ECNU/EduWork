import { dialog, ipcMain, session, systemPreferences } from 'electron'

export const NATIVE_WEB_IPC = Object.freeze({ boot: 'eduwork:native-web:boot', failed: 'eduwork:native-web:failed', directory: 'eduwork:native-web:directory' })

export function registerNativeWebBridge({ getHost, getWindow }) {
  const owner = event => {
    const window = getWindow()
    if (!window || window.isDestroyed() || event.sender !== window.webContents
      || event.senderFrame !== window.webContents.mainFrame) throw new Error('Rejected desktop command')
    const url = new URL(event.senderFrame.url)
    if (url.protocol !== 'dsh-app:' || url.hostname !== 'app') throw new Error('Rejected desktop origin')
    return window
  }
  ipcMain.handle(NATIVE_WEB_IPC.boot, event => { owner(event); return getHost()?.boot() })
  ipcMain.handle(NATIVE_WEB_IPC.failed, (event, message) => {
    owner(event)
    if (typeof message !== 'string') throw new Error('Invalid boot diagnostic')
    console.error('Application frontend failed:', message.slice(0, 2000))
  })
  ipcMain.handle(NATIVE_WEB_IPC.directory, async event => {
    const window = owner(event)
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['ws://127.0.0.1/*'] }, (details, callback) => {
    callback(getHost()?.socketHeaders(details, getWindow()?.webContents.id) ?? {})
  })
  const owned = contents => {
    if (!contents || contents !== getWindow()?.webContents) return false
    try { const url = new URL(contents.getURL()); return url.protocol === 'dsh-app:' && url.hostname === 'app' }
    catch { return false }
  }
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) =>
    Boolean(owned(contents) && permission === 'media' && details.mediaType === 'audio'))
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (!owned(contents) || permission !== 'media' || !details.mediaTypes?.length
      || details.mediaTypes.some(type => type !== 'audio')) { callback(false); return }
    if (process.platform === 'darwin') systemPreferences.askForMediaAccess('microphone').then(callback, () => callback(false))
    else callback(true)
  })
}
