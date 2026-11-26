import assert from 'node:assert/strict'
import test from 'node:test'

// A browser without anchor positioning or registered custom properties, as Firefox 113–127:
// loading the fallback must not throw, or the preamble would stop before the remote transport.
Reflect.set(globalThis, 'CSS', { supports: () => false })
const { anchorRules, placement } = await import('../../src/web/anchors.ts')
Reflect.deleteProperty(globalThis, 'CSS')

test('anchor declarations are copied into custom properties under the same selectors and conditions', () => {
  const rules = anchorRules(`
    ._trigger_1{anchor-name:var(--dsh-model-anchor);border-radius:4px}
    /* position-anchor: --commented-out; */
    ._menu_1{position:fixed;position-anchor:var(--dsh-model-anchor);right:anchor(right)}
    ._label_1::after{content:"a{b;anchor-name:--x}"}
    @media (min-width: 768px){html[data-platform=darwin] ._backing_1{position-anchor: --surface !important}}
    @position-try --below{top:anchor(bottom)}
  `)
  assert.equal(rules.css, [
    '._trigger_1{--eduwork-anchor-name:var(--dsh-model-anchor)}',
    '._menu_1{--eduwork-position-anchor:var(--dsh-model-anchor)}',
    '@media (min-width: 768px){html[data-platform=darwin] ._backing_1{--eduwork-position-anchor:--surface !important}}',
  ].join('\n'))
  assert.deepEqual(rules.anchors, ['._trigger_1'])
  assert.deepEqual(rules.cards, ['._menu_1', 'html[data-platform=darwin] ._backing_1'])
  assert.deepEqual(anchorRules('._a{color:red}'), { css: '', anchors: [], cards: [] })
})

test('strings, escapes and selector lists survive the copy, and each selector is looked up on its own', () => {
  const rules = anchorRules('[data-label="a/* x */b"],._list_1:is(.a,.b),.w-1\\{2{anchor-name:--l}')
  assert.equal(rules.css, '[data-label="a/* x */b"],._list_1:is(.a,.b),.w-1\\{2{--eduwork-anchor-name:--l}')
  assert.deepEqual(rules.anchors, ['[data-label="a/* x */b"]', '._list_1:is(.a,.b)', '.w-1\\{2'])
  assert.deepEqual(anchorRules(`[data-trigger="]"],[data-x='(,'],.also{anchor-name:--a}`).anchors, ['[data-trigger="]"]', `[data-x='(,']`, '.also'])
})

const viewport = { width: 390, height: 844 }
const box = (top: number, left: number, height = 28, width = 40) => ({ top, left, bottom: top + height, right: left + width })

test('a card opens above a control at the bottom of the window, aligned with its left edge', () => {
  assert.deepEqual(placement(box(777, 60), { width: 200, height: 160 }, viewport), { top: 777 - 4 - 160, left: 60 })
})

test('a card opens below a control at the top of the window, aligned with the nearer right edge', () => {
  assert.deepEqual(placement(box(40, 300), { width: 200, height: 160 }, viewport), { top: 68 + 4, left: 340 - 200 })
})

test('a card that fits on both sides takes the roomier one', () => {
  assert.equal(placement(box(300, 20), { width: 100, height: 100 }, viewport).top, 328 + 4)
  assert.equal(placement(box(600, 20), { width: 100, height: 100 }, viewport).top, 600 - 4 - 100)
})

test('a card stays inside the window margins and is capped to the room it gets', () => {
  const tall = placement(box(700, 370, 28, 10), { width: 500, height: 900 }, viewport)
  assert.deepEqual(tall, { top: 12, left: 12, maxWidth: 390 - 24, maxHeight: 700 - 4 - 12 })
  assert.equal(placement(box(777, 0, 28, 30), { width: 200, height: 100 }, viewport).left, 12)
})
