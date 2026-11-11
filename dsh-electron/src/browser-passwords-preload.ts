import { ipcRenderer } from 'electron'
import { installBrowserPasswordDetector } from '../vendor/orca/src/preload/browser-password-detector'
// Bundled into one sandbox-compatible preload; no API is exposed to page JavaScript.
if (process.isMainFrame) installBrowserPasswordDetector({
  send: (channel, payload) => ipcRenderer.send(channel, payload),
  on: (channel, listener) => ipcRenderer.on(channel, (_event, payload) => listener(payload)),
})
