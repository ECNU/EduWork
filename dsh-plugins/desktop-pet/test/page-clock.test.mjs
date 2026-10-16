import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const skins = new URL('../skins/eduwork-page/', import.meta.url)

// The page under a mocked clock, with just enough DOM to run its scheduler.
function page() {
  const handlers = {}, drawn = []
  const element = () => ({ style: {}, hidden: true, textContent: '', className: '', getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0 }) })
  const context = target => new Proxy({}, { get: (_, name) => name === 'drawImage' ? image => target ? target.src = image.src : drawn.push(image.src) : () => ({ data: [0, 0, 0, 0] }) })
  const canvas = { ...element(), getContext: () => context() }
  Object.assign(globalThis, {
    devicePixelRatio: 1,
    window: { eduworkPet: { on: (name, handler) => { handlers[name] = handler }, ready() {}, interactive() {}, failed: message => { throw new Error(message) } } },
    document: { getElementById: id => id === 'pet' ? canvas : element(), addEventListener() {}, body: {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    fetch: async path => ({ json: async () => JSON.parse(await readFile(new URL(path.replace('../skin/', ''), skins), 'utf8')) }),
    Image: class { set src(value) { this.url = value; queueMicrotask(() => this.onload()) } get src() { return this.url } naturalWidth = 192; naturalHeight = 208 },
    OffscreenCanvas: class { constructor() { this.src = '' } getContext() { return context(this) } },
  })
  return { handlers, drawn }
}
const settle = () => new Promise(resolve => setImmediate(resolve))

test('a nap longer than ten minutes leaves no expired deadline waking the clock', async t => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 })
  t.after(() => mock.timers.reset())
  const { handlers, drawn } = page(), timeout = globalThis.setTimeout
  let wakeups = 0
  globalThis.setTimeout = (...args) => { wakeups++; return timeout(...args) }
  await import('../lib/page/pet.js')
  handlers.init({ layout: { window: { width: 192, height: 312 }, pet: { x: 0, y: 64, width: 192, height: 208 } }, settings: { sleep: true, bubbles: true }, locale: 'en' })
  for (let i = 0; i < 10; i++) await settle()
  handlers.status({ items: [], running: 0, acknowledged: 0 })
  const minute = async () => { const before = wakeups; for (let s = 0; s < 60; s++) { mock.timers.tick(1000); await settle() } return wakeups - before }
  for (let m = 0; m < 11; m++) await minute()
  assert.match(drawn.at(-1), /sleep\.svg$/u)
  assert.ok(await minute() <= 1, 'asleep')
  // Tucking a sleeping pet is a fixed pose too; its clock stays quiet.
  handlers.placement({ tucked: 'right', bubble: 'above' })
  assert.ok(await minute() <= 2, 'tucked')
  assert.match(drawn.at(-1), /peek\.svg$/u)
  handlers.placement({ tucked: null, bubble: 'above' })
  await minute()
  // Activity wakes the pet again.
  handlers.status({ items: [{ key: 'done', kind: 'completed', createdAt: Date.now(), title: '' }], running: 0, acknowledged: 0 })
  await minute()
  assert.doesNotMatch(drawn.at(-1), /sleep\.svg$/u)
})
