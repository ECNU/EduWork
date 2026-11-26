// The desktop application page's half of the Agent's Sidebar browser; see lib/sidebar-client.js.
import { createElement as h, useRef, useState } from 'react'
import { Button, IconChevronDownOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { SIDEBAR_SETTINGS, connectSidebarBrowser, workspaceStorage } from '../lib/sidebar-client.js'

export const inject = ['sidebarRight', 'locale', 'sessions', 'workspaces', 'slots', 'configForms']

const width = 'eduworkSidebarBrowserWidth'
const widthWords = {
  en: { title: 'Sidebar page width', description: 'Lay out pages in the Sidebar at desktop width and scale them down, or at the width of the Sidebar', desktop: 'Desktop width', sidebar: 'Follow the Sidebar' },
  zh: { title: '侧边栏网页宽度', description: '侧边栏里的网页按桌面宽度排版再缩小显示，或按侧边栏的宽度排版', desktop: '桌面宽度', sidebar: '跟随侧边栏' },
  ja: { title: 'サイドバーのページの幅', description: 'サイドバーのページをデスクトップの幅でレイアウトして縮小表示するか、サイドバーの幅でレイアウトします', desktop: 'デスクトップの幅', sidebar: 'サイドバーに合わせる' },
  es: { title: 'Ancho de las páginas de la barra lateral', description: 'Mostrar las páginas de la barra lateral con ancho de escritorio y reducidas, o con el ancho de la barra lateral', desktop: 'Ancho de escritorio', sidebar: 'Ajustar a la barra lateral' },
  fr: { title: 'Largeur des pages de la barre latérale', description: 'Mettre en page les pages de la barre latérale en largeur de bureau et les réduire, ou à la largeur de la barre latérale', desktop: 'Largeur de bureau', sidebar: 'Suivre la barre latérale' },
  de: { title: 'Seitenbreite in der Seitenleiste', description: 'Seiten in der Seitenleiste in Desktopbreite darstellen und verkleinern oder an die Breite der Seitenleiste anpassen', desktop: 'Desktopbreite', sidebar: 'Seitenleiste folgen' },
  ru: { title: 'Ширина страниц в боковой панели', description: 'Показывать страницы в боковой панели в ширину рабочего стола с уменьшением или по ширине боковой панели', desktop: 'Ширина рабочего стола', sidebar: 'По ширине боковой панели' },
  pt: { title: 'Largura das páginas da barra lateral', description: 'Mostrar as páginas da barra lateral na largura da área de trabalho, reduzidas, ou na largura da barra lateral', desktop: 'Largura da área de trabalho', sidebar: 'Seguir a barra lateral' },
}

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
const selector = {
  display: 'inline-flex', alignItems: 'center', gap: 12, height: 36, padding: '0 14px', border: 'none', borderRadius: 'var(--dsw-radius-md)',
  background: 'var(--dsw-alias-bg-module-platform)', font: 'inherit', fontSize: 14, lineHeight: '22px', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer',
}

function WidthRow({ useSettings, choose, t }) {
  const settings = useSettings(value => value)
  const [open, setOpen] = useState(false)
  const anchor = useRef(null)
  const value = settings.value?.sidebarWidth ?? 'sidebar'
  const button = h('button', {
    ref: anchor, type: 'button', style: selector, 'aria-haspopup': 'menu', 'aria-expanded': open,
    disabled: settings.status !== 'ready' || !settings.writable, onClick: () => setOpen(open => !open),
  }, t(value), h(IconChevronDownOutlineRegular, { style: { width: 16, height: 16 } }))
  return h('div', { style: row },
    h('div', { style: label }, h('div', { style: title }, t('title')), h('div', { style: description }, t('description'))),
    h(Menu, {
      open, onClose: () => setOpen(false), items: [{ id: 'desktop', label: t('desktop') }, { id: 'sidebar', label: t('sidebar') }], selectedId: value,
      onSelect: id => { anchor.current?.focus({ preventScroll: true }); setOpen(false); void choose(id) }, align: 'end', portal: true, anchor: button,
    }))
}

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
  const form = ctx.configForms.get(SIDEBAR_SETTINGS)
  ctx.effect(() => connectSidebarBrowser({
    bridge, desktop: globalThis.dshDesktop.browser, sidebar: ctx.sidebarRight, document,
    storage: (sessionId, signal) => workspaceStorage(ctx.workspaces.list, sessionId, signal),
    conversation: sessionId => ctx.sessions.binding(sessionId), text: t,
    desktopWidth: { getSnapshot: () => form.getSnapshot().value?.sidebarWidth === 'desktop', subscribe: listener => form.subscribe(listener) },
  }))
  ctx.effect(() => ctx.locale.register(width, widthWords))
  // In Settings → General, after DSH's row choosing where links open (order 17).
  ctx.effect(() => ctx.configForms.whileServed([SIDEBAR_SETTINGS], () => ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'eduwork-sidebar-browser-width', order: 17.5, locale: width, inject: () => ({ hooks: { settings: form }, choose: value => form.set('sidebarWidth', value) }),
  }, WidthRow))))
  ctx.effect(() => ctx.locale.register(data, dataWords))
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'eduwork-sidebar-browser-data', order: 17.6, locale: data, inject: () => ({ clear: () => bridge.clearData() }),
  }, DataRow))
}
