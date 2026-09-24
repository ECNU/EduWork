// Native window smoke test; the Dock's activate event is dispatched explicitly.
import assert from 'node:assert/strict'
import { app, BrowserWindow } from 'electron'
import { attachAppActivation, attachWindowVisibility } from '../src/window-visibility.mjs'

app.whenReady().then(async () => {
let quitting = false
const windows = []
const dispose = attachAppActivation({ app, windows: () => windows })
try {
  assert.equal(process.platform, 'darwin')
  for (const kind of ['startup', 'main', 'failure']) {
    const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } })
    windows.unshift(window)
    attachWindowVisibility({ app, window, isQuitting: () => quitting, shouldExit: () => false, hasTray: () => false })
    await window.loadURL('data:text/html,<p>Synthetic window lifecycle test</p>')
    window.show()
    window.close()
    assert.equal(window.isDestroyed(), false, kind + ' remains available without a tray')
    assert.equal(window.isVisible(), false)
    app.emit('activate')
    assert.equal(window.isVisible(), true, kind + ' reopens on activation')
    window.hide()
    app.emit('activate')
    assert.equal(window.isVisible(), true, kind + ' reopens repeatedly')
    quitting = true
    window.close()
    assert.equal(window.isDestroyed(), true, kind + ' can close when quitting')
    quitting = false
  }
  console.log('PASS: native macOS startup/main/failure windows hide, reopen and close during quit; Dock event dispatched explicitly')
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  dispose()
  for (const window of windows) if (!window.isDestroyed()) window.destroy()
  app.exit(process.exitCode || 0)
}
})
