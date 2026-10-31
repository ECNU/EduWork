import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const skins = new URL('../skins/eduwork-page/', import.meta.url)

// The page with a skin whose peek artwork faces right; records the horizontal scale of each draw.
function page() {
  const handlers = {}, scales = []
  const element = () => ({ style: {}, hidden: true, textContent: '', className: '', getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0 }) })
  const context = () => new Proxy({}, { get: (_, name) => name === 'scale' ? x => scales.push(x) : () => ({ data: [0, 0, 0, 0] }) })
  const canvas = { ...element(), getContext: context }
  Object.assign(globalThis, {
    devicePixelRatio: 1,
    window: { eduworkPet: { on: (name, handler) => { handlers[name] = handler }, ready() {}, interactive() {}, failed: message => { throw new Error(message) } } },
    document: { getElementById: id => id === 'pet' ? canvas : element(), addEventListener() {}, body: {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    fetch: async path => ({ json: async () => {
      const manifest = JSON.parse(await readFile(new URL(path.replace('../skin/', ''), skins), 'utf8'))
      if (path.endsWith('skin.json')) manifest.animations.peek.facing = 'right'
      return manifest
    } }),
    Image: class { set src(value) { this.url = value; queueMicrotask(() => this.onload()) } get src() { return this.url } naturalWidth = 192; naturalHeight = 208 },
    OffscreenCanvas: class { getContext() { return context() } },
  })
  return { handlers, scales }
}
const settle = async () => { for (let i = 0; i < 10; i++) { mock.timers.tick(100); await new Promise(resolve => setImmediate(resolve)) } }

test('a right-facing peek mirrors only on the right edge', async t => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 })
  t.after(() => mock.timers.reset())
  const { handlers, scales } = page()
  await import('../lib/page/pet.js')
  handlers.init({ layout: { window: { width: 192, height: 312 }, pet: { x: 0, y: 64, width: 192, height: 208 } }, settings: { sleep: true, bubbles: true }, locale: 'en' })
  await settle()
  handlers.status({ items: [], running: 0, acknowledged: 0 })
  await settle()
  // Tucked on the left, the pet looks right: the artwork already faces that way.
  handlers.placement({ tucked: 'left', bubble: 'above' })
  await settle()
  assert.equal(scales.at(-1), 1)
  handlers.placement({ tucked: 'right', bubble: 'above' })
  await settle()
  assert.equal(scales.at(-1), -1)
})
