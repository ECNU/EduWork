import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DesktopHostProcess as NativeHost } from './eduwork-native-host-process.mjs'
import { authenticateWebHost, forwardWebRequest, serveWebDocument } from './web-document.mjs'

// Preserve the product shell's lifecycle contract while the pinned official
// 0.1.7 Host owns Web transport. Credentials never cross the renderer bridge.
export class DesktopHostProcess {
  #host; #ready; #cookie; #runtime
  constructor(node, projectDir, inspectPort, options = {}) {
    if (!process.env.EDUWORK_PRODUCT_ROOT) throw new Error('Product Runtime location is unavailable')
    this.#runtime = join(process.env.EDUWORK_PRODUCT_ROOT, 'd')
    this.#host = new NativeHost(node, this.#runtime, projectDir, inspectPort, process.env,
      options.onFailure, undefined, undefined, undefined, { bootstrap: options.bootstrap, onLog: options.onLog })
  }
  async start() {
    const ready = await this.#host.start()
    const url = new URL(ready.url)
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || !url.port) {
      await this.#host.stop(); throw new Error('Host reported an invalid loopback address')
    }
    this.#cookie = await authenticateWebHost(ready.url)
    this.#ready = { origin: url.origin, injections: ready.injections ?? [] }
    return this.boot()
  }
  boot() {
    if (!this.#ready) throw new Error('Desktop Host has not finished starting')
    return { injections: this.#ready.injections, streamBaseUrl: this.#ready.origin }
  }
  get origin() { return this.#ready?.origin }
  inspectQuit() { return this.#host.inspectQuit() }
  async readLocalePreference() {
    const rpcId = randomUUID(), method = 'settings/describe'
    const response = await this.fetch(new Request(`dsh-app://app/api/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args: {} } }),
    }))
    const envelope = await response.json()
    if (!response.ok || envelope.type !== 'server-response' || envelope.rpcId !== rpcId || envelope.result?.ok !== true) throw new Error('Desktop locale unavailable')
    const preference = envelope.result.value?.namespaces?.find(item => item.ns === 'locale')?.value?.preference
    if (preference != null && typeof preference !== 'string') throw new Error('Invalid desktop locale preference')
    return preference ?? null
  }
  fetch(request) {
    const url = new URL(request.url)
    if (url.protocol !== 'dsh-app:' || url.hostname !== 'app') return Promise.resolve(new Response(null, { status: 403 }))
    if (!this.#ready) return Promise.resolve(new Response(null, { status: 503 }))
    if (['/', '/index.html', '/favicon.ico', '/manifest.webmanifest'].includes(url.pathname) || url.pathname.startsWith('/assets/')) {
      return serveWebDocument(request, join(this.#runtime, 'node_modules/@deepseek-ai/dsh-web-frontend/dist'))
    }
    return forwardWebRequest(request, this.#ready.origin, this.#cookie)
  }
  socketHeaders(details, ownerId) {
    if (!this.#ready || new URL(details.url).host !== new URL(this.#ready.origin).host) return {}
    const headers = Object.fromEntries(Object.entries(details.requestHeaders).map(([key, value]) => [key.toLowerCase(), value]))
    if (details.webContentsId !== ownerId || headers.origin !== 'dsh-app://app') return { cancel: true }
    return { requestHeaders: { ...headers, origin: this.#ready.origin, cookie: this.#cookie, 'sec-fetch-site': 'same-origin' } }
  }
  updateTasks(action) { return this.#host.updateTasks(action) }
  async stop() { this.#ready = undefined; this.#cookie = undefined; await this.#host.stop() }
}
