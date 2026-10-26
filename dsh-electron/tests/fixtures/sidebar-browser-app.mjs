// Electron application for sidebar-browser.test.mjs: the real broker, preload
// and renderer half around a stand-in Sidebar (sidebar-browser-app.html).
// stdout carries one JSON line per event; stdin takes {id, code} lines whose
// code runs as an async function of { window, broker }.
import { app, BrowserWindow, ipcMain, protocol } from 'electron'
import { readFile } from 'node:fs/promises'
import { createRequire, registerHooks } from 'node:module'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ws = join(dirname(createRequire(join(process.env.EDUWORK_TEST_RUNTIME, 'package.json')).resolve('ws/package.json')), 'wrapper.mjs')
registerHooks({ resolve(specifier, context, next) {
  return specifier === 'ws' ? { url: pathToFileURL(ws).href, shortCircuit: true } : next(specifier, context)
} })
const { createSidebarBrowser, SIDEBAR_BROWSER_ENV, SIDEBAR_BROWSER_IPC } = await import('../../src/sidebar-browser.mjs')

const emit = value => process.stdout.write(JSON.stringify(value) + '\n')
protocol.registerSchemesAsPrivileged([{ scheme: 'dsh-app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
let window
const broker = createSidebarBrowser({ getWindow: () => window, idleMs: 1500 })
const own = event => event.sender === window?.webContents && event.senderFrame === window.webContents.mainFrame
ipcMain.on(SIDEBAR_BROWSER_IPC.bind, (event, ...args) => { if (own(event)) void broker.bind(window, ...args).catch(() => {}) })
ipcMain.on(SIDEBAR_BROWSER_IPC.opened, (event, ...args) => { if (own(event)) broker.opened(...args) })

// Electron emits ready only after the entry module settles.
void app.whenReady().then(async () => {
  const files = {
    '/index.html': [join(here, 'sidebar-browser-app.html'), 'text/html'],
    '/sidebar-client.js': [join(here, '../../../dsh-plugins/browser-upstream/lib/sidebar-client.js'), 'text/javascript'],
  }
  protocol.handle('dsh-app', async request => {
    const [path, type] = files[new URL(request.url).pathname] ?? []
    return path ? new Response(await readFile(path), { headers: { 'content-type': type } }) : new Response(null, { status: 404 })
  })
  window = new BrowserWindow({ width: 1200, height: 800, webPreferences: {
    preload: join(here, '../../src/sidebar-browser-preload.cjs'), webviewTag: true, sandbox: true, contextIsolation: true,
  } })
  // Guests are opaque, as the desktop bridge makes them.
  window.webContents.on('will-attach-webview', (_event, preferences) => { preferences.transparent = false })
  // Popups become tabs in the opener's conversation, as DesktopBrowserGuests arranges.
  window.webContents.on('did-attach-webview', (_event, guest) => guest.setWindowOpenHandler(({ url }) => {
    void window.webContents.executeJavaScript(`fixture.popup(${guest.id}, ${JSON.stringify(url)})`)
    return { action: 'deny' }
  }))
  const environment = await broker.listen()
  createInterface({ input: process.stdin }).on('line', async line => {
    const { id, code } = JSON.parse(line)
    try { emit({ id, value: await new Function('scope', `return (async ({ window, broker }) => { ${code} })(scope)`)({ window, broker }) }) }
    catch (error) { emit({ id, error: error.message }) }
  })
  await window.loadURL('dsh-app://app/index.html')
  emit({ ready: environment[SIDEBAR_BROWSER_ENV] })
}).catch(error => { console.error(error); app.exit(1) })
