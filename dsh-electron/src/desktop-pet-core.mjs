// Pure desktop pet rules for the Electron shell: the bridge contract, window
// geometry and placement. Screen data is passed in; no Electron imports here.

export const PET_SCHEME = 'eduwork-pet'
const SKIN_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u

/** Host → shell contract. The skin is an id inside the product's pet package. */
export function validatePetRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid pet request')
  const keys = Object.keys(body)
  if (body.action === 'reset-position' && keys.length === 1) return body
  if (body.action !== 'configure' || keys.sort().join() !== 'action,bubbles,enabled,frame,size,skin,sleep') throw new Error('Invalid pet request')
  const { frame } = body, dimension = value => Number.isSafeInteger(value) && value >= 16 && value <= 4096
  if (typeof body.enabled !== 'boolean' || typeof body.bubbles !== 'boolean' || typeof body.sleep !== 'boolean' || typeof body.skin !== 'string' || !SKIN_ID.test(body.skin)
    || !Number.isSafeInteger(body.size) || body.size < 50 || body.size > 200
    || !frame || typeof frame !== 'object' || Object.keys(frame).sort().join() !== 'height,width' || !dimension(frame.width) || !dimension(frame.height)) throw new Error('Invalid pet settings')
  return body
}

// 100% is 128 DIP tall. The window adds room above and below the pet for the
// bubble and at the sides for the badge, and never covers more than that.
const BASE_HEIGHT = 128, MARGIN = { side: 40, top: 64, bottom: 40 }, MIN_WIDTH = 220, BUBBLE = 34
export function petGeometry(frame, size) {
  const height = Math.round(BASE_HEIGHT * size / 100), width = Math.round(frame.width * height / frame.height)
  const window = { width: Math.max(width + MARGIN.side * 2, MIN_WIDTH), height: height + MARGIN.top + MARGIN.bottom }
  return { window, pet: { x: Math.round((window.width - width) / 2), y: MARGIN.top, width, height } }
}

const TUCK_VISIBLE = 0.42, TUCK_TRIGGER = 0.3
const contains = (rect, point) => point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height
function nearest(displays, point) {
  const distance = ({ bounds: r }) => Math.hypot(Math.max(r.x - point.x, 0, point.x - r.x - r.width + 1), Math.max(r.y - point.y, 0, point.y - r.y - r.height + 1))
  return displays.find(display => contains(display.bounds, point)) ?? [...displays].sort((a, b) => distance(a) - distance(b))[0]
}
function neighbour(displays, display, side, y) {
  const x = side === 'left' ? display.bounds.x - 1 : display.bounds.x + display.bounds.width
  return displays.some(other => other !== display && contains(other.bounds, { x, y }))
}

/**
 * Final window position for a requested one (screen DIP, integers). The pet
 * stays inside the nearest work area, while the window's empty margins may
 * reach past it, so the pet can sit right under the menu bar or on the
 * taskbar. Pushed past an outer side edge, it tucks in and leaves 42% visible.
 * The bubble goes below the pet when there is no room above it.
 */
export function placePet({ x, y }, geometry, displays, { allowTuck = true } = {}) {
  const { pet } = geometry
  const center = { x: Math.round(x + pet.x + pet.width / 2), y: Math.round(y + pet.y + pet.height / 2) }
  const display = nearest(displays, center), area = display.workArea
  const petY = Math.min(Math.max(Math.round(y) + pet.y, area.y), area.y + area.height - pet.height)
  const left = Math.round(x) + pet.x, right = area.x + area.width
  let tucked = null, petX = Math.min(Math.max(left, area.x), right - pet.width)
  if (allowTuck && left < area.x - pet.width * TUCK_TRIGGER && !neighbour(displays, display, 'left', center.y)) { tucked = 'left'; petX = Math.round(area.x - pet.width * (1 - TUCK_VISIBLE)) }
  if (allowTuck && left + pet.width > right + pet.width * TUCK_TRIGGER && !neighbour(displays, display, 'right', center.y)) { tucked = 'right'; petX = Math.round(right - pet.width * TUCK_VISIBLE) }
  return { x: petX - pet.x, y: petY - pet.y, tucked, bubble: petY - BUBBLE < area.y ? 'below' : 'above', display: display.id }
}

export function defaultPetPosition(geometry, primary) {
  const area = primary.workArea
  return { x: area.x + area.width - geometry.pet.x - geometry.pet.width - 32, y: area.y + area.height - geometry.pet.y - geometry.pet.height - 30 }
}

/** Saved per display, relative to its work area, so resolution changes keep it near. */
export function savedPetPosition(placed, displays) {
  const area = displays.find(display => display.id === placed.display).workArea
  return { schemaVersion: 1, display: placed.display, dx: placed.x - area.x, dy: placed.y - area.y, tucked: placed.tucked }
}
export function restorePetPosition(saved, geometry, displays, primary) {
  const display = saved?.schemaVersion === 1 && displays.find(item => item.id === saved.display)
  if (!display || !Number.isFinite(saved.dx) || !Number.isFinite(saved.dy)) return placePet(defaultPetPosition(geometry, primary), geometry, displays, { allowTuck: false })
  return placePet({ x: display.workArea.x + saved.dx, y: display.workArea.y + saved.dy }, geometry, displays, { allowTuck: saved.tucked === 'left' || saved.tucked === 'right' })
}

/** Clicking a tucked pet without pending work pulls it back onto the screen. */
export function untuckPetPosition(placed, geometry, displays) {
  const area = displays.find(display => display.id === placed.display).workArea
  const x = placed.tucked === 'left' ? area.x + 8 - geometry.pet.x : area.x + area.width - 8 - geometry.pet.x - geometry.pet.width
  return placePet({ x, y: placed.y }, geometry, displays, { allowTuck: false })
}

/** What the pet page may know: no session ids, titles only with previews on. */
export function petStatus(notifications) {
  const preview = notifications.preferences?.preview === true
  return {
    items: [...notifications.items.values()].map(item => ({ key: item.key, kind: item.kind, createdAt: item.createdAt, title: preview ? item.title : '', ...(item.kind === 'plugin' ? { level: item.level, requiresAction: item.requiresAction, label: item.label, alert: item.alert } : {}) })),
    running: notifications.running.length, acknowledged: notifications.acknowledged,
  }
}
