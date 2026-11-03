import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const seenForm = { getSnapshot: () => ({ value: { tourSeen: true } }), subscribe: () => () => {}, set: async () => {} }

function fakeDom() {
  const listeners = new Map()
  const body = { children: [], append(node) { this.children.push(node); node.parent = this } }
  const make = tag => ({ tag, style: {}, attrs: {}, children: [], listeners: {}, set innerHTML(v) { this.html = v },
    setAttribute(k, v) { this.attrs[k] = v }, append(...nodes) { this.children.push(...nodes) },
    addEventListener(t, fn) { this.listeners[t] = fn }, focus() {}, remove() { body.children = body.children.filter(n => n !== this) } })
  globalThis.document = {
    body, documentElement: { lang: 'zh-CN' }, activeElement: null,
    createElement: make,
    getElementById: id => body.children.find(n => n.id === id) ?? null,
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener: (t, fn) => listeners.set(fn, t), removeEventListener: (_t, fn) => listeners.delete(fn),
    dispatchEvent: event => { for (const [fn, t] of listeners) if (t === event.type) fn(event) },
  }
  const winListeners = new Map()
  globalThis.window = { addEventListener: (t, fn) => winListeners.set(t, fn), removeEventListener: (t) => winListeners.delete(t), fire: t => winListeners.get(t)?.() }
  globalThis.MutationObserver = class { observe() {} disconnect() {} }
  globalThis.fetch = async () => ({ ok: false })
  globalThis.KeyboardEvent = class { constructor(type, init) { this.type = type; Object.assign(this, init) } preventDefault() { this.prevented = true } stopPropagation() { this.stopped = true } }
  return { body, listeners }
}

function load() {
  let loaded
  new Function('window', source)(Object.assign(globalThis.window, { __ModuleLoader__: { load: e => { loaded = e.factory(n => { if (n === 'react') return { createElement: (...args) => ({ args }) }; throw new Error(n) }) } } }))
  return loaded
}

test('registers one account menu entry that opens the in-app guide', () => {
  const dom = fakeDom()
  const mod = load()
  const entries = []
  mod.apply({ configForms: { get: () => seenForm }, effect: () => {}, inject: (_deps, fn) => fn({ accountMenuEntries: { register: e => { entries.push(e); return () => {} } } }) })
  assert.deepEqual(entries.map(e => e.id), ['eduwork-user-guide'])
  const button = entries[0].Component()
  assert.equal(dom.body.children.length, 0)
  assert.equal(button.args[3].args[2], '使用教程')
  button.args[1].onClick()
  const panel = dom.body.children[0]
  assert.equal(panel.id, 'eduwork-user-guide-panel')
  const frame = panel.children[0].children[1]
  assert.equal(frame.tag, 'iframe'); assert.equal(frame.src, '/eduwork-user-guide/?theme=light')
  button.args[1].onClick()
  assert.equal(dom.body.children.length, 1, 'a second click does not stack panels')
  const esc = new KeyboardEvent('keydown', { key: 'Escape' })
  document.dispatchEvent(esc)
  assert.equal(dom.body.children.length, 0, 'Escape closes the panel')
  assert.ok(esc.stopped && esc.prevented, 'Escape does not reach DSH popups under the guide')
})

test('the guide follows the app dark theme, not the system', () => {
  const dom = fakeDom()
  dom.body.hasAttribute = name => name === 'data-ds-dark-theme'
  const mod = load()
  mod.openGuide()
  const frame = dom.body.children[0].children[0].children[1]
  assert.equal(frame.src, '/eduwork-user-guide/?theme=dark')
  assert.match(frame.style.cssText, /background:#12161d/)
  mod.closeGuide()
})

test('unloading the plugin closes an open guide', () => {
  const dom = fakeDom()
  const mod = load()
  let dispose
  mod.apply({ configForms: { get: () => seenForm }, effect: () => {}, inject: (_deps, fn) => { dispose = fn({ accountMenuEntries: { register: () => () => {} } }) } })
  mod.openGuide()
  assert.equal(dom.body.children.length, 1)
  dispose()
  assert.equal(dom.body.children.length, 0)
})

test('the application menu event opens the guide; unloading stops listening', () => {
  const dom = fakeDom()
  const mod = load()
  const effects = []
  mod.apply({ configForms: { get: () => seenForm }, effect: fn => effects.push(fn()), inject: () => {} })
  window.fire('eduwork:open-user-guide')
  assert.equal(dom.body.children.length, 1)
  for (const dispose of effects) dispose()
  assert.equal(dom.body.children.length, 0)
  window.fire('eduwork:open-user-guide')
  assert.equal(dom.body.children.length, 0)
})

test('the panel title uses the distribution product name', async () => {
  const dom = fakeDom()
  const mod = load()
  const settings = await mod.loadSettings(async () => ({ ok: true, json: async () => ({ productName: 'Campus AI' }) }))
  assert.deepEqual(settings, { productName: 'Campus AI', autoStart: true, steps: [] })
  assert.deepEqual(await mod.loadSettings(async () => { throw new Error('offline') }), { productName: 'EduWork', autoStart: true, steps: [] })
  mod.openGuide()
  assert.equal(dom.body.children[0].attrs['aria-label'], 'EduWork 使用教程')
  mod.closeGuide()
})

test('without an account menu service the plugin still loads', () => {
  fakeDom()
  const mod = load()
  const injected = []
  mod.apply({ configForms: { get: () => seenForm }, effect: () => {}, inject: deps => { injected.push(deps) } })
  assert.deepEqual(injected, [['accountMenuEntries']])
  assert.deepEqual(mod.inject, ['configForms'])
})
