import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { Socket, connect, createServer } from 'node:net'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { networkInterfaces, tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInThisContext } from 'node:vm'
import { patchRemotionRendererSource, remotionRendererPatch } from '../patch-remotion-renderer-runtime.mjs'

const product = process.env.EDUWORK_TEST_PRODUCT
// Windows Firewall silently drops connections to closed ports instead of refusing them.
const reach = (port, host) => new Promise(resolve => {
  const socket = connect({ port, host })
  socket.on('connect', () => { socket.destroy(); resolve('connected') })
  socket.on('error', error => resolve(error.code))
  socket.setTimeout(2000, () => { socket.destroy(); resolve('timeout') })
})

test('unreviewed renderer input is rejected before mutation', () => {
  assert.throws(() => patchRemotionRendererSource('dist/get-port.js', Buffer.from('unreviewed Remotion')), /input changed/)
})

test('the packaged render server listens on loopback only', { skip: !product && 'Set EDUWORK_TEST_PRODUCT to an assembled product', timeout: 60_000 }, async t => {
  const renderer = join(product, 'd/node_modules', remotionRendererPatch.package)
  const { runtimePatches } = JSON.parse(await readFile(join(product, 'assembly.json'), 'utf8'))
  for (const file of Object.keys(remotionRendererPatch.files)) {
    const receipt = runtimePatches.find(row => row.id === remotionRendererPatch.id && row.file === file)
    assert.equal(createHash('sha256').update(await readFile(join(renderer, file))).digest('hex'), receipt.afterSHA256)
  }
  const { RenderInternals } = createRequire(join(product, 'd/package.json'))(remotionRendererPatch.package)
  const { host, hostsToTry } = RenderInternals.getPortConfig(false)
  assert.equal(host, '127.0.0.1')
  assert.ok(hostsToTry.every(address => ['::1', '127.0.0.1'].includes(address)), hostsToTry.join())

  // A listener on every interface still answers localhost, so its port stays taken.
  for (const wildcard of ['::', '0.0.0.0']) {
    const other = createServer().unref()
    await new Promise(resolve => other.listen({ port: 0, host: wildcard }, resolve))
    t.after(() => other.close())
    await assert.rejects(RenderInternals.getDesiredPort({ desiredPort: other.address().port, from: 3000, to: 3100, hostsToTry }), /not available/)
  }

  const bundle = await mkdtemp(join(tmpdir(), 'eduwork-render-server-'))
  t.after(() => rm(bundle, { recursive: true, force: true }))
  await writeFile(join(bundle, 'index.html'), 'render bundle')
  await writeFile(join(bundle, 'bundle.js'), '')
  const server = await RenderInternals.prepareServer({ webpackConfigOrServeUrl: bundle, port: null, remotionRoot: bundle,
    offthreadVideoThreads: 0, logLevel: 'error', indent: false, offthreadVideoCacheSizeInBytes: null, binariesDirectory: null,
    forceIPv4: false, sampleRate: 48000 })
  t.after(() => server.closeServer(true))
  assert.equal(await (await fetch(server.serveUrl)).text(), 'render bundle')
  // Link-local addresses need a zone to be reached at all.
  for (const { address } of Object.values(networkInterfaces()).flat().filter(row => !row.internal && !row.scopeid)) {
    assert.notEqual(await reach(server.offthreadPort, address), 'connected', address)
  }
})

test('a port probe that never gets an answer gives up and releases its socket', { skip: !product && 'Set EDUWORK_TEST_PRODUCT to an assembled product', timeout: 10_000 }, async () => {
  const renderer = join(product, 'd/node_modules', remotionRendererPatch.package)
  // Binding and closing succeed; the connection to port 3000 then neither connects nor fails.
  const sockets = []
  const net = {
    createServer: () => ({ unref() {}, on() {}, listen: (_, done) => setImmediate(done), close: done => setImmediate(done) }),
    connect: ({ port }) => {
      const socket = new Socket()
      sockets.push(socket)
      if (port !== 3000) setImmediate(() => socket.emit('error', new Error('ECONNREFUSED')))
      return socket
    },
  }
  const module = { exports: {} }
  const require = createRequire(join(renderer, 'dist/get-port.js'))
  runInThisContext(`(function (exports, require, module) {${await readFile(join(renderer, 'dist/get-port.js'), 'utf8')}\n})`)(
    module.exports, name => name === 'net' ? net : require(name), module)
  const { getDesiredPort } = module.exports
  const { port, unlockPort } = await getDesiredPort({ from: 3000, to: 3001, hostsToTry: ['127.0.0.1'] })
  unlockPort()
  assert.equal(port, 3001)
  assert.equal(sockets.length, 2)
  assert.ok(sockets.every(socket => socket.destroyed))
})
