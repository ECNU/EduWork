const STATIC_DOCUMENTS = new Set(['/', '/index.html', '/favicon.ico', '/favicon.svg', '/manifest.webmanifest'])

// Only the shell-owned frontend gets an early static path. Host API, plugin
// bundles and WebSocket traffic keep waiting for the authenticated Host.
export function classifyDesktopRequest(request) {
  let url
  try { url = new URL(request.url) } catch { return { kind: 'forbidden' } }
  if (url.protocol !== 'dsh-app:' || url.hostname !== 'app' || url.username || url.password) return { kind: 'forbidden', url }
  return STATIC_DOCUMENTS.has(url.pathname) || url.pathname.startsWith('/assets/')
    ? { kind: 'static', url }
    : { kind: 'host', url }
}
