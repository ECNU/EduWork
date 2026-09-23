import test from 'node:test'
import assert from 'node:assert/strict'
import { bindMacDockActivate } from '../src/mac-dock-activate.mjs'

function mockApplication() {
  const listeners = new Map()
  return {
    on(event, handler) {
      listeners.set(event, handler)
    },
    emit(event) {
      listeners.get(event)?.()
    },
    listenerCount(event) {
      return listeners.has(event) ? 1 : 0
    },
  }
}

test('non-darwin does not register activate', () => {
  const application = mockApplication()
  let calls = 0
  bindMacDockActivate(application, () => { calls++ }, 'win32')
  assert.equal(application.listenerCount('activate'), 0)
  application.emit('activate')
  assert.equal(calls, 0)
})

test('darwin dock activate', async t => {
  const application = mockApplication()
  await t.test('show is not called until activate fires', () => {
    let calls = 0
    bindMacDockActivate(application, () => { calls++ }, 'darwin')
    assert.equal(calls, 0)
    application.emit('activate')
    assert.equal(calls, 1)
  })
  await t.test('darwin registers activate once', () => {
    assert.equal(application.listenerCount('activate'), 1)
    bindMacDockActivate(application, () => {}, 'darwin')
    assert.equal(application.listenerCount('activate'), 1)
  })
  await t.test('calling activate runs the latest show callback', () => {
    const order = []
    bindMacDockActivate(application, () => { order.push('first') }, 'darwin')
    bindMacDockActivate(application, () => { order.push('second') }, 'darwin')
    application.emit('activate')
    assert.deepEqual(order, ['second'])
  })
})
