/**
 * Host adapter: the only module that touches DSH. It uses the seams DSH offers
 * to transports — an independent owner Peer per connection, the shared `/api`
 * Fetch handler, Gateway `wireStream.open`, and `renderIndex` over the
 * published frontend, as the official frontend-static plugin does — and
 * nothing internal. The DSH services are typed structurally here, so the
 * package does not compile against DSH internals either.
 */
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import type { StreamFailure } from '../protocol/tunnel.ts'

/** A DSH Peer: one independent caller identity whose disposal ends its streams and refuses its later calls. */
export interface Peer { dispose(): Promise<void> }

/** The DSH Host services the adapter uses. */
export interface DshServices {
  readonly webServer: { renderIndex(html: string): string; getOrigin(): string }
  readonly connection: {
    createPeer(options: { principal: { kind: 'owner' }; interactions: 'answer' }): Peer
    createSharedFetchHandler(channel: '/api'): { fetch(request: Request, peer: Peer): Promise<Response> }
  }
  readonly typertGateway: {
    readonly wireStream: {
      open(endpoint: string, payload: unknown, uplink: AsyncIterable<unknown>, peer: Peer, signal: AbortSignal): Promise<AsyncIterable<unknown>>
      failure(error: unknown): StreamFailure
    }
  }
}

export interface HostAdapter {
  /** An owner Peer that answers approvals and questions, for one remote connection. */
  createPeer(): Peer
  /** The remote document and the frontend's public files: `/`, dist files, `/plugins/` bundles. */
  page(request: Request): Promise<Response>
  /** One `/api` request on behalf of `peer`. */
  api(request: Request, peer: Peer): Promise<Response>
  openStream(endpoint: string, payload: unknown, uplink: AsyncIterable<unknown>, peer: Peer, signal: AbortSignal): AsyncIterable<unknown>
  streamFailure(error: unknown): StreamFailure
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
}
const MISSING = new Set(['ENOENT', 'EISDIR', 'ENOTDIR'])
/** Response headers a public bundle keeps when it crosses to the device. */
const BUNDLE_HEADERS = ['content-type', 'cache-control', 'etag', 'last-modified']

/**
 * @param dsh - the Host's services.
 * @param distIndex - `index.html` of the published `@deepseek-ai/dsh-web-frontend` the Host serves.
 */
export function createHostAdapter(dsh: DshServices, distIndex: string): HostAdapter {
  const api = dsh.connection.createSharedFetchHandler('/api')
  const distRoot = dirname(distIndex)

  /** The document as the Host renders it for its own browser; the web client adds its transport hook. */
  async function document(): Promise<Response> {
    const html = dsh.webServer.renderIndex(await readFile(distIndex, 'utf8'))
    return new Response(html, { headers: { 'content-type': TYPES['.html']!, 'cache-control': 'no-store' } })
  }

  async function distFile(pathname: string): Promise<Response> {
    const target = resolve(normalize(join(distRoot, pathname)))
    if (!target.startsWith(distRoot + sep)) return new Response(null, { status: 404 })
    try {
      const body = await readFile(target)
      const immutable = pathname.startsWith('/assets/')
      return new Response(body, { headers: {
        'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
        'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      } })
    } catch (error) {
      if (MISSING.has((error as NodeJS.ErrnoException).code ?? '')) return new Response(null, { status: 404 })
      throw error
    }
  }

  /** Plugin client bundles are public Host routes; fetch them from the Host's own loopback origin. */
  async function bundle(url: URL, signal: AbortSignal): Promise<Response> {
    const response = await fetch(new URL(url.pathname + url.search, dsh.webServer.getOrigin()), { signal, redirect: 'error' })
    const headers = new Headers()
    for (const name of BUNDLE_HEADERS) {
      const value = response.headers.get(name)
      if (value !== null) headers.set(name, value)
    }
    return new Response(response.body, { status: response.status, headers })
  }

  return {
    createPeer: () => dsh.connection.createPeer({ principal: { kind: 'owner' }, interactions: 'answer' }),
    async page(request) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
      const url = new URL(request.url)
      const pathname = decodeURIComponent(url.pathname)
      if (pathname === '/' || pathname === '/index.html') return document()
      if (pathname.startsWith('/plugins/')) return bundle(url, request.signal)
      return distFile(pathname)
    },
    api: (request, peer) => api.fetch(request, peer),
    async *openStream(endpoint, payload, uplink, peer, signal) {
      yield* await dsh.typertGateway.wireStream.open(endpoint, payload, uplink, peer, signal)
    },
    streamFailure: error => dsh.typertGateway.wireStream.failure(error),
  }
}
