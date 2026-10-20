import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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

test('startup branding cannot inject markup and status remains addressable', () => {
  const page = startupPage({ productName: '<img onerror="oops">', logo: '" onerror="oops' })
  assert.ok(!page.includes('<img onerror='))
  assert.ok(page.includes('&lt;img'))
  assert.ok(page.includes('role="status"'))
  assert.ok(page.includes('role="progressbar"'))
  assert.ok(!page.includes('aria-valuenow'))
  assert.ok(page.includes('animation:eduwork-startup-motion'))
  assert.ok(startupPage({ productName: 'EduWork', logo: '', accent: '#2575ff' }).includes('#2575ff'))
})
