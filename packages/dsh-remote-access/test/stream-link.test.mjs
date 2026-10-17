/**
 * The whole path: device carrier over the encrypted channel to the host channel.
 *
 * This is the first test where both halves run against each other rather than
 * against a double. The encrypted link is real — two `Session`s, one per direction,
 * sealing and opening every frame — so a mismatched sequence, a wrong key or a
 * direction error fails here rather than in production.
 *
 * What it establishes, in the order the device would meet it:
 *
 *   - a unary call written by the device's `rpc.call` reaches the host's stream
 *     dispatcher and comes back in an envelope the client's own decoder accepts;
 *   - a logical stream opened through `rpc.open` yields the frames the client
 *     parses, in the order it expects;
 *   - an uplink item and its half-close reach the host method;
 *   - cancelling the stream stops the host method;
 *   - closing the link fails everything still open on it.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { DIRECTION, KIND, Session } from '../src/channel/crypto.js'
import { RemoteChannel } from '../src/stream/channel.js'
import { decodeResponse } from '../src/stream/envelope.js'
import { DeviceLink } from '../src/stream/link.js'
import { RemoteError, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'

/**
 * Negotiated keys, as the handshake would produce them.
 *
 * Fixed bytes rather than a real handshake: the handshake has its own tests, and
 * what is under test here is everything above it. Random values would only make a
 * failure harder to reproduce.
 */
const KEYS = {
  peerToHost: new Uint8Array(32).fill(0x11),
  hostToPeer: new Uint8Array(32).fill(0x22),
}

const device = () => new Session({
  sendKey: KEYS.peerToHost,
  receiveKey: KEYS.hostToPeer,
  direction: DIRECTION.PEER_TO_HOST,
  kind: KIND.RPC,
})
const host = () => new Session({
  sendKey: KEYS.hostToPeer,
  receiveKey: KEYS.peerToHost,
  direction: DIRECTION.HOST_TO_PEER,
  kind: KIND.RPC,
})

/** The Gateway's failure mapper, transcribed from `rpcFailure`. */
const toWireFailure = error => {
  const remote = remoteErrorOf(error)
  if (remote !== undefined) {
    return { code: remote.code, message: remote.message, details: remote.details }
  }
  return {
    code: 'gateway/internal',
    message: error instanceof Error ? error.message : String(error),
    details: {},
  }
}

/**
 * Wire a device link to a host channel over one in-process sealed pair.
 *
 * The two `receive` calls are the whole transport: a frame the device seals is
 * opened by the host, and the answer travels back the same way. Nothing is stubbed
 * between them — including the crypto, which is the point.
 *
 * Each side gets exactly one `Session` for the life of the connection. Rebuilding
 * one per frame would reset its sequence numbers, and the framing authenticates a
 * strictly increasing counter — so a fresh session per frame does not merely cost
 * allocations, it fails on the second frame.
 */
function connectHost({
  dispatchRpc = async () => ({ ok: true, value: null }),
  open = async () => (async function* () { })(),
} = {}) {
  const deviceSession = device()
  const hostSession = host()
  let link
  const hostChannel = new RemoteChannel({
    dispatchRpc,
    open,
    failure: toWireFailure,
    // The host's outbound frames are plaintext JSON; sealing is the transport's job,
    // which on the other side of this test is `hostSession`. Handing the plaintext
    // straight to the device is the mistake this comment exists to prevent — the
    // device would try to authenticate it as a frame and report the first byte.
    send: async text => {
      await link.receive(await hostSession.seal(new TextEncoder().encode(text)))
    },
    peer: { marker: 'operator' },
  })
  link = new DeviceLink({
    session: deviceSession,
    send: async frame => {
      await hostChannel.receive(new TextDecoder().decode(await hostSession.open(frame)))
    },
  })
  return { link, hostChannel, deviceSession, hostSession }
}

/** Wait for a value to satisfy a predicate, or fail. */
async function until(predicate, label, { timeoutMs = 2_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = predicate()
    if (value) return value
    if (Date.now() > deadline) assert.fail(`${label}: timed out`)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

describe('设备载体的形状', () => {
  it('transportGlobals 提供 Connection 安装器要的三样', () => {
    const { link } = connectHost()
    const globals = link.transportGlobals()
    assert.equal(typeof globals.streamBaseUrl, 'string')
    assert.equal(typeof globals.rpc.call, 'function')
    assert.equal(typeof globals.rpc.open, 'function')
    // The class, not an instance: the official mux client constructs one itself.
    assert.equal(typeof globals.WebSocket, 'function')
    assert.equal(globals.WebSocket.prototype?.constructor, globals.WebSocket)
  })

  it('WebSocket 类的实例是 WebSocket 形状', () => {
    const { link } = connectHost()
    const Linked = link.webSocketClass()
    const socket = new Linked('https://remote.invalid/api/remote.mux')
    assert.equal(socket.readyState, Linked.CONNECTING)
    assert.equal(typeof socket.send, 'function')
    assert.equal(typeof socket.close, 'function')
    assert.equal(typeof socket.addEventListener, 'function')
    socket.close()
  })

  it('非 /api 通道的流被拒绝', () => {
    const { link } = connectHost()
    // The client refuses this too; refusing here means the caller learns the channel
    // was wrong rather than that the Host misbehaved.
    assert.throws(() => link.rpc.open('/other', 'x', { args: [] }, undefined, undefined), /\/api/u)
  })
})

describe('一元调用经真实加密通道', () => {
  it('回成设备解码器能收的信封', async () => {
    const { link } = connectHost({ dispatchRpc: async () => ({ ok: true, value: { sessions: ['a'] } }) })
    const result = await link.rpc.call('/api', 'session/list', { args: [] }, undefined)
    // `rpc.call` resolves to `{ ok, value }` — the client's own result shape — so the
    // envelope never leaks past the transport.
    assert.deepEqual(result, { ok: true, value: { sessions: ['a'] } })
  })

  it('宿主端 RemoteError 的码穿过加密通道到达设备', async () => {
    const { link } = connectHost({
      dispatchRpc: async () => ({ ok: false, error: new RemoteError('gateway/arguments-invalid', 'bad args', { field: 'args' }) }),
    })
    const result = await link.rpc.call('/api', 'session/prompt', { args: [1] }, undefined)
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'gateway/arguments-invalid')
    assert.deepEqual(result.error.details, { field: 'args' })
  })

  it('宿主抛错时设备拿到 gateway/internal，而不是连接断开', async () => {
    const { link } = connectHost({ dispatchRpc: async () => { throw new Error('boom') } })
    const result = await link.rpc.call('/api', 'session/list', { args: [] }, undefined)
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'gateway/internal')
    assert.match(result.error.message, /boom/u)
  })

  it('多个并发调用各自拿到自己的答案', async () => {
    // Correlation is by rpcId, so two in flight must not swap answers. This is the
    // same class of defect as a carrier that pairs by arrival order.
    const { link } = connectHost({
      dispatchRpc: async (method, payload) => ({ ok: true, value: { method, args: payload.args } }),
    })
    const answers = await Promise.all([
      link.rpc.call('/api', 'session/list', { args: [1] }, undefined),
      link.rpc.call('/api', 'session/page', { args: [2] }, undefined),
      link.rpc.call('/api', 'settings/describe', { args: [3] }, undefined),
    ])
    assert.deepEqual(answers.map(answer => answer.value.method).sort(), ['session/list', 'session/page', 'settings/describe'])
    assert.deepEqual(answers.map(answer => answer.value.args), [[1], [2], [3]])
  })

  it('关闭链接后调用失败', async () => {
    const { link } = connectHost()
    link.close('gone')
    await assert.rejects(link.rpc.call('/api', 'session/list', { args: [] }, undefined), /closed/u)
  })
})

describe('逻辑流经真实加密通道', () => {
  it('$events 的 ready 帧到达设备', async () => {
    const ready = { type: 'ready', clientId: 'c1', host: { home: '/home/host' } }
    const { link } = connectHost({
      open: async (endpoint, payload, uplink, peer, signal) => (async function* () {
        yield ready
        await new Promise(resolve => {
          if (signal.aborted) resolve()
          else signal.addEventListener('abort', resolve, { once: true })
        })
      })(),
    })

    const stream = link.rpc.open('/api', '$events', { args: {} }, undefined, undefined)
    // Synchronous return of an async iterable: the client passes this straight into
    // its stream normalizer, which iterates it.
    assert.equal(typeof stream[Symbol.asyncIterator], 'function')

    const iterator = stream[Symbol.asyncIterator]()
    const first = await iterator.next()
    assert.equal(first.done, false)
    assert.deepEqual(first.value, ready)

    await iterator.return?.()
    link.close()
  })

  it('有限流以 end 收尾', async () => {
    const { link } = connectHost({
      open: async () => (async function* () { yield 'one'; yield 'two' })(),
    })
    const stream = link.rpc.open('/api', 'demo/finite', { args: [] }, undefined, undefined)
    const items = []
    for await (const item of stream) items.push(item)
    assert.deepEqual(items, ['one', 'two'])
  })

  it('上行项与半关闭到达宿主方法', async () => {
    const seen = []
    const { link } = connectHost({
      open: async (endpoint, payload, uplink, peer, signal) => {
        void (async () => {
          for await (const item of uplink) seen.push(item)
          seen.push('ENDED')
        })()
        return (async function* () {
          await new Promise(resolve => {
            if (signal.aborted) resolve()
            else signal.addEventListener('abort', resolve, { once: true })
          })
        })()
      },
    })

    const uplink = (async function* () { yield { hello: 'host' } })()
    const stream = link.rpc.open('/api', 'demo/stream', { args: [] }, undefined, uplink)
    const iterator = stream[Symbol.asyncIterator]()
    // This stream yields nothing, so the read stays parked. It is started only to
    // drive the generator, and it has to be settled before the test ends: a parked
    // read keeps the generator inside an `await`, and `return()` cannot finish a
    // generator that is still suspended there.
    const reading = iterator.next()
    await until(() => seen.length >= 2, 'the uplink item and its end')
    assert.deepEqual(seen, [{ hello: 'host' }, 'ENDED'])

    link.close()
    await reading.catch(() => undefined)
  })

  it('取消流会中止宿主方法', async () => {
    let reason
    const { link } = connectHost({
      open: async (endpoint, payload, uplink, peer, signal) => {
        signal.addEventListener('abort', () => { reason = signal.reason?.message })
        return (async function* () {
          await new Promise(resolve => {
            if (signal.aborted) resolve()
            else signal.addEventListener('abort', resolve, { once: true })
          })
        })()
      },
    })

    const controller = new AbortController()
    const stream = link.rpc.open('/api', 'demo/held', { args: [] }, controller.signal, undefined)
    const iterator = stream[Symbol.asyncIterator]()
    // Attach the catch before aborting. Aborting first, then awaiting, leaves a
    // rejected promise unhandled for a turn and the test runner reports it as an
    // unhandled rejection rather than as the assertion it is meant to be.
    const reading = iterator.next().catch(error => error)
    await new Promise(resolve => setTimeout(resolve, 20))
    controller.abort()
    await until(() => reason !== undefined, 'the host to observe the cancellation')
    assert.equal(reason, 'Remote stream cancelled')
    const outcome = await reading
    assert.equal(outcome instanceof Error, true, 'the parked read should settle with the abort reason')
    link.close()
  })

  it('宿主失败时设备读到错误', async () => {
    const { link } = connectHost({ open: async () => { throw new Error('no such method') } })
    const stream = link.rpc.open('/api', 'demo/missing', { args: [] }, undefined, undefined)
    const iterator = stream[Symbol.asyncIterator]()
    await assert.rejects(async () => { await iterator.next() }, /no such method/u)
  })

  it('关闭链接后流失败，而不是永远挂着', async () => {
    const { link } = connectHost({
      open: async (endpoint, payload, uplink, peer, signal) => (async function* () {
        await new Promise(resolve => {
          if (signal.aborted) resolve()
          else signal.addEventListener('abort', resolve, { once: true })
        })
      })(),
    })
    const stream = link.rpc.open('/api', 'demo/held', { args: [] }, undefined, undefined)
    const iterator = stream[Symbol.asyncIterator]()
    const reading = iterator.next()
    await new Promise(resolve => setTimeout(resolve, 10))
    link.close('carrier lost')
    await assert.rejects(async () => { await reading }, /carrier lost/u)
  })
})

describe('设备侧的 WebSocket 隧道', () => {
  it('官方 mux 的语言能穿过隧道到达宿主', async () => {
    // The mux's socket carries the logical-stream vocabulary, and this asserts the
    // routing rather than the protocol: a frame written to the socket arrives at the
    // host's stream dispatcher with its payload intact.
    const opened = []
    const { link } = connectHost({
      open: async (endpoint, payload, uplink, peer, signal) => {
        opened.push({ endpoint, payload })
        return (async function* () {
          yield { type: 'ready', clientId: 'c1', host: { home: '/home/host' } }
          await new Promise(resolve => {
            if (signal.aborted) resolve()
            else signal.addEventListener('abort', resolve, { once: true })
          })
        })()
      },
    })

    const Linked = link.webSocketClass()
    const socket = new Linked('https://remote.invalid/api/remote.mux')
    const messages = []
    socket.addEventListener('message', event => messages.push(JSON.parse(event.data)))
    await until(() => socket.readyState === Linked.OPEN, 'the socket to open')

    socket.send(JSON.stringify({ type: 'open', streamId: 's1', endpoint: '$events', payload: { args: {} } }))
    const first = await until(() => messages[0], 'the ready frame')
    assert.equal(first.type, 'item')
    assert.equal(first.streamId, 's1')
    assert.deepEqual(first.value, { type: 'ready', clientId: 'c1', host: { home: '/home/host' } })
    assert.deepEqual(opened, [{ endpoint: '$events', payload: { args: {} } }])

    socket.close()
    link.close()
  })

  it('隧道会把 mux 早于 open 发出的帧排队', async () => {
    const opened = []
    const { link } = connectHost({
      open: async (endpoint, payload, uplink, peer, signal) => {
        opened.push(endpoint)
        return (async function* () {
          await new Promise(resolve => {
            if (signal.aborted) resolve()
            else signal.addEventListener('abort', resolve, { once: true })
          })
        })()
      },
    })
    const Linked = link.webSocketClass()
    const socket = new Linked('https://remote.invalid/api/remote.mux')
    // The mux's pump can send before the socket reports open. A dropped frame here
    // would be a logical stream that never starts and never fails.
    socket.send(JSON.stringify({ type: 'open', streamId: 's1', endpoint: '$events', payload: { args: {} } }))
    await until(() => opened.length === 1, 'the queued frame to arrive')
    assert.deepEqual(opened, ['$events'])
    socket.close()
    link.close()
  })
})

describe('信封解码器仍是权威', () => {
  it('把设备解出的失败交回解码器仍然成立', async () => {
    // A guard against these tests drifting from the device's own rules: the failure
    // the link hands back is one the shipped decoder accepts.
    const { link } = connectHost({
      dispatchRpc: async () => ({ ok: false, error: { code: 'gateway/denied', message: 'no', details: {} } }),
    })
    const result = await link.rpc.call('/api', 'session/prompt', { args: [] }, undefined)
    assert.equal(result.ok, false)
    assert.doesNotThrow(() => decodeResponse({
      type: 'server-response',
      rpcId: 'x',
      result: { ok: false, error: result.error },
    }))
  })
})
