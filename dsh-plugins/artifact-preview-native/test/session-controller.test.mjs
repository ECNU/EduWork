import assert from 'node:assert/strict'
import test from 'node:test'
import { installNativeReveal } from '../lib/session-controller.js'
import { revealInFileManager } from '../lib/reveal.js'

test('native reveal changes only the opener delegate and restores it on plugin disposal', () => {
  const original = () => {}, controller = { revealPath: original, openPath: () => {} }
  const openPath = controller.openPath
  let dispose
  installNativeReveal(controller, setup => { dispose = setup() }, 'win32')
  assert.equal(controller.revealPath, revealInFileManager)
  assert.equal(controller.openPath, openPath)
  dispose()
  assert.equal(controller.revealPath, original)
})

test('native adapter refuses a changed pinned contract and leaves non-Windows untouched', () => {
  assert.throws(() => installNativeReveal({}, setup => setup(), 'win32'), /hook has changed/)
  installNativeReveal({}, () => assert.fail('must not install on macOS'), 'darwin')
})
