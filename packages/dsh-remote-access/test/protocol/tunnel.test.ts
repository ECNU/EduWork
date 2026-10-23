import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { WINDOW } from '../../src/protocol/body.ts'
import { utf8 } from '../../src/protocol/bytes.ts'
import { ChannelClosed, type Header } from '../../src/protocol/channel.ts'
import { Close } from '../../src/protocol/close-codes.ts'
import { serveTunnel, TunnelClient, TunnelError, TunnelStreamError, type TunnelHandler } from '../../src/protocol/tunnel.ts'
import { channelPair } from '../harness.ts'

const handler = (overrides: Partial<TunnelHandler>): TunnelHandler => ({
  fetch: async () => new Response('not found', { status: 404 }),
  async *openStream() {},
  streamFailure: error => ({ code: 'internal', message: String(error), details: {} }),
  ...overrides,
})

async function connect(serve: TunnelHandler, onControl?: (header: Header) => void) {
  const pair = await channelPair()
  void serveTunnel(pair.host, serve)
  return { ...pair, client: new TunnelClient(pair.device, onControl) }
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const pattern = (size: number): Uint8Array<ArrayBuffer> => new Uint8Array(size).map((_, i) => (i * 31) % 256)

/** A response body that counts what the Host pulls from it and notices cancellation. */
function counted(total = Infinity) {
  const state = { pulled: 0, cancelled: false }
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulled >= total) return controller.close()
      const chunk = new Uint8Array(Math.min(65536, total - state.pulled))
      state.pulled += chunk.byteLength
      controller.enqueue(chunk)
    },
    cancel() { state.cancelled = true },
  })
  return { state, body }
}

test('requests carry method, path, headers and body; responses carry status, headers and body', async () => {
  const { client } = await connect(handler({
    async fetch(request) {
      const url = new URL(request.url)
      const echo = `${request.method} ${url.pathname}${url.search} ${request.headers.get('x-a')} ${await request.text()}`
      return new Response(echo, { status: 201, headers: { 'x-b': '2' } })
    },
  }))
  const response = await client.fetch({ method: 'POST', url: '/api/session/prompt?x=1', headers: { 'x-a': '1' }, body: utf8('hello') })
  assert.equal(response.status, 201)
  assert.equal(response.headers.get('x-b'), '2')
  assert.equal(await response.text(), 'POST /api/session/prompt?x=1 1 hello')
})

test('bodies larger than the credit window flow in both directions', async () => {
  const upload = pattern(3 * WINDOW + 12345), download = pattern(5 * WINDOW + 777)
  const { client } = await connect(handler({
    async fetch(request) {
      const received = new Uint8Array(await request.arrayBuffer())
      return new Response(sha256(received) === sha256(upload) ? download : 'corrupt')
    },
  }))
  const response = await client.fetch({ method: 'PUT', url: '/upload', body: new Blob([upload]).stream() })
  assert.equal(sha256(new Uint8Array(await response.arrayBuffer())), sha256(download))
})

test('HEAD and null-body statuses have no body', async () => {
  const { client } = await connect(handler({
    fetch: async request => new Response(request.method === 'HEAD' ? 'ignored' : null, { status: request.method === 'HEAD' ? 200 : 204 }),
  }))
  assert.equal((await client.fetch({ method: 'HEAD', url: '/' })).body, null)
  assert.equal((await client.fetch({ method: 'DELETE', url: '/x' })).status, 204)
})

test('a reader that stops reading bounds what the Host pulls from its source', async () => {
  const source = counted(8 * WINDOW)
  const { client } = await connect(handler({ fetch: async () => new Response(source.body) }))
  const response = await client.fetch({ method: 'GET', url: '/large' })
  await sleep(300)
  assert.ok(source.state.pulled <= WINDOW + 4 * 65536, `pulled ${source.state.pulled} bytes without a reader`)
  assert.equal((await response.arrayBuffer()).byteLength, 8 * WINDOW)
})

test('aborting a request or cancelling its body stops the Host', async () => {
  const sources: ReturnType<typeof counted>[] = [], signals: AbortSignal[] = []
  const { client } = await connect(handler({
    async fetch(_request, signal) {
      const source = counted()
      sources.push(source)
      signals.push(signal)
      return new Response(source.body)
    },
  }))
  const abort = new AbortController()
  const aborted = await client.fetch({ method: 'GET', url: '/a' }, abort.signal)
  const reader = aborted.body!.getReader()
  await reader.read()
  abort.abort(new Error('user left'))
  await assert.rejects(reader.read(), /user left/)

  const cancelled = await client.fetch({ method: 'GET', url: '/b' })
  await cancelled.body!.cancel()
  await sleep(50)
  assert.ok(signals[0]!.aborted && sources[0]!.state.cancelled)
  assert.ok(signals[1]!.aborted && sources[1]!.state.cancelled)
})

test('a Host that cannot answer rejects the request instead of hanging', async () => {
  const { client } = await connect(handler({ fetch: async () => { throw new Error('boom') } }))
  await assert.rejects(client.fetch({ method: 'GET', url: '/' }), (error: Error) => error instanceof TunnelError && error.message === 'boom')
})

test('streams carry items and uplink until the end; Host failures keep their code', async () => {
  const { client } = await connect(handler({
    async *openStream(endpoint, payload, uplink) {
      if (endpoint === 'broken') {
        yield 'first'
        throw Object.assign(new Error('gone'), { code: 'session/not-found' })
      }
      yield { endpoint, payload }
      for await (const value of uplink) yield { echo: value }
    },
    streamFailure: error => ({ code: (error as { code: string }).code, message: (error as Error).message, details: { hint: 1 } }),
  }))
  async function* uplink() { yield 1; yield 2 }
  const items: unknown[] = []
  for await (const item of client.openStream('$events', { from: 3 }, new AbortController().signal, uplink())) items.push(item)
  assert.deepEqual(items, [{ endpoint: '$events', payload: { from: 3 } }, { echo: 1 }, { echo: 2 }])

  const broken = client.openStream('broken', null, new AbortController().signal)
  assert.deepEqual(await broken.next(), { value: 'first', done: false })
  await assert.rejects(broken.next(), (error: TunnelStreamError) =>
    error instanceof TunnelStreamError && error.code === 'session/not-found' && error.message === 'gone' && (error.details as { hint: number }).hint === 1)
})

test('leaving a stream early or aborting it cancels the Host side', async () => {
  const signals: AbortSignal[] = []
  const { client } = await connect(handler({
    async *openStream(_endpoint, _payload, _uplink, signal) {
      signals.push(signal)
      for (let i = 0; ; i++) {
        yield i
        await sleep(5)
      }
    },
  }))
  for await (const item of client.openStream('$events', {}, new AbortController().signal)) if (item === 2) break
  const abort = new AbortController()
  const stream = client.openStream('$events', {}, abort.signal)
  await stream.next()
  abort.abort(new Error('closed tab'))
  await assert.rejects(stream.next(), /closed tab/)
  await sleep(50)
  assert.deepEqual(signals.map(s => s.aborted), [true, true])
})

test('when the channel closes, pending exchanges fail as carrier errors and the Host is aborted', async () => {
  const hostSignals: AbortSignal[] = []
  const { client, device } = await connect(handler({
    fetch: (_request, signal) => {
      hostSignals.push(signal)
      return new Promise(() => {})
    },
    async *openStream(_e, _p, _u, signal) {
      hostSignals.push(signal)
      yield 'started'
      await new Promise(() => {})
    },
  }))
  const pending = client.fetch({ method: 'POST', url: '/api/session/prompt', body: utf8('{}') })
  const stream = client.openStream('$events', {}, new AbortController().signal)
  await stream.next()
  device.close(Close.normal, 'network lost')
  await assert.rejects(pending, ChannelClosed)
  await assert.rejects(stream.next(), ChannelClosed)
  await assert.rejects(client.fetch({ method: 'GET', url: '/' }), ChannelClosed)
  await sleep(20)
  assert.deepEqual(hostSignals.map(s => s.aborted), [true, true])
})

test('a result finishing after its connection closed is never delivered to another connection', async () => {
  const calls: PromiseWithResolvers<string>[] = []
  const shared = handler({
    async fetch() {
      const call = Promise.withResolvers<string>()
      calls.push(call)
      return new Response(await call.promise)
    },
  })
  const a = await connect(shared), b = await connect(shared)
  const fromA = a.client.fetch({ method: 'GET', url: '/slow' })
  await sleep(20)
  a.device.close()
  await assert.rejects(fromA, ChannelClosed)
  const fromB = b.client.fetch({ method: 'GET', url: '/slow' })
  await sleep(20)
  calls[0]!.resolve('for A')
  await sleep(20)
  calls[1]!.resolve('for B')
  assert.equal(await (await fromB).text(), 'for B')
})

test('malformed or replayed exchanges close the channel as a protocol error', async () => {
  for (const frames of [
    [{ t: 'req', id: 1, method: 'GET', url: '//evil.example/x', headers: {}, body: false }],
    [{ t: 'req', id: 1, method: 'GET', url: 'https://evil.example/x', headers: {}, body: false }],
    [{ t: 'stream-open', id: 2, endpoint: '$events' }, { t: 'stream-open', id: 2, endpoint: '$events' }],
    [{ t: 'revoked' }],
  ]) {
    const { device, host } = await channelPair()
    void serveTunnel(host, handler({ async *openStream() { await new Promise(() => {}) } }))
    for (const frame of frames) device.send(frame)
    await assert.rejects(device.receive(), (error: ChannelClosed) => error.code === Close.protocolError)
  }
})

test('frames without an exchange id are handed to the control handler', async () => {
  const control = Promise.withResolvers<Header>()
  const { host } = await connect(handler({}), control.resolve)
  host.send({ t: 'revoked' })
  assert.deepEqual(await control.promise, { t: 'revoked' })
})

test('ping is answered by the Host and fails once the channel is gone', async () => {
  const { client, device } = await connect(handler({}))
  await Promise.all([client.ping(), client.ping()])
  device.close()
  await assert.rejects(client.ping(), ChannelClosed)
})

test('the Host closes a connection whose device went silent', async () => {
  const { device, host } = await channelPair()
  void serveTunnel(host, handler({}), 50)
  await assert.rejects(device.receive(), (error: ChannelClosed) => error.code === Close.timeout)
})
