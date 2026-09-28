import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, inject, name, type Config } from '@eduwork/dsh-literature/arxiv'

const CONFIG: Config = {
  apiBase: 'https://export.arxiv.org',
  wwwBase: 'https://arxiv.org',
  timeoutMs: 1000,
  maxRedirects: 3,
  maxUrlLength: 100,
  maxResponseBytes: 1000,
  rateLimitMs: 0,
  userAgent: 'test',
}

describe('literature-arxiv plugin', () => {
  it('registers the arxiv source with the literature seam', () => {
    const registerSource = vi.fn()
    const ctx = { literature: { registerSource } } as unknown as Context
    apply(ctx, CONFIG)
    expect(name).toBe('literature-arxiv')
    expect(inject).toEqual(['literature'])
    expect(registerSource).toHaveBeenCalledTimes(1)
    expect((registerSource.mock.calls[0]![0] as { id: string }).id).toBe('arxiv')
  })

  it('throttles consecutive requests', async () => {
    vi.useFakeTimers()
    const registerSource = vi.fn()
    const ctx = { literature: { registerSource } } as unknown as Context
    apply(ctx, { apiBase: 'https://export.arxiv.org', wwwBase: 'https://arxiv.org', timeoutMs: 1000, maxRedirects: 3, maxUrlLength: 100, maxResponseBytes: 1000, rateLimitMs: 100, userAgent: 'test' })
    const arxiv = registerSource.mock.calls[0]![0] as { search: (r: { query: string }) => Promise<unknown> }
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<feed/>', { status: 200 })))
    await arxiv.search({ query: 'a' })
    let secondSettled = false
    const second = arxiv.search({ query: 'b' }).then(() => { secondSettled = true })
    await vi.advanceTimersByTimeAsync(99)
    expect(secondSettled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await second
    expect(secondSettled).toBe(true)
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
})
