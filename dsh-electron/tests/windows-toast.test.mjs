import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createWindowsToasts, windowsToastCLSID } from '../src/windows-toast.mjs'

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'eduwork-toast-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const shown = [], clicked = [], file = join(directory, 'toast-activations.json')
  let initialized = false
  let handler
  class Notification extends EventEmitter {
    constructor(options) { super(); this.options = options }
    static isSupported() { initialized = true; return true }
    static handleActivation(callback) { handler = callback }
    show() { shown.push(this) }
    close() { this.emit('close') }
  }
  const create = () => {
    initialized = false
    return createWindowsToasts({ Notification, file, productName: 'EduWork & Co',
      activate: target => clicked.push(target), failed: () => assert.fail('notification delivery failed') })
  }
  const activate = ({ options }) => {
    assert.equal(initialized, true, 'the cold app must register with Windows before receiving a click')
    handler({ type: 'click', arguments: 'eduwork-toast=' + options.id })
  }
  return { create, shown, clicked, file, activate }
}

test('each installed Toast opens its own target even after a second Toast is sent', async t => {
  const f = await fixture(t), toasts = f.create()
  toasts.publish({ title: '<需要授权>', content: '会话 & 1', key: 'a', sessionId: 'one' })
  toasts.publish({ title: '完成', content: '会话 2', sound: true, key: 'b', sessionId: 'two' })
  const [first, second] = f.shown
  assert.match(first.options.toastXml, /EduWork &amp; Co · &lt;需要授权&gt;/u)
  assert.match(first.options.toastXml, /会话 &amp; 1/u)
  assert.match(first.options.toastXml, /<audio silent="true"\/>/u)
  assert.doesNotMatch(second.options.toastXml, /<audio/u)
  assert.doesNotMatch(await readFile(f.file, 'utf8'), /需要授权|会话/u)
  first.emit('click')
  f.activate(first)
  f.activate(second)
  assert.deepEqual(f.clicked, [{ key: 'a', sessionId: 'one' }, { key: 'b', sessionId: 'two' }])
})

test('cold activation survives restart, consumes the target once and rejects dismissed notifications', async t => {
  const f = await fixture(t), first = f.create()
  first.publish({ title: '完成', content: '会话', key: 'a', sessionId: 'one' })
  first.publish({ title: '日历', content: '提醒', key: 'calendar' })
  const restarted = f.create()
  restarted.dismiss('calendar')
  f.activate(f.shown[1])
  f.activate(f.shown[0])
  f.create()
  f.activate(f.shown[0])
  assert.deepEqual(f.clicked, [{ key: 'a', sessionId: 'one' }])
})

test('the Toast activator CLSID is stable per installed distribution', () => {
  const clsid = windowsToastCLSID('org.eduwork.eduwork.electron')
  assert.match(clsid, /^\{[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}\}$/u)
  assert.equal(windowsToastCLSID('org.eduwork.eduwork.electron'), clsid)
  assert.notEqual(windowsToastCLSID('org.eduwork.eduwork-chatecnu.electron'), clsid)
})
