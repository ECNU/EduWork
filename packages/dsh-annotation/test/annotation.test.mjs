import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { decode, encode, reference } from '../src/client/reference.js'

const t = key => ({ notePrefix: '批注：', noted: '批注', invalid: 'invalid' })[key] ?? key

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
  const React = { createElement: () => null, useEffect() {}, useRef() {}, useState() {}, useSyncExternalStore() {} }
  const plugin = factory(name => ({ react: { default: React, ...React }, 'react-dom': { createPortal() {} } })[name])
  const effects = [], sources = [], slots = [], bails = []
  const actx = { bail: (...args) => { bails.push(args); return true } }
  const scope = {
    effect: fn => effects.push(fn()),
    inputTriggers: { registerSource: src => { sources.push(src); return () => {} } },
    slots: { inject: (_name, fn) => fn(), register: (spec, component) => { slots.push({ spec, component }); return () => {} } },
    sessions: { scope: id => id === 's1' ? actx : undefined },
    get: () => ({ input: { for: () => ({ focus() {}, notify() {} }) } }),
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
  injected.insert(value, { captureInsertion: () => ({ start: 2, end: 5, draftRev: 7 }) })
  assert.deepEqual(JSON.parse(JSON.stringify(bails[0].slice(1))), ['slash/input-insert-reference', { reference: value, span: { start: 5, end: 5, draftRev: 7 } }])
})
