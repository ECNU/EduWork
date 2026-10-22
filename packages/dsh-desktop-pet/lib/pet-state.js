// Pure state and pacing rules for the pet page. Time and randomness are
// passed in, so the same inputs always give the same results in tests.

export const PACE = Object.freeze({
  workGap: [12_000, 30_000], workLength: [2_500, 6_000],
  idleGap: [20_000, 45_000], idleLength: 6_000,
  blinkGap: [3_000, 7_000],
  // Goal rounds and short pauses between turns stay "working".
  workingGrace: 3_000,
  celebrate: 4_000, failed: 3_000, greet: 2_400,
  sleepAfter: 10 * 60_000,
  motionFrame: 1000 / 12,
})

const HUMAN = ['question', 'approval']
const newest = (a, b) => b.createdAt - a.createdAt

/**
 * The base state from the notification snapshot, by priority: attention,
 * failed, done, working, idle. `target` is the item a click opens.
 * @param {{ key: string, kind: string, createdAt: number }[]} items
 * @param {number} running sessions with live work
 */
export function deriveStatus(items, running) {
  for (const [state, kinds] of [['attention', HUMAN], ['failed', ['failed']], ['done', ['completed']]]) {
    const rows = items.filter(item => kinds.includes(item.kind) || item.kind === 'plugin' && (state === 'attention' ? item.requiresAction : state === 'failed' ? !item.requiresAction && item.level === 'error' : !item.requiresAction && item.level !== 'error'))
      .sort((a, b) => state === 'attention' ? Number(HUMAN.includes(b.kind)) - Number(HUMAN.includes(a.kind)) || newest(a, b) : newest(a, b))
    if (rows.length) return { state, target: rows[0], count: rows.length }
  }
  return running > 0 ? { state: 'working', target: null, count: running } : { state: 'idle', target: null, count: 0 }
}

export function badgeText(status) {
  if (status.state === 'attention') return '?'
  if (status.state === 'failed') return '!'
  if (status.state === 'done') return status.count > 1 ? String(Math.min(status.count, 99)) : '!'
  return ''
}

export const between = ([min, max], random) => Math.round(min + (max - min) * random())
export const pick = (list, random) => list[Math.min(list.length - 1, Math.floor(random() * list.length))]

const order = ({ frames, playback }) => {
  const forward = [...frames.keys()]
  return playback === 'pingpong' && frames.length > 2 ? [...forward, ...forward.slice(1, -1).reverse()] : forward
}
const cycle = animation => order(animation).reduce((sum, i) => sum + animation.frames[i].ms, 0)
const cycles = animation => animation.playback === 'once' ? 1 : animation.repeat ?? Infinity

/** Total length of a finite animation, or Infinity for an endless loop. */
export const animationLength = animation => cycle(animation) * cycles(animation)

/**
 * The frame shown `elapsed` ms after an animation started and the time until
 * it changes. `once` holds its last frame; a finite loop reports `finished`.
 */
export function frameAt(animation, elapsed) {
  const sequence = order(animation), length = animationLength(animation)
  if (elapsed >= length) return { index: sequence.at(-1), next: Infinity, finished: true }
  if (sequence.length === 1) return { index: 0, next: length - elapsed, finished: false }
  let t = elapsed % cycle(animation)
  for (const index of sequence) {
    const ms = animation.frames[index].ms
    if (t < ms) return { index, next: ms - t, finished: false }
    t -= ms
  }
}

/**
 * Built-in motions for still images, as an offset around the pet's feet
 * (`origin: 'bottom'`) or its top edge (`origin: 'top'`, for dangling).
 */
export function motionAt(motion, t) {
  const wave = period => Math.sin(2 * Math.PI * t / period)
  switch (motion) {
    case 'float': return { dx: 0, dy: -2 * (1 - Math.cos(2 * Math.PI * t / 2400)), rotate: 0, scaleY: 1, origin: 'bottom' }
    case 'hop': { const p = t % 800 / 800; return { dx: 0, dy: p < 0.5 ? -12 * Math.sin(Math.PI * p / 0.5) : 0, rotate: 0, scaleY: 1, origin: 'bottom' } }
    case 'dangle': return { dx: 0, dy: 0, rotate: 6 * wave(1200), scaleY: 1, origin: 'top' }
    case 'breathe': return { dx: 0, dy: 0, rotate: 0, scaleY: 1 + 0.025 * wave(2600), origin: 'bottom' }
    case 'sway': return { dx: 0, dy: 0, rotate: 3 * wave(2000), scaleY: 1, origin: 'bottom' }
    case 'shake': return { dx: t < 1500 ? 3 * wave(120) : 0, dy: 0, rotate: 0, scaleY: 1, origin: 'bottom' }
    default: return STILL
  }
}
export const STILL = Object.freeze({ dx: 0, dy: 0, rotate: 0, scaleY: 1, origin: 'bottom' })
