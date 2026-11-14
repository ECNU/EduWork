import assert from 'node:assert/strict'
import { getEventListeners } from 'node:events'
import test from 'node:test'

// Load the fallbacks into a runtime without the built-ins, as Safari on iOS 16 is.
const native = { withResolvers: Promise.withResolvers, any: AbortSignal.any, canParse: URL.canParse }
Reflect.deleteProperty(Promise, 'withResolvers')
Reflect.deleteProperty(AbortSignal, 'any')
Reflect.deleteProperty(URL, 'canParse')
await import('../../src/web/fallbacks.ts')

test('Promise.withResolvers settles its promise from outside', async () => {
  assert.notEqual(Promise.withResolvers, native.withResolvers)
  const fulfilled = Promise.withResolvers<number>()
  fulfilled.resolve(1)
  assert.equal(await fulfilled.promise, 1)
  const rejected = Promise.withResolvers<number>()
  rejected.reject(new Error('no'))
  await assert.rejects(rejected.promise, /no/)
})

test('AbortSignal.any follows the first source to abort and lets go of the rest', () => {
  const first = new AbortController(), second = new AbortController()
  const signal = AbortSignal.any([first.signal, second.signal])
  let events = 0
  signal.addEventListener('abort', () => events++)
  assert.equal(signal.aborted, false)
  second.abort('second')
  first.abort('first')
  assert.equal(signal.reason, 'second')
  assert.equal(events, 1)
  assert.equal(getEventListeners(first.signal, 'abort').length, 0)
})

test('AbortSignal.any is aborted from the start by an aborted source', () => {
  const signal = AbortSignal.any([new AbortController().signal, AbortSignal.abort('early')])
  assert.equal(signal.aborted, true)
  assert.equal(signal.reason, 'early')
  assert.equal(AbortSignal.any([]).aborted, false)
})

test('URL.canParse resolves against a base like the URL constructor', () => {
  assert.equal(URL.canParse('https://example.edu/a'), true)
  assert.equal(URL.canParse('a/b'), false)
  assert.equal(URL.canParse('a/b', 'https://example.edu/'), true)
  assert.equal(URL.canParse(new URL('https://example.edu/'), undefined), true)
})

test('a browser\'s own built-ins are kept', async () => {
  Object.assign(Promise, { withResolvers: native.withResolvers })
  Object.assign(AbortSignal, { any: native.any })
  Object.assign(URL, { canParse: native.canParse })
  // A second copy of the module, loaded while the built-ins exist.
  await import(new URL('../../src/web/fallbacks.ts?again', import.meta.url).href)
  assert.equal(Promise.withResolvers, native.withResolvers)
  assert.equal(AbortSignal.any, native.any)
  assert.equal(URL.canParse, native.canParse)
})
