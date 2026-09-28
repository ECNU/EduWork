import { it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LiteratureRuntime } from '@eduwork/dsh-literature/core'
import { DblpSource } from '@eduwork/dsh-literature/dblp'
import { ArxivSource } from '@eduwork/dsh-literature/arxiv'

/** Time one provider call, logging the duration or the failure; a perf probe must not fail on live-API throttling. */
async function timed<T>(label: string, run: () => Promise<T>): Promise<T | undefined> {
  const t0 = Date.now()
  try {
    const value = await run()
    console.log(`${label}: ${Date.now() - t0}ms`)
    return value
  } catch (error) {
    console.log(`${label}: failed after ${Date.now() - t0}ms: ${String(error)}`)
    return undefined
  }
}

it('measure a single search', async () => {
  const ctx = new Context()
  const r = new LiteratureRuntime(ctx, { timeoutMs: 30_000 })
  const dblp = new DblpSource('https://dblp.org', { timeoutMs: 20_000, maxRedirects: 5, maxUrlLength: 2048, maxResponseBytes: 5_000_000, userAgent: 'probe', rateLimitMs: 1000 }, async () => {})
  const arxiv = new ArxivSource('https://export.arxiv.org', 'https://arxiv.org', { timeoutMs: 30_000, maxRedirects: 5, maxUrlLength: 2048, maxResponseBytes: 50_000_000, userAgent: 'probe', rateLimitMs: 1000, rateLimitBackoffBaseMs: 1000, rateLimitBackoffMaxRetries: 3 }, async () => {})
  r.registerSource(dblp)
  r.registerSource(arxiv)

  const dblpHits = await timed('dblp.search', () => dblp.search({ query: 'graph neural network', maxResults: 10 }))
  const arxivHits = await timed('arxiv.search', () => arxiv.search({ query: 'graph neural network', maxResults: 10 }))
  const merged = await timed('seam search (parallel)', () => r.search({ query: 'graph neural network', maxResults: 10 }))
  console.log(`hits: dblp=${dblpHits?.length ?? 'n/a'}, arxiv=${arxivHits?.length ?? 'n/a'}, merged=${merged?.records.length ?? 'n/a'}`)
  await ctx.fiber.dispose()
}, 180_000)
