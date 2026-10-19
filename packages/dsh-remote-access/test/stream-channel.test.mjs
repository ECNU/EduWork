/**
 * The host-side channel: one encrypted connection, presented to the Gateway as one
 * carrier.
 *
 * Three things are checked, and each is checked against a public contract rather
 * than against this file's recollection:
 *
 *   - the frame vocabulary, both directions, through the shipped
 *     `stream-protocol` parser;
 *   - the response envelope, through the strict device rules implemented in
 *     `decodeResponse`;
 *   - the `wireStream.open` argument order, which is the defect this file's first
 *     version shipped and which is silent when wrong.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseRemoteStreamServerMessage } from '@deepseek-ai/dsh-api-gateway/stream-protocol'
import { RemoteError, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'

import { RemoteChannel, UplinkInbox } from '../src/stream/channel.js'
import { decodeResponse } from '../src/stream/envelope.js'

// `decodeResponse` implements the device client's documented strict response rules.
// Assertions below therefore claim the *device* accepts what the host produced, and
// the loader no longer reads a private file path that changes between DSH releases.

/**
 * The Gateway's failure mapper, transcribed from `rpcFailure` in
 * `dsh-api-gateway/lib/index.js`.
 *
 * Transcription rather than a stand-in because the interesting property is that it
 * identifies a `RemoteError` structurally (via `remoteErrorOf`) and is **not**
 * idempotent: its own output is a plain object without the marker, so mapping it
 * twice yields `gateway/internal`. Both halves are shipped — `remoteErrorOf` is
 * imported, the `gateway/internal` fallback is copied — so a double that "helpfully"
 * passed a code through would hide the very behaviour under test.
 */
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

/** A tunnel sink plus the frames written to it. */
function collector() {
  const writes = []
  return {
    writes,
    send: text => { writes.push(text) },
    /**
     * Every write as plain JSON.
     *
     * Unary responses and stream frames travel on the same channel but are different
     * vocabularies — a `server-response` is not a stream frame and the stream parser
     * rejects it. Reading unary answers through the stream parser was a defect in
     * this test file, not in the channel.
     */
    parsed: () => writes.map(text => JSON.parse(text)),
    /** Every write parsed as a stream frame, which is what the device will do. */
    frames: () => writes.map(text => parseRemoteStreamServerMessage(text)),
    async settled(count, label = 'frames') {
      const deadline = Date.now() + 2_000
      while (writes.length < count) {
        if (Date.now() > deadline) {
          assert.fail(`${label}: timed out with ${String(writes.length)}/${String(count)} frames`)
        }
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      return writes.map(text => parseRemoteStreamServerMessage(text))
    },
  }
}

/**
 * A channel over a dispatcher the test controls.
 *
 * `calls` records how `wireStream.open` was invoked, which is what the argument-order
 * test reads.
 */
function channelWith({ dispatchRpc, open, peer } = {}) {
  const sink = collector()
  const calls = []
  const channel = new RemoteChannel({
    dispatchRpc: dispatchRpc ?? (async () => ({ ok: true, value: null })),
    open: open ?? (async (...args) => {
      calls.push(args)
      return (async function* () {})()
    }),
    failure: toWireFailure,
    send: sink.send,
    peer,
  })
  return { channel, sink, calls }
}

/** A downlink that yields the given values, then ends. */
function yields(...values) {
  return (async function* () {
    for (const value of values) yield value
  })()
}

/**
 * A downlink that yields its values and then holds until cancelled, as `$events`
 * does. It takes a control-shaped object with a `signal`, the same way cancel
 * reaches a real stream, so the abort wiring is exercised rather than assumed.
 */
function holds(control, ...initial) {
  return (async function* () {
    for (const value of initial) yield value
    await new Promise(resolve => {
      if (control.signal.aborted) resolve()
      else control.signal.addEventListener('abort', resolve, { once: true })
    })
  })()
}

const clientRequest = (rpcId, method, payload = { args: [] }) => JSON.stringify({
  type: 'client-request', rpcId, method, payload,
})
const openFrame = (streamId, endpoint, payload) => JSON.stringify({ type: 'open', streamId, endpoint, payload })
const itemFrame = (streamId, value) => JSON.stringify({ type: 'item', streamId, value })
const endFrame = streamId => JSON.stringify({ type: 'end', streamId })
const cancelFrame = streamId => JSON.stringify({ type: 'cancel', streamId })

describe('一元调用', () => {
  it('成功调用回成设备解码器能收的信封', async () => {
    const { channel, sink } = channelWith({ dispatchRpc: async () => ({ ok: true, value: { sessions: [] } }) })
    await channel.receive(clientRequest('rpc-1', 'session/list'))

    const writes = sink.parsed()
    assert.equal(writes.length, 1)
    assert.deepEqual(decodeResponse(writes[0]), {
      rpcId: 'rpc-1',
      result: { ok: true, value: { sessions: [] } },
    })
  })

  it('dispatchRpc 的 RemoteError 保留 Host 码', async () => {
    const { channel, sink } = channelWith({
      dispatchRpc: async () => ({ ok: false, error: new RemoteError('gateway/arguments-invalid', 'bad args', { field: 'args' }) }),
    })
    await channel.receive(clientRequest('rpc-2', 'session/prompt'))
    const decoded = decodeResponse(sink.writes.length === 1 ? sink.parsed()[0] : null)
    assert.equal(decoded.result.ok, false)
    assert.equal(decoded.result.error.code, 'gateway/arguments-invalid')
    assert.deepEqual(decoded.result.error.details, { field: 'args' })
  })

  it('每个失败信封都能被设备解码器接受', async () => {
    // The strictness worth naming: `result` must be a record, `ok` must be exactly
    // `false`, and `code`, `message` and `details` must all be present with the right
    // types. An earlier version of the relay's own Host adapter emitted
    // `{ code, message }` here, which that decoder refuses.
    const cases = [
      async () => { throw new Error('a') },
      async () => ({ ok: false, error: { code: 'x/y' } }),
      async () => ({ ok: false, error: null }),
      async () => 42,
      async () => null,
    ]
    for (const [index, dispatchRpc] of cases.entries()) {
      const { channel, sink } = channelWith({ dispatchRpc })
      await channel.receive(clientRequest(`f-${String(index)}`, 'session/list'))
      const decoded = decodeResponse(sink.parsed()[0])
      assert.equal(decoded.result.ok, false, `case ${String(index)}`)
      const error = decoded.result.error
      assert.equal(typeof error.code, 'string', `case ${String(index)} code`)
      assert.equal(error.code.length > 0, true, `case ${String(index)} code`)
      assert.equal(typeof error.message, 'string', `case ${String(index)} message`)
      assert.equal(typeof error.details, 'object', `case ${String(index)} details`)
      assert.equal(Array.isArray(error.details), false, `case ${String(index)} details`)
    }
  })

  it('解码器确实会拒绝缺字段的信封', () => {
    // Proves the previous tests are not vacuous. This is exactly the shape the relay's
    // own Host adapter produced before it was fixed.
    assert.throws(
      () => decodeResponse({ type: 'server-response', rpcId: 'x', result: { ok: false, error: { code: 500, message: 'no' } } }),
      TypeError,
    )
    assert.throws(
      () => decodeResponse({ type: 'server-response', rpcId: 'x', result: { ok: false, error: { code: 'a', message: 'b' } } }),
      TypeError,
    )
  })

  it('rpcId 与 peer 原样传递', async () => {
    const seen = []
    const peer = { marker: 'operator' }
    const { channel, sink } = channelWith({
      peer,
      dispatchRpc: async (...args) => { seen.push(args); return { ok: true, value: 1 } },
    })
    await channel.receive(clientRequest('RpcId-123', 'session/list', { args: [1] }))
    assert.equal(seen.length, 1)
    assert.equal(seen[0][0], 'session/list')
    assert.deepEqual(seen[0][1], { args: [1] })
    assert.equal(seen[0][3], peer)
    assert.equal(sink.parsed()[0].rpcId, 'RpcId-123')
  })

  it('畸形的请求信封抛出，而不是被当作业务失败', async () => {
    const { channel } = channelWith()
    await assert.rejects(
      channel.receive(JSON.stringify({ type: 'client-request', method: 'a' })),
      /no rpcId/u,
    )
    await assert.rejects(
      channel.receive(JSON.stringify({ type: 'client-request', rpcId: 'x' })),
      /no method/u,
    )
    await assert.rejects(channel.receive('not json'), /./u)
  })
})

describe('流式调用', () => {
  it('wireStream.open 的实参顺序是 (endpoint, payload, uplink, peer, signal)', async () => {
    // The defect this file's first version shipped, and it is silent when wrong: a
    // controller in the `peer` position would be handed to business code, and a Peer
    // in the `signal` position would fail at the first `signal.aborted`. Asserted by
    // identity, and asserted as *positions*, so reordering the call cannot pass.
    const peer = { marker: 'operator' }
    const { channel, calls } = channelWith({ peer })
    await channel.receive(openFrame('s1', '$events', { args: {} }))
    await new Promise(resolve => setTimeout(resolve, 10))

    assert.equal(calls.length, 1)
    const [endpoint, payload, uplink, gotPeer, signal] = calls[0]
    assert.equal(endpoint, '$events')
    assert.deepEqual(payload, { args: {} })
    // The uplink is the Host method's input, not a controller.
    assert.equal(typeof uplink[Symbol.asyncIterator], 'function')
    assert.equal(uplink instanceof AbortController, false)
    // Argument four is the Peer, by identity.
    assert.equal(gotPeer, peer)
    // Argument five is an AbortSignal, and it must not be the Peer.
    assert.equal(typeof signal?.aborted, 'boolean')
    assert.notEqual(signal, peer)
  })

  it('$events 的 ready 帧经官方帧格式下行', async () => {
    const ready = { type: 'ready', clientId: 'c1', host: { home: '/home/host' } }
    const { channel, sink } = channelWith({
      open: async (endpoint, payload, uplink, peer, signal) => holds({ signal }, ready),
    })
    await channel.receive(openFrame('s1', '$events', { args: {} }))
    const frames = await sink.settled(1, 'the ready frame')
    assert.equal(frames[0].type, 'item')
    assert.equal(frames[0].streamId, 's1')
    assert.deepEqual(frames[0].value, ready)
    channel.close()
  })

  it('下行以 end 收尾', async () => {
    const { channel, sink } = channelWith({ open: async () => yields('a', 'b') })
    await channel.receive(openFrame('s1', 'demo/finite', { args: [] }))
    const frames = await sink.settled(3, 'two items and an end')
    assert.deepEqual(frames.map(frame => frame.type), ['item', 'item', 'end'])
    assert.deepEqual(frames.slice(0, 2).map(frame => frame.value), ['a', 'b'])
  })

  it('上行项与半关闭到达宿主方法', async () => {
    const seen = []
    const { channel, sink } = channelWith({
      open: async (endpoint, payload, uplink, peer, signal) => {
        void (async () => {
          for await (const item of uplink) seen.push(item)
          seen.push('ENDED')
        })()
        return holds({ signal })
      },
    })
    await channel.receive(openFrame('s1', 'demo/stream', { args: [] }))
    await channel.receive(itemFrame('s1', { hello: 'host' }))
    await channel.receive(endFrame('s1'))
    await sink.settled(0)
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.deepEqual(seen, [{ hello: 'host' }, 'ENDED'])
    channel.close()
  })

  it('cancel 帧中止宿主方法', async () => {
    let reason
    const { channel } = channelWith({
      open: async (endpoint, payload, uplink, peer, signal) => {
        signal.addEventListener('abort', () => { reason = signal.reason?.message })
        return holds({ signal })
      },
    })
    await channel.receive(openFrame('s1', 'demo/held', { args: [] }))
    await new Promise(resolve => setTimeout(resolve, 10))
    await channel.receive(cancelFrame('s1'))
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(reason, 'Remote stream cancelled')
    assert.equal(channel.size, 0)
  })

  it('分发抛错时发 error 帧而不是 end', async () => {
    const { channel, sink } = channelWith({ open: async () => { throw new Error('no such method') } })
    await channel.receive(openFrame('s1', 'demo/missing', { args: [] }))
    const frames = await sink.settled(1, 'the failure frame')
    assert.equal(frames[0].type, 'error')
    assert.equal(frames[0].error.code, 'gateway/internal')
    assert.match(frames[0].error.message, /no such method/u)
    assert.equal(channel.size, 0)
  })

  it('下行不是异步可迭代时发 error 帧', async () => {
    const { channel, sink } = channelWith({ open: async () => 42 })
    await channel.receive(openFrame('s1', 'demo/not-a-stream', { args: [] }))
    const frames = await sink.settled(1, 'the failure frame')
    assert.equal(frames[0].type, 'error')
    assert.match(frames[0].error.message, /AsyncIterable/u)
  })

  it('重复 open 同一 streamId 会失败该流，而不是覆盖', async () => {
    const { channel, sink } = channelWith({ open: async (endpoint, payload, uplink, peer, signal) => holds({ signal }) })
    await channel.receive(openFrame('s1', 'demo/held', { args: [] }))
    await channel.receive(openFrame('s1', 'demo/other', { args: [] }))
    const frames = await sink.settled(1, 'the duplicate failure')
    assert.equal(frames[0].type, 'error')
    assert.match(frames[0].error.message, /duplicate/u)
    channel.close()
  })
})

describe('通道结束', () => {
  it('关闭通道会失败所有仍然打开的流', async () => {
    const aborted = []
    const { channel } = channelWith({
      open: async (endpoint, payload, uplink, peer, signal) => {
        signal.addEventListener('abort', () => aborted.push(signal.reason?.message))
        return holds({ signal })
      },
    })
    await channel.receive(openFrame('s1', 'demo/a', { args: [] }))
    await channel.receive(openFrame('s2', 'demo/b', { args: [] }))
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(channel.size, 2)

    channel.close('carrier lost')
    // A device whose carrier vanished did not cancel anything; leaving its streams
    // open would keep Host methods running for a peer that is gone.
    assert.deepEqual(aborted, ['carrier lost', 'carrier lost'])
    assert.equal(channel.size, 0)
    assert.equal(channel.closed, true)
  })

  it('关闭后收到帧会抛出，重复关闭是幂等的', async () => {
    const { channel } = channelWith({ open: async (endpoint, payload, uplink, peer, signal) => holds({ signal }) })
    channel.close()
    channel.close()
    assert.equal(channel.closed, true)
    await assert.rejects(channel.receive(openFrame('s1', 'x', { args: [] })), /channel is closed/u)
  })

  it('关闭会中止通道生命周期信号', async () => {
    let aborted = false
    const { channel } = channelWith({
      dispatchRpc: async (method, payload, signal) => {
        signal.addEventListener('abort', () => { aborted = true })
        return { ok: true, value: null }
      },
    })
    await channel.receive(clientRequest('rpc-1', 'session/list'))
    channel.close('gone')
    assert.equal(aborted, true)
  })
})

describe('中继侧的宿主适配器也遵守同一个信封', () => {
  it('KernelHost 的失败信封能被设备解码器接受', async () => {
    // The same defect class as the one this channel's envelope work exists to avoid,
    // found in the relay's own Host adapter: its `failure` helper emitted
    // `{ code, message }` with no `details`, and `parseConnectionResponse` refuses
    // that. So every refusal it built — "the host could not authenticate to itself",
    // a rejected call, a non-envelope body — reached the device as a transport error
    // instead of as the reason the Host had written down.
    const { KernelHost } = await import('../src/relay/host.js')

    // Minimal collaborators: the mint refuses, which is the shortest path to one of
    // the failure envelopes, and no kernel call is made.
    const connection = {
      authenticatedUrl: () => 'http://127.0.0.1:1/?token=x',
      createSharedFetchHandler: () => ({ fetch: async () => { throw new Error('unreachable') } }),
      operator: { marker: 'operator' },
    }
    const host = new KernelHost({
      connection,
      authority: '127.0.0.1:1',
      fetchImpl: async () => ({ status: 500, headers: { get: () => undefined } }),
      RequestImpl: class {},
    })

    const envelope = await host.dispatch({ endpoint: 'session/list', payload: { args: [] }, rpcId: 'rpc-host-1' })
    assert.equal(envelope.type, 'server-response')
    assert.equal(envelope.rpcId, 'rpc-host-1')
    assert.equal(envelope.result.ok, false)
    // The assertion that matters: the shipped decoder accepts it.
    const decoded = decodeResponse(envelope)
    assert.equal(decoded.result.ok, false)
    assert.equal(typeof decoded.result.error.code, 'string')
    assert.equal(typeof decoded.result.error.details, 'object')
  })
})

describe('上行收件箱', () => {
  it('按序交付并报告结束', async () => {
    const inbox = new UplinkInbox()
    inbox.push('a')
    inbox.push({ b: 2 })
    inbox.end()
    const items = []
    for await (const item of inbox) items.push(item)
    assert.deepEqual(items, ['a', { b: 2 }])
  })

  it('结束后的项被拒绝', () => {
    const inbox = new UplinkInbox()
    inbox.end()
    assert.throws(() => inbox.push('late'), /after end/u)
  })

  it('超过上限会失败该流，且已接受的项仍可读', async () => {
    const inbox = new UplinkInbox()
    assert.throws(() => {
      for (let index = 0; index < 10_000; index += 1) inbox.push('x'.repeat(1_000))
    }, /exceeded/u)
    // The cap fails the stream; it does not discard what already arrived.
    assert.equal(inbox.depth > 0, true)
    for (let guard = 0; guard < 10_000 && inbox.depth > 0; guard += 1) await inbox.next()
    await assert.rejects(async () => { await inbox.next() }, /exceeded/u)
  })

  it('失败会唤醒等待中的读取', async () => {
    const inbox = new UplinkInbox()
    const pending = inbox.next()
    inbox.fail(new Error('carrier lost'))
    await assert.rejects(async () => { await pending }, /carrier lost/u)
  })

  it('return 丢弃剩余项并结束', async () => {
    const inbox = new UplinkInbox()
    inbox.push('a')
    assert.deepEqual(await inbox.return(), { value: undefined, done: true })
    assert.deepEqual(await inbox.next(), { value: undefined, done: true })
  })
})
