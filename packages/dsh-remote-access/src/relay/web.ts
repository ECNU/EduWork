/**
 * The web client's files, as the relay serves them below its base URL. Every
 * page path gets the same loader page, whose `<base>` names the base URL so
 * that the client's own paths are relative to it; the DSH interface itself
 * never comes from here but from the Host, through the Service Worker.
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
 * @param url - the relay's base URL, as `relayBase` gives it; the loader page may only connect back to it.
 */
export function webClient(dir: string, url: string): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const { origin, pathname: base } = new URL(url)
  const page = [
    // The crypto library compiles small WebAssembly hash functions; nothing evaluates JavaScript.
    // WebKit loads a download saved from a Blob (see web/preamble.ts) as a frame.
    "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", `connect-src 'self' ${url.replace(/^http/, 'ws')}`, "img-src 'self' data:", "frame-src 'self' blob:",
    "base-uri 'self'", "form-action 'none'", "frame-ancestors 'none'",
  ].join('; ')
  const notFound = (response: ServerResponse): void => void response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found')
  return async (request, response) => {
    const { pathname, search } = new URL(request.url ?? '/', origin)
    // The base without its final slash, as people type it.
    if (`${pathname}/` === base) return void response.writeHead(301, { location: base + search }).end()
    if (!pathname.startsWith(base) || (request.method !== 'GET' && request.method !== 'HEAD')) return notFound(response)
    const path = pathname.slice(base.length)
    if (path === 'healthz') return void response.writeHead(200, { 'content-type': 'text/plain' }).end('ok')
    const isPage = path === '' || parseHostPath(path)?.rest === ''
    const name = isPage ? 'index.html' : path
    const type = isPage ? 'text/html; charset=utf-8' : FILES[name]
    if (type === undefined) return notFound(response)
    const file = await readFile(join(dir, name))
    const body = isPage ? Buffer.from(file.toString().replace('<head>', `<head>\n<base href="${base}">`)) : file
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
