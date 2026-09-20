import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeVisualStyle, VISUAL_STYLES } from '../lib/core.js'

test('visual styles are a small removable product policy', () => {
  assert.deepEqual([...VISUAL_STYLES], ['dsh', 'ecnu-liwa'])
  assert.equal(normalizeVisualStyle('ecnu-liwa'), 'ecnu-liwa')
  assert.equal(normalizeVisualStyle('dsh'), 'dsh')
  assert.equal(normalizeVisualStyle('unknown'), 'ecnu-liwa')
  assert.equal(normalizeVisualStyle(undefined), 'ecnu-liwa')
})
