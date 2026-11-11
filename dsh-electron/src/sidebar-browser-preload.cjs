// The application's own page reports which conversation each Sidebar browser
// guest belongs to and carries out the Agent's tab requests (sidebar-browser.mjs).
// Only the trusted main frame gets this; the main process verifies it again.
if (process.isMainFrame && location.protocol === 'dsh-app:' && location.host === 'app') {
  const { contextBridge, ipcRenderer } = require('electron')
  contextBridge.exposeInMainWorld('eduworkSidebarBrowser', {
    bind: (guestId, sessionId, tabId) => ipcRenderer.send('eduwork:sidebar-browser:bind', guestId, sessionId, tabId),
    opened: (request, result) => ipcRenderer.send('eduwork:sidebar-browser:opened', request, result),
    onRequest: listener => {
      const handler = (_event, message) => listener(message)
      ipcRenderer.on('eduwork:sidebar-browser:request', handler)
      return () => ipcRenderer.off('eduwork:sidebar-browser:request', handler)
    },
  })
}

// Settings metadata stays on the trusted application frame, outside Host RPC.
if (process.isMainFrame && location.protocol === 'dsh-app:' && location.host === 'app') {
  const { contextBridge, ipcRenderer } = require('electron')
  contextBridge.exposeInMainWorld('eduworkPasswordSettings', Object.freeze({
    request: request => {
      if (request?.op !== 'builtin-snapshot' && !navigator.userActivation.isActive) {
        return Promise.resolve({ status: 'user-action-required' })
      }
      return ipcRenderer.invoke('eduwork:password-settings', request)
    },
  }))
}
