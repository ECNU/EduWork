// The desktop application page's half of the Agent's Sidebar browser; see lib/sidebar-client.js.
import { createElement as h, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { connectSidebarBrowser, workspaceStorage } from '../lib/sidebar-client.js'

export const inject = ['sidebarRight', 'locale', 'sessions', 'workspaces', 'slots']

const data = 'eduworkSidebarBrowserData'
const dataWords = {
  en: { title: 'Sidebar browser data', description: 'Sign-ins, cookies, site storage and cache of the Sidebar browser, kept for each workspace until the app quits', clear: 'Clear' },
  zh: { title: '侧边栏浏览器数据', description: '侧边栏浏览器的登录状态、Cookie、网站存储和缓存，按工作区分开保存，退出应用后清空', clear: '清除' },
  ja: { title: 'サイドバーのブラウザのデータ', description: 'サイドバーのブラウザのログイン状態、Cookie、サイトのストレージ、キャッシュ。ワークスペースごとに保存され、アプリの終了時に消去されます', clear: '消去' },
  es: { title: 'Datos del navegador de la barra lateral', description: 'Inicios de sesión, cookies, almacenamiento de sitios y caché del navegador de la barra lateral, guardados por espacio de trabajo hasta que se cierra la aplicación', clear: 'Borrar' },
  fr: { title: 'Données du navigateur de la barre latérale', description: 'Connexions, cookies, stockage des sites et cache du navigateur de la barre latérale, conservés par espace de travail jusqu’à la fermeture de l’application', clear: 'Effacer' },
  de: { title: 'Daten des Seitenleisten-Browsers', description: 'Anmeldungen, Cookies, Websitespeicher und Cache des Seitenleisten-Browsers, je Arbeitsbereich gespeichert, bis die App beendet wird', clear: 'Löschen' },
  ru: { title: 'Данные браузера боковой панели', description: 'Входы, файлы cookie, хранилище сайтов и кэш браузера боковой панели, отдельно для каждого рабочего пространства, до закрытия приложения', clear: 'Очистить' },
  pt: { title: 'Dados do navegador da barra lateral', description: 'Logins, cookies, armazenamento de sites e cache do navegador da barra lateral, guardados por espaço de trabalho até o app ser fechado', clear: 'Limpar' },
}

// A row as DSH's own General settings rows are laid out (ui-chat's PreferenceRow).
const row = { display: 'flex', alignItems: 'center', gap: 8, padding: '16px 0', borderBottom: '0.5px solid var(--dsw-alias-border-l2)' }
const label = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4, paddingRight: 48 } as const
const title = { fontSize: 14, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)' }
const description = { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }

// The desktop app asks the user to confirm, clears every workspace and reloads their pages.
function DataRow({ clear, t }: { clear: () => Promise<boolean>, t: (key: string) => string }) {
  const [busy, setBusy] = useState(false)
  return h('div', { style: row },
    h('div', { style: label }, h('div', { style: title }, t('title')), h('div', { style: description }, t('description'))),
    h(Button, { variant: 'outline', disabled: busy, onClick: () => { setBusy(true); void clear().finally(() => setBusy(false)) } }, t('clear')))
}

export function apply(ctx) {
  const bridge = globalThis.eduworkSidebarBrowser
  if (bridge === undefined) return
  const namespace = 'eduworkSidebarBrowser'
  ctx.effect(() => ctx.locale.register(namespace, { zh: { acting: 'Agent 正在操作', stop: '停止' }, en: { acting: 'Agent is browsing', stop: 'Stop' } }))
  const t = ctx.locale.bind(namespace)
  ctx.effect(() => connectSidebarBrowser({
    bridge, desktop: globalThis.dshDesktop.browser, sidebar: ctx.sidebarRight, document,
    storage: (sessionId, signal) => workspaceStorage(ctx.workspaces.list, sessionId, signal),
    conversation: sessionId => ctx.sessions.binding(sessionId), text: t,
  }))
  ctx.effect(() => ctx.locale.register(data, dataWords))
  // In Settings → General, after DSH's row choosing where links open (order 17).
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'eduwork-sidebar-browser-data', order: 17.5, locale: data, inject: () => ({ clear: () => bridge.clearData() }),
  }, DataRow))
}
