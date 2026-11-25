// The right-click menu of a Sidebar browser page. DSH gives one only to the
// application page (main.ts), and a page's own right click otherwise shows
// nothing. The items act on what was clicked, as in Chrome, and read in the
// application's language: editing as DSH's own menu names it, back, forward,
// reload and the system browser as its Sidebar toolbar does, copying a link as
// its open-in-app menu does.
import { clipboard, Menu } from 'electron'
import { navigationTarget } from './external-navigation.mjs'

const words = {
  en: { newTab: 'Open link in new tab', external: 'Open link in system browser', copyLink: 'Copy link address', copyImage: 'Copy image', copyImageAddress: 'Copy image address', back: 'Back', forward: 'Forward', reload: 'Reload', desktopWidth: 'Show this page at desktop width' },
  zh: { newTab: '在新标签页中打开链接', external: '在系统浏览器中打开链接', copyLink: '复制链接地址', copyImage: '复制图片', copyImageAddress: '复制图片地址', back: '后退', forward: '前进', reload: '刷新', desktopWidth: '按桌面宽度显示此网页' },
  ja: { newTab: 'リンクを新しいタブで開く', external: 'リンクをシステムブラウザで開く', copyLink: 'リンクアドレスをコピー', copyImage: '画像をコピー', copyImageAddress: '画像アドレスをコピー', back: '戻る', forward: '進む', reload: '再読み込み', desktopWidth: 'このページをデスクトップの幅で表示' },
  es: { newTab: 'Abrir enlace en una pestaña nueva', external: 'Abrir enlace en el navegador del sistema', copyLink: 'Copiar dirección del enlace', copyImage: 'Copiar imagen', copyImageAddress: 'Copiar dirección de la imagen', back: 'Atrás', forward: 'Adelante', reload: 'Recargar', desktopWidth: 'Mostrar esta página con ancho de escritorio' },
  fr: { newTab: 'Ouvrir le lien dans un nouvel onglet', external: 'Ouvrir le lien dans le navigateur système', copyLink: 'Copier l’adresse du lien', copyImage: 'Copier l’image', copyImageAddress: 'Copier l’adresse de l’image', back: 'Retour', forward: 'En avant', reload: 'Recharger', desktopWidth: 'Afficher cette page en largeur de bureau' },
  de: { newTab: 'Link in neuem Tab öffnen', external: 'Link im Systembrowser öffnen', copyLink: 'Linkadresse kopieren', copyImage: 'Bild kopieren', copyImageAddress: 'Bildadresse kopieren', back: 'Zurück', forward: 'Vorwärts', reload: 'Neu laden', desktopWidth: 'Diese Seite in Desktopbreite anzeigen' },
  ru: { newTab: 'Открыть ссылку в новой вкладке', external: 'Открыть ссылку в системном браузере', copyLink: 'Копировать адрес ссылки', copyImage: 'Копировать изображение', copyImageAddress: 'Копировать адрес изображения', back: 'Назад', forward: 'Вперед', reload: 'Перезагрузить', desktopWidth: 'Показывать эту страницу в ширину рабочего стола' },
  pt: { newTab: 'Abrir link em nova guia', external: 'Abrir link no navegador do sistema', copyLink: 'Copiar endereço do link', copyImage: 'Copiar imagem', copyImageAddress: 'Copiar endereço da imagem', back: 'Voltar', forward: 'Avançar', reload: 'Recarregar', desktopWidth: 'Mostrar esta página na largura da área de trabalho' },
}
const editing = [['undo', 'canUndo'], ['redo', 'canRedo'], null, ['cut', 'canCut'], ['copy', 'canCopy'], ['paste', 'canPaste'], null, ['selectAll', 'canSelectAll']]
// A world of its own, so nothing the page put on its window runs.
const OPENER_WORLD = 1001
// Chromium's stand-in for a link the page may not open, such as javascript:.
const BLOCKED = 'about:blank#blocked'
// copyImageAt finds the image from the guest's top document, which reaches
// a frame only when every frame up to the top runs in its process.
const reaches = frame => frame !== null && frame.processId === frame.top.processId && (frame.parent === null || reaches(frame.parent))

/**
 * The menu for the right click Electron's context-menu event describes.
 * @param locale - the application's desktop locale, whose messages name the editing commands.
 * @param width - whether the page shows at desktop width, and the user's choice for it.
 */
function sidebarBrowserMenu(window, guest, params, locale, width) {
  const text = words[locale.id.slice(0, 2)] ?? words.en
  const groups = []
  const link = params.linkURL === BLOCKED ? '' : params.linkURL
  if (link) {
    // The page opens the new tab itself, through DSH's own checks of the address;
    // the application page opens the system browser, as the Sidebar toolbar does.
    const open = (contents, code) => contents.executeJavaScriptInIsolatedWorld(OPENER_WORLD, [{ code }], true)
    const opens = navigationTarget(link) === 'external' ? [
      { label: text.newTab, click: () => void open(guest, `window.open(${JSON.stringify(link)})`) },
      { label: text.external, click: () => void open(window.webContents, `window.open(${JSON.stringify(link)}, '_blank', 'noopener,noreferrer')`) },
    ] : []
    groups.push([...opens, { label: text.copyLink, click: () => void clipboard.writeText(link) }])
  }
  if (params.mediaType === 'image' && params.srcURL) {
    groups.push([
      { label: text.copyImage, enabled: params.hasImageContents && reaches(params.frame), click: () => guest.copyImageAt(params.x, params.y) },
      { label: text.copyImageAddress, click: () => void clipboard.writeText(params.srcURL) },
    ])
  }
  if (params.isEditable) {
    groups.push(editing.map(item => item === null ? { type: 'separator' }
      : { label: locale.messages[item[0]], enabled: params.editFlags[item[1]], click: () => guest[item[0]]() }))
  } else if (params.selectionText) {
    groups.push([{ label: locale.messages.copy, enabled: params.editFlags.canCopy, click: () => guest.copy() }])
  }
  if (groups.length === 0) {
    const history = guest.navigationHistory
    groups.push([
      { label: text.back, enabled: history.canGoBack(), click: () => history.goBack() },
      { label: text.forward, enabled: history.canGoForward(), click: () => history.goForward() },
      { label: text.reload, click: () => guest.reload() },
    ])
    const desktop = width.desktopWidth()
    if (desktop !== undefined) groups.push([{ type: 'checkbox', label: text.desktopWidth, checked: desktop, click: item => width.chooseWidth(item.checked) }])
  }
  return groups.flatMap((group, index) => index === 0 ? group : [{ type: 'separator' }, ...group])
}

/**
 * Show the menu where the user right-clicks a Sidebar guest. The Agent's
 * right clicks open the page's own menus, as the user's do, and nothing on
 * the user's screen.
 * @param window - the application window the guest is in.
 * @param locale - the application's current desktop locale.
 * @param byAgent - whether the guest's latest press or key was its Agent's.
 * @param desktopWidth - whether the guest shows its page at desktop width; undefined leaves the choice out.
 * @param chooseWidth - the user's choice of width for the guest's tab.
 * @returns removes the menu.
 */
export function attachSidebarBrowserMenu(window, guest, locale, { byAgent, desktopWidth, chooseWidth }) {
  const show = (_event, params) => {
    if (!byAgent()) Menu.buildFromTemplate(sidebarBrowserMenu(window, guest, params, locale(), { desktopWidth, chooseWidth })).popup({ window })
  }
  guest.on('context-menu', show)
  return () => guest.off('context-menu', show)
}
