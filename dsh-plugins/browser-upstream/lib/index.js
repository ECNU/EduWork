import * as PlaywrightBrowser from '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp'
import { browserConfig } from './config.js'
import { browserGuard, browserPermission } from './permission.js'

export const name = 'eduwork-browser-upstream'
export const inject = [...PlaywrightBrowser.inject, 'sandboxPolicy']
export { browserConfig }

export function apply(ctx, config = {}) {
  const browser = browserConfig(config)
  ctx.tools.guard(exec => browserGuard(ctx, exec))
  ctx.on('tools/pre-execute', (exec, next) => browserPermission(ctx, exec, next))
  return ctx.plugin(PlaywrightBrowser, browser)
}
