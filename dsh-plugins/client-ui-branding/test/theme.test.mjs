import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { ECNU_LIWA_TOKENS, normalizeVisualStyle, tokensForVisualStyle } from '../src/theme.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('visual style defaults to blue and preserves an explicit red preference', () => {
  assert.equal(normalizeVisualStyle('dsh'), 'dsh')
  assert.equal(normalizeVisualStyle('unknown'), 'dsh')
  assert.equal(normalizeVisualStyle('ecnu-liwa'), 'ecnu-liwa')
  assert.equal(tokensForVisualStyle('dsh'), null)
})

test('product identity is assembly supplied and theme adaptive', () => {
  const source = fs.readFileSync(path.join(root, 'src/client/index.ts'), 'utf8')
  assert.match(source, /styleLabels\[choice.id\]/)
  assert.match(source, /productIdentity/)
  assert.match(source, /--chatecnu-logo-accent/)
  assert.match(source, /#2575ff/)
  assert.match(source, /#9f2636/)
  assert.match(source, /identity.logoUrl \|\|/)
  assert.doesNotMatch(source, /ChatECNU Work|华东师范大学|BUBBLE_TAIL_PATH|LETTERS_PATH/)
})

test('Liwa is a complete light/dark alias-token overlay', () => {
  assert.equal(tokensForVisualStyle('ecnu-liwa'), ECNU_LIWA_TOKENS)
  assert.ok(Object.keys(ECNU_LIWA_TOKENS).length >= 32)
  for (const [name, value] of Object.entries(ECNU_LIWA_TOKENS)) {
    assert.match(name, /^--dsw-/)
    assert.equal(typeof value.light, 'string')
    assert.equal(typeof value.dark, 'string')
  }
})

test('Liwa replaces every DSH business-blue surface visible in the product shell', () => {
  const light = Object.fromEntries(Object.entries(ECNU_LIWA_TOKENS).map(([name, value]) => [name, value.light]))
  assert.equal(light['--dsw-alias-state-business-primary'], '#9f2636')
  assert.equal(light['--dsw-alias-button-info-fill'], '#a52d3d')
  assert.equal(light['--dsw-alias-brand-primary-new-colorprimary-new-color'], '#9f2636')
  assert.equal(light['--dsw-alias-state-business-tertiary'], '#f5e3e3')
  assert.equal(light['--dsw-specific-sidebar-nav-item-active-accent'], '#f3dfe0')
  assert.equal(light['--dsw-specific-bubble'], '#fbefee')
  assert.equal(light['--dsw-specific-bubble-highlight'], '#efd5d7')
})
