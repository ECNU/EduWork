// Local acceptance check (not run in CI, which installs no browsers): the
// device side of the protocol runs in Chromium and WebKit against a Node Host
// over real WebSockets — handshake, device signature, pairing code, a request
// body larger than the credit window, a stream and a ping.
//
//   node scripts/check-browser.ts [chromium|webkit ...]
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium, webkit } from 'playwright-core'
import { WebSocketServer } from 'ws'
import { pairingCode, verifyAuth } from '../src/protocol/auth.ts'
import { base64url } from '../src/protocol/bytes.ts'
import { Channel, type SocketLike } from '../src/protocol/channel.ts'
import { generateKeyPair, prologue } from '../src/protocol/noise.ts'
import { serveTunnel } from '../src/protocol/tunnel.ts'

const engines = { chromium, webkit }
const selected = (process.argv.slice(2).length > 0 ? process.argv.slice(2) : Object.keys(engines)) as (keyof typeof engines)[]
const hostId = base64url(crypto.getRandomValues(new Uint8Array(32)))
const keys = generateKeyPair()
const uploadBytes = 3 * 1024 * 1024 + 4321

const bundle = await build({
  entryPoints: [new URL('../test/browser/device.ts', import.meta.url).pathname],
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, minify: true,
})
const script = bundle.outputFiles[0]!.contents
const server = createServer((request, response) => {
  if (request.url === '/device.js') response.writeHead(200, { 'content-type': 'text/javascript' }).end(script)
  else response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>device</title>')
}).listen(0, '127.0.0.1')
await new Promise(resolve => server.once('listening', resolve))
const port = (server.address() as { port: number }).port

const hostCodes: string[] = []
new WebSocketServer({ server, path: '/tunnel' }).on('connection', async socket => {
  const channel = await Channel.accept(socket as unknown as SocketLike, keys, prologue('relay', hostId), AbortSignal.timeout(10_000))
  const auth = await verifyAuth((await channel.receive()).header, channel.hash)
  if (auth === undefined) return channel.close(4403, 'bad auth')
  hostCodes.push(await pairingCode(channel.hash))
  channel.send({ t: 'ready', host: 'check-browser' })
  void serveTunnel(channel, {
    fetch: async request => new Response(await request.arrayBuffer(), { headers: { 'x-host': 'node' } }),
    async *openStream(endpoint, payload) { yield { endpoint, payload }; yield 'second' },
    streamFailure: error => ({ code: 'internal', message: String(error), details: {} }),
  })
})

const report: Record<string, unknown> = { bundleBytes: script.byteLength }
for (const name of selected) {
  const browser = await engines[name].launch()
  try {
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${port}/`)
    const result = await page.evaluate(async ([url, id, key, bytes]) => {
      const device = await import('/device.js')
      return device.run(url, id, key, bytes)
    }, [`ws://127.0.0.1:${port}/tunnel`, hostId, base64url(keys.publicKey), uploadBytes] as const)
    assert.deepEqual(result.reply, { t: 'ready', host: 'check-browser' })
    assert.ok(result.intact, 'echoed body differs')
    assert.deepEqual(result.items, [{ endpoint: '$events', payload: { from: 0 } }, 'second'])
    assert.equal(result.code, hostCodes.at(-1))
    report[name] = { echo3MiBms: result.roundTripMs, pairingCode: result.code }
  } finally {
    await browser.close()
  }
}
server.close()
console.log(JSON.stringify(report, null, 2))
process.exit(0)
