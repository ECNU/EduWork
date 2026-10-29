import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserUseProviderName } from '@deepseek-ai/dsh-browser-use/brand'
import { SessionResources } from '@deepseek-ai/dsh-experimental-browser-use-runtime'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import { createScope } from '@deepseek-ai/dsh-scope'

// In the desktop app a conversation's own Agent drives the browser tabs in that
// conversation's right Sidebar (dsh-electron/src/sidebar-browser.mjs); its
// subagents keep the isolated browser. The official provider's mountSessionMcp
// gives every Agent the same server arguments, so this mounts the same
// Playwright MCP server per Agent with its own. Remove it once the official
// provider accepts per-Agent arguments.
export const SIDEBAR_BROWSER_ENV = 'EDUWORK_SIDEBAR_BROWSER_SECRET'
const server = 'playwright-mcp'
const prefix = `mcp__${server}__`
const resourceTools = new Set(['list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource'])

const sidebarGuidance = [
  'In this conversation the browser tools (mcp__playwright-mcp__*) control the browser tabs in the right sidebar of the user\'s desktop app. The user watches every step there and shares the same pages and logins.',
  'Tabs already open belong to the user: read them freely, but open a new tab for unrelated browsing instead of navigating away from or closing a page the user is on.',
  'When a login, CAPTCHA, payment or other step needs the user, ask them to complete it in the sidebar and wait for their reply before continuing.',
  'While the user is not viewing this conversation in the desktop app, for example when they use it from their phone, the open tabs keep working and a new tab opens in the background: it works the same and shares the logins, but the user cannot see it, so ask them to open this conversation in the desktop app before a step that needs them. A page that a link in a sidebar tab opens in a new window loads only once the user returns to this conversation.',
].join('\n')

/** The desktop launcher's endpoint, removed from the environment so no other code or child inherits it. */
export function takeSidebarEndpoint(environment = process.env) {
  const value = environment[SIDEBAR_BROWSER_ENV]
  delete environment[SIDEBAR_BROWSER_ENV]
  return value || undefined
}

export const usesSidebar = agent => agent?.session.header.origin !== 'subagent'

/** Server arguments and environment for one Agent's Playwright MCP client. */
export function serverLaunch(browser, agent, sidebar, cli, environment = process.env) {
  // Upstream environment options could otherwise replace the browser mode or
  // import an unrelated profile; empty values mean absent to its parser.
  const env = Object.fromEntries(Object.keys(environment)
    .filter(key => key.toUpperCase().startsWith('PLAYWRIGHT_MCP_'))
    .map(key => [key, '']))
  const args = [cli, '--browser', 'chromium']
  // The endpoint stays out of the process list.
  if (usesSidebar(agent)) return { args, env: { ...env, PLAYWRIGHT_MCP_CDP_ENDPOINT: `${sidebar}/${agent.session.id}` } }
  args.push('--isolated')
  if (browser.headless) args.push('--headless')
  if (browser.executablePath !== undefined) args.push('--executable-path', browser.executablePath)
  return { args, env }
}

/** Mount Playwright MCP per Agent, as mountSessionMcp does for the official provider. */
export function mountSidebarBrowser(ctx, browser, sidebar) {
  const workingDirectory = ctx.get('workingDirectory')
  if (workingDirectory === undefined) throw new Error(`${server}: browser MCP requires a working-directory provider`)
  // The Playwright MCP release the official provider pins.
  const provider = fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-experimental-browser-use-playwright-mcp'))
  const cli = join(dirname(createRequire(provider).resolve('@playwright/mcp/package.json')), 'cli.js')
  const ready = new WeakSet()
  let resources
  ctx.effect(function* () {
    yield ctx.browserUse.register(BrowserUseProviderName(server))
    resources = new SessionResources(ctx, {
      label: server,
      exclusive: false,
      async open(agent, signal) {
        const scope = createScope(ctx, agent)
        let cancellation
        const cancel = () => { cancellation = scope.dispose() }
        signal.addEventListener('abort', cancel, { once: true })
        try {
          signal.throwIfAborted()
          scope.ctx.on('tools/execute', async (exec, next) => {
            if (!exec.name.startsWith(prefix) || exec.agent === agent || ctx.tools.get(exec.name, exec.agent) !== ctx.tools.get(exec.name, agent)) return next()
            throw new Error(`${server}: browser tool belongs to another Session`)
          })
          const { args, env } = serverLaunch(browser, agent, sidebar, cli)
          await scope.ctx.plugin(McpClient, McpClient.Config({
            transport: 'stdio', serverName: server, command: process.execPath, args, env,
            cwd: await workingDirectory.ensure(agent, signal),
            toolCallTimeoutMs: browser.toolCallTimeoutMs, failOnStartupError: true, reconnect: { enabled: false },
          }))
          signal.throwIfAborted()
          return { value: scope, close: () => scope.dispose() }
        } catch (error) {
          await (cancellation ?? scope.dispose())
          throw error
        } finally {
          signal.removeEventListener('abort', cancel)
        }
      },
    })
    yield () => resources.dispose()
  }, `${server}.sessions`)
  ctx.on('agent/created', async ({ agent, signal }) => {
    await resources.get(agent, signal)
    ready.add(agent)
  }, { prepend: true })
  // Calls are serialized per Agent, and closing an Agent closes its server.
  ctx.on('tools/execute', async (exec, next) => {
    if (!exec.name.startsWith(prefix) && !(resourceTools.has(exec.name) && exec.arguments?.server === server)) return next()
    if (!ready.has(exec.agent)) throw new Error(`${server}: browser tool belongs to another Session`)
    return resources.run(exec.agent, exec.signal, async (_scope, combined) => {
      const original = exec.signal
      exec.signal = combined
      try { return await next() } finally { exec.signal = original }
    })
  })
  ctx.systemPrompt.section({
    name: 'eduwork-browser:sidebar',
    order: ctx.systemPrompt.getSectionOrder('MCP_SERVERS') + 1,
    text: ({ agent }) => agent !== undefined && usesSidebar(agent) ? sidebarGuidance : '',
  })
}
