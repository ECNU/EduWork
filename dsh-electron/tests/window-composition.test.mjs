import test from 'node:test'
import assert from 'node:assert/strict'
import { stabilizeWindowComposition } from '../src/window-composition.mjs'

test('window composition targets only its HWND with the Win32 BOOL ABI', () => {
  for (const bytes of [4, 8]) {
    const handle = Buffer.alloc(bytes)
    const expected = bytes === 8 ? 0x12345678abcdefn : 0xabcdefn
    if (bytes === 8) handle.writeBigUInt64LE(expected)
    else handle.writeUInt32LE(Number(expected))
    let called = false
    const window = { isDestroyed: () => false, getNativeWindowHandle: () => handle }
    const loadNative = () => ({ load(name) {
      assert.equal(name, 'dwmapi.dll')
      return { func(signature) {
        assert.match(signature, /__stdcall DwmSetWindowAttribute/)
        return (hwnd, attribute, value, size) => {
          assert.equal(hwnd, expected)
          assert.equal(attribute, 3)
          assert.equal(size, 4)
          assert.equal(value.readInt32LE(), 1)
          called = true
          return 0
        }
      } }
    } })
    assert.equal(stabilizeWindowComposition(window, { platform: 'win32', loadNative }), true)
    assert.equal(called, true)
  }
})

test('unsupported platforms and destroyed windows never load Windows code', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    const window = { isDestroyed: () => true }
    assert.equal(stabilizeWindowComposition(window, { platform, loadNative() { throw Error('must not run') } }), false)
  }
})

test('native errors fall back without preventing startup', () => {
  for (const result of [null, -2147024809]) {
    const warnings = []
    assert.equal(stabilizeWindowComposition({ isDestroyed: () => false, getNativeWindowHandle: () => Buffer.alloc(8) }, {
      platform: 'win32',
      loadNative() {
        if (result === null) throw new Error('binding unavailable')
        return { load: () => ({ func: () => () => result }) }
      },
      warn: message => warnings.push(message),
    }), false)
    assert.equal(warnings.length, 1)
  }
})
