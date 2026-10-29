import * as PlaywrightBrowser from '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp'
import { browserConfig } from './config.js'
import { browserGuard, browserPermission } from './permission.js'
import { mountSidebarBrowser, takeSidebarEndpoint } from './sidebar.js'

export const name = 'eduwork-browser-upstream'
export const inject = [...PlaywrightBrowser.inject, 'sandboxPolicy']
export { browserConfig }

// Only the desktop app starts the Host with a Sidebar browser endpoint.
const sidebar = takeSidebarEndpoint()

export function apply(ctx, config = {}) {
  const browser = browserConfig(config)
  ctx.tools.guard(exec => browserGuard(ctx, exec))
  ctx.on('tools/pre-execute', (exec, next) => browserPermission(ctx, exec, next))
  if (sidebar === undefined) return ctx.plugin(PlaywrightBrowser, browser)
  mountSidebarBrowser(ctx, browser, sidebar)
}
