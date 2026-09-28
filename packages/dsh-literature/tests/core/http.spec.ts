import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpGet, type HttpLimits } from '@eduwork/dsh-literature/core'
import { LiteratureError } from '@eduwork/dsh-literature/core'

const LIMITS: HttpLimits = {
  maxUrlLength: 100,
  maxResponseBytes: 100,
  timeoutMs: 5000,
  maxRedirects: 3,
  userAgent: 'test-agent',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubFetch(responses: readonly Response[]): void {
  let index = 0
  vi.stubGlobal('fetch', vi.fn(async () => {
    const response = responses[Math.min(index, responses.length - 1)]
    index += 1
    return response
  }))
}

describe('httpGet', () => {
  it('returns status, body bytes, content type, and final URL', async () => {
    stubFetch([new Response('hello', { status: 200, headers: { 'content-type': 'text/plain' } })])
    const result = await httpGet('https://arxiv.org/abs/1', LIMITS)
    expect(result.statusCode).toBe(200)
    expect(new TextDecoder().decode(result.body)).toBe('hello')
    expect(result.contentType).toBe('text/plain')
    expect(result.finalUrl).toBe('https://arxiv.org/abs/1')
  })

  it('rejects non-http schemes and embedded credentials', async () => {
    await expect(httpGet('ftp://x/y', LIMITS)).rejects.toThrow(LiteratureError)
    await expect(httpGet('https://u:p@x/y', LIMITS)).rejects.toThrow(LiteratureError)
  })

  it('rejects a URL exceeding the length cap', async () => {
    await expect(httpGet(`https://arxiv.org/${'a'.repeat(100)}`, LIMITS)).rejects.toThrow(LiteratureError)
  })

  it('follows same-origin redirects', async () => {
    stubFetch([
      new Response(null, { status: 302, headers: { location: 'https://arxiv.org/next' } }),
      new Response('ok', { status: 200 }),
    ])
    const result = await httpGet('https://arxiv.org/start', LIMITS)
    expect(result.finalUrl).toBe('https://arxiv.org/next')
    expect(new TextDecoder().decode(result.body)).toBe('ok')
  })

  it('blocks cross-origin redirects by default', async () => {
    stubFetch([new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/x' } })])
    await expect(httpGet('https://arxiv.org/start', LIMITS)).rejects.toThrow(LiteratureError)
  })

  it('follows cross-origin redirects when allowed', async () => {
    stubFetch([
      new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/x' } }),
      new Response('ok', { status: 200 }),
    ])
    const result = await httpGet('https://doi.org/10.1/x', LIMITS, undefined, { followCrossOrigin: true })
    expect(result.finalUrl).toBe('https://elsewhere.example/x')
  })

  it('allows same-origin hops after one cross-origin hop', async () => {
    stubFetch([
      new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/x' } }),
      new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/next' } }),
      new Response('ok', { status: 200 }),
    ])
    const result = await httpGet('https://doi.org/10.1/x', LIMITS, undefined, { followCrossOrigin: true })
    expect(result.finalUrl).toBe('https://elsewhere.example/next')
  })

  it('blocks a second cross-origin hop even when cross-origin is allowed', async () => {
    stubFetch([
      new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/x' } }),
      new Response(null, { status: 302, headers: { location: 'https://further.example/x' } }),
      new Response('ok', { status: 200 }),
    ])
    await expect(httpGet('https://doi.org/10.1/x', LIMITS, undefined, { followCrossOrigin: true })).rejects.toThrow(LiteratureError)
  })

  it('rejects a declared content-length past the byte cap', async () => {
    stubFetch([new Response('x', { status: 200, headers: { 'content-length': '1000' } })])
    await expect(httpGet('https://arxiv.org/x', LIMITS)).rejects.toThrow(LiteratureError)
  })

  it('rejects a pre-aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(httpGet('https://arxiv.org/x', LIMITS, controller.signal)).rejects.toThrow(LiteratureError)
  })

  it('rejects a malformed URL', async () => {
    await expect(httpGet('http://[', LIMITS)).rejects.toThrow(LiteratureError)
  })

  it('wraps a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    await expect(httpGet('https://arxiv.org/x', LIMITS)).rejects.toThrow(LiteratureError)
  })

  it('reports a timeout when the deadline fires during fetch', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { signal: AbortSignal }) => {
      await new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => { reject(new Error('aborted')) })
      })
      return new Response('x')
    }))
    await expect(httpGet('https://arxiv.org/x', { ...LIMITS, timeoutMs: 5 })).rejects.toThrow(LiteratureError)
  })

  it('reports an upstream cancellation as aborted, not timed out', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { signal: AbortSignal }) => {
      await new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => { reject(new Error('aborted')) })
      })
      return new Response('x')
    }))
    const promise = httpGet('https://arxiv.org/x', { ...LIMITS, timeoutMs: 5000 }, controller.signal)
    controller.abort()
    await expect(promise).rejects.toThrow('aborted')
  })

  it('rejects a redirect without a location header', async () => {
    stubFetch([new Response(null, { status: 302 })])
    await expect(httpGet('https://arxiv.org/start', LIMITS)).rejects.toThrow(LiteratureError)
  })

  it('rejects a redirect past the budget', async () => {
    stubFetch([new Response(null, { status: 302, headers: { location: 'https://arxiv.org/next' } })])
    await expect(httpGet('https://arxiv.org/start', { ...LIMITS, maxRedirects: 0 })).rejects.toThrow(LiteratureError)
  })

  it('ignores a non-numeric content-length and accepts one within the cap', async () => {
    stubFetch([new Response('x', { status: 200, headers: { 'content-length': 'abc' } })])
    const result = await httpGet('https://arxiv.org/x', LIMITS)
    expect(result.statusCode).toBe(200)
    stubFetch([new Response('x', { status: 200, headers: { 'content-length': '50' } })])
    const within = await httpGet('https://arxiv.org/x', LIMITS)
    expect(within.statusCode).toBe(200)
  })

  it('returns an empty body for a null body', async () => {
    stubFetch([new Response(null, { status: 200 })])
    const result = await httpGet('https://arxiv.org/x', LIMITS)
    expect(result.body.byteLength).toBe(0)
  })

  it('rejects a streamed body past the byte cap', async () => {
    stubFetch([new Response(new Uint8Array(200), { status: 200 })])
    await expect(httpGet('https://arxiv.org/x', LIMITS)).rejects.toThrow(LiteratureError)
  })

  it('aborts a streamed read when the signal fires', async () => {
    const controller = new AbortController()
    const stream = new ReadableStream({
      pull(streamController) {
        streamController.enqueue(new Uint8Array([1, 2, 3]))
        controller.abort()
      },
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, { status: 200 })))
    await expect(httpGet('https://arxiv.org/x', LIMITS, controller.signal)).rejects.toThrow(LiteratureError)
  })
})
