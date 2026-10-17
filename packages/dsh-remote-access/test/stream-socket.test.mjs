/**
 * The stream socket, driven against the official mux server over a real socket.
 *
 * The claim under test is narrow and load-bearing: a WebSocket-shaped object is
 * enough to carry the Gateway's logical-stream mux, so every piece of the stream
 * stack above it — framing, multiplexing, uplink pumping, cancellation — stays the
 * official implementation instead of becoming ours.
 *
 * So the other end here is not a stub. It is `RemoteStreamMuxServer`, loaded from
 * the shipped gateway, speaking the shipped `stream-protocol` parser, over a real
 * `ws` upgrade. A test against a hand-written peer would prove only that two files
 * in this repository agree with each other.
 */

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { after, describe, it } from 'node:test'

import { StreamSocket, CLOSED, CLOSING, CONNECTING, OPEN } from '../src/stream/socket.js'

const require = createRequire(import.meta.url)

/**
 * The shipped gateway internals.
 *
 * They are on disk — the package ships `lib/types/**` — but absent from its
 * `exports` map, so they are reached through the package root rather than a
 * subpath. Loading them by absolute file URL keeps `import` semantics intact
 * (the files are ESM) without depending on a resolution rule that is not offered.
 */
function gatewayFile(relative) {
  const root = dirname(require.resolve('@deepseek-ai/dsh-api-gateway/package.json'))
  return pathToFileURL(join(root, relative)).href
}

const { RemoteStreamMuxServer } = await import(gatewayFile(join('lib', 'types', 'stream-server.js')))
const protocol = await import(gatewayFile(join('lib', 'types', 'stream-protocol.js')))
const { WebSocket: WsClient } = require('ws')

const servers = []
after(async () => {
  for (const server of servers) await server.close()
})

/**
 * A Peer as `bindPeer` needs one: an object whose `ctx.effect` registers a disposer.
 *
 * That is the whole requirement — `bindPeer` reads `peer.ctx.effect` and nothing
 * else — so this is not a mock of the Peer contract, it is the part of it the mux
 * touches.
 */
function fakePeer() {
  const disposers = []
  return {
    disposers,
    ctx: {
      effect: (run) => {
        const dispose = run()
        disposers.push(dispose)
        return dispose
      },
    },
  }
}

/**
 * Start the official mux server on a loopback port.
 *
 * @param open - the stream dispatcher; this is what the Gateway supplies in
 *   production, so a test can decide what a stream yields without a Host.
 */
async function startMux(open) {
  const failures = []
  const mux = new RemoteStreamMuxServer(
    open,
    error => ({ code: 'gateway/internal', message: String(error?.message ?? error), details: {} }),
    // A long heartbeat keeps the timer out of the test's way; the protocol does not
    // depend on it and `close()` clears it.
    60_000,
    262_144,
  )
  const peer = fakePeer()
  const http = createServer()
  http.on('upgrade', (request, socket, head) => mux.handleUpgrade(request, socket, head, peer))
  await new Promise((resolve, reject) => {
    http.once('error', reject)
    http.listen(0, '127.0.0.1', resolve)
  })
  const { port } = http.address()
  let closed = false
  const server = {
    port,
    peer,
    failures,
    /**
     * Idempotent, because both the test and the file-level hook close it.
     *
     * `ws` throws "The server is not running" from a second `close()`, and a throw
     * inside the after hook is reported as the file failing rather than as the
     * cleanup it is.
     */
    async close() {
      if (closed) return
      closed = true
      await mux.close()
      await new Promise(resolve => http.close(resolve))
    },
  }
  servers.push(server)
  return server
}

/**
 * A tunnel that carries text frames over one real `ws` client connection.
 *
 * This stands in for the encrypted relay carrier: from the socket's point of view
 * it is an opaque bidirectional text channel, which is exactly what the E2EE
 * channel will present.
 */
function loopbackTunnel(port) {
  return (handlers) => {
    const ws = new WsClient(`ws://127.0.0.1:${String(port)}${protocol.REMOTE_STREAM_MUX_PATH}`)
    ws.on('open', () => handlers.onOpen())
    ws.on('message', data => handlers.onText(data.toString('utf8')))
    ws.on('close', (code, reason) => handlers.onClose(code, reason.toString('utf8')))
    ws.on('error', error => handlers.onError(error.message))
    return {
      send: text => { if (ws.readyState === WsClient.OPEN) ws.send(text) },
      close: (code, reason) => { ws.close(code, reason) },
      raw: ws,
    }
  }
}

/** A promise plus its resolver, for waiting on a socket event. */
function deferred() {
  let resolve
  const promise = new Promise(settle => { resolve = settle })
  return { promise, resolve }
}

/** Collect the messages one socket receives, in order. */
function collector(socket) {
  const received = []
  const waiters = []
  socket.addEventListener('message', event => {
    received.push(event.data)
    for (const waiter of waiters.splice(0)) waiter()
  })
  return {
    received,
    /** Wait until at least `count` messages have arrived, or fail. */
    async until(count, label) {
      const deadline = Date.now() + 5_000
      while (received.length < count) {
        if (Date.now() > deadline) assert.fail(`${label}: timed out with ${String(received.length)}/${String(count)} messages`)
        await Promise.race([
          new Promise(resolve => waiters.push(resolve)),
          new Promise(resolve => setTimeout(resolve, 50)),
        ])
      }
      return received
    },
  }
}

async function openSocket(port) {
  const socket = new StreamSocket(`ws://127.0.0.1:${String(port)}${protocol.REMOTE_STREAM_MUX_PATH}`, {
    tunnel: loopbackTunnel(port),
  })
  const opened = deferred()
  socket.addEventListener('open', () => opened.resolve(true))
  await opened.promise
  return socket
}

describe('流套接字对官方 mux 的接口', () => {
  it('暴露真实 WebSocket 的常量与状态', () => {
    // The mux compares `readyState` against these. Values that disagreed with the
    // platform would make its state machine take the wrong branch.
    assert.equal(CONNECTING, 0)
    assert.equal(OPEN, 1)
    assert.equal(CLOSING, 2)
    assert.equal(CLOSED, 3)
    assert.equal(StreamSocket.OPEN, 1)
    assert.equal(StreamSocket.CLOSED, 3)
  })

  it('在隧道建立前排队，建立后原样发出', async () => {
    const server = await startMux(() => (async function* () {})())
    const opened = deferred()
    // A tunnel that does not open until the test says so.
    const sent = []
    let handlers
    const socket = new StreamSocket('ws://relay.invalid/api/remote.mux', {
      tunnel: given => {
        handlers = given
        return { send: text => sent.push(text), close: () => {} }
      },
    })
    socket.addEventListener('open', () => opened.resolve(true))

    // The mux's pump can send before the socket reports open. A dropped frame here
    // would leave a logical stream that never starts and never fails.
    socket.send('first')
    socket.send('second')
    assert.deepEqual(sent, [], 'nothing may leave before the tunnel is open')

    handlers.onOpen()
    await opened.promise
    assert.deepEqual(sent, ['first', 'second'])
    assert.equal(socket.readyState, OPEN)
    await server.close()
  })

  it('拒绝二进制帧，而不是悄悄编一个', () => {
    const socket = new StreamSocket('ws://relay.invalid/api/remote.mux', {
      tunnel: () => ({ send: () => {}, close: () => {} }),
    })
    // The mux is text-only, so accepting bytes would mean inventing an encoding.
    assert.throws(() => socket.send(new Uint8Array([1, 2, 3])), /only text frames/u)
  })

  it('隧道工厂抛错时不从构造函数里抛出去', async () => {
    // The caller is the official mux client, which has no try/catch around `new`.
    // Throwing would lose the socket reference and leave its streams unsettled.
    const errors = []
    const closes = []
    const socket = new StreamSocket('ws://relay.invalid/api/remote.mux', {
      tunnel: () => { throw new Error('no route to relay') },
    })
    socket.addEventListener('error', event => errors.push(event.message))
    socket.addEventListener('close', event => closes.push(event))
    assert.equal(socket.readyState, CLOSED)
    // Both events are dispatched after the current turn, as a real WebSocket does,
    // so the listener that reports the failure exists by the time it fires.
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.deepEqual(errors, ['no route to relay'])
    assert.equal(closes.length, 1)
    assert.equal(closes[0].wasClean, false)
  })

  it('隧道工厂返回的对象不合法时报错而不是静默', async () => {
    const errors = []
    const socket = new StreamSocket('ws://relay.invalid/api/remote.mux', { tunnel: () => ({}) })
    socket.addEventListener('error', event => errors.push(event.message))
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.match(errors[0] ?? '', /send\(\) and close\(\)/u)
  })

  it('结束时的非法关闭码被改成 1000', async () => {
    const closes = []
    const socket = new StreamSocket('ws://relay.invalid/api/remote.mux', {
      tunnel: given => {
        given.onOpen()
        return { send: () => {}, close: () => {} }
      },
    })
    socket.addEventListener('close', event => closes.push(event))
    // 1005 is reserved and may not go on the wire; a real WebSocket throws, and a
    // throw during teardown would be reported as a stream failure.
    socket.close(1005, 'nope')
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(closes[0].code, 1000)
  })
})

describe('经官方 mux 服务端的端到端', () => {
  it('握手完成，且官方解析器认得我们发出的每一帧', async () => {
    const seen = []
    const server = await startMux((endpoint, payload, uplink, peer, control) => {
      seen.push({ endpoint, payload })
      return (async function* () {
        yield { type: 'ready', clientId: 'test-client', host: { home: '/home/test' } }
        // Hold the stream open until cancelled, as `$events` does — and end on the
        // signal, because the mux awaits each stream's completion when it closes.
        await new Promise(resolve => {
          if (control.signal.aborted) resolve()
          else control.signal.addEventListener('abort', resolve, { once: true })
        })
      })()
    })

    const socket = await openSocket(server.port)
    const messages = collector(socket)

    // Exactly the frame the Gateway's mux client sends to open a logical stream.
    const openFrame = { type: 'open', streamId: 's1', endpoint: protocol.REMOTE_EVENT_STREAM_ENDPOINT, payload: protocol.REMOTE_EVENT_STREAM_PAYLOAD }
    socket.send(JSON.stringify(openFrame))

    // The server parses with the shipped parser; if our frame were malformed this
    // would throw there rather than here.
    const parsed = protocol.parseRemoteStreamClientMessage(JSON.stringify(openFrame))
    assert.equal(parsed.type, 'open')
    assert.equal(parsed.endpoint, '$events')

    const received = await messages.until(1, 'ready frame')
    const ready = protocol.parseRemoteStreamServerMessage(received[0])
    assert.equal(ready.type, 'item')
    assert.equal(ready.streamId, 's1')
    assert.deepEqual(ready.value, { type: 'ready', clientId: 'test-client', host: { home: '/home/test' } })

    // Our own frames reached the server's dispatcher unchanged.
    assert.equal(seen.length, 1)
    assert.equal(seen[0].endpoint, '$events')
    assert.deepEqual(seen[0].payload, { args: {} })

    await server.close()
  })

  it('上行帧到达服务端，半关闭也到达', async () => {
    let gotUplink
    const uplinkSeen = deferred()
    const server = await startMux((endpoint, payload, uplink, peer, control) => {
      gotUplink = uplink
      void (async () => {
        const items = []
        for await (const item of uplink) items.push(item)
        gotUplink = items
        uplinkSeen.resolve(true)
      })()
      return (async function* () {
        yield { type: 'item', value: 'down' }
        await new Promise(resolve => control.signal.addEventListener('abort', resolve, { once: true }))
      })()
    })

    const socket = await openSocket(server.port)
    const messages = collector(socket)
    socket.send(JSON.stringify({ type: 'open', streamId: 's2', endpoint: 'demo/stream', payload: { args: [] } }))
    await messages.until(1, 'first downlink')

    socket.send(JSON.stringify({ type: 'item', streamId: 's2', value: { hello: 'host' } }))
    socket.send(JSON.stringify({ type: 'end', streamId: 's2' }))

    await uplinkSeen.promise
    // The uplink is what the Host method iterates; both the item and the half-close
    // have to survive the trip or a method would wait forever for its input.
    assert.deepEqual(gotUplink, [{ hello: 'host' }])

    await server.close()
  })

  it('服务端结束流时，客户端读到 end', async () => {
    const server = await startMux(() => (async function* () {
      yield 'one'
      yield 'two'
    })())

    const socket = await openSocket(server.port)
    const messages = collector(socket)
    socket.send(JSON.stringify({ type: 'open', streamId: 's3', endpoint: 'demo/finite', payload: { args: [] } }))

    const received = await messages.until(3, 'two items and an end')
    const parsed = received.map(text => protocol.parseRemoteStreamServerMessage(text))
    assert.deepEqual(parsed.map(frame => frame.type), ['item', 'item', 'end'])
    assert.deepEqual(parsed.slice(0, 2).map(frame => frame.value), ['one', 'two'])

    await server.close()
  })

  it('客户端关闭套接字会让服务端的上行以载体失败告终', async () => {
    // Not a graceful end: the mux calls `stream.stop(new Error('Remote stream socket
    // closed'))`, so a Host method reading its uplink sees a carrier failure rather
    // than a half-close. That is the documented semantics — a client that vanished
    // did not finish sending — and asserting a clean end here would encode the
    // opposite of what the shipped implementation does.
    const settled = deferred()
    const server = await startMux((endpoint, payload, uplink, peer, control) => {
      void (async () => {
        try {
          for await (const _item of uplink) void _item
          settled.resolve({ ended: true })
        } catch (error) {
          settled.resolve({ ended: false, message: error.message })
        }
      })()
      // The downlink must end when the stream is cancelled. `RemoteStreamMuxServer`
      // closes by stopping every stream and then awaiting each `done`, so a
      // dispatcher that ignores `control.signal` — as `await new Promise(() => {})`
      // does — leaves `close()` waiting forever and hangs whatever called it.
      return (async function* () {
        yield 'kept-open'
        await new Promise(resolve => {
          if (control.signal.aborted) resolve()
          else control.signal.addEventListener('abort', resolve, { once: true })
        })
      })()
    })

    const socket = await openSocket(server.port)
    const messages = collector(socket)
    socket.send(JSON.stringify({ type: 'open', streamId: 's4', endpoint: 'demo/held', payload: { args: [] } }))
    await messages.until(1, 'first item')

    socket.close(1000, 'done')
    assert.equal(socket.readyState, CLOSED)

    const outcome = await Promise.race([
      settled.promise,
      new Promise(resolve => setTimeout(() => resolve({ timedOut: true }), 5_000)),
    ])
    assert.deepEqual(outcome, { ended: false, message: 'Remote stream socket closed' })

    // And the server really can shut down, which is the property the signal-listen
    // above buys: without it this call never returns.
    await server.close()
  })
})
