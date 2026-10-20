import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { webClient } from '../../src/relay/web.ts'

const HOST_ID = 'A'.repeat(43)

test('the relay serves the loader page for every page path, its own files, and nothing else', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'web-client-'))
  await writeFile(join(dir, 'index.html'), '<!doctype html>loader')
  await writeFile(join(dir, 'sw.js'), 'worker')
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const web = webClient(dir, 'https://remote.example.edu')
  server.on('request', (request, response) => void web(request, response))

  for (const path of ['/', `/h/${HOST_ID}/`]) {
    const response = await fetch(origin + path)
    assert.equal(await response.text(), '<!doctype html>loader', path)
    assert.match(response.headers.get('content-security-policy')!, /connect-src 'self' wss:\/\/remote\.example\.edu;.*frame-ancestors 'none'/)
  }
  const worker = await fetch(`${origin}/sw.js`)
  assert.equal(worker.headers.get('content-type'), 'text/javascript; charset=utf-8')
  assert.equal(worker.headers.get('cache-control'), 'no-cache')
  assert.equal(worker.headers.get('content-security-policy'), null)

  // The interface comes from the Host through the Service Worker, never from the relay.
  for (const path of [`/h/${HOST_ID}/app/`, '/h/short/', '/index.html', '/../package.json', '/lib/relay.js']) {
    assert.equal((await fetch(origin + path)).status, 404, path)
  }
  assert.equal((await fetch(origin, { method: 'POST' })).status, 404)
})
