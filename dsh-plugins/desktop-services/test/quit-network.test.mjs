import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { boundDispatcherClose } from '../lib/quit-network.js'

const runtime = process.env.EDUWORK_TEST_RUNTIME
test('a fetch aborted during a stalled proxy CONNECT no longer holds the dispatcher close', { skip: !runtime }, async t => {
  const req = createRequire(join(runtime, 'package.json'))
  const { Agent, ProxyAgent, getGlobalDispatcher, setGlobalDispatcher } = await import(pathToFileURL(req.resolve('undici')))
  const previous = getGlobalDispatcher()
  // A proxy that accepts the tunnel request but never answers it.
  const sockets = []
  const proxy = createServer().on('connect', (_request, socket) => { sockets.push(socket) })
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
  t.after(() => { for (const socket of sockets) socket.destroy(); proxy.close() })
  const agent = new Agent({ factory: (_origin, options) => new ProxyAgent({ ...options, uri: `http://127.0.0.1:${proxy.address().port}` }) })
  setGlobalDispatcher(agent)
  t.after(() => setGlobalDispatcher(previous))
  const controller = new AbortController()
  const request = fetch('https://ilinkai.weixin.qq.com/ilink/bot/getupdates', { method: 'POST', body: '{}', signal: controller.signal }).catch(error => error.name)
  await new Promise(resolve => setTimeout(resolve, 80))
  controller.abort()
  assert.equal(await request, 'AbortError')
  let destroyed = false
  assert.equal(boundDispatcherClose({ graceMs: 100, log: () => { destroyed = true } }), true)
  const started = Date.now()
  await agent.close()
  assert.ok(Date.now() - started < 1000, `close took ${Date.now() - started} ms`)
  assert.equal(destroyed, true)
})
