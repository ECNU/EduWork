// Only the application renderer can receive preview links or request an OS browser.
if (process.isMainFrame && location.protocol === 'dsh-app:' && location.host === 'app') {
  const { contextBridge: previewContextBridge, ipcRenderer: previewIpc } = require('electron')
  previewContextBridge.exposeInMainWorld('eduworkPreviewLinks', {
    subscribe(listener) {
      const receive = (_event, url) => listener(url)
      previewIpc.on('eduwork:preview-link', receive)
      previewIpc.send('eduwork:preview-ready', true)
      return () => {
        previewIpc.removeListener('eduwork:preview-link', receive)
        previewIpc.send('eduwork:preview-ready', false)
      }
    },
    openExternal(url) { previewIpc.send('eduwork:preview-external', url) },
  })
}
