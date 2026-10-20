/**
 * The web client's files, as the relay serves them. Every page path gets the
 * same loader page; the DSH interface itself never comes from here but from
 * the Host, through the Service Worker.
 */
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { parseHostPath } from '../web/bridge.ts'

const FILES: Readonly<Record<string, string>> = {
  'loader.js': 'text/javascript; charset=utf-8',
  'loader.css': 'text/css; charset=utf-8',
  'sw.js': 'text/javascript; charset=utf-8',
  'preamble.js': 'text/javascript; charset=utf-8',
  'manifest.webmanifest': 'application/manifest+json',
  'icon.svg': 'image/svg+xml',
  'icon.png': 'image/png',
}

/**
 * @param dir - the built web client.
 * @param origin - the relay's public origin; the loader page may only connect back to it.
 */
export function webClient(dir: string, origin: string): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const socketOrigin = origin.replace(/^http/, 'ws')
  const page = [
    // The crypto library compiles small WebAssembly hash functions; nothing evaluates JavaScript.
    // WebKit loads a download saved from a Blob (see web/preamble.ts) as a frame.
    "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", `connect-src 'self' ${socketOrigin}`, "img-src 'self' data:", "frame-src 'self' blob:",
    "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
  ].join('; ')
  return async (request, response) => {
    const { pathname } = new URL(request.url ?? '/', origin)
    const isPage = pathname === '/' || parseHostPath(pathname)?.rest === ''
    const name = isPage ? 'index.html' : pathname.slice(1)
    const type = isPage ? 'text/html; charset=utf-8' : FILES[name]
    if (type === undefined || (request.method !== 'GET' && request.method !== 'HEAD')) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found')
      return
    }
    const body = await readFile(join(dir, name))
    response.writeHead(200, {
      'content-type': type,
      'content-length': body.byteLength,
      // Pages and scripts must update together; the worker is checked against the server on every navigation.
      'cache-control': name.startsWith('icon.') ? 'public, max-age=86400' : 'no-cache',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...isPage && { 'content-security-policy': page },
    }).end(request.method === 'HEAD' ? undefined : body)
  }
}
