/**
 * `@eduwork/dsh-literature/arxiv`: registers the arXiv source with the
 * literature seam. A function/namespace plugin (NOT a default-export service):
 * it registers INTO the seam's source registry.
 * @module @eduwork/dsh-literature/arxiv
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createThrottle } from '@eduwork/dsh-literature/core'
import type {} from '@eduwork/dsh-literature/core'
import { ArxivSource, type ArxivLimits } from './source.ts'

export { ArxivSource } from './source.ts'
export type { ArxivLimits } from './source.ts'

/** Default `User-Agent` for arXiv requests. */
export const DEFAULT_USER_AGENT = 'deepseek-harness/0.1.0 (+https://github.com/deepseek-ai)'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'literature-arxiv'

/** The literature seam this source registers into. */
export const inject = ['literature']

/** Plugin config: endpoints and transport/rate limits (all defaulted). */
export interface Config {
  /** arXiv query API base URL (the Atom endpoint). */
  readonly apiBase?: string
  /** arXiv website base URL (bibtex and full-text downloads). */
  readonly wwwBase?: string
  /** Request timeout in milliseconds. */
  readonly timeoutMs?: number
  /** Maximum number of same-origin redirect hops. */
  readonly maxRedirects?: number
  /** Maximum accepted request URL length. */
  readonly maxUrlLength?: number
  /** Maximum response body size in bytes. */
  readonly maxResponseBytes?: number
  /** Minimum interval between requests, in milliseconds. */
  readonly rateLimitMs?: number
  /** Exponential-backoff base delay in milliseconds (default 3000). */
  readonly rateLimitBackoffBaseMs?: number
  /** Maximum rate-limit backoff retries (default 5). */
  readonly rateLimitBackoffMaxRetries?: number
  /** `User-Agent` header sent on every request. */
  readonly userAgent?: string
}

export const Config: z<Config> = z.object({
  apiBase: z.string().default('https://export.arxiv.org'),
  wwwBase: z.string().default('https://arxiv.org'),
  timeoutMs: z.number().default(30_000),
  maxRedirects: z.number().default(5),
  maxUrlLength: z.number().default(2048),
  // Full-text artifacts (source tarballs, PDFs) run tens of MB; keep the
  // download cap aligned with the seam's downloadMaxBytes default.
  maxResponseBytes: z.number().default(100_000_000),
  // arXiv's official guidance is a 3s delay between API requests; a tighter
  // interval trips their limiter and the backoff then costs seconds per call.
  rateLimitMs: z.number().default(3000),
  rateLimitBackoffBaseMs: z.number().default(3000),
  rateLimitBackoffMaxRetries: z.number().default(5),
  userAgent: z.string().default(DEFAULT_USER_AGENT),
})

/** Register the arXiv source with `ctx.literature`. */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as Required<Config>
  const limits: ArxivLimits = {
    timeoutMs: resolved.timeoutMs,
    maxRedirects: resolved.maxRedirects,
    maxUrlLength: resolved.maxUrlLength,
    maxResponseBytes: resolved.maxResponseBytes,
    userAgent: resolved.userAgent,
    rateLimitMs: resolved.rateLimitMs,
    rateLimitBackoffBaseMs: resolved.rateLimitBackoffBaseMs,
    rateLimitBackoffMaxRetries: resolved.rateLimitBackoffMaxRetries,
  }
  ctx.literature.registerSource(new ArxivSource(
    resolved.apiBase.replace(/\/$/, ''),
    resolved.wwwBase.replace(/\/$/, ''),
    limits,
    createThrottle(resolved.rateLimitMs),
  ))
}
