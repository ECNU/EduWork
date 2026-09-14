import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DETAILS_PANEL_DEFAULT_WIDTH,
  DETAILS_PANEL_MAX_WIDTH,
  DETAILS_PANEL_MIN_WIDTH,
  normalizeDetailsPanelWidth,
} from '../lib/layout-policy.js'

test('details panel width remains a bounded integer preference', () => {
  assert.equal(DETAILS_PANEL_MIN_WIDTH, 300)
  assert.equal(DETAILS_PANEL_MAX_WIDTH, 1600)
  assert.equal(DETAILS_PANEL_DEFAULT_WIDTH, 360)
  assert.equal(normalizeDetailsPanelWidth(899.6), 900)
  assert.equal(normalizeDetailsPanelWidth(80), 300)
  assert.equal(normalizeDetailsPanelWidth(5000), 1600)
  assert.equal(normalizeDetailsPanelWidth(Number.NaN), 360)
  assert.equal(normalizeDetailsPanelWidth('900'), 360)
  assert.equal(normalizeDetailsPanelWidth(undefined), 360)
})
