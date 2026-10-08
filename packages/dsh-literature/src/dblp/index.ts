/**
 * `@eduwork/dsh-literature/dblp`: registers the dblp source with the
 * literature seam. A function/namespace plugin (NOT a default-export service):
 * it registers INTO the seam's source registry, like the web providers register
 * into `ctx.web`.
 * @module @eduwork/dsh-literature/dblp
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createThrottle } from '@eduwork/dsh-literature/core'
import type {} from '@eduwork/dsh-literature/core'
import { DblpSource, type DblpLimits } from './source.ts'

export { DblpSource } from './source.ts'
export type { DblpLimits } from './source.ts'

/** Default `User-Agent` for dblp requests. */
export const DEFAULT_USER_AGENT = 'deepseek-harness/0.1.0 (+https://github.com/deepseek-ai)'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'literature-dblp'

/** The literature seam this source registers into. */
export const inject = ['literature']

/** Plugin config: endpoint and transport/rate limits (all defaulted). */
export interface Config {
  /** dblp API base URL. */
  readonly baseUrl?: string
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
  /** `User-Agent` header sent on every request. */
  readonly userAgent?: string
}

export const Config: z<Config> = z.object({
  baseUrl: z.string().default('https://dblp.org'),
  timeoutMs: z.number().default(30_000),
  maxRedirects: z.number().default(5),
  maxUrlLength: z.number().default(2048),
  maxResponseBytes: z.number().default(5_000_000),
  rateLimitMs: z.number().default(1000),
  userAgent: z.string().default(DEFAULT_USER_AGENT),
})

/** Register the dblp source with `ctx.literature`. */
export function apply(ctx: Context, config: Config): void {
  const resolved = config as Required<Config>
  const limits: DblpLimits = {
    timeoutMs: resolved.timeoutMs,
    maxRedirects: resolved.maxRedirects,
    maxUrlLength: resolved.maxUrlLength,
    maxResponseBytes: resolved.maxResponseBytes,
    userAgent: resolved.userAgent,
    rateLimitMs: resolved.rateLimitMs,
  }
  ctx.literature.registerSource(new DblpSource(resolved.baseUrl.replace(/\/$/, ''), limits, createThrottle(resolved.rateLimitMs)))
}
