// First-run tour: card placement, target lookup, first-run trigger and step flow.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

function makeEl(tag, doc) {
  const el = {
    tag, style: {}, attrs: {}, children: [], listeners: {}, hidden: false, textContent: '', parentElement: null, rect: { left: 0, top: 0, width: 0, height: 0 },
    setAttribute(k, v) { this.attrs[k] = String(v) }, append(...nodes) { for (const n of nodes) { n.parentElement = this; this.children.push(n) } },
    addEventListener(t, fn) { this.listeners[t] = fn }, focus() { doc.focused = this },
    remove() { doc.body.children = doc.body.children.filter(n => n !== this) },
    getBoundingClientRect() { return { ...this.rect, right: this.rect.left + this.rect.width, bottom: this.rect.top + this.rect.height } },
    click() { this.listeners.click?.() },
  }
  Object.defineProperty(el, 'innerHTML', { set(v) { this.html = v } })
  return el
}

function fakeDocument({ nodes = [] } = {}) {
  const docListeners = new Set()
  const doc = {
    focused: null, nodes,
    body: { children: [], append(n) { this.children.push(n) } },
    documentElement: { lang: 'zh-CN' },
    defaultView: { innerWidth: 1280, innerHeight: 800, addEventListener() {}, removeEventListener() {} },
    createElement: tag => makeEl(tag, doc),
    getElementById: id => doc.body.children.find(n => n.id === id) ?? null,
    querySelector: () => null,
    querySelectorAll: sel => nodes.filter(n => /dialog/.test(sel) ? n.dialog : !n.dialog),
    addEventListener: (_t, fn) => docListeners.add(fn), removeEventListener: (_t, fn) => docListeners.delete(fn),
    key: key => { for (const fn of [...docListeners]) fn({ key, preventDefault() {}, stopPropagation() {} }) },
  }
  return doc
}

function load(doc) {
  globalThis.document = doc
  globalThis.window = Object.assign(doc.defaultView, { addEventListener() {}, removeEventListener() {} })
  globalThis.setInterval = () => 1; globalThis.clearInterval = () => {}
  let loaded
  new Function('window', source)(Object.assign(globalThis.window, { __ModuleLoader__: { load: e => { loaded = e.factory(n => { if (n === 'react') return { createElement: (...args) => ({ args }) }; throw new Error(n) }) } } }))
  return loaded
}

test('the card goes right of the target, then below, and stays inside the window', () => {
  const mod = load(fakeDocument())
  const view = { width: 1280, height: 800 }, card = { width: 340, height: 180 }
  assert.deepEqual(mod.placeCard({ left: 20, top: 100, width: 200, height: 40 }, card, view), { left: 240, top: 94 })
  const wide = mod.placeCard({ left: 100, top: 100, width: 1100, height: 40 }, card, view)
  assert.equal(wide.top, 160)
  const low = mod.placeCard({ left: 1000, top: 760, width: 200, height: 30 }, card, view)
  assert.ok(low.left >= 16 && low.left + 340 <= 1264 && low.top >= 16 && low.top + 180 <= 784)
  assert.deepEqual(mod.placeCard(null, card, view), { left: 470, top: 310 })
})

test('targets are found by exact visible text, preferring the topmost match', () => {
  const doc = fakeDocument()
  const mk = (text, rect) => Object.assign(makeEl('button', doc), { textContent: text, rect })
  doc.nodes.push(mk('新会话', { left: 30, top: 600, width: 300, height: 30 }), mk('新会话', { left: 30, top: 150, width: 300, height: 40 }),
    mk(' 新会话 ', { left: 0, top: 0, width: 0, height: 0 }), mk('新会话 3天', { left: 30, top: 90, width: 300, height: 30 }))
  const mod = load(doc)
  assert.equal(mod.findByText(doc, 'button', ['新会话']).rect.top, 150)
  assert.equal(mod.findByText(doc, 'button', ['新会话'], r => r.left > 500), null)
})

test('eight steps with Chinese and English copy; the last one leads to the guide', () => {
  const mod = load(fakeDocument())
  assert.equal(mod.STEPS.length, 8)
  for (const step of mod.STEPS) for (const pair of [step.title, step.body]) assert.ok(pair[0] && pair[1], step.id)
  assert.equal(mod.STEPS[0].find, undefined)
  assert.equal(mod.STEPS.at(-1).id, 'guide')
})

test('walking through to the end offers the guide and records completion', () => {
  const doc = fakeDocument()
  const mod = load(doc)
  const done = []; let opened = 0
  mod.startTour({ zh: true, doc, steps: mod.resolveSteps([], 'EduWork'), onDone: r => done.push(r), onOpenGuide: () => { opened++ } })
  const root = doc.body.children[0]
  const [, card] = root.children
  const [title, , foot] = card.children
  const [count, skip, back, next, guide] = foot.children
  assert.equal(title.textContent, '欢迎使用 EduWork'); assert.equal(count.textContent, '1 / 8'); assert.equal(back.hidden, true)
  assert.equal(root.style.background, 'rgba(8,12,20,.58)', 'a step without a target dims the whole window')
  for (let i = 0; i < 7; i++) next.click()
  assert.equal(count.textContent, '8 / 8'); assert.equal(guide.hidden, false); assert.equal(skip.hidden, true); assert.equal(next.textContent, '完成')
  guide.click()
  assert.deepEqual(done, ['finished']); assert.equal(opened, 1); assert.equal(doc.body.children.length, 0)
})

test('Escape skips, arrows move, and unloading neither records nor opens anything', () => {
  const doc = fakeDocument()
  const mod = load(doc)
  const done = []
  mod.startTour({ zh: false, doc, onDone: r => done.push(r), onOpenGuide: assert.fail })
  const count = doc.body.children[0].children[1].children[2].children[0]
  doc.key('ArrowRight'); doc.key('ArrowRight'); doc.key('ArrowLeft')
  assert.equal(count.textContent, '2 / 8')
  doc.key('Escape')
  assert.deepEqual(done, ['skipped'])
  mod.startTour({ zh: false, doc, onDone: r => done.push(r), onOpenGuide: assert.fail })
  mod.stopTour()
  assert.deepEqual(done, ['skipped']); assert.equal(doc.body.children.length, 0)
})

test('the first-run tour starts once the workbench is ready, never before settings load, when seen, disabled or under a modal', async () => {
  const composer = doc => Object.assign(makeEl('textarea', doc), { rect: { left: 300, top: 600, width: 700, height: 60 } })
  const modal = doc => Object.assign(makeEl('div', doc), { dialog: true, rect: { left: 400, top: 200, width: 400, height: 300 } })
  const cases = [
    [undefined, ['composer'], true, 0], [{ tourSeen: true }, ['composer'], true, 0], [{ tourSeen: false }, [], true, 0],
    [{ tourSeen: false }, ['composer', 'modal'], true, 0], [{ tourSeen: false }, ['composer'], false, 0], [{ tourSeen: false }, ['composer'], true, 1],
  ]
  for (const [value, parts, enabled, expected] of cases) {
    const doc = fakeDocument()
    for (const part of parts) doc.nodes.push(part === 'modal' ? modal(doc) : composer(doc))
    const mod = load(doc)
    const writes = []
    const form = { getSnapshot: () => ({ value }), subscribe: () => () => {}, set: async (k, v) => { writes.push([k, v]) } }
    const stop = mod.watchFirstRun(form, { delay: 0, enabled: () => enabled, observe: () => () => {} })
    await new Promise(r => setTimeout(r, 5))
    assert.equal(doc.body.children.length, expected, JSON.stringify([value, parts, enabled]))
    if (expected) { doc.key('Escape'); await new Promise(r => setImmediate(r)); assert.deepEqual(writes, [['tourSeen', true]]) }
    stop()
  }
})

test('distributions replace, reword and add steps; the product name is filled in', () => {
  const doc = fakeDocument()
  const mod = load(doc)
  const builtin = mod.resolveSteps([], 'Campus AI')
  assert.equal(builtin[0].title[0], '欢迎使用 Campus AI'); assert.match(builtin[2].body[1], /Campus AI reads/)
  const steps = mod.resolveSteps([
    { id: 'welcome', title: { zh: '你好，{product}' } },
    { id: 'quota', title: { zh: '用量', en: 'Quota' }, body: { zh: '这里看剩余用量。', en: 'Remaining quota.' }, selector: '[data-quota]' },
    { id: 'broken' },
    { id: 'guide' },
  ], 'Campus AI')
  assert.deepEqual(steps.map(s => s.id), ['welcome', 'quota', 'guide'])
  assert.deepEqual(steps[0].title, ['你好，Campus AI', 'Welcome to Campus AI'])
  const target = Object.assign(makeEl('div', doc), { rect: { left: 10, top: 10, width: 50, height: 20 } })
  doc.nodes.push(target)
  assert.equal(steps[1].find(doc), target)
  assert.equal(steps[2].find, undefined)
  assert.equal(mod.resolveSteps([{ id: 'broken' }]).length, 8, 'an unusable list falls back to the built-in steps')
  const bad = mod.resolveSteps([{ id: 'x', title: { en: 'X' }, body: { en: 'Y' }, selector: '[' }])
  assert.equal(bad[0].find({ querySelectorAll() { throw new SyntaxError('bad') } }), null)
})
