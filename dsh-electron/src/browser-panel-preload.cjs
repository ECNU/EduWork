if (process.isMainFrame && location.protocol === 'dsh-app:' && location.host === 'app') {
  const { contextBridge, ipcRenderer } = require('electron')
  contextBridge.exposeInMainWorld('eduworkBrowserPanel', {
    command: request => ipcRenderer.invoke('eduwork:browser-panel', request),
    subscribe: listener => {
      const receive = (_event, value) => listener(value)
      ipcRenderer.on('eduwork:browser-panel-changed', receive)
      return () => ipcRenderer.removeListener('eduwork:browser-panel-changed', receive)
    },
  })
}
