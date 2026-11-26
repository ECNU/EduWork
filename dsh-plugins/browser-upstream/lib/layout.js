// browser_layout: the Agent lays its current tab out at desktop width or at
// the Sidebar's own width, as the user does for a tab from its page's menu.
// The desktop app restyles the tab (sidebar-client.js) and answers once the
// page lays out at its new width (dsh-electron/src/sidebar-browser.mjs), at
// the conversation's Sidebar endpoint; the page does not reload. Subagents
// keep a browser of their own and do not get the tool.
import { randomUUID } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { finish, page, within } from './read-act.js'
import { postToSidebar, usesSidebar } from './sidebar.js'

/** Register browser_layout; sidebar is the desktop app's Sidebar endpoint. */
export function registerLayout(ctx, sidebar) {
  const endpoint = sidebar.replace(/^ws:/u, 'http:')
  ctx.tools.register(defineTool({
    name: 'browser_layout',
    description: 'Lay the current tab\'s page out at desktop width or at the Sidebar\'s own width. At the Sidebar\'s width, which pages have unless the user chose otherwise, many websites show their phone layout, with menus, filters or sorting folded away or missing; mode desktop lays the page out at least 1280 px wide, as on a computer, scaled down when the tab is narrower. Use desktop when the phone layout hides or gets in the way of what you need, and sidebar to give the page the Sidebar\'s width back when the user asks. Only this tab changes, not the user\'s setting or other tabs, and the user can change it back from the page\'s right-click menu. The page does not reload; the result shows it as browser_read does.',
    parameters: {
      mode: { type: 'string', required: true, enum: ['desktop', 'sidebar'], description: 'desktop: at least 1280 px wide, scaled down when the tab is narrower; sidebar: the Sidebar\'s own width.' },
    },
    output: page,
    timeoutMs: 60_000,
    presentCall: args => ({ card: 'generic', title: args.mode === 'desktop' ? '浏览器 · 按桌面宽度显示网页' : '浏览器 · 网页跟随侧边栏宽度', kind: 'execute' }),
    execute: (args, exec) => within(ctx, exec, async run => {
      // The desktop app knows the tab by this mark, which only its page's session carries.
      const mark = randomUUID().replaceAll('-', '')
      await run('browser_evaluate', { function: `() => 'eduwork-layout:${mark}'` })
      const { width, settled } = await postToSidebar(`${endpoint}/${exec.agent.session.id}/layout`, { mode: args.mode, mark }, exec.signal)
      const at = args.mode === 'desktop' ? 'desktop width' : 'the Sidebar\'s width'
      return finish(run, exec.agent, [settled
        ? `This tab is at ${at} now: its page lays out ${width} px wide. Only this tab changed, and the page did not reload.`
        : `This tab is at ${at} now, but its page had not laid out at the new width yet; read it again in a moment. Only this tab changed, and the page did not reload.`,
      'A page that chose its layout as it loaded keeps it until it reloads; reload it only if the user has nothing unsaved in it.'])
    }),
  }), { when: ({ agent }) => usesSidebar(agent) })
}
