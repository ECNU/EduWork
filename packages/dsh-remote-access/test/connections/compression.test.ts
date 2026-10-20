import assert from 'node:assert/strict'
import test from 'node:test'
import { gunzipSync } from 'node:zlib'
import { compressPages } from '../../src/connections/compression.ts'
import type { HostAdapter } from '../../src/host/adapter.ts'

const SCRIPT = 'console.log("frontend")\n'.repeat(500)
const IMMUTABLE = 'public, max-age=31536000, immutable'

/** A Host whose pages are this script, a PNG and a missing file; it records how often a script body is read. */
function host() {
  const reads = { script: 0 }
  const script = (cacheControl: string): Response => new Response(new ReadableStream({
    pull(controller) {
      reads.script++
      controller.enqueue(new TextEncoder().encode(SCRIPT))
      controller.close()
    },
  }, { highWaterMark: 0 }), { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': cacheControl } })
  const adapter = {
    async page(request: Request) {
      const { pathname } = new URL(request.url)
      if (pathname.startsWith('/assets/')) return script(IMMUTABLE)
      if (pathname === '/plugins/live.js') return script('no-cache')
      if (pathname === '/icon.png') return new Response(new Uint8Array(4096), { headers: { 'content-type': 'image/png' } })
      return new Response(null, { status: 404 })
    },
    api: async () => Response.json({ rpc: true }),
  } as unknown as HostAdapter
  return { adapter: compressPages(adapter), reads }
}

const get = (path: string, encoding?: string, method = 'GET'): Request =>
  new Request(`http://host${path}`, { method, headers: encoding === undefined ? {} : { 'accept-encoding': encoding } })

test('public text files are gzipped for a client that accepts it; anything else passes unchanged', async () => {
  const { adapter } = host()
  const zipped = await adapter.page(get('/plugins/live.js', 'gzip'))
  assert.equal(zipped.headers.get('content-encoding'), 'gzip')
  assert.equal(zipped.headers.get('content-type'), 'text/javascript; charset=utf-8')
  const bytes = new Uint8Array(await zipped.arrayBuffer())
  assert.equal(gunzipSync(bytes).toString(), SCRIPT)
  assert.ok(bytes.byteLength < SCRIPT.length / 10)

  for (const [request, why] of [
    [get('/plugins/live.js'), 'the client did not ask for gzip'],
    [get('/plugins/live.js', 'br'), 'the client asked for another encoding'],
    [get('/plugins/live.js', 'gzip', 'HEAD'), 'not a GET'],
    [get('/icon.png', 'gzip'), 'not text'],
    [get('/missing.js', 'gzip'), 'not a 200'],
  ] as const) assert.equal((await adapter.page(request)).headers.get('content-encoding'), null, why)
  const rpc = await adapter.api(new Request('http://host/api/session/list', { method: 'POST', headers: { 'accept-encoding': 'gzip' } }), { dispose: async () => {} })
  assert.equal(rpc.headers.get('content-encoding'), null, 'RPC results are never compressed')
})

test('a file that never changes at its URL is compressed once', async () => {
  const { adapter, reads } = host()
  const first = await adapter.page(get('/assets/app-1a2b.js', 'gzip'))
  const again = await adapter.page(get('/assets/app-1a2b.js', 'gzip'))
  assert.deepEqual(new Uint8Array(await again.arrayBuffer()), new Uint8Array(await first.arrayBuffer()))
  assert.equal(reads.script, 1, 'the second response came from the kept copy')
  await adapter.page(get('/plugins/live.js', 'gzip'))
  await adapter.page(get('/plugins/live.js', 'gzip'))
  assert.equal(reads.script, 3, 'a file that may change is compressed each time')
})
