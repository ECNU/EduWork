import z from '@deepseek-ai/schemastery'
import { installConcurrency, DEFAULT_REQUEST_LIMIT, MAX_REQUEST_LIMIT } from './index.js'

export const name = 'eduwork-request-concurrency'
export const inject = ['llm']
export const Config = z.object({
  maxConcurrentRequests: z.number().step(1).min(1).max(MAX_REQUEST_LIMIT).default(DEFAULT_REQUEST_LIMIT).volatile(),
})

export function apply(ctx, config) {
  const setLimit = installConcurrency(ctx, config.maxConcurrentRequests.get())
  ctx.on('loader/volatile-update', () => setLimit(config.maxConcurrentRequests.get()))
}
