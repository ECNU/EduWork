// Native window smoke test; the Dock's activate event is dispatched explicitly.
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { app, BrowserWindow } from 'electron'
import { attachAppActivation, attachWindowVisibility } from '../src/window-visibility.mjs'
import { shouldPresentMainWindow } from '../src/startup-presentation.mjs'

// Match the product's macOS lifecycle while testing each window in isolation.
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
let quitting = false
const windows = []
const dispose = attachAppActivation({ app, windows: () => windows })
try {
  assert.equal(process.platform, 'darwin')
  const fallback = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } })
  windows.push(fallback)
  await fallback.loadURL('data:text/html,<p>Synthetic initial window</p>')
  app.hide()
  for (let attempt = 0; attempt < 100 && !app.isHidden(); attempt++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(app.isHidden(), true)
  if (shouldPresentMainWindow({ presented: false, appHidden: app.isHidden(), startupFailure: false,
    quitting: false, recoveryActive: false, destroyed: false, startupWindowPresent: false })) fallback.show()
  assert.equal(fallback.isVisible(), false, 'Host readiness preserves hiding before the first window')
  assert.equal(app.isHidden(), true)
  app.emit('activate')
  assert.equal(fallback.isVisible(), true, 'explicit activation can still present the first window')
  fallback.hide()
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
    assert.equal(fallback.isVisible(), false, 'Preferred recovery window wins over another live window')
    window.hide()
    app.emit('activate')
    assert.equal(window.isVisible(), true, kind + ' reopens repeatedly')
    quitting = true
    const closed = once(window, 'closed', { signal: AbortSignal.timeout(10000) })
    window.close()
    await closed
    assert.equal(window.isDestroyed(), true, kind + ' can close when quitting')
    quitting = false
  }
  console.log('PASS: hiding before first presentation survives Host readiness; native startup/main/failure windows hide, reopen and close during quit; Dock event dispatched explicitly')
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  dispose()
  for (const window of windows) if (!window.isDestroyed()) window.destroy()
  app.exit(process.exitCode || 0)
}
})
