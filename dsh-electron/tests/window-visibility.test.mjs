import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { attachAppActivation, attachWindowVisibility } from '../src/window-visibility.mjs'

function fixture({ platform = 'darwin', quitting = false, exit = false, tray = false, minimized = false, destroyed = false } = {}) {
  const app = new EventEmitter()
  const window = new EventEmitter()
  const calls = []
  app.quit = () => calls.push('quit')
  window.isDestroyed = () => destroyed
  window.isMinimized = () => minimized
  window.isFullScreen = () => false
  window.restore = () => calls.push('restore')
  window.show = () => calls.push('show')
  window.focus = () => calls.push('focus')
  window.hide = () => calls.push('hide')
  const show = attachWindowVisibility({ app, window, platform, isQuitting: () => quitting,
    shouldExit: () => exit, hasTray: () => tray })
  const close = () => {
    let prevented = false
    window.emit('close', { preventDefault: () => { prevented = true } })
    return prevented
  }
  return { app, window, calls, show, close }
}

test('clicking the macOS Dock icon restores the first available startup or main window', () => {
  const destroyed = fixture({ destroyed: true })
  const available = fixture({ minimized: true })
  attachAppActivation({ app: available.app, platform: 'darwin', windows: () => [destroyed.window, available.window] })
  available.app.emit('activate')
  assert.deepEqual(destroyed.calls, [])
  assert.deepEqual(available.calls, ['restore', 'show', 'focus'])
})

test('macOS close hides the window even when the tray is unavailable', () => {
  const f = fixture()
  assert.equal(f.close(), true)
  assert.deepEqual(f.calls, ['hide'])
})

test('the exit close action requests a full application quit', () => {
  const f = fixture({ exit: true })
  assert.equal(f.close(), true)
  assert.deepEqual(f.calls, ['quit'])
})

test('Windows retains existing tray and no-tray close behavior', () => {
  const withTray = fixture({ platform: 'win32', tray: true })
  assert.equal(withTray.close(), true)
  assert.deepEqual(withTray.calls, ['hide'])
  const withoutTray = fixture({ platform: 'win32' })
  assert.equal(withoutTray.close(), true)
  assert.deepEqual(withoutTray.calls, ['quit'])
})

test('macOS leaves fullscreen before hiding and tolerates a destroyed window', () => {
  const f = fixture()
  f.window.isFullScreen = () => true
  f.window.setFullScreen = value => f.calls.push(['fullscreen', value])
  f.close()
  assert.deepEqual(f.calls, [['fullscreen', false]])
  f.window.emit('leave-full-screen')
  assert.deepEqual(f.calls, [['fullscreen', false], 'hide'])
})

test('quitting does not intercept the native window close', () => {
  const f = fixture({ quitting: true })
  assert.equal(f.close(), false)
  assert.deepEqual(f.calls, [])
})
