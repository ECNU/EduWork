import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultPetPosition, petGeometry, petStatus, placePet, restorePetPosition, savedPetPosition, untuckPetPosition, validatePetRequest } from '../src/desktop-pet-core.mjs'

// Two side-by-side displays; the primary one has a menu bar and a Dock.
const primary = { id: 1, bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 33, width: 1512, height: 870 } }
const right = { id: 2, bounds: { x: 1512, y: 0, width: 1920, height: 1080 }, workArea: { x: 1512, y: 0, width: 1920, height: 1040 } }
const geometry = petGeometry({ width: 192, height: 208 }, 100)
const configure = (extra = {}) => ({ action: 'configure', enabled: true, skin: 'eduwork-page', frame: { width: 192, height: 208 }, size: 100, bubbles: true, sleep: true, ...extra })

test('geometry: 100% is 128 DIP tall, the window leaves room for bubble and badge', () => {
  assert.deepEqual(geometry, { window: { width: 220, height: 232 }, pet: { x: 51, y: 64, width: 118, height: 128 } })
  assert.deepEqual(petGeometry({ width: 192, height: 208 }, 200).pet, { x: 40, y: 64, width: 236, height: 256 })
  assert.equal(petGeometry({ width: 400, height: 100 }, 50).window.width, 336)
})

test('placement keeps the pet in the work area, rounds fractional pointers and tucks at outer edges', () => {
  assert.deepEqual(placePet({ x: 100.6, y: 400.4 }, geometry, [primary]), { x: 101, y: 400, tucked: null, bubble: 'above', display: 1 })
  // The pet reaches the menu bar and the Dock but never goes under them; only the
  // window's empty margins do. At the top the bubble moves below the pet.
  const top = placePet({ x: 100, y: -50 }, geometry, [primary])
  assert.equal(top.y + geometry.pet.y, 33)
  assert.equal(top.bubble, 'below')
  assert.equal(placePet({ x: 100, y: 33 + 34 - 64 }, geometry, [primary]).bubble, 'above')
  assert.equal(placePet({ x: 100, y: 2000 }, geometry, [primary]).y + geometry.pet.y + geometry.pet.height, 33 + 870)
  // A small overshoot clamps; a larger one tucks and leaves 42% of the pet visible.
  assert.equal(placePet({ x: -70, y: 300 }, geometry, [primary]).x, -51)
  const left = placePet({ x: -120, y: 300 }, geometry, [primary])
  assert.equal(left.tucked, 'left')
  assert.equal(left.x + geometry.pet.x + geometry.pet.width, Math.round(118 * 0.42))
  const edge = placePet({ x: 1450, y: 300 }, geometry, [primary])
  assert.equal(edge.tucked, 'right')
  assert.equal(1512 - (edge.x + geometry.pet.x), Math.round(118 * 0.42))
  // Toward a neighbouring display the pet moves across instead of tucking.
  const across = placePet({ x: 1450, y: 300 }, geometry, [primary, right])
  assert.equal(across.tucked, null)
  assert.equal(placePet({ x: 1700, y: 300 }, geometry, [primary, right]).display, 2)
  assert.equal(placePet({ x: 1450, y: 300 }, geometry, [primary], { allowTuck: false }).tucked, null)
})

test('positions are remembered per display and fall back to the primary corner', () => {
  const placed = placePet({ x: 2000, y: 500 }, geometry, [primary, right])
  const saved = savedPetPosition(placed, [primary, right])
  assert.deepEqual(saved, { schemaVersion: 1, display: 2, dx: 488, dy: 500, tucked: null })
  assert.deepEqual(restorePetPosition(saved, geometry, [primary, right], primary), placed)
  const corner = defaultPetPosition(geometry, primary)
  assert.deepEqual(restorePetPosition(saved, geometry, [primary], primary), { ...corner, tucked: null, bubble: 'above', display: 1 })
  assert.deepEqual(restorePetPosition(null, geometry, [primary], primary), { ...corner, tucked: null, bubble: 'above', display: 1 })
  const tucked = placePet({ x: 1450, y: 300 }, geometry, [primary])
  assert.equal(restorePetPosition(savedPetPosition(tucked, [primary]), geometry, [primary], primary).tucked, 'right')
  const back = untuckPetPosition(tucked, geometry, [primary])
  assert.equal(back.tucked, null)
  assert.equal(back.x + geometry.pet.x + geometry.pet.width, 1512 - 8)
})

test('the bridge accepts only complete settings or a position reset', () => {
  assert.deepEqual(validatePetRequest(configure()), configure())
  assert.deepEqual(validatePetRequest({ action: 'reset-position' }), { action: 'reset-position' })
  for (const bad of [null, [], { action: 'reset-position', x: 1 }, { action: 'open', url: 'https://example.org' }, configure({ skin: '../x' }), configure({ size: 49 }),
    configure({ size: 100.5 }), configure({ enabled: 'yes' }), configure({ frame: { width: 192 } }), configure({ frame: { width: 192, height: 9000 } }),
    configure({ path: '/tmp/skin' }), (({ sleep, ...rest }) => rest)(configure())]) assert.throws(() => validatePetRequest(bad), JSON.stringify(bad))
})

test('the page sees item kinds and counts; titles only with previews and never session ids', () => {
  const items = new Map([['a', { key: 'a', kind: 'completed', sessionId: 'secret-session', title: 'Report', createdAt: 5 }]])
  assert.deepEqual(petStatus({ items, running: ['s1', 's2'], acknowledged: 3, preferences: { preview: false } }),
    { items: [{ key: 'a', kind: 'completed', createdAt: 5, title: '' }], running: 2, acknowledged: 3 })
  assert.equal(petStatus({ items, running: [], acknowledged: 0, preferences: { preview: true } }).items[0].title, 'Report')
})
