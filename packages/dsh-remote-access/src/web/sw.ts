/**
 * The Service Worker behind every `h/<hostId>/app/` iframe, scoped to `h/`
 * below the relay's base URL. It answers the
 * iframe's requests through the loader page of the same Host: the document
 * (given the preamble first in its head), static files and plugin bundles
 * (cached per Host, since their URLs carry content hashes), and file
 * downloads and uploads. RPCs and streams bypass it through the preamble.
 */
import { appPath, hostPath, parseHostPath, type BridgeRequest, type BridgeResponse, type FetchMessage } from './bridge.ts'

// The DOM library is in scope for the rest of the client; declare the little of the worker scope used here.
interface ExtendableEvent extends Event { waitUntil(promise: Promise<unknown>): void }
interface FetchEvent extends ExtendableEvent { readonly request: Request; respondWith(response: Promise<Response>): void }
interface WindowClient { readonly url: string; postMessage(message: FetchMessage, transfer: Transferable[]): void }
const worker = globalThis as unknown as {
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEvent) => void): void
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void
  skipWaiting(): Promise<void>
  clients: { claim(): Promise<void>; matchAll(options: { type: 'window'; includeUncontrolled: true }): Promise<readonly WindowClient[]> }
  registration: { readonly scope: string }
}

/** The relay's base URL, one level above the scope. */
const base = new URL('../', worker.registration.scope)
const PREAMBLE = `<base href="./"><script src="${base.pathname}preamble.js"></script>`
const NULL_BODY = new Set([101, 204, 205, 304])

worker.addEventListener('install', event => event.waitUntil(worker.skipWaiting()))
worker.addEventListener('activate', event => event.waitUntil(worker.clients.claim()))
worker.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  const target = url.origin === base.origin && url.pathname.startsWith(base.pathname) ? parseHostPath(url.pathname.slice(base.pathname.length)) : undefined
  if (target === undefined || !target.rest.startsWith('app/')) return
  event.respondWith(answer(event.request, target.hostId, `/${target.rest.slice('app/'.length)}${url.search}`))
})

async function answer(request: Request, hostId: string, url: string): Promise<Response> {
  const cache = request.method === 'GET' && (url.startsWith('/assets/') || /[?&]rev=/.test(url)) ? await caches.open(`host-${hostId}`) : undefined
  const cached = await cache?.match(request)
  if (cached !== undefined) return cached
  const reply = await viaLoader(hostId, {
    method: request.method,
    url,
    // The Host gzips the frontend's files for the tunnel; this worker unpacks them.
    headers: [...request.headers, ['accept-encoding', 'gzip']],
    ...request.method !== 'GET' && request.method !== 'HEAD' && { body: await request.arrayBuffer() },
  })
  if ('error' in reply) return Response.error()
  const headers = new Headers(reply.headers)
  let body = reply.body
  if (headers.get('content-encoding') === 'gzip') {
    body = await new Response(new Blob([body]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
    headers.delete('content-encoding')
  }
  const isDocument = request.mode === 'navigate' && (url === '/' || url.startsWith('/?'))
  if (isDocument && headers.get('content-type')?.startsWith('text/html')) {
    const html = new TextDecoder().decode(body).replace(/<head(\s[^>]*)?>/i, head => head + PREAMBLE)
    return new Response(html, { status: reply.status, headers })
  }
  const response = new Response(NULL_BODY.has(reply.status) || request.method === 'HEAD' ? null : body, { status: reply.status, headers })
  if (cache !== undefined && response.ok) await cache.put(request, response.clone())
  return response
}

/** Ask the loader page of this Host, which owns its tunnel. */
async function viaLoader(hostId: string, request: BridgeRequest): Promise<BridgeResponse> {
  const windows = await worker.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const loader = windows.find(client => new URL(client.url).pathname === base.pathname + hostPath(hostId))
  if (loader === undefined) return { error: `no loader page is open for ${appPath(hostId)}` }
  const { port1, port2 } = new MessageChannel()
  const reply = new Promise<BridgeResponse>(resolve => {
    port1.onmessage = ({ data }: MessageEvent<BridgeResponse>) => resolve(data)
  })
  loader.postMessage({ kind: 'fetch', request }, [port2, ...request.body === undefined ? [] : [request.body]])
  return reply
}
