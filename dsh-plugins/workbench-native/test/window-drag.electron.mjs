// Prints the window regions a DSH base.css gives nodes marked as the skills page
// marks them. Run with Electron: <Electron> window-drag.electron.mjs <base.css> <userData>
import { app, BrowserWindow } from 'electron'
import { readFile } from 'node:fs/promises'

app.setPath('userData', process.argv[3])
app.whenReady().then(async () => {
  const css = await readFile(process.argv[2], 'utf8')
  const window = new BrowserWindow({ show: false })
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<html data-platform="darwin"><style>${css}</style>
    <body><div id="root"><div id="row" data-window-drag></div><div id="overlay" data-window-drag-exclude></div>
    <div inert><div id="inertRow" data-window-drag></div></div></div></body></html>`))
  const regions = await window.webContents.executeJavaScript(`Object.fromEntries(['row', 'overlay', 'inertRow']
    .map(id => [id, getComputedStyle(document.getElementById(id)).getPropertyValue('-webkit-app-region')]))`)
  process.stdout.write(JSON.stringify(regions))
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
