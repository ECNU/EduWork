import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { webClient } from '../../src/relay/web.ts'

const HOST_ID = 'A'.repeat(43)

test('the relay serves the loader page for every page path below its own, its files, and nothing else', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'web-client-'))
  await writeFile(join(dir, 'index.html'), '<!doctype html><head>loader')
  await writeFile(join(dir, 'sw.js'), 'worker')
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const web = webClient(dir, 'https://example.edu/remote/')
  server.on('request', (request, response) => void web(request, response))

  for (const path of ['/remote/', `/remote/h/${HOST_ID}/`]) {
    const response = await fetch(origin + path)
    // The page names the base, which its own relative URLs resolve against.
    assert.equal(await response.text(), '<!doctype html><head>\n<base href="/remote/">loader', path)
    assert.match(response.headers.get('content-security-policy')!, /connect-src 'self' wss:\/\/example\.edu\/remote\/;.*base-uri 'self';.*frame-ancestors 'none'/)
  }
  const worker = await fetch(`${origin}/remote/sw.js`)
  assert.equal(await worker.text(), 'worker')
  assert.equal(worker.headers.get('content-type'), 'text/javascript; charset=utf-8')
  assert.equal(worker.headers.get('cache-control'), 'no-cache')
  assert.equal(worker.headers.get('content-security-policy'), null)
  assert.equal(await (await fetch(`${origin}/remote/healthz`)).text(), 'ok')
  const bare = await fetch(`${origin}/remote?list`, { redirect: 'manual' })
  assert.equal(bare.status, 301)
  assert.equal(bare.headers.get('location'), '/remote/?list')

  // The interface comes from the Host through the Service Worker, never from the relay; nothing outside its path is the relay's.
  for (const path of [`/remote/h/${HOST_ID}/app/`, '/remote/h/short/', '/remote/index.html', '/remote/../package.json', '/remote/lib/relay.js', '/', '/sw.js', '/healthz', `/h/${HOST_ID}/`]) {
    assert.equal((await fetch(origin + path)).status, 404, path)
  }
  assert.equal((await fetch(`${origin}/remote/`, { method: 'POST' })).status, 404)
})
