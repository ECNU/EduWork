import { contextBridge, ipcRenderer, webUtils } from 'electron'

// Keep the same origin boundary as the main-process owner check. Foreign
// previews receive no filesystem picker, boot data or native file paths.
if (location.protocol === 'dsh-app:' && location.hostname === 'app') {
  contextBridge.exposeInMainWorld('dshDesktopBoot', {
    ready: () => ipcRenderer.invoke('eduwork:native-web:boot'),
    failed: message => ipcRenderer.invoke('eduwork:native-web:failed', message),
  })
  contextBridge.exposeInMainWorld('__DSH_DIRECTORY_PICKER__', { pick: () => ipcRenderer.invoke('eduwork:native-web:directory') })
  contextBridge.exposeInMainWorld('__DSH_HOST_PATHS__', { pathFor: file => webUtils.getPathForFile(file) })
}
contextBridge.exposeInMainWorld('dshDesktop', { protocolVersion: 1 })
