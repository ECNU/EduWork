// Local acceptance check of the built web client (not run in CI, which
// installs no browsers). A real relay serves lib/web; a Host with a stand-in
// DSH serves a small document that uses the carrier hooks the way DSH's
// client does. In Chromium and WebKit: pair through the page while the Host
// owner approves, load the document through the Service Worker (its script
// gzipped by the Host and unpacked by the worker), call an RPC,
// read a stream, fetch and download a file, send an upload larger than the credit window,
// survive the Host going away and coming back, and lose access on revocation.
// Each engine runs against a relay at the root of its domain and one below a
// path of its own, which must not see a single request outside that path; the
// latter also inside a frame of another page of its domain, as a portal embeds it.
//
//   node scripts/build.ts && node scripts/check-web.ts [chromium|webkit ...]
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, webkit, type Frame } from 'playwright-core'
import { HostStore } from '../src/devices/store.ts'
import type { HostAdapter } from '../src/host/adapter.ts'
import { Relay } from '../src/relay/relay.ts'
import { webClient } from '../src/relay/web.ts'
import { RemoteAccess } from '../src/remote-access.ts'

const ACCESS_KEY = 'check-web'
const UPLOAD_BYTES = 3 * 1024 * 1024 + 4321
const engines = { chromium, webkit }
const selected = (process.argv.slice(2).length > 0 ? process.argv.slice(2) : Object.keys(engines)) as (keyof typeof engines)[]

// What the stand-in DSH document does once loaded: the same calls DSH's client makes through the hooks.
const APP = `
const transport = globalThis.__DSH_TRANSPORT__
const plain = value => Object.getPrototypeOf(value) === Object.prototype
window.exercise = async () => {
  const result = { marked: document.documentElement.hasAttribute('data-eduwork-remote') }
  const rpc = await transport.fetch(new URL('api/session/list', document.baseURI), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rpcId: 'r1' }) })
  result.rpc = await rpc.json()
  result.rpcPlain = plain(result.rpc)
  result.items = []
  for await (const item of transport.openStream('$events', { from: 0 }, new AbortController().signal)) result.items.push(item)
  result.itemsPlain = result.items.every(plain)
  result.file = await (await fetch('api/file?path=notes.txt')).text()
  const upload = new Uint8Array(${UPLOAD_BYTES}).map((_, i) => (i * 7) % 256)
  result.uploaded = await (await fetch('api/session/uploadFileBinary', { method: 'POST', body: upload })).text()
  try {
    for await (const _ of transport.openStream('terminal/create', {}, new AbortController().signal)) {}
  } catch (error) {
    result.refused = error.dshRemoteStreamFailure
  }
  return result
}
// A download the browser manages itself, as DSH's export and document previews start them.
window.save = () => Object.assign(document.createElement('a'), { href: 'api/file?path=notes.txt', download: 'notes.txt' }).click()
document.getElementById('state').textContent = 'loaded'
`

/** The `accept-encoding` of each request for the document's script. */
const scriptEncodings: (string | null)[] = []

function fakeDsh(): HostAdapter {
  return {
    createPeer: () => ({ dispose: async () => {} }),
    async page(request) {
      const { pathname } = new URL(request.url)
      if (pathname === '/') return new Response('<!doctype html><html><head><title>DSH</title><script type="module" src="./assets/app.js"></script></head><body><p id="state">loading</p></body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } })
      if (pathname === '/assets/app.js') {
        scriptEncodings.push(request.headers.get('accept-encoding'))
        return new Response(APP, { headers: { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=31536000, immutable' } })
      }
      return new Response(null, { status: 404 })
    },
    async api(request) {
      const { pathname } = new URL(request.url)
      if (pathname === '/api/session/list') return Response.json({ type: 'server-response', rpcId: (await request.json() as { rpcId: string }).rpcId, result: { ok: true, value: ['s1'] } })
      if (pathname === '/api/file') return new Response('hello from the Host')
      if (pathname === '/api/session/uploadFileBinary') {
        const bytes = new Uint8Array(await request.arrayBuffer())
        return new Response(String(bytes.length === UPLOAD_BYTES && bytes.every((byte, i) => byte === (i * 7) % 256)))
      }
      return new Response(null, { status: 404 })
    },
    async *openStream(endpoint) { yield { endpoint, n: 1 }; yield { nested: { n: 2 } } },
    streamFailure: error => ({ code: 'internal', message: String(error), details: {} }),
  }
}

/** The portal of the relay's domain, outside its path: it embeds the relay page named after `#`. */
const PORTAL = '/portal/'
const PORTAL_PAGE = '<!doctype html><iframe style="width:390px;height:844px" onload="document.body.dataset.framed = 1"></iframe><script>document.querySelector("iframe").src = decodeURIComponent(location.hash.slice(1))</script>'

/** A relay below `path` on its own server, which lets pages of its domain embed it only when `embedded`; `strays` collects every other request that reached the domain outside it. */
async function serve(path: string, embedded: boolean) {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}${path}`
  const relay = new Relay({ url, accessKeys: [ACCESS_KEY] })
  const web = webClient(fileURLToPath(new URL('../lib/web/', import.meta.url)), url, embedded ? "'self'" : undefined)
  const strays: string[] = []
  server.on('request', (request, response) => {
    if (request.url === PORTAL) return void response.writeHead(200, { 'content-type': 'text/html' }).end(PORTAL_PAGE)
    if (!request.url!.startsWith(path)) strays.push(request.url!)
    void web(request, response)
  })
  server.on('upgrade', (request, socket, head) => {
    if (!request.url!.startsWith(path)) strays.push(request.url!)
    if (!relay.upgrade(request, socket, head)) socket.destroy()
  })
  return { url, strays, close: () => { relay.close(); server.close() } }
}

async function until<T>(read: () => T | undefined, what: string, ms = 15_000): Promise<T> {
  for (const deadline = Date.now() + ms; Date.now() < deadline; await new Promise(resolve => setTimeout(resolve, 50))) {
    const value = read()
    if (value !== undefined) return value
  }
  throw new Error(`timed out waiting for ${what}`)
}

const startHost = (store: HostStore, relay: string): RemoteAccess => {
  const access = new RemoteAccess({ adapter: fakeDsh(), store, relay, credential: async () => ({ credential: { accessKey: ACCESS_KEY } }), hostName: 'Lab PC', warn: () => {} })
  access.start()
  return access
}

async function check(name: keyof typeof engines, path: string, embedded: boolean): Promise<Record<string, unknown>> {
  const { url, strays, close } = await serve(path, embedded)
  const store = await HostStore.open(join(await mkdtemp(join(tmpdir(), 'check-web-')), 'state.json'))
  let access = startHost(store, url)
  await until(() => access.status().link.state === 'online' || undefined, 'the Host online')
  const browser = await engines[name].launch()
  try {
    const page = await browser.newPage({ acceptDownloads: true })
    let loader: Frame = page.mainFrame()
    if (embedded) {
      await page.goto(`${new URL(url).origin}${PORTAL}#${encodeURIComponent(access.createInvite())}`)
      loader = (await (await page.waitForSelector('iframe')).contentFrame())!
    } else {
      await page.goto(access.createInvite())
    }
    await loader.getByRole('button', { name: /开始配对|Pair/ }).click()
    const request = await until(() => access.status().pending[0], 'the pairing request')
    assert.equal((await loader.locator('.code').textContent())?.replace(' ', ''), request.code, 'both screens show the same code')
    access.decide(request.key, true)

    await loader.waitForURL(`${url}h/${store.identity.hostId}/`)
    const scope = await loader.evaluate(() => navigator.serviceWorker.ready.then(registration => registration.scope))
    assert.equal(scope, `${url}h/`, 'the worker is scoped to the relay\'s computers')
    const app = loader.frameLocator('iframe')
    await app.locator('#state', { hasText: 'loaded' }).waitFor()
    assert.equal(scriptEncodings.at(-1), 'gzip', 'the worker asks for the script gzipped')
    const frame = page.frames().find(candidate => candidate.url().endsWith('/app/'))!
    const result = await frame.evaluate(() => (window as unknown as { exercise(): Promise<Record<string, unknown>> }).exercise())
    assert.equal(result.marked, true, 'the preamble marks the document of a remote device')
    assert.deepEqual(result.rpc, { type: 'server-response', rpcId: 'r1', result: { ok: true, value: ['s1'] } })
    assert.deepEqual(result.items, [{ endpoint: '$events', n: 1 }, { nested: { n: 2 } }])
    assert.equal(result.rpcPlain, true, 'RPC results are objects of the iframe realm')
    assert.equal(result.itemsPlain, true, 'stream items are objects of the iframe realm')
    assert.equal(result.file, 'hello from the Host')
    assert.equal(result.uploaded, 'true')
    assert.deepEqual(result.refused, { kind: 'remote', code: 'remote-access/forbidden', details: { endpoint: 'terminal/create' } })
    const download = page.waitForEvent('download')
    await frame.evaluate(() => (window as unknown as { save(): void }).save())
    assert.equal(await (await download).failure(), null, 'the browser saves a download through the tunnel')
    assert.equal(await readFile((await (await download).path())!, 'utf8'), 'hello from the Host')

    // The Host goes away and comes back; the page reconnects without reloading the interface.
    access.stop()
    await loader.locator('#bar:not([hidden])').waitFor()
    access = startHost(store, url)
    await loader.locator('#bar').waitFor({ state: 'hidden', timeout: 20_000 })
    const again = await frame.evaluate(() => (window as unknown as { exercise(): Promise<{ file: string }> }).exercise())
    assert.equal(again.file, 'hello from the Host', 'the same iframe works after reconnecting')

    await access.revoke(request.key)
    await loader.locator('.card', { hasText: /移除|removed/ }).waitFor()
    assert.deepEqual(strays, [], 'every request stays below the relay\'s path')
    if (!embedded) {
      // Unless the relay lets it, the portal gets no loader page in its frame.
      const portal = await browser.newPage()
      await portal.goto(`${new URL(url).origin}${PORTAL}#${encodeURIComponent(url)}`)
      await portal.waitForSelector('body[data-framed]')
      assert.equal(await portal.evaluate(() => Boolean(document.querySelector('iframe')!.contentDocument?.querySelector('main'))), false, 'the loader page refuses to be framed')
    }
    return { pairingCode: request.code }
  } finally {
    access.stop()
    await browser.close()
    close()
  }
}

for (const name of selected) {
  for (const [path, embedded] of [['/', false], ['/eduwork-remote/', false], ['/eduwork-remote/', true]] as const) {
    console.log(name, path, embedded ? 'embedded' : '', await check(name, path, embedded))
  }
}
