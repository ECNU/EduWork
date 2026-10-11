import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { adaptNativeDesktopSource } from '../scripts/native-desktop-source.mjs'
import { startupPage } from '../src/startup-page.mjs'

test('window factory keeps native fullscreen and editing behavior without reattaching materials', async () => {
  const original = await readFile(new URL('./fixtures/window-factory.ts', import.meta.url), 'utf8')
  const adapted = adaptNativeDesktopSource('apps/desktop/src/main.ts', original)
  assert.ok(adapted.includes("window.on('enter-full-screen', sendFullscreen)"))
  assert.ok(adapted.includes("window.on('leave-full-screen', sendFullscreen)"))
  assert.ok(adapted.includes("window.webContents.on('context-menu'"))
  assert.ok(adapted.includes("backgroundColor: '#faf3ef'"))
  assert.ok(!adapted.includes('setVibrancy('))
  assert.ok(!adapted.includes("backgroundColor: '#00000000'"))
})

test('resize suppression settles, cleans up and ignores external pages', async () => {
  const source = await readFile(new URL('../src/window-motion-preload.cjs', import.meta.url), 'utf8')
  for (const host of ['app', 'external']) {
    const events = {}, attributes = new Set(), styles = []
    let settle, removed = false
    const root = { setAttribute: name => attributes.add(name), removeAttribute: name => attributes.delete(name) }
    const document = { readyState: 'complete', documentElement: root,
      createElement: () => ({ remove() { removed = true } }), head: { append: style => styles.push(style) } }
    runInNewContext(source, { process: { isMainFrame: true }, location: { protocol: 'dsh-app:', host }, document,
      window: { addEventListener: (name, fn) => { events[name] = fn }, removeEventListener: name => delete events[name] },
      setTimeout: fn => { settle = fn; return 1 }, clearTimeout() {} })
    if (host !== 'app') { assert.equal(styles.length, 0); continue }
    events.resize(); assert.ok(attributes.has('data-eduwork-resizing'))
    settle(); assert.equal(attributes.size, 0)
    events.resize(); events.pagehide(); assert.equal(attributes.size, 0)
    assert.equal(events.resize, undefined); assert.equal(removed, true)
  }
})

test('startup branding cannot inject markup and status remains addressable', () => {
  const page = startupPage({ title: '<img onerror="oops">', logo: '" onerror="oops' })
  assert.ok(!page.includes('<img onerror='))
  assert.ok(page.includes('&lt;img'))
  assert.ok(page.includes('role="status"'))
  assert.ok(page.includes('<progress aria-label='))
  assert.ok(startupPage({ title: 'EduWork', logo: '', blue: true }).includes('#2575ff'))
})
