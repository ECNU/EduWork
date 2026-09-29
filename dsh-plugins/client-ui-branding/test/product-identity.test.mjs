import assert from 'node:assert/strict'
import test from 'node:test'
import { installProductIdentity } from '../src/client/product-identity.js'

function fixture(title = '课程 — DeepSeek Harness') {
  let snapshot = { status: 'loading' }, listener, observer, removed = false
  const doc = { title, head: { append() {} }, createElement: () => ({ dataset: {}, removeAttribute() {}, remove() { removed = true } }) }
  class Observer {
    constructor(callback) { observer = callback }
    observe() {}
    disconnect() { observer = undefined }
  }
  const scope = { getSnapshot: () => snapshot, subscribe: callback => { listener = callback; return () => { listener = undefined } } }
  const dispose = installProductIdentity(scope, doc, Observer)
  return { doc, dispose, refresh(value) { snapshot = value; listener?.() }, navigate(title) { doc.title = title; observer?.() },
    get cleaned() { return !listener && !observer && removed } }
}

test('loading completion and preference refresh preserve a mounted session title', () => {
  const f = fixture()
  assert.equal(f.doc.title, '课程 — EduWork')
  f.refresh({ status: 'ready', base: { product: { name: 'EduWork' } }, value: { visualStyle: 'ecnu-liwa' } })
  assert.equal(f.doc.title, '课程 — EduWork')
  f.navigate('下一节 — DeepSeek Harness')
  f.refresh({ status: 'ready', base: { product: { name: 'EduWork' } } })
  assert.equal(f.doc.title, '下一节 — EduWork')
  f.dispose()
  assert.ok(f.cleaned)
})

test('late edition identity replaces only the old product suffix', () => {
  const f = fixture()
  f.refresh({ base: { product: { name: 'EduWork@Example' } } })
  assert.equal(f.doc.title, '课程 — EduWork@Example')
  f.navigate('DeepSeek Harness')
  assert.equal(f.doc.title, 'EduWork@Example')
  f.navigate('关于 DeepSeek Harness')
  assert.equal(f.doc.title, '关于 DeepSeek Harness')
  f.dispose()
  assert.equal(f.doc.title, '关于 DeepSeek Harness')
  assert.ok(f.cleaned)
})

test('disposal restores an owned title and removes subscriptions', () => {
  const f = fixture('DeepSeek Harness')
  assert.equal(f.doc.title, 'EduWork')
  f.dispose()
  assert.equal(f.doc.title, 'DeepSeek Harness')
  f.refresh({ base: { product: { name: 'Another product' } } })
  assert.equal(f.doc.title, 'DeepSeek Harness')
  assert.ok(f.cleaned)
})
