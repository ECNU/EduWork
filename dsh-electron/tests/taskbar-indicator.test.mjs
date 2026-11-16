import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { createTaskbarIndicator } from '../src/taskbar-indicator.mjs'

test('Windows badges and flashes follow the taskbar button, including restore from tray', () => {
  const calls = [], window = new EventEmitter()
  let focused = false, visible = true, minimized = false
  Object.assign(window, {
    isFocused: () => focused, isVisible: () => visible, isMinimized: () => minimized, isDestroyed: () => false,
    setOverlayIcon: (icon, description) => calls.push([icon?.x ?? null, description]),
    flashFrame: value => calls.push(value),
  })
  const nativeImage = { createFromPath(path) {
    const png = readFileSync(path)
    assert.equal(png.readUInt32BE(16), 320)
    assert.equal(png.readUInt32BE(20), 32)
    return { crop: rect => rect }
  } }
  const badge = createTaskbarIndicator({ platform: 'win32', nativeImage, warn: assert.fail })
  badge.update({ count: 1, notify: true })
  badge.attach(window)
  assert.deepEqual(calls.splice(0), [[0, '1']])
  badge.update({ count: 12, notify: true })
  assert.deepEqual(calls.splice(0), [[288, '12'], true])
  focused = true
  window.emit('focus')
  badge.update({ count: 12, notify: true })
  assert.deepEqual(calls.splice(0), [false])
  focused = false; visible = false
  badge.update({ count: 11, notify: true })
  assert.deepEqual(calls.splice(0), [[288, '11']])
  visible = true; window.emit('show')
  assert.deepEqual(calls.splice(0), [[288, '11']])
  visible = false; minimized = true
  badge.update({ count: 11, notify: true })
  badge.update({ count: 0 })
  assert.deepEqual(calls.splice(0), [true, [null, ''], false])
  window.emit('closed')
  badge.update({ count: 1, notify: true })
  assert.deepEqual(calls, [])
})

test('macOS preserves the full count in the Dock and clears it when resolved', () => {
  const values = []
  const badge = createTaskbarIndicator({ platform: 'darwin', getDock: () => ({ setBadge: text => values.push(text) }), warn: assert.fail })
  badge.update({ count: 12, notify: true })
  badge.update({ count: 12 })
  badge.update({ count: 0 })
  assert.deepEqual(values, ['12', ''])
})
