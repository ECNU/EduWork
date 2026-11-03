// Serves the bundled guide read-only: paths stay inside guide/; hidden files and unknown types are refused.
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Shared with the desktop shell: once it sees this route, the application menu shows "User Guide".
export const ROUTE = '/eduwork-user-guide'
export const GUIDE_ROOT = fileURLToPath(new URL('../guide/', import.meta.url))

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

/** Resolves a request path to a file under guide/, or null. */
export function resolveGuidePath(pathname, root = GUIDE_ROOT) {
  if (typeof pathname !== 'string' || !pathname.startsWith(ROUTE)) return null
  let rest
  try { rest = decodeURIComponent(pathname.slice(ROUTE.length)) } catch { return null }
  if (rest === '' || rest === '/') rest = '/index.html'
  if (!rest.startsWith('/') || rest.includes('\0') || rest.includes('\\')) return null
  const relative = normalize(rest).replace(/^[/\\]+/, '')
  if (relative.split(/[/\\]/).some(part => part === '..' || part.startsWith('.'))) return null
  if (!TYPES[extname(relative).toLowerCase()]) return null
  const file = join(root, relative)
  return file.startsWith(root.endsWith(sep) ? root : root + sep) ? file : null
}

/** Writes data-theme on <html>; other values leave the page unchanged. */
export function withTheme(body, theme) {
  if (theme !== 'light' && theme !== 'dark') return body
  return Buffer.from(String(body).replace(/<html\b/i, `<html data-theme="${theme}"`))
}

/** The tour settings the client reads: product name, autoplay and step overrides. */
export const TOUR_PATH = ROUTE + '/tour.json'

/** The part of the configuration the client needs; tourSeen travels through the settings form. */
export function tourSettings(config = {}) {
  return { productName: config.productName || 'EduWork', autoStart: config.autoStart !== false, steps: Array.isArray(config.steps) ? config.steps : [] }
}

/** GET/HEAD serve files and tour.json; anything else is 404/405. */
export function createGuideHandler({ root = GUIDE_ROOT, read = readFile, tour = () => ({}) } = {}) {
  return async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://local')
    const pathname = url.pathname
    if (pathname === ROUTE) {
      res.writeHead(301, { Location: ROUTE + '/' }); res.end(); return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return
    }
    if (pathname === TOUR_PATH) {
      const body = Buffer.from(JSON.stringify(tour()))
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' })
      res.end(req.method === 'HEAD' ? undefined : body); return
    }
    const file = resolveGuidePath(pathname, root)
    let body = null
    if (file) body = await read(file).catch(() => null)
    if (!body) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return }
    // ?theme=light|dark follows the app theme, not the system one; the page runs no script.
    if (extname(file).toLowerCase() === '.html') body = withTheme(body, url.searchParams.get('theme'))
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()],
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'self'",
    })
    res.end(req.method === 'HEAD' ? undefined : body)
  }
}
