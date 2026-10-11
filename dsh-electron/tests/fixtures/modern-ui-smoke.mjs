// Real Electron component acceptance. The shell page is synthetic; it does not
// replace acceptance of a complete distribution or native macOS execution.
import { app, BrowserWindow, protocol } from 'electron'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createWindow } from 'fixture-window'
import { startupPage } from '../../src/startup-page.mjs'

const output = process.env.EDUWORK_UI_EVIDENCE
const preload = process.env.EDUWORK_UI_PRELOAD
app.setPath('userData', join(output, 'browser'))
app.on('window-all-closed', () => {})
protocol.registerSchemesAsPrivileged([{ scheme: 'dsh-app', privileges: { standard: true, secure: true } }])
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const checks = []
app.whenReady().then(async () => {
  await mkdir(output, { recursive: true })
  const startup = new BrowserWindow({ width: 600, height: 390, resizable: false, maximizable: false,
    autoHideMenuBar: true, title: 'EduWork · 初始化验证', backgroundColor: '#faf3ef', webPreferences: { sandbox: true, contextIsolation: true } })
  try {
    await startup.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(startupPage({ title: 'EduWork', logo: process.env.EDUWORK_UI_LOGO })))
    assert.equal(await startup.webContents.executeJavaScript('document.documentElement.scrollHeight <= innerHeight'), true)
    await sleep(250)
    await writeFile(join(output, '04-初始化页面.png'), (await startup.webContents.capturePage()).toPNG())
    checks.push('Real startup markup fits its native window without scrolling')
    startup.destroy()
    protocol.handle('dsh-app', () => new Response(`<!doctype html><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;font:15px "Segoe UI",system-ui;color:#241a18;background:#faf3ef}#frame{display:grid;grid-template-columns:240px 1fr;height:100vh;padding-top:40px}aside{padding:24px}main{background:#fffdfb;border-radius:16px 0 0;display:grid;place-content:center;padding:36px}h1{font-size:26px;font-weight:600}.card{border:1px solid #e5d4cc;border-radius:20px;background:white;padding:24px;min-width:280px}small{color:#99847c}#frame[data-animating]{transition:grid-template-columns .6s}#frame [data-side]{transition:left .6s}
      </style><div id="frame" data-animating><aside><b>EduWork</b><p>窗口布局验证</p><small>合成验收页面</small></aside><main><h1>准备好，开始高效工作。</h1><div class="card">窗口背景与布局保持一致</div><p><small>验证最大化、最小化、还原及动画恢复</small></p></main><div data-side></div></div>`, { headers: { 'Content-Type': 'text/html;charset=utf-8' } }))
    const window = createWindow(preload, false, true)
    window.setTitle('EduWork · 窗口验证')
    await window.loadURL('dsh-app://app/index.html')
    window.show()
    const run = code => window.webContents.executeJavaScript(code)
    const bounds = window.getBounds(), zoom = window.webContents.getZoomFactor(), fill = window.getBackgroundColor()
    await sleep(250)
    await writeFile(join(output, '05-窗口组件-普通.png'), (await window.webContents.capturePage()).toPNG())
    assert.equal(await run(`dispatchEvent(new Event('resize')); getComputedStyle(document.getElementById('frame')).transitionDuration`), '0s')
    await sleep(220)
    assert.equal(await run(`getComputedStyle(document.getElementById('frame')).transitionDuration`), '0.6s')
    checks.push('Resize suppresses pending layout animation and restores ordinary transitions')
    const maximized = once(window, 'maximize'); window.maximize(); await maximized; await sleep(300)
    assert.equal(window.isMaximized(), true)
    assert.equal(window.getBackgroundColor(), fill)
    await writeFile(join(output, '06-窗口组件-最大化.png'), (await window.webContents.capturePage()).toPNG())
    const minimized = once(window, 'minimize'); window.minimize(); await minimized
    const restored = once(window, 'restore'); window.restore(); await restored; await sleep(300)
    assert.equal(window.isMaximized(), true)
    assert.equal(window.webContents.getZoomFactor(), zoom)
    assert.equal(window.getBackgroundColor(), fill)
    const unmaximized = once(window, 'unmaximize'); window.unmaximize(); await unmaximized; await sleep(300)
    assert.deepEqual(window.getBounds(), bounds)
    assert.equal(await run('document.documentElement.hasAttribute("data-eduwork-resizing")'), false)
    await writeFile(join(output, '07-窗口组件-还原.png'), (await window.webContents.capturePage()).toPNG())
    checks.push('Native maximize/minimize/restore preserves background, zoom, restored bounds and clears resize state')
    window.destroy()
    await writeFile(join(output, 'modern-ui-report.json'), JSON.stringify({ passed: true, platform: process.platform, electron: process.versions.electron, checks,
      limitations: ['Synthetic shell page; not a full product end-to-end run', 'macOS native execution not performed'] }, null, 2))
    app.exit(0)
  } catch (error) {
    await writeFile(join(output, 'modern-ui-report.json'), JSON.stringify({ passed: false, error: error.stack, checks }, null, 2))
    app.exit(1)
  }
})
