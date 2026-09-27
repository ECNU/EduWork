// Keep local application views in Electron; ordinary web links belong to the
// user's default browser. Never grant a remote page the desktop preload.
export function navigationTarget(raw) {
  try {
    const url = new URL(raw)
    if (url.username || url.password) return 'blocked'
    if (url.protocol === 'dsh-app:' && ['app', 'shell'].includes(url.hostname)) return 'internal'
    if (url.protocol === 'https:' || url.protocol === 'http:') return 'external'
  } catch {}
  return 'blocked'
}

export function attachExternalNavigation(contents, openExternal, onError = () => {}, openNative = async url => (await import('electron')).shell.openExternal(url)) {
  let previewReady = false
  const trusted = event => event.senderFrame === contents.mainFrame &&
    event.senderFrame?.url?.startsWith('dsh-app://app/')
  contents.on('ipc-message', (event, channel, value) => {
    if (!trusted(event)) return
    if (channel === 'eduwork:preview-ready') previewReady = value === true
    if (channel === 'eduwork:preview-external' && navigationTarget(value) === 'external') {
      void Promise.resolve().then(() => openNative(value)).catch(onError)
    }
  })
  contents.on('did-start-navigation', (_event, _url, inPlace, isMainFrame) => {
    if (isMainFrame && !inPlace) previewReady = false
  })
  const open = url => {
    if (previewReady && /\.(mp4|webm|mov|mp3|wav|ogg|opus|m4a|aac|flac)$/i.test(new URL(url).pathname)) {
      contents.send('eduwork:preview-link', url)
      return
    }
    // Both synchronous launch failures and rejected OS calls are contained.
    void Promise.resolve().then(() => openExternal(url)).catch(onError)
  }
  contents.setWindowOpenHandler(({ url }) => {
    if (navigationTarget(url) === 'external') open(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, legacyURL) => {
    const url = legacyURL ?? event.url
    const target = navigationTarget(url)
    if (target === 'internal') return
    event.preventDefault()
    if (target === 'external') open(url)
  })
}
