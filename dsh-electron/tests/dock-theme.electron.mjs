// Run on macOS: electron dsh-electron/tests/dock-theme.electron.mjs
import { app, BrowserWindow, nativeImage, protocol } from 'electron'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, renameSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const temporary = mkdtempSync(join(tmpdir(), 'eduwork-theme-'))
const appRoot = join(temporary, 'app'), brand = join(temporary, 'brand'), userData = join(temporary, 'user-data')
for (const folder of [appRoot, brand, userData]) mkdirSync(folder)
const images = ['icon-1024.png', 'icon-blue-1024.png', 'dock-red-1024.png', 'dock-blue-1024.png']
for (const file of images) copyFileSync(join(root, 'assets/eduwork', file), join(brand, file))
const originalImages = images.map(file => readFileSync(join(brand, file)))
copyFileSync(join(root, 'dsh-electron/src/dock-theme-preload.cjs'), join(temporary, 'preload.cjs'))
protocol.registerSchemesAsPrivileged([{ scheme: 'dsh-app', privileges: { standard: true, secure: true } }])
app.whenReady().then(async () => {
  let window, splash
  try {
    assert.equal(process.platform, 'darwin')
    for (const file of images.slice(2)) {
      const icon = nativeImage.createFromPath(join(brand, file))
      assert.deepEqual(icon.getSize(), { width: 1024, height: 1024 })
      const bitmap = icon.toBitmap(), bounds = [1024, 1024, -1, -1]
      for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
        if (!bitmap[(y * 1024 + x) * 4 + 3]) continue
        bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y)
        bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y)
      }
      assert.deepEqual(bounds, [100, 100, 923, 923], 'Both Dock colors have equal transparent margins')
    }
    protocol.handle('dsh-app', () => new Response('<html><body>Theme test</body></html>', { headers: { 'content-type': 'text/html' } }))
    const source = readFileSync(join(root, 'dsh-electron/src/product.mjs'), 'utf8')
    const helper = source.slice(source.indexOf('function savedEduworkStyle()'), source.indexOf('export async function attachDesktopWindow')).replace('export ', '')
    const seen = [], warnings = []
    const nativeApp = { getAppPath: () => appRoot, getPath: name => { assert.equal(name, 'userData'); return userData }, dock: { setIcon(icon) { seen.push(icon.toPNG()); app.dock.setIcon(icon) } } }
    const { attachDockTheme, savedEduworkStyle } = new Function('app', 'nativeImage', 'process', 'join', 'readFileSync', 'writeFileSync', 'renameSync', 'console', helper + '\nreturn {attachDockTheme, savedEduworkStyle}')(
      nativeApp, nativeImage, process, join, readFileSync, writeFileSync, renameSync, { warn: (...args) => warnings.push(args) })
    const preference = join(userData, 'visual-style.json')
    assert.equal(savedEduworkStyle(), 'ecnu-liwa')
    writeFileSync(preference, '{broken')
    assert.equal(savedEduworkStyle(), 'ecnu-liwa')
    window = new BrowserWindow({ show: false, webPreferences: { preload: join(temporary, 'preload.cjs'), sandbox: true, contextIsolation: true } })
    attachDockTheme(window)
    await window.loadURL('dsh-app://app/index.html')
    assert.equal(seen.length, 0, 'No default theme is sent while settings are loading')
    const select = async (style, count, file) => {
      await window.webContents.executeJavaScript(`document.documentElement.dataset.chatecnuVisualStyle = ${JSON.stringify(style)}`)
      for (let i = 0; i < 100 && seen.length < count; i++) await new Promise(resolve => setTimeout(resolve, 20))
      assert.equal(seen.length, count)
      assert.deepEqual(seen.at(-1), nativeImage.createFromPath(join(brand, file)).toPNG())
      assert.equal(savedEduworkStyle(), style)
    }
    await select('dsh', 1, 'dock-blue-1024.png')
    await select('ecnu-liwa', 2, 'dock-red-1024.png')
    await select('dsh', 3, 'dock-blue-1024.png')
    const receive = window.webContents.listeners('ipc-message').at(-1)
    receive({ senderFrame: {} }, 'eduwork:visual-style', 'ecnu-liwa')
    receive({ senderFrame: window.webContents.mainFrame }, 'eduwork:visual-style', '../../invalid')
    assert.equal(seen.length, 3)
    await window.loadURL('dsh-app://app/index.html')
    await select('ecnu-liwa', 4, 'dock-red-1024.png')
    // Render the production startup page using each persisted choice.
    const start = source.indexOf('  const startupBlue ='), end = source.indexOf('\n  lifecycle.check()', start)
    const render = new Function('app', 'BrowserWindow', 'process', 'join', 'readFileSync', 'savedEduworkStyle', `return (async () => {
      const settings = { productName: 'Theme test' }, paths = { icon: ${JSON.stringify(join(brand, images[0]))} }
      let progressWindow
      ${source.slice(start, end)}
      return progressWindow
    })()`)
    for (const [style, color] of [['dsh', 'rgb(37, 117, 255)'], ['ecnu-liwa', 'rgb(159, 38, 54)']]) {
      writeFileSync(preference, JSON.stringify({ style }))
      let startupDock
      const startupApp = { getAppPath: () => appRoot, dock: { setIcon(file) { startupDock = file; app.dock.setIcon(file) } } }
      splash = await render(startupApp, BrowserWindow, process, join, readFileSync, savedEduworkStyle)
      assert.equal(startupDock, join(brand, style === 'dsh' ? images[3] : images[2]))
      assert.equal(await splash.webContents.executeJavaScript("getComputedStyle(document.querySelector('progress')).accentColor"), color)
      const expected = readFileSync(join(brand, style === 'dsh' ? images[1] : images[0])).toString('base64')
      assert.equal(await splash.webContents.executeJavaScript("document.querySelector('img').src"), 'data:image/png;base64,' + expected)
      splash.destroy(); splash = undefined
    }
    for (let i = 0; i < images.length; i++) assert.deepEqual(readFileSync(join(brand, images[i])), originalImages[i])
    assert.equal(warnings.length, 0)
    rmSync(preference); mkdirSync(preference + '.tmp')
    receive({ senderFrame: window.webContents.mainFrame }, 'eduwork:visual-style', 'dsh')
    assert.equal(warnings.length, 1, 'A failed preference write does not interrupt the live icon update')
    assert.equal(seen.length, 5)
    await window.loadURL('about:blank')
    receive({ senderFrame: window.webContents.mainFrame }, 'eduwork:visual-style', 'ecnu-liwa')
    assert.equal(seen.length, 5, 'A main frame outside the workbench cannot change the icon')
    const packaging = readFileSync(join(root, 'dsh-electron/scripts/assemble-macos.ps1'), 'utf8')
    for (const file of images) assert(packaging.includes("'" + file + "'"))
    console.log(`PASS: equal Dock margins, sandbox preload, red/blue/reload, trusted frame and style checks, persisted startup images and colors, unchanged icon resources, write failure (Electron ${process.versions.electron})`)
  } catch (error) { console.error(error); process.exitCode = 1 }
  finally { splash?.destroy(); window?.destroy(); rmSync(temporary, { recursive: true, force: true }); app.exit(process.exitCode || 0) }
})
