import * as PlaywrightBrowser from '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp'
import z from '@deepseek-ai/schemastery'
import { browserConfig } from './config.js'
import { browserGuard, browserPermission } from './permission.js'
import { noteSavedScreenshots, registerPageTools } from './read-act.js'
import { mountBrowser, takeSidebarEndpoint } from './sidebar.js'

export const name = 'eduwork-browser-upstream'
export const inject = [...PlaywrightBrowser.inject, 'sandboxPolicy']
export { browserConfig }

// How wide the desktop app shows Sidebar pages (sidebar-client.js). Volatile:
// DSH keeps it per plugin entry, and the app's own settings row edits it.
export const Config = z.object({ sidebarWidth: z.union([z.const('desktop'), z.const('sidebar')]).default('desktop').volatile() })

// Only the desktop app starts the Host with a Sidebar browser endpoint.
const sidebar = takeSidebarEndpoint()

export function apply(ctx, config = {}) {
  const browser = browserConfig(config)
  ctx.inject(['settings'], child => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  ctx.tools.guard(exec => browserGuard(ctx, exec))
  ctx.on('tools/pre-execute', (exec, next) => browserPermission(ctx, exec, next))
  registerPageTools(ctx)
  noteSavedScreenshots(ctx)
  mountBrowser(ctx, browser, sidebar)
}
