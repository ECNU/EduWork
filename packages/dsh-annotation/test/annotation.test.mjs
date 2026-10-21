import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { decode, encode, reference } from '../src/client/reference.js'
import { place } from '../src/client/position.js'

const t = key => ({ notePrefix: '批注：', noted: '批注', invalid: 'invalid' })[key] ?? key

test('long quotations survive reference serialization without truncation', () => {
  const quote = '完整原文🙂'.repeat(1000) + '\n末尾标记'
  const value = reference(quote, '备注', t)
  assert.equal(decode(value.ref).quote, quote)
  assert.ok(value.clipboardText.includes('末尾标记'))
})

test('floating panels fit below, flip above, and clamp inside a small viewport', () => {
  assert.deepEqual(place(500, 100, 320, 200, 1000, 700, 80), { left: 180, top: 108 })
  assert.deepEqual(place(500, 680, 320, 200, 1000, 700, 660), { left: 180, top: 452 })
  assert.deepEqual(place(10, 50, 234, 164, 250, 180, 30), { left: 8, top: 8 })
})

test('reference carries the annotation and stands alone as text', () => {
  const value = reference('第一行\r\n第二行', ' 为什么？ ', t)
  assert.deepEqual(decode(value.ref), { quote: '第一行\n第二行', note: '为什么？' })
  assert.equal(value.clipboardText, '\n> 第一行\n> 第二行\n批注：为什么？\n')
  assert.equal(value.label, '“第一行 第二行” · 批注')
  assert.equal(reference('  ', 'x', t), undefined)
  assert.equal(decode('not json'), undefined)
  assert.equal(decode(encode('\uFFFC')), undefined)
})

test('bundle registers a codec source and inserts through the official event', async () => {
  let factory
  const window = { __ModuleLoader__: { load: entry => { factory = entry.factory } } }
  vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), { window })
  const React = { createElement: () => null, useEffect() {}, useLayoutEffect() {}, useRef() {}, useState() {}, useSyncExternalStore() {} }
  const plugin = factory(name => ({ react: { default: React, ...React }, 'react-dom': { createPortal() {} } })[name])
  const effects = [], sources = [], slots = [], bails = []
  let accepted = true, focused = 0, notified = 0
  const actx = { bail: (...args) => { bails.push(args); return accepted } }
  const scope = {
    effect: fn => effects.push(fn()),
    inputTriggers: { registerSource: src => { sources.push(src); return () => {} } },
    slots: { inject: (_name, fn) => fn(), register: (spec, component) => { slots.push({ spec, component }); return () => {} } },
    sessions: { scope: id => id === 's1' ? actx : undefined },
    get: () => ({ input: { for: () => ({ focus() { focused++ }, notify() { notified++ } }) } }),
  }
  const ctx = { effect: fn => effects.push(fn()), locale: { register: () => () => {}, bind: () => t }, inject: (_deps, fn) => fn(scope) }
  plugin.apply(ctx)
  const [source] = sources
  assert.equal(source.trigger, '@')
  assert.equal((await source.candidates({}, {})).length, 0)
  const value = reference('原文', '', t)
  assert.equal(await source.codec.serialize(value.ref), value.clipboardText)
  await assert.rejects(source.codec.serialize('{}'))
  assert.equal(slots[0].spec.name, 'conversation.input.overlay')
  const injected = slots[0].spec.inject('s1')
  const actions = { captureInsertion: () => ({ start: 2, end: 5, draftRev: 7 }) }
  assert.equal(injected.insert(value, actions), true)
  assert.deepEqual(JSON.parse(JSON.stringify(bails[0].slice(1))), ['slash/input-insert-reference', { reference: value, span: { start: 5, end: 5, draftRev: 7 } }])
  accepted = undefined
  assert.equal(injected.insert(value, actions), false)
  assert.equal(focused, 1)
  assert.equal(notified, 1)
  assert.equal(slots[0].spec.inject('missing-session').insert(value, actions), false)
})

test('annotation UI confirms Enter after composition and dismisses only outside the preview', async () => {
  let factory, overlay, stateIndex = 0
  const effects = [], listeners = new Map(), removed = [], draftChanges = []
  const target = { quote: '原文', x: 10, y: 10 }
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useEffect: fn => effects.push(fn), useLayoutEffect() {},
    useRef: () => ({ current: null }),
    useState: initial => stateIndex++ === 0 ? [target, value => draftChanges.push(value)] : [initial, () => {}],
    useSyncExternalStore: () => ({ quote: '原文', note: '批注' }),
  }
  const events = {
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name, fn) => { assert.equal(listeners.get(name), fn); removed.push(name) },
  }
  const window = { ...events, __ModuleLoader__: { load: entry => { factory = entry.factory } } }
  vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), { window, document: { ...events, body: {} } })
  const plugin = factory(name => ({ react: { default: React, ...React }, 'react-dom': { createPortal: node => node } })[name])
  const scope = {
    effect: fn => fn(), inputTriggers: { registerSource() {} },
    slots: { inject: (_, fn) => fn(), register: (_, component) => { overlay = component } },
  }
  plugin.apply({ effect: fn => fn(), locale: { register() {}, bind: () => t }, inject: (_, fn) => fn(scope) })
  let accepted = false
  const tree = overlay({ sessionId: 's', previews: { subscribe() {}, get() {} }, t, insert: () => accepted })
  const editorNode = tree.children[1]
  editorNode.props.onAdd('保留这条批注')
  assert.deepEqual(draftChanges, [], 'rejected insertion must keep the mounted editor and its note')
  accepted = true
  editorNode.props.onAdd('保留这条批注')
  assert.deepEqual(draftChanges, [null], 'only an accepted insertion closes the editor')
  let added = 0, prevented = 0
  const editor = editorNode.type({ ...editorNode.props, onAdd: () => added++ })
  const keydown = editor.children[1].props.onKeyDown
  const key = extra => keydown({ key: 'Enter', nativeEvent: {}, preventDefault: () => prevented++, ...extra })
  key({ nativeEvent: { isComposing: true } })
  key({ nativeEvent: { keyCode: 229 } })
  key({ shiftKey: true })
  assert.equal(added, 0)
  assert.equal(prevented, 0)
  key({})
  key({ metaKey: true })
  assert.equal(added, 2)
  assert.equal(prevented, 2)

  effects.length = 0
  const previewNode = tree.children[2]
  let closed = 0
  const preview = previewNode.type({ ...previewNode.props, onClose: () => closed++ })
  const inside = {}
  preview.props.ref.current = { contains: node => node === inside }
  const cleanup = effects[0]()
  listeners.get('pointerdown')({ target: inside })
  listeners.get('focusin')({ target: inside })
  assert.equal(closed, 0)
  listeners.get('pointerdown')({ target: {} })
  listeners.get('focusin')({ target: {} })
  listeners.get('blur')()
  listeners.get('keydown')({ key: 'Escape' })
  assert.equal(closed, 4)
  cleanup()
  assert.deepEqual(removed.sort(), ['blur', 'focusin', 'keydown', 'pointerdown'])
})
