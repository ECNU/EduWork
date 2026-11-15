import test from 'node:test'
import assert from 'node:assert/strict'
import { bindDesktopAction, bindSettingsOpenAction } from '../src/client/desktop-actions.ts'
import { settingsFixture } from './settings-fixture.mjs'

function windowFixture(pending = []) {
  const window = new EventTarget()
  window.__eduworkTrayActions = [...pending]
  return window
}

test('an early tray settings action survives another action drain', () => {
  const window = windowFixture(['open-settings'])
  globalThis.window = window
  const disposeSession = bindDesktopAction('new-session', () => {})
  assert.deepEqual(window.__eduworkTrayActions, ['open-settings'])
  let opened = 0
  const disposeSettings = bindDesktopAction('open-settings', () => { opened += 1 })
  assert.equal(opened, 1)
  assert.deepEqual(window.__eduworkTrayActions, [])
  disposeSettings()
  disposeSession()
})

test('every tray settings request invokes the idempotent handler', () => {
  const window = windowFixture()
  globalThis.window = window
  let opened = 0
  const dispose = bindDesktopAction('open-settings', () => { opened += 1 })
  for (let click = 0; click < 2; click += 1) {
    window.__eduworkTrayActions.push('open-settings')
    window.dispatchEvent(new Event('eduwork:tray-action'))
  }
  assert.equal(opened, 2)
  dispose()
})

test('the tray settings action uses the settings shell store open action', () => {
  const window = windowFixture()
  globalThis.window = window
  const settings = settingsFixture()
  const dispose = bindSettingsOpenAction({
    slots: settings.slots,
    sessions: { getSnapshot: () => ({ phase: 'ready' }) },
    frame: callback => callback(),
  })
  window.__eduworkTrayActions.push('open-settings')
  window.dispatchEvent(new Event('eduwork:tray-action'))
  assert.equal(settings.owner.getSnapshot().open, true)
  window.__eduworkTrayActions.push('open-settings')
  window.dispatchEvent(new Event('eduwork:tray-action'))
  assert.equal(settings.opened(), 1)
  settings.owner.actions.close()
  window.__eduworkTrayActions.push('open-settings')
  window.dispatchEvent(new Event('eduwork:tray-action'))
  assert.equal(settings.owner.getSnapshot().open, true)
  assert.equal(settings.opened(), 2)
  dispose()
})

test('the adapter requires the pinned settings shell store', () => {
  assert.throws(() => bindSettingsOpenAction({ slots: { entries: () => [] } }), /settings shell store is not registered/)
})
