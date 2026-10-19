/**
 * The join between the tunnel and the kernel.
 *
 * The kernel's own contract cannot be exercised from outside its process — the
 * launch token that mints a browser cookie is a random value held in memory, and
 * nothing else can produce one. So the double below reimplements that contract
 * from the kernel's side rather than replaying this module's view of it: it
 * derives the authority from the `Host` header, keeps cookies in a jar keyed by
 * authority, and refuses a call whose `method` disagrees with its path. A double
 * that echoed the adapter back would pass while the adapter was wrong.
 *
 * What these tests cannot show is that the running Host behaves this way. That is
 * an in-client check, and it is the reason the wiring commit is separate from
 * this one.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { KernelHost, kernelDispatch, mintCookie } from '../src/relay/host.js'

/** A cookie jar that only answers for the authority it was minted against. */
function createJar() {
  const byAuthority = new Map()
  let serial = 0
  return {
    mint(authority) {
      serial += 1
      const name = `dsh-auth-${String(serial)}`
      const value = `session-${String(serial)}`
      byAuthority.set(authority, { name, value })
      return { name, value }
    },
    header(authority) {
      const entry = byAuthority.get(authority)
      return entry === undefined ? undefined : `${entry.name}=${entry.value}`
    },
    value(authority) {
      return byAuthority.get(authority)?.value
    },
  }
}

/**
 * A kernel that enforces the documented fence: trusted authority, that
 * authority's cookie, and a path whose endpoint matches the envelope's method.
 *
 * `mintToken` is what `authenticatedUrl` hands out and `acceptToken` is what the
 * fence accepts. They are separate so a test can make the kernel refuse an
 * exchange it was offered — passing one value for both would change what the
 * adapter sends and what the kernel wants at once, and the two would still agree.
 */
function fakeKernel({
  authority,
  mintToken = 'launch-token',
  acceptToken = mintToken,
  handler,
  jar = createJar(),
  trusted = true,
}) {
  const calls = []
  const mints = []
  const sharedPeers = []
  const fetchImpl = async (url) => {
    const parsed = new URL(String(url))
    const host = parsed.host
    const tokens = parsed.searchParams.getAll('token')
    const requested = tokens.length === 1 && tokens[0] === acceptToken
    const indexRequest = parsed.pathname === '/' && host === authority && requested
    mints.push({ url: String(url), host, accepted: indexRequest })
    if (!indexRequest) return new Response('forbidden', { status: 403 })
    const minted = jar.mint(authority)
    const headers = new Headers()
    headers.append('set-cookie', `${minted.name}=${minted.value}; Path=/; HttpOnly; SameSite=Lax`)
    return new Response(null, { status: 303, headers })
  }

  const connection = {
    operator: { id: 'operator' },
    authenticatedUrl(base) {
      const url = new URL(base)
      url.searchParams.set('token', mintToken)
      return url.toString()
    },
    admit(request) {
      const host = request.headers.get('host')
      if (!trusted || host !== authority) return { rejection: 403 }
      const cookie = request.headers.get('cookie')
      const value = jar.value(authority)
      if (value === undefined || cookie === null || !cookie.includes(value)) return { rejection: 401 }
      return { peer: this.operator }
    },
    createSharedFetchHandler(apiPath) {
      return {
        async fetch(request, peer) {
          sharedPeers.push(peer)
          const host = request.headers.get('host')
          const cookie = request.headers.get('cookie')
          const value = jar.value(authority)
          if (host !== authority) return new Response('forbidden', { status: 403 })
          if (value === undefined || cookie === null || !cookie.includes(value)) {
            return new Response('unauthorized', { status: 401 })
          }
          if (request.method !== 'POST') return new Response('not found', { status: 404 })
          const url = new URL(request.url)
          if (!url.pathname.startsWith(`${apiPath}/`)) return new Response('not found', { status: 404 })
          const endpoint = url.pathname.slice(apiPath.length + 1)
          if (request.headers.get('content-type') !== 'application/json') return new Response('bad type', { status: 415 })
          const envelope = await request.json()
          if (envelope.method !== endpoint) {
            return Response.json({
              type: 'server-response',
              rpcId: envelope.rpcId,
              result: { ok: false, error: { code: 'gateway/bad-request', message: 'method does not match endpoint' } },
            })
          }
          calls.push({ endpoint, payload: envelope.payload, rpcId: envelope.rpcId })
          return Response.json(await handler(endpoint, envelope.payload, envelope.rpcId))
        },
      }
    },
  }
  return { connection, fetchImpl, calls, mints, jar, sharedPeers }
}

const AUTHORITY = '127.0.0.1:62021'
const okHandler = async (endpoint, payload, rpcId) => ({
  type: 'server-response',
  rpcId,
  result: { ok: true, value: { endpoint, payload } },
})

test('铸到的 cookie 用的是内核给的 URL，不是自己拼的', async () => {
  const kernel = fakeKernel({ authority: AUTHORITY, handler: okHandler })
  const cookie = await mintCookie({
    connection: kernel.connection,
    authority: AUTHORITY,
    fetchImpl: kernel.fetchImpl,
  })
  assert.equal(typeof cookie, 'string')
  assert.match(cookie, /^dsh-auth-\d+=session-\d+$/u)
  assert.equal(kernel.mints.length, 1)
  // The token has to come from `authenticatedUrl`. Building it by hand would mean
  // reimplementing how the process proves it is itself, so the test asserts the
  // adapter asked rather than assumed.
  assert.match(kernel.mints[0].url, /[?&]token=launch-token/u)
  assert.equal(kernel.mints[0].host, AUTHORITY)
})

test('内核不回 303 时返回 undefined，而不是把拒绝当成 cookie', async () => {
  // The kernel accepts a token this process did not present, which is what a
  // stale or foreign launch token looks like from here.
  const kernel = fakeKernel({ authority: AUTHORITY, handler: okHandler, acceptToken: 'some-other-process' })
  const cookie = await mintCookie({
    connection: kernel.connection,
    authority: AUTHORITY,
    fetchImpl: kernel.fetchImpl,
  })
  assert.equal(cookie, undefined)
  assert.equal(kernel.mints[0].accepted, false)
})

test('一次调用走完整条路：铸 cookie、POST 到正确端点、拿回信封', async () => {
  const kernel = fakeKernel({ authority: AUTHORITY, handler: okHandler })
  const host = new KernelHost({
    connection: kernel.connection,
    authority: AUTHORITY,
    fetchImpl: kernel.fetchImpl,
  })

  const reply = await host.dispatch({
    endpoint: 'session/list',
    payload: { args: { _request: {} } },
    rpcId: 'rpc-1',
  })

  assert.deepEqual(reply.result.ok, true)
  assert.equal(reply.rpcId, 'rpc-1')
  assert.deepEqual(kernel.calls, [
    { endpoint: 'session/list', payload: { args: { _request: {} } }, rpcId: 'rpc-1' },
  ])
})

test('没有 operator 时回退到 browserPeer 或 createPeer，并把结果缓存', () => {
  const browserPeer = { principal: { kind: 'owner' }, interactions: 'answer', signal: new AbortController().signal }
  const withBrowser = new KernelHost({
    connection: { browserPeer, createSharedFetchHandler: () => ({}) },
    authority: AUTHORITY,
  })
  assert.equal(withBrowser.peer, browserPeer)

  const created = { principal: { kind: 'owner' }, interactions: 'answer', signal: new AbortController().signal }
  let creations = 0
  const withFactory = new KernelHost({
    connection: {
      createSharedFetchHandler: () => ({}),
      createPeer: () => {
        creations += 1
        return created
      },
    },
    authority: AUTHORITY,
  })
  assert.equal(withFactory.peer, created)
  assert.equal(withFactory.peer, created)
  assert.equal(creations, 1, 'the owner Peer must be stable across calls')
})

test('共享处理器拿到的是宿主 operator Peer，而不是 undefined', async () => {
  const kernel = fakeKernel({ authority: AUTHORITY, handler: okHandler })
  const host = new KernelHost({ connection: kernel.connection, authority: AUTHORITY, fetchImpl: kernel.fetchImpl })

  await host.dispatch({ endpoint: 'session/list', payload: {}, rpcId: 'peer-1' })

  assert.equal(kernel.sharedPeers.length, 1)
  assert.equal(kernel.sharedPeers[0], kernel.connection.operator)
})

test('副作用调用按 requestId 只执行一次，读调用不缓存', async () => {
  // The kernel's /api handler does not remember request ids, so a device that loses
  // its connection mid-prompt and resends the same request would run it twice. The
  // adapter is where "at-most-once by requestId" is actually enforced.
  const kernel = fakeKernel({ authority: AUTHORITY, handler: okHandler })
  const host = new KernelHost({ connection: kernel.connection, authority: AUTHORITY, fetchImpl: kernel.fetchImpl })

  const prompt = { endpoint: 'session/prompt', payload: { args: {} }, rpcId: 'prompt-1', sideEffect: true }
  const first = await host.dispatch(prompt)
  const second = await host.dispatch({ ...prompt })
  assert.deepEqual(second, first)
  assert.equal(kernel.calls.length, 1, 'the same prompt must not reach the kernel twice')

  await host.dispatch({ ...prompt, rpcId: 'prompt-2' })
  assert.equal(kernel.calls.length, 2, 'a fresh request id is a fresh call')

  const read = { endpoint: 'session/list', payload: {}, rpcId: 'read-1' }
  await host.dispatch(read)
  await host.dispatch({ ...read })
  assert.equal(kernel.calls.length, 4, 'reads are cheap to repeat and must reflect current state')
})

test('失败的副作用调用不被记住，设备可以重试', async () => {
  let attempts = 0
  const kernel = fakeKernel({
    authority: AUTHORITY,
    handler: async (endpoint, payload, rpcId) => {
      attempts += 1
      return {
        type: 'server-response',
        rpcId,
        result: attempts === 1
          ? { ok: false, error: { code: 'gateway/internal', message: 'transient', details: {} } }
          : { ok: true, value: { endpoint, payload } },
      }
    },
  })
  const host = new KernelHost({ connection: kernel.connection, authority: AUTHORITY, fetchImpl: kernel.fetchImpl })
  const call = { endpoint: 'session/prompt', payload: { args: {} }, rpcId: 'retry-1', sideEffect: true }

  const failed = await host.dispatch(call)
  assert.equal(failed.result.ok, false)
  const retried = await host.dispatch({ ...call })
  assert.equal(retried.result.ok, true, 'a failure is not a decision; the retry must reach the kernel')
  assert.equal(attempts, 2)
})

test('副作用去重绑定设备、端点和 payload，不跨请求复用', async () => {
  const kernel = fakeKernel({ authority: AUTHORITY, handler: okHandler })
  const host = new KernelHost({ connection: kernel.connection, authority: AUTHORITY, fetchImpl: kernel.fetchImpl })
  const base = {
    endpoint: 'session/prompt',
    payload: { args: { text: 'a' } },
    rpcId: 'same-id',
    sideEffect: true,
  }

  await host.dispatch({ ...base, device: { deviceId: 'device-a' } })
  await host.dispatch({ ...base, device: { deviceId: 'device-b' } })
  assert.equal(kernel.calls.length, 2, 'the same rpcId from another device is another call')

  await host.dispatch({ ...base, device: { deviceId: 'device-a' }, payload: { args: { text: 'b' } } })
  assert.equal(kernel.calls.length, 3, 'a reused rpcId with another payload is another call')

  await host.dispatch({ ...base, device: { deviceId: 'device-a' }, endpoint: 'session/cancel' })
  assert.equal(kernel.calls.length, 4, 'the method is part of the request identity')

  // The exact same tuple is a retry and still comes from the cache.
  await host.dispatch({ ...base, device: { deviceId: 'device-a' } })
  assert.equal(kernel.calls.length, 4)
})

test('并发到达的同一副作用请求合并为一次执行', async () => {
  let attempts = 0
  let release
  const blocked = new Promise((resolve) => {
    release = resolve
  })
  const kernel = fakeKernel({
    authority: AUTHORITY,
    handler: async (endpoint, payload, rpcId) => {
      attempts += 1
      await blocked
      return { type: 'server-response', rpcId, result: { ok: true, value: { endpoint, payload } } }
    },
  })
  const host = new KernelHost({ connection: kernel.connection, authority: AUTHORITY, fetchImpl: kernel.fetchImpl })
  const call = {
    endpoint: 'session/prompt',
    payload: { args: {} },
    rpcId: 'inflight-1',
    sideEffect: true,
    device: { deviceId: 'device-a' },
  }

  const first = host.dispatch(call)
  const second = host.dispatch({ ...call })
  for (let i = 0; i < 100 && attempts === 0; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.equal(attempts, 1, 'the second copy must join the first, not start a second kernel call')
  release()

  const [a, b] = await Promise.all([first, second])
  assert.equal(attempts, 1)
  assert.deepEqual(b, a)
})

test('payload 原样透传，宿主不解析它', async () => {
  // Parameter names differ per method upstream (`session/create` takes `request`,
  // `session/list` takes `_request`). A Host that parsed this would be asserting a
  // schema it does not own and would break on the next Host release.
  const kernel = fakeKernel({ authority: AUTHORITY, handler: okHandler })
  const host = new KernelHost({ connection: kernel.connection, authority: AUTHORITY, fetchImpl: kernel.fetchImpl })
  const payload = { args: { request: { odd: true }, nested: { deep: [1, 2, 3] } } }

  await host.dispatch({ endpoint: 'session/prompt', payload, rpcId: 'rpc-2' })
  assert.deepEqual(kernel.calls[0].payload, payload)
})

test('cookie 只铸一次，多次调用复用', async () => {
  const kernel = fakeKernel({ authority: AUTHORITY, handler: okHandler })
  const host = new KernelHost({ connection: kernel.connection, authority: AUTHORITY, fetchImpl: kernel.fetchImpl })

  await Promise.all([
    host.dispatch({ endpoint: 'session/list', payload: {}, rpcId: 'a' }),
    host.dispatch({ endpoint: 'session/list', payload: {}, rpcId: 'b' }),
    host.dispatch({ endpoint: 'session/list', payload: {}, rpcId: 'c' }),
  ])
  // A race here would mint three cookies and leave two of them unused; caching
  // the promise rather than the value is what keeps that from happening.
  assert.equal(kernel.mints.length, 1, 'three concurrent calls must not mint three cookies')
})

test('铸 cookie 失败时返回 500 信封，而不是抛给隧道', async () => {
  const kernel = fakeKernel({ authority: AUTHORITY, handler: okHandler, acceptToken: 'some-other-process' })
  const host = new KernelHost({ connection: kernel.connection, authority: AUTHORITY, fetchImpl: kernel.fetchImpl })

  const reply = await host.dispatch({ endpoint: 'session/list', payload: {}, rpcId: 'rpc-3' })
  assert.equal(reply.type, 'server-response')
  assert.equal(reply.rpcId, 'rpc-3')
  assert.equal(reply.result.ok, false)
  // A string code with the HTTP status kept as a detail. The decoder the device
  // uses requires a string `code` and a record `details`; a bare numeric status is
  // neither a stable failure code nor an acceptable envelope.
  assert.equal(reply.result.error.code, 'host/http-error')
  assert.deepEqual(reply.result.error.details, { status: 500 })
  assert.match(reply.result.error.message, /cookie/u)
  // And the failure is not cached: a Host that could not authenticate once must
  // be able to try again rather than stay broken for the life of the process.
  assert.equal(kernel.mints.length, 1)
  host.forgetCookie()
  await host.dispatch({ endpoint: 'session/list', payload: {}, rpcId: 'rpc-4' })
  assert.equal(kernel.mints.length, 2)
})

test('请求路径里的端点与信封里的 method 始终一致', async () => {
  // The kernel refuses when they disagree, so this is the failure the adapter
  // would otherwise produce silently for every call. The double enforces it too;
  // what this asserts is that the adapter never trips it.
  const kernel = fakeKernel({ authority: AUTHORITY, handler: okHandler })
  const host = new KernelHost({ connection: kernel.connection, authority: AUTHORITY, fetchImpl: kernel.fetchImpl })

  for (const endpoint of ['session/list', 'session/page', 'settings/describe', 'a/b/c']) {
    const reply = await host.dispatch({ endpoint, payload: {}, rpcId: `rpc-${endpoint}` })
    assert.equal(reply.result.ok, true, `${endpoint} should reach the kernel`)
  }
  assert.deepEqual(kernel.calls.map((call) => call.endpoint), [
    'session/list',
    'session/page',
    'settings/describe',
    'a/b/c',
  ])
})

test('内核回的不是信封时，转成 500 信封而不是伪装成成功', async () => {
  const kernel = fakeKernel({
    authority: AUTHORITY,
    // A handler that fails hard: the kernel answers with a transport status and a
    // plain body, so there is no `result` to relay and the device must still be
    // told something true.
    handler: async () => {
      throw new Error('handler exploded')
    },
  })
  const host = new KernelHost({ connection: kernel.connection, authority: AUTHORITY, fetchImpl: kernel.fetchImpl })

  const reply = await host.dispatch({ endpoint: 'session/list', payload: {}, rpcId: 'rpc-boom' })
  assert.equal(reply.type, 'server-response')
  assert.equal(reply.rpcId, 'rpc-boom')
  assert.equal(reply.result.ok, false)
  // The kernel's own words are carried through: the caller is the operator's own
  // device, and a bare 500 would hide the only useful diagnostic.
  assert.match(reply.result.error.message, /handler exploded/u)
  assert.equal(reply.result.error.code, 'host/http-error')
  assert.deepEqual(reply.result.error.details, { status: 500 })
})

test('admit 返回对象，读 rejection 而不是当布尔用', async () => {
  const kernel = fakeKernel({ authority: AUTHORITY, handler: okHandler })
  const host = new KernelHost({ connection: kernel.connection, authority: AUTHORITY, fetchImpl: kernel.fetchImpl })

  const rejected = host.inspect(new Request(`http://${AUTHORITY}${'/api/session/list'}`))
  // `{ rejection: 403 }` is truthy, so `if (host.inspect(...))` would treat a
  // refusal as an admission and skip the fence entirely.
  assert.equal('rejection' in rejected, true)
  assert.equal(Boolean(rejected), true, 'the refusal object is truthy — that is the trap')

  await host.dispatch({ endpoint: 'session/list', payload: {}, rpcId: 'rpc-7' })
  const admitted = host.inspect(
    new Request(`http://${AUTHORITY}/api/session/list`, {
      headers: { host: AUTHORITY, cookie: kernel.jar.header(AUTHORITY) ?? '' },
    }),
  )
  assert.equal('peer' in admitted, true)
  assert.equal(admitted.peer, kernel.connection.operator)
})

test('kernelDispatch 把隧道的一次调用译成一次内核调用', async () => {
  const kernel = fakeKernel({ authority: AUTHORITY, handler: okHandler })
  const host = new KernelHost({ connection: kernel.connection, authority: AUTHORITY, fetchImpl: kernel.fetchImpl })
  const dispatch = kernelDispatch(host)

  const reply = await dispatch({
    rpcId: 'rpc-8',
    method: 'session/page',
    payload: { args: { _request: { sessionId: 's1' } } },
    device: { deviceId: 'device-1' },
  })
  assert.equal(reply.result.ok, true)
  assert.deepEqual(kernel.calls[0], {
    endpoint: 'session/page',
    payload: { args: { _request: { sessionId: 's1' } } },
    rpcId: 'rpc-8',
  })
})

test('构造时就拒绝缺参数，不留到第一次调用才炸', () => {
  const kernel = fakeKernel({ authority: AUTHORITY, handler: okHandler })
  assert.throws(() => new KernelHost({ authority: AUTHORITY }), /no connection service/u)
  assert.throws(() => new KernelHost({ connection: kernel.connection, authority: '' }), /authority is required/u)
  // `null` rather than `undefined`: an omitted option falls back to the global,
  // which is the intended behaviour, so only a value that is present and unusable
  // should be refused here.
  assert.throws(
    () => new KernelHost({ connection: kernel.connection, authority: AUTHORITY, RequestImpl: null }),
    /no Request implementation/u,
  )
  assert.throws(
    () => new KernelHost({ connection: kernel.connection, authority: AUTHORITY, RequestImpl: 'Request' }),
    /no Request implementation/u,
  )
})
