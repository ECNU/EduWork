import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, inject, name, type Config } from '@eduwork/dsh-literature/dblp'

const CONFIG: Config = {
  baseUrl: 'https://dblp.org',
  timeoutMs: 1000,
  maxRedirects: 3,
  maxUrlLength: 100,
  maxResponseBytes: 1000,
  rateLimitMs: 0,
  userAgent: 'test',
}

describe('literature-dblp plugin', () => {
  it('registers the dblp source with the literature seam', () => {
    const registerSource = vi.fn()
    const ctx = { literature: { registerSource } } as unknown as Context
    apply(ctx, CONFIG)
    expect(name).toBe('literature-dblp')
    expect(inject).toEqual(['literature'])
    expect(registerSource).toHaveBeenCalledTimes(1)
    expect((registerSource.mock.calls[0]![0] as { id: string }).id).toBe('dblp')
  })

  it('throttles consecutive requests', async () => {
    const registerSource = vi.fn()
    const ctx = { literature: { registerSource } } as unknown as Context
    apply(ctx, { baseUrl: 'https://dblp.org', timeoutMs: 1000, maxRedirects: 3, maxUrlLength: 100, maxResponseBytes: 1000, rateLimitMs: 100, userAgent: 'test' })
    const dblp = registerSource.mock.calls[0]![0] as { search: (r: { query: string }) => Promise<unknown> }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ result: { hits: { hit: [] } } }), { status: 200 })))
    await dblp.search({ query: 'a' })
    const started = Date.now()
    await dblp.search({ query: 'b' })
    expect(Date.now() - started).toBeGreaterThanOrEqual(90)
    vi.unstubAllGlobals()
  })
})
