// The desktop application page's half of the Agent's Sidebar browser; see lib/sidebar-client.js.
import { connectSidebarBrowser } from '../lib/sidebar-client.js'

export const inject = ['sidebarRight', 'locale']

export function apply(ctx) {
  const bridge = globalThis.eduworkSidebarBrowser
  if (bridge === undefined) return
  const namespace = 'eduworkSidebarBrowser'
  ctx.effect(() => ctx.locale.register(namespace, { zh: { acting: 'Agent 正在操作' }, en: { acting: 'Agent is browsing' } }))
  const t = ctx.locale.bind(namespace)
  ctx.effect(() => connectSidebarBrowser({ bridge, sidebar: ctx.sidebarRight, document, label: () => t('acting') }))
}
