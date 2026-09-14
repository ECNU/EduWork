import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeVisualStyle, VISUAL_STYLES } from '../lib/core.js'

test('visual styles are a small removable product policy', () => {
  assert.deepEqual([...VISUAL_STYLES], ['dsh', 'ecnu-liwa'])
  assert.equal(normalizeVisualStyle('ecnu-liwa'), 'ecnu-liwa')
  assert.equal(normalizeVisualStyle('unknown'), 'dsh')
  assert.equal(normalizeVisualStyle(undefined), 'dsh')
})
