import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { shouldPresentMainWindow } from '../src/startup-presentation.mjs'

const allowed = { presented: false, startupFailure: false, quitting: false, recoveryActive: false, destroyed: false, startupWindowPresent: false }

test('the main BootPage is shown only when no other startup surface or stop condition applies', () => {
  assert.equal(shouldPresentMainWindow(allowed), true)
  for (const key of Object.keys(allowed)) {
    assert.equal(shouldPresentMainWindow({ ...allowed, [key]: true }), false, key)
  }
})

test('legacy npm builds append motion support but not the native brand IPC preload', () => {
  const source = readFileSync(new URL('../scripts/build-shell.mjs', import.meta.url), 'utf8')
  const start = source.indexOf("if (file === 'apps/desktop/src/preload-app.ts')")
  const end = source.indexOf("if (!native && file === 'apps/desktop/src/locale.ts')", start)
  assert.ok(start >= 0 && end > start, 'preload append boundary changed')
  const append = source.slice(start, end)
  assert.match(append, /boot-motion-preload\.cjs/)
  const guard = append.indexOf('if (native)')
  assert.ok(guard >= 0, 'brand preload must be native-only')
  assert.ok(guard < append.indexOf('boot-brand-preload.cjs'), 'brand preload is appended before its native guard')
})

test('startup recovery drops the tray before the stale BootPage window', () => {
  const source = readFileSync(new URL('../src/product.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('export async function showDesktopFailure')
  const end = source.indexOf('\n}\n', start)
  assert.ok(start >= 0 && end > start, 'showDesktopFailure boundary changed')
  const failure = source.slice(start, end)
  assert.match(failure, /tray\.destroy\(\)/)
  assert.ok(failure.indexOf('tray.destroy()') < failure.indexOf('mainWindow.destroy()'), 'tray must not outlive the main window')
})
