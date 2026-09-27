import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { attachExternalNavigation, navigationTarget } from '../src/external-navigation.mjs'

test('new-window and same-window links open exactly once in the OS browser', async () => {
  const contents = new EventEmitter(), opened = []
  contents.setWindowOpenHandler = callback => { contents.open = callback }
  attachExternalNavigation(contents, async url => opened.push(url))
  const url = 'https://example.org/资料?q=a%20b#chapter'
  assert.deepEqual(contents.open({ url }), { action: 'deny' })
  let prevented = false
  contents.emit('will-navigate', { preventDefault() { prevented = true } }, url)
  await new Promise(setImmediate)
  assert.deepEqual(opened, [url, url])
  assert.equal(prevented, true)
  contents.emit('will-navigate', { preventDefault() { throw Error('internal navigation blocked') } }, 'dsh-app://app/index.html#/session/one')
  for (const bad of ['file:///C:/Windows/test.exe','javascript:alert(1)','data:text/html,hi','mailto:a@example.org','https://user:password@example.org','dsh-app://unowned/index.html']) {
    assert.equal(navigationTarget(bad), 'blocked')
    contents.open({ url: bad })
  }
  await new Promise(setImmediate)
  assert.equal(opened.length, 2)
})

test('modern navigation details and launch failures do not create unhandled rejections', async () => {
  const contents = new EventEmitter(), errors = []
  contents.setWindowOpenHandler = () => {}
  attachExternalNavigation(contents, () => { throw Error('OS launch failed') }, error => errors.push(error.message))
  let prevented = false
  contents.emit('will-navigate', { url: 'https://example.org', preventDefault() { prevented = true } })
  await new Promise(setImmediate)
  assert.equal(prevented, true)
  assert.deepEqual(errors, ['OS launch failed'])
})

test('media routing requires the trusted preview client and external override bypasses it', async () => {
  const contents = new EventEmitter(), routed = [], native = [], sent = []
  contents.mainFrame = { url: 'dsh-app://app/index.html' }
  contents.setWindowOpenHandler = callback => { contents.open = callback }
  contents.send = (...args) => sent.push(args)
  attachExternalNavigation(contents, url => routed.push(url), assert.fail, url => native.push(url))
  const url = 'https://example.org/movie.MP4?download=1'
  contents.open({ url })
  contents.emit('ipc-message', { senderFrame: { url: 'dsh-app://app/index.html' } }, 'eduwork:preview-ready', true)
  contents.open({ url })
  const trusted = { senderFrame: contents.mainFrame }
  contents.emit('ipc-message', trusted, 'eduwork:preview-ready', true)
  contents.open({ url })
  contents.open({ url: 'https://example.org/page' })
  contents.emit('ipc-message', trusted, 'eduwork:preview-external', url)
  for (const invalid of ['file:///secret', 'https://user:pass@example.org', 'javascript:alert(1)']) {
    contents.emit('ipc-message', trusted, 'eduwork:preview-external', invalid)
  }
  contents.emit('ipc-message', { senderFrame: { url: 'https://example.org' } }, 'eduwork:preview-external', url)
  await new Promise(setImmediate)
  assert.deepEqual(sent, [['eduwork:preview-link', url]])
  assert.deepEqual(native, [url])
  assert.deepEqual(routed, [url, url, 'https://example.org/page'])
  contents.emit('did-start-navigation', {}, 'dsh-app://app/index.html', false, true)
  contents.open({ url })
  await new Promise(setImmediate)
  assert.equal(routed.length, 4)
  assert.equal(sent.length, 1)
})
