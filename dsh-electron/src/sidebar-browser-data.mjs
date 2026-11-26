// Clearing what the Sidebar browser keeps: sign-ins, cookies, site storage,
// service workers and HTTP cache. DSH keeps each workspace's pages in a
// partition of its own (browser-guests.ts), in memory only. Clearing leaves
// open pages showing what they showed, so the pages it concerns reload.
import { isIP } from 'node:net'
import { dialog, session, webContents } from 'electron'

const words = {
  en: { site: 'Clear data for {site}?', siteDetail: 'Its sign-ins, cookies, site storage and cache in this workspace are cleared, so the site is signed out in the workspace\'s other conversations too. Its open pages reload.', all: 'Clear all Sidebar browser data?', allDetail: 'Sign-ins, cookies, site storage and cache of the Sidebar browser are cleared in every workspace. Open pages reload.', clear: 'Clear' },
  zh: { site: '清除 {site} 的数据？', siteDetail: '这个网站在本工作区的登录状态、Cookie、网站存储和缓存都会被清除，同一工作区其他对话里的这个网站也会退出登录。打开着的这个网站的网页会重新加载。', all: '清除侧边栏浏览器的所有数据？', allDetail: '所有工作区里侧边栏浏览器的登录状态、Cookie、网站存储和缓存都会被清除，打开着的网页会重新加载。', clear: '清除' },
  ja: { site: '{site} のデータを消去しますか？', siteDetail: 'このワークスペースでのこのサイトのログイン状態、Cookie、サイトのストレージ、キャッシュが消去され、同じワークスペースのほかの会話でもこのサイトからログアウトされます。開いているこのサイトのページは再読み込みされます。', all: 'サイドバーのブラウザのデータをすべて消去しますか？', allDetail: 'すべてのワークスペースで、サイドバーのブラウザのログイン状態、Cookie、サイトのストレージ、キャッシュが消去されます。開いているページは再読み込みされます。', clear: '消去' },
  es: { site: '¿Borrar los datos de {site}?', siteDetail: 'Se borran sus inicios de sesión, cookies, almacenamiento del sitio y caché en este espacio de trabajo, así que el sitio también cierra la sesión en las demás conversaciones del espacio de trabajo. Sus páginas abiertas se recargan.', all: '¿Borrar todos los datos del navegador de la barra lateral?', allDetail: 'Se borran los inicios de sesión, cookies, almacenamiento de sitios y caché del navegador de la barra lateral en todos los espacios de trabajo. Las páginas abiertas se recargan.', clear: 'Borrar' },
  fr: { site: 'Effacer les données de {site} ?', siteDetail: 'Ses connexions, cookies, stockage du site et cache dans cet espace de travail sont effacés : le site est aussi déconnecté dans les autres conversations de l’espace de travail. Ses pages ouvertes sont rechargées.', all: 'Effacer toutes les données du navigateur de la barre latérale ?', allDetail: 'Les connexions, cookies, stockage des sites et cache du navigateur de la barre latérale sont effacés dans tous les espaces de travail. Les pages ouvertes sont rechargées.', clear: 'Effacer' },
  de: { site: 'Daten von {site} löschen?', siteDetail: 'Anmeldungen, Cookies, Websitespeicher und Cache dieser Website in diesem Arbeitsbereich werden gelöscht, sodass die Website auch in den anderen Unterhaltungen des Arbeitsbereichs abgemeldet ist. Ihre geöffneten Seiten werden neu geladen.', all: 'Alle Daten des Seitenleisten-Browsers löschen?', allDetail: 'Anmeldungen, Cookies, Websitespeicher und Cache des Seitenleisten-Browsers werden in allen Arbeitsbereichen gelöscht. Geöffnete Seiten werden neu geladen.', clear: 'Löschen' },
  ru: { site: 'Очистить данные {site}?', siteDetail: 'Входы, файлы cookie, хранилище и кэш этого сайта в этом рабочем пространстве будут удалены, поэтому в других беседах рабочего пространства вы тоже выйдете с этого сайта. Открытые страницы сайта перезагрузятся.', all: 'Очистить все данные браузера боковой панели?', allDetail: 'Входы, файлы cookie, хранилище сайтов и кэш браузера боковой панели будут удалены во всех рабочих пространствах. Открытые страницы перезагрузятся.', clear: 'Очистить' },
  pt: { site: 'Limpar os dados de {site}?', siteDetail: 'Os logins, cookies, armazenamento do site e cache neste espaço de trabalho são limpos, então o site também sai da conta nas outras conversas do espaço de trabalho. As páginas abertas do site são recarregadas.', all: 'Limpar todos os dados do navegador da barra lateral?', allDetail: 'Os logins, cookies, armazenamento de sites e cache do navegador da barra lateral são limpos em todos os espaços de trabalho. As páginas abertas são recarregadas.', clear: 'Limpar' },
}

const web = url => URL.canParse(url) && ['http:', 'https:'].includes(new URL(url).protocol)
const hostOf = url => new URL(url).hostname.replace(/^\[|\]$/gu, '')
// A host with one label, such as localhost, or an address is a site of its
// own: Chromium clears only its own cookies with it.
const single = host => isIP(host) !== 0 || !host.includes('.')
const within = (site, host) => host === site || !single(site) && host.endsWith(`.${site}`)

/**
 * The site a page's cookies belong to: the registrable domain, as Chromium
 * finds it from the public suffix list, which it accepts as a cookie's Domain
 * where it refuses any shorter suffix of the host. The cookie goes to a
 * partition of its own and is removed again.
 * @param url - an HTTP(S) address.
 */
export async function siteOf(url) {
  const host = hostOf(url)
  if (single(host)) return host
  const probe = session.fromPartition('eduwork-sidebar-browser-site')
  const labels = host.split('.')
  for (let i = labels.length - 2; i > 0; i--) {
    const domain = labels.slice(i).join('.')
    // Chromium refuses a public suffix as a cookie's Domain.
    const accepted = await probe.cookies.set({ url: `http://${host}/`, name: 'site', value: '', domain }).then(() => true, () => false)
    if (accepted) {
      await probe.cookies.remove(`http://${host}/`, 'site')
      return domain
    }
  }
  return host
}

// A page has reloaded once its new document commits, its load fails or it
// closes: until then the page that was cleared still shows and takes input.
// One whose site answers with no content stops loading and keeps its page;
// one whose site does not answer is waited for no longer than RELOADING.
// A plain reload would run what its renderer still holds in memory, as the
// scripts from the cleared cache.
const RELOADING = 10_000
function reload(page) {
  return new Promise(resolve => {
    const events = {
      'did-navigate': () => done(),
      'did-fail-load': (_event, _code, _description, _url, mainFrame) => { if (mainFrame) done() },
      'did-stop-loading': () => done(),
      destroyed: () => done(),
    }
    const timer = setTimeout(() => done(), RELOADING)
    const done = () => {
      clearTimeout(timer)
      for (const [name, listener] of Object.entries(events)) page.off(name, listener)
      resolve()
    }
    for (const [name, listener] of Object.entries(events)) page.on(name, listener)
    page.reloadIgnoringCache()
  })
}

/** The Sidebar browser's data, by the workspace partitions DSH reserves for it. */
export function createSidebarBrowserData() {
  const partitions = new Set()
  // Each partition's origins its pages have loaded, in any frame: site
  // storage is kept by origin, and clearing names the origins it clears.
  const loaded = new WeakMap()
  const pagesIn = partition => webContents.getAllWebContents().filter(contents => contents.getType() === 'webview' && contents.session === partition)

  async function clearSite(partition, url) {
    if (!web(url)) throw new Error('Not a web page address')
    const site = await siteOf(url)
    const ofSite = address => web(address) && within(site, hostOf(address))
    const origins = new Set([new URL(url).origin, ...[...loaded.get(partition) ?? []].filter(ofSite)])
    // The site's own storage wherever it was kept, as in a frame of another
    // site, and none another site kept in a frame of this one.
    await partition.clearData({ origins: [...origins], originMatchingMode: 'origin-in-all-contexts' })
    // The HTTP cache keeps a resource by its own address, which may be an
    // origin of the site no page loaded: the workspace's cache goes, which
    // signs no other site out.
    await partition.clearCache()
    await Promise.all(pagesIn(partition).filter(page => ofSite(page.getURL())).map(reload))
    return site
  }
  async function clearWorkspace(partition) {
    await partition.clearData()
    loaded.get(partition)?.clear()
    await Promise.all(pagesIn(partition).map(reload))
  }

  return {
    /** DSH reserved a workspace's partition. */
    reserved(name) {
      partitions.add(name)
    },

    /**
     * Note the origins a Sidebar guest's frames load.
     * @returns stops noting them.
     */
    attach(guest) {
      const partition = guest.session
      if (!loaded.has(partition)) loaded.set(partition, new Set())
      const note = (_event, url) => { if (web(url)) loaded.get(partition).add(new URL(url).origin) }
      guest.on('did-frame-navigate', note)
      return () => guest.off('did-frame-navigate', note)
    },

    /**
     * Clear one site in a workspace: its cookies on every subdomain, the
     * storage of each of its origins the workspace's pages loaded, and the
     * workspace's HTTP cache. Its open pages have reloaded once this settles.
     * @param partition - the workspace's session.
     * @param url - an address of the site.
     * @returns the site cleared.
     */
    clearSite,

    /** Clear everything in a workspace; its pages have reloaded once this settles. */
    clearWorkspace,

    /** The user's clearing of a page's site, once they confirm it in the application window. */
    async confirmSite(window, locale, guest) {
      // The page may close while the user decides; its workspace stays.
      const url = guest.getURL(), partition = guest.session
      const text = words[locale.id.slice(0, 2)] ?? words.en
      const site = await siteOf(url)
      const { response } = await dialog.showMessageBox(window, { type: 'warning', message: text.site.replace('{site}', site), detail: text.siteDetail, buttons: [text.clear, locale.messages.cancel], defaultId: 1, cancelId: 1 })
      if (response === 0) await clearSite(partition, url)
    },

    /**
     * The user's clearing of every workspace, once they confirm it in the application window.
     * @returns whether it was cleared.
     */
    async confirmAll(window, locale) {
      const text = words[locale.id.slice(0, 2)] ?? words.en
      const { response } = await dialog.showMessageBox(window, { type: 'warning', message: text.all, detail: text.allDetail, buttons: [text.clear, locale.messages.cancel], defaultId: 1, cancelId: 1 })
      if (response !== 0) return false
      await Promise.all([...partitions].map(name => clearWorkspace(session.fromPartition(name))))
      return true
    },
  }
}
