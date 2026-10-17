/**
 * Capture the Host's rendered web shell and the client assets it references.
 *
 * The relay serves the browser shell, but the shell is not a static file in this
 * product: the Host renders index injections into it — the `__ModuleLoader__`
 * facade, the preloads, the parser-blocking bootstrap combo scripts and the boot
 * graph — and those rows name client bundles under `/plugins/...` that only the
 * Host serves. A phone pointed at the relay therefore gets the shell and then dies
 * on the first missing global.
 *
 * This module takes a snapshot of what the Host's own web server answers, plus the
 * assets the page names, so a deployment can mirror them onto the relay. It is an
 * operator action, not a boot path: the snapshot is versioned to the running app
 * and has to be retaken when the app or its plugins change.
 *
 * The cookie is minted the same way `KernelHost` does it, because `/` is behind the
 * kernel's browser fence and the launch token is only available in this process.
 */

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { mintCookie } from './relay/host.js'

/**
 * Every same-origin URL the rendered page names.
 *
 * Three sources, because the boot page uses all three: ordinary `src`/`href`
 * attributes, bundle URLs inside inline JSON (the boot graph), and the structured
 * index rows (which also carry `script-src` entries).
 *
 * @param html - the rendered index.
 * @param rows - `webServer.collectIndexInjections()` output, if available.
 * @returns absolute or root-relative URLs, de-duplicated.
 */
export function snapshotUrls(html, rows = []) {
  const urls = new Set()
  const add = (value) => {
    // The rendered page is HTML: `&` in a query is written `&amp;`, and a browser
    // decodes it before requesting. Fetching the escaped form asks the Host for a
    // different URL and gets a 404.
    urls.add(String(value).replaceAll('&amp;', '&'))
  }
  for (const match of String(html).matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/giu)) {
    add(match[1])
  }
  // The boot graph carries every entry's bundle URL inside an inline JSON script,
  // as a relative `plugins/??...` string rather than an attribute. Missing these
  // means the page boots and then fails to load its first client entry.
  for (const match of String(html).matchAll(/["']([^"']*plugins\/[^"']+)["']/gu)) {
    add(match[1])
  }
  for (const match of String(html).matchAll(/["'](\/plugins\/[^"']+)["']/gu)) {
    add(match[1])
  }
  for (const row of rows) {
    if (typeof row?.src === 'string' && row.src !== '') add(row.src)
  }
  return [...urls]
}

/**
 * Write the rendered index, its index rows and every asset it names into a
 * directory a deployment can copy to the relay.
 *
 * @param options.webServer - the kernel web server (for `collectIndexInjections`).
 * @param options.connection - the kernel connection (for `authenticatedUrl`).
 * @param options.authority - `host:port` the Host is listening on.
 * @param options.directory - destination directory.
 * @param options.log - progress line.
 * @returns `{ directory, files, urls }`.
 */
export async function exportWebSnapshot({ webServer, connection, authority, directory, log = () => {} }) {
  if (typeof authority !== 'string' || authority === '') throw new Error('web snapshot: an authority is required')
  const cookie = await mintCookie({ connection, authority })
  if (cookie === undefined) throw new Error('web snapshot: the host refused to issue a browser cookie')

  const origin = `http://${authority}`
  const fetchPath = async (path) => {
    const response = await fetch(origin + path, { headers: { host: authority, cookie } })
    if (!response.ok) throw new Error(`web snapshot: ${path} answered HTTP ${String(response.status)}`)
    return response
  }

  const page = await fetchPath('/')
  const html = await page.text()
  const rows = typeof webServer?.collectIndexInjections === 'function'
    ? webServer.collectIndexInjections()
    : []
  const urls = snapshotUrls(html, rows)

  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'index.html'), html)
  await writeFile(join(directory, 'injections.json'), JSON.stringify(rows, null, 2))

  const files = []
  for (const url of urls) {
    let parsed
    try {
      parsed = new URL(url, origin)
    } catch {
      continue
    }
    // Only this Host's own assets: an absolute CDN or data URL is not ours to mirror.
    if (parsed.origin !== origin) continue
    if (parsed.pathname === '/' || parsed.pathname.startsWith('/api')) continue
    const response = await fetchPath(`${parsed.pathname}${parsed.search}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    // A combo URL (`/plugins/??a,b&rev=...`) has no filename: it is a dynamic
    // concatenation. Save it under a hash of the exact path + query and let the
    // relay compute the same hash, so a preload or a later fetch resolves to it.
    const key = `${parsed.pathname}${parsed.search}`
    const combo = parsed.pathname === '/plugins/' && parsed.search !== ''
    const relative = combo
      ? `plugins/combo/${createHash('sha256').update(key).digest('hex')}.js`
      : parsed.pathname.replace(/^\/+/u, '')
    const target = join(directory, 'assets', relative)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, bytes)
    files.push({ url, path: relative, type: response.headers.get('content-type') ?? '', combo })
  }

  await writeFile(
    join(directory, 'manifest.json'),
    JSON.stringify({ authority, urls, files }, null, 2),
  )
  log(`web snapshot: ${String(files.length)} asset(s), ${String(urls.length)} URL(s), ${directory}`)
  return { directory, files: files.length, urls: urls.length }
}
