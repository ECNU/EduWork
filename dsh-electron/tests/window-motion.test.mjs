import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { EventEmitter } from 'node:events'
import { attachWindowMotion } from '../src/window-motion.mjs'

const source = await readFile(new URL('../src/window-motion-preload.cjs', import.meta.url), 'utf8')
function renderer({ host = 'app', mainFrame = true, reduce = false } = {}) {
  const events = new EventEmitter(), documentEvents = new EventEmitter(), ipc = new EventEmitter(), preference = new EventEmitter()
  const attributes = new Map(), properties = new Map(), timers = new Map(), frames = new Map()
  let now = 0, id = 0, removed = false
  const root = { style: { setProperty: (k, v) => properties.set(k, String(v)), removeProperty: k => properties.delete(k) },
    setAttribute: (k, v) => attributes.set(k, v), removeAttribute: k => attributes.delete(k), hasAttribute: k => attributes.has(k) }
  preference.matches = reduce
  preference.addEventListener = preference.on; preference.removeEventListener = preference.removeListener
  const document = { hidden: false, readyState: 'complete', documentElement: root,
    createElement: () => ({ remove() { removed = true } }), head: { append() {} },
    addEventListener: documentEvents.on.bind(documentEvents), removeEventListener: documentEvents.removeListener.bind(documentEvents) }
  const context = { process: { isMainFrame: mainFrame }, location: { protocol: 'dsh-app:', host }, document,
    require: () => ({ ipcRenderer: ipc }), innerWidth: 1000, innerHeight: 700, matchMedia: () => preference,
    performance: { now: () => now }, window: { addEventListener: events.on.bind(events), removeEventListener: events.removeListener.bind(events) },
    setTimeout: (fn, delay) => { timers.set(++id, { fn, time: now + delay }); return id }, clearTimeout: id => timers.delete(id),
    requestAnimationFrame: fn => { frames.set(++id, fn); return id }, cancelAnimationFrame: id => frames.delete(id) }
  runInNewContext(source, context)
  return { attributes, properties, document, preference, ipc, events, removed: () => removed,
    resize(width, height = 700) { context.innerWidth = width; context.innerHeight = height; events.emit('resize') },
    visibility(hidden) { document.hidden = hidden; documentEvents.emit('visibilitychange') },
    advance(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.time <= now) { timers.delete(id); timer.fn() }
      for (const [id, fn] of [...frames]) { frames.delete(id); fn(now) } },
  }
}

test('large geometry changes hold old layout before easing to the new viewport', () => {
  const r = renderer()
  r.resize(1600, 900)
  assert.equal(r.attributes.get('data-eduwork-motion'), 'native')
  assert.equal(r.properties.get('--eduwork-motion-width'), '1000px')
  assert.equal(r.properties.has('--eduwork-motion-x'), false)
  assert.equal(r.properties.has('--eduwork-motion-y'), false)
  r.advance(159)
  assert.equal(r.properties.get('--eduwork-motion-width'), '1000px')
  r.advance(1)
  assert.equal(r.attributes.get('data-eduwork-motion'), 'layout')
  r.advance(70)
  assert.ok(parseFloat(r.properties.get('--eduwork-motion-width')) > 1000)
  assert.ok(parseFloat(r.properties.get('--eduwork-motion-width')) < 1600)
  r.advance(70)
  assert.equal(r.attributes.size, 0)
  assert.equal(r.properties.size, 0)
})

test('rapid reversal resumes from current layout and always clears styles', () => {
  const r = renderer()
  r.resize(1600); r.advance(160); r.advance(60)
  const width = r.properties.get('--eduwork-motion-width')
  r.resize(1000)
  assert.equal(r.attributes.get('data-eduwork-motion'), 'native')
  assert.equal(r.properties.get('--eduwork-motion-width'), width)
  r.advance(160); r.advance(140)
  assert.equal(r.attributes.size, 0)
  assert.equal(r.properties.size, 0)
})

test('manual edge resizing stays live, reduced motion skips animation, hiding releases frozen layout', () => {
  const r = renderer()
  r.ipc.emit('eduwork:window-motion', {}, 'drag'); r.resize(1500)
  assert.equal(r.attributes.has('data-eduwork-motion'), false)
  r.advance(200); r.resize(1900)
  assert.equal(r.attributes.get('data-eduwork-motion'), 'native')
  r.visibility(true)
  assert.equal(r.attributes.size, 0)
  r.visibility(false); r.resize(1000)
  r.preference.matches = true; r.preference.emit('change')
  assert.equal(r.attributes.size, 0)
  const reduced = renderer({ reduce: true }); reduced.resize(1600)
  assert.equal(reduced.attributes.size, 0)
})

test('fullscreen waits for native completion with watchdog, pagehide removes listeners', () => {
  const r = renderer()
  r.ipc.emit('eduwork:window-motion', {}, 'fullscreen-start'); r.resize(1800)
  r.advance(500)
  assert.equal(r.attributes.get('data-eduwork-motion'), 'native')
  r.ipc.emit('eduwork:window-motion', {}, 'fullscreen-end'); r.advance(160)
  assert.equal(r.attributes.get('data-eduwork-motion'), 'layout')
  r.events.emit('pagehide'); r.advance(2000)
  assert.equal(r.attributes.size, 0); assert.equal(r.properties.size, 0)
  assert.equal(r.events.listenerCount('resize'), 0)
  assert.equal(r.ipc.listenerCount('eduwork:window-motion'), 0)
  assert.equal(r.removed(), true)
  const lost = renderer(); lost.ipc.emit('eduwork:window-motion', {}, 'fullscreen-start'); lost.resize(1800)
  lost.advance(1500); lost.advance(180)
  assert.equal(lost.attributes.size, 0)
})

test('preload only installs on the trusted application main frame', () => {
  for (const options of [{ host: 'external' }, { mainFrame: false }]) {
    const r = renderer(options)
    r.resize(1600)
    assert.equal(r.attributes.size, 0)
    assert.equal(r.ipc.listenerCount('eduwork:window-motion'), 0)
  }
})

test('native notifications target only the app document and dispose on close', () => {
  const window = new EventEmitter(), sent = []
  let url = 'dsh-app://app/index.html', destroyed = false
  window.isDestroyed = () => destroyed
  window.webContents = { isDestroyed: () => false, getURL: () => url, send: (...args) => sent.push(args) }
  attachWindowMotion(window)
  window.emit('maximize'); window.emit('will-resize'); window.emit('will-enter-full-screen'); window.emit('enter-full-screen')
  assert.deepEqual(sent.map(item => item[1]), ['native', 'drag', 'fullscreen-start', 'fullscreen-end'])
  for (const value of ['https://example.com/', 'dsh-app://app.evil/', 'dsh-app://app:123/index.html', '']) { url = value; window.emit('maximize') }
  assert.equal(sent.length, 4)
  url = 'dsh-app://app/'; destroyed = true; window.emit('maximize')
  assert.equal(sent.length, 4)
  window.emit('closed'); assert.equal(window.listenerCount('maximize'), 0)
})
