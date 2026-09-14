import { open } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { basename } from 'node:path'
import { parseByteRange } from './core.js'

export const PREVIEW_FETCH_PATH = '/api/artifactPreview/file'
export const PREVIEW_LEGACY_PREFIX = '/chatecnu-work/artifacts/'
const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  // A downloaded HTML/SVG source must not execute on the application's origin.
  'Content-Security-Policy': "sandbox; default-src 'none'",
  'Referrer-Policy': 'no-referrer',
}

export function streamFailure(status, headers = {}) {
  return new Response(null, { status, headers: { ...PRIVATE_HEADERS, ...headers } })
}

// RFC 5987 carries the original basename across desktop redirects. Keep inline
// so the same response also remains playable in audio/video/iframe elements.
export function fileDisposition(path, download = false) {
  const encoded = encodeURIComponent(basename(path).toWellFormed())
    .replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encoded}`
}

/** Read only opaque tickets, never a caller-supplied filesystem path. */
export function streamToken(request) {
  const url = new URL(request.url)
  const token = url.pathname === PREVIEW_FETCH_PATH
    ? (url.searchParams.getAll('token').length === 1 ? url.searchParams.get('token') : '')
    : (url.pathname.startsWith(PREVIEW_LEGACY_PREFIX) ? url.pathname.slice(PREVIEW_LEGACY_PREFIX.length) : '')
  return typeof token === 'string' && /^[A-Za-z0-9_-]{32}$/.test(token) ? token : ''
}

/** Common stream body for the official Fetch carrier and the legacy HTTP route. */
export async function fileResponse(request, entry, openFile = open) {
  request.signal.throwIfAborted()
  let file
  try {
    file = await openFile(entry.path, 'r')
    request.signal.throwIfAborted()
    const info = await file.stat()
    request.signal.throwIfAborted()
    if (!info.isFile()) return streamFailure(404)
    const requested = request.headers.get('range')
    const range = requested === null ? null : parseByteRange(requested, info.size)
    if (requested !== null && range === null) return streamFailure(416, { 'Content-Range': `bytes */${info.size}` })
    const headers = {
      ...PRIVATE_HEADERS, 'Accept-Ranges': 'bytes', 'Content-Type': entry.mime,
      'Content-Disposition': fileDisposition(entry.path, new URL(request.url).searchParams.get('download') === '1'),
      'Content-Length': String(range === null ? info.size : range.end - range.start + 1),
      ...(range === null ? {} : { 'Content-Range': `bytes ${range.start}-${range.end}/${info.size}` }),
    }
    // Opening before emitting headers also makes missing files fail consistently.
    if (request.method === 'HEAD') return new Response(null, { status: range === null ? 200 : 206, headers })
    const stream = file.createReadStream({ ...(range ?? {}), autoClose: true, signal: request.signal })
    file = undefined // The stream owns the descriptor until EOF, cancellation, or failure.
    return new Response(Readable.toWeb(stream), { status: range === null ? 200 : 206, headers })
  } catch (error) {
    if (request.signal.aborted) throw request.signal.reason
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'EISDIR'].includes(error?.code)) return streamFailure(404)
    throw error
  } finally {
    await file?.close()
  }
}

/** Backward-compatible node:http adapter; a disconnected reader cancels the file. */
export async function serveLegacyStream(request, response, fetchResponse) {
  const abort = new AbortController()
  const disconnected = () => { if (!response.writableEnded) abort.abort() }
  response.once('close', disconnected)
  try {
    const headers = new Headers()
    for (const [name, value] of Object.entries(request.headers)) {
      if (Array.isArray(value)) for (const item of value) headers.append(name, item)
      else if (typeof value === 'string') headers.set(name, value)
    }
    const fetchRequest = new Request(new URL(request.url ?? '/', 'http://loopback.invalid'), {
      method: request.method ?? 'GET', headers, signal: abort.signal,
    })
    const result = await fetchResponse(fetchRequest)
    if (abort.signal.aborted) { await result.body?.cancel(); return }
    response.writeHead(result.status, Object.fromEntries(result.headers))
    if (result.body === null) response.end()
    else await pipeline(Readable.fromWeb(result.body), response)
  } catch (error) {
    if (!abort.signal.aborted) response.destroy(error)
  } finally {
    response.off('close', disconnected)
  }
}
