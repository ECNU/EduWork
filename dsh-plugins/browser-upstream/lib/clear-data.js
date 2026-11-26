// browser_clear_data: the Agent clears what the Sidebar browser keeps for its
// conversation's workspace, as the user does from a page's menu or in
// settings. The desktop app clears it and reloads the pages concerned
// (dsh-electron/src/sidebar-browser-data.mjs), at the conversation's Sidebar
// endpoint. Subagents keep a browser of their own and do not get the tool.
import { defineTool } from '@deepseek-ai/dsh-tools'
import { websitePageOf } from './read-act.js'
import { postToSidebar, usesSidebar } from './sidebar.js'

/** Register browser_clear_data; sidebar is the desktop app's Sidebar endpoint. */
export function registerClearData(ctx, sidebar) {
  const endpoint = sidebar.replace(/^ws:/u, 'http:')
  ctx.tools.register(defineTool({
    name: 'browser_clear_data',
    description: 'Clear what the browser keeps for websites: sign-ins, cookies, site storage and cache. scope site clears the website of the page you last read, as the last result of browser_read, browser_act or browser_layout showed it, with all its subdomains; scope workspace clears every website. Every conversation in this workspace shares the browser\'s data, so they are signed out too. Open pages concerned reload: read the page again before acting on it. Use it when the user asks to sign out, switch accounts or start a website afresh.',
    parameters: {
      scope: { type: 'string', required: true, enum: ['site', 'workspace'], description: 'site: the website of the page you last read; workspace: every website.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    timeoutMs: 30_000,
    presentCall: args => ({ card: 'generic', title: args.scope === 'workspace' ? '浏览器 · 清除所有网站数据' : '浏览器 · 清除网站数据', kind: 'execute' }),
    execute: async (args, exec) => {
      const page = websitePageOf(exec.agent)
      if (args.scope === 'site' && page === undefined) throw new Error('Read a page of the website with browser_read first: scope site clears the website of the page you last read.')
      // Its origin names the site, however long the page's address.
      const { site } = await postToSidebar(`${endpoint}/${exec.agent.session.id}/clear-data`, { scope: args.scope, ...args.scope === 'site' && { url: page.origin } }, exec.signal)
      return `${site === undefined ? 'Cleared the data of every website in this workspace' : `Cleared the data of ${site}`}; the open pages concerned reload. Read the page again before acting on it.`
    },
  }), { when: ({ agent }) => usesSidebar(agent) })
}
