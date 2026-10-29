// The desktop application page's half of the Agent's Sidebar browser; see lib/sidebar-client.js.
import { connectSidebarBrowser, workspaceStorage } from '../lib/sidebar-client.js'

export const inject = ['sidebarRight', 'locale', 'sessions', 'workspaces']

export function apply(ctx) {
  const bridge = globalThis.eduworkSidebarBrowser
  if (bridge === undefined) return
  const namespace = 'eduworkSidebarBrowser'
  ctx.effect(() => ctx.locale.register(namespace, { zh: { acting: 'Agent 正在操作', stop: '停止' }, en: { acting: 'Agent is browsing', stop: 'Stop' } }))
  const t = ctx.locale.bind(namespace)
  ctx.effect(() => connectSidebarBrowser({
    bridge, desktop: globalThis.dshDesktop.browser, sidebar: ctx.sidebarRight, document,
    storage: (sessionId, signal) => workspaceStorage(ctx.workspaces.list, sessionId, signal),
    conversation: sessionId => ctx.sessions.binding(sessionId)?.session, text: t,
  }))
}
