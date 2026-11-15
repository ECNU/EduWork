import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { gunzipSync } from 'node:zlib'
import { compressPages } from '../../src/connections/compression.ts'
import { remoteHandler } from '../../src/connections/handler.ts'
import { createHostAdapter, type DshServices, type Peer } from '../../src/host/adapter.ts'

test('each remote document renders with its connection Peer, including through gzip', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'remote-index-peer-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const distIndex = join(directory, 'index.html')
  await writeFile(distIndex, '<!doctype html><head></head><body>frontend</body>')
  const snapshots = new Map<Peer, string>()
  const rendered: Peer[] = []
  const services: DshServices = {
    webServer: {
      getOrigin: () => 'http://127.0.0.1:9',
      renderIndex(html, peer) {
        // rc.1's webserver/index-inject listeners need the admitted Peer to
        // derive the page's access snapshot; rendering anonymously is invalid.
        assert.ok(snapshots.has(peer), 'renderIndex must receive the connection Peer')
        rendered.push(peer)
        return html.replace('</head>', `<script>${snapshots.get(peer)}</script></head>`)
      },
    },
    connection: {
      createPeer(options) {
        assert.deepEqual(options, { principal: { kind: 'owner' }, interactions: 'answer' })
        return { dispose: async () => {} }
      },
      createSharedFetchHandler: () => ({ fetch: async () => new Response(null, { status: 204 }) }),
    },
    typertGateway: { wireStream: {
      open: async () => (async function* () {})(),
      failure: error => ({ code: 'internal', message: String(error), details: {} }),
    } },
  }
  const adapter = compressPages(createHostAdapter(services, distIndex))
  const peers = [adapter.createPeer(), adapter.createPeer()]
  assert.notEqual(peers[0], peers[1])
  // Same URL across devices and repeated renders must never reuse another
  // connection's document or an obsolete access snapshot from the gzip cache.
  for (const path of ['/', '/index.html']) {
    for (const encoding of [undefined, 'gzip']) {
      for (const [index, peer] of peers.entries()) {
        const snapshot = JSON.stringify({ device: index, render: rendered.length })
        snapshots.set(peer, snapshot)
        const handler = remoteHandler(adapter, peer, name => assert.fail(`unexpected refusal: ${name}`))
        const request = new Request(`http://host${path}`, {
          headers: encoding ? { 'accept-encoding': encoding } : {},
        })
        const response = await handler.fetch(request, request.signal)
        assert.equal(response.status, 200)
        assert.equal(response.headers.get('cache-control'), 'no-store')
        assert.equal(response.headers.get('content-encoding'), encoding ?? null)
        const html = encoding ? gunzipSync(await response.arrayBuffer()).toString() : await response.text()
        assert.ok(html.includes(`<script>${snapshot}</script>`))
        assert.equal(rendered.at(-1), peer)
      }
    }
  }
  assert.equal(rendered.length, 8)
})
