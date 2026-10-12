import test from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { adaptWindowLayout } from '../scripts/window-layout.mjs'

test('responsive measurement ignores a temporary presentation scale', () => {
  const source = 'const width = el.getBoundingClientRect().width; if (width > 0) actions.setViewportWidth(width);'
  const widths = []
  const actions = { setViewportWidth: width => widths.push(width) }
  const el = { clientWidth: 720, getBoundingClientRect: () => ({ width: 1440 }) }
  runInNewContext(adaptWindowLayout(source), { el, actions })
  assert.deepEqual(widths, [720])
  el.clientWidth = 1100
  runInNewContext(adaptWindowLayout(source), { el, actions })
  assert.deepEqual(widths, [720, 1100])
  el.clientWidth = 0
  runInNewContext(adaptWindowLayout(source), { el, actions })
  assert.equal(widths.length, 2)
})

test('an upstream contract change requires review instead of silently skipping the adapter', () => {
  assert.throws(() => adaptWindowLayout('const width = differentMeasurement();'), /measurement changed/)
  assert.throws(() => adaptWindowLayout('const width = el.getBoundingClientRect().width;'.repeat(2)), /measurement changed/)
})
