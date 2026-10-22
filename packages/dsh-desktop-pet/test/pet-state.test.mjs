import test from 'node:test'
import assert from 'node:assert/strict'
import { PACE, animationLength, badgeText, between, deriveStatus, frameAt, motionAt, pick } from '../lib/pet-state.js'

const item = (key, kind, createdAt = 1) => ({ key, kind, createdAt, title: '' })
const frames = (...ms) => ms.map((value, i) => ({ file: `${i}.svg`, ms: value }))

test('status priority: attention, failed, done, working, idle; clicks open the newest item', () => {
  const items = [item('done-old', 'completed', 1), { ...item('plugin', 'plugin', 3), level: 'success', requiresAction: false }, item('bad', 'failed', 2), item('ask', 'approval', 1), item('question', 'question', 4)]
  assert.deepEqual(deriveStatus(items, 2), { state: 'attention', target: items[4], count: 2 })
  assert.deepEqual(deriveStatus(items.slice(0, 3), 2), { state: 'failed', target: items[2], count: 1 })
  assert.deepEqual(deriveStatus(items.slice(0, 2), 2), { state: 'done', target: items[1], count: 2 })
  assert.deepEqual(deriveStatus([], 2), { state: 'working', target: null, count: 2 })
  assert.deepEqual(deriveStatus([], 0), { state: 'idle', target: null, count: 0 })
})

test('badges: ? for attention, ! for failed, count for several results', () => {
  assert.equal(badgeText(deriveStatus([item('a', 'question')], 0)), '?')
  assert.equal(badgeText(deriveStatus([item('a', 'failed')], 0)), '!')
  assert.equal(badgeText(deriveStatus([item('a', 'completed')], 0)), '!')
  assert.equal(badgeText(deriveStatus([item('a', 'completed'), { ...item('b', 'plugin'), level: 'success', requiresAction: false }], 0)), '2')
  assert.equal(badgeText(deriveStatus([], 3)), '')
})

test('frame timing for loop, once, ping-pong and finite repeats', () => {
  const loop = { frames: frames(100, 200), playback: 'loop' }
  assert.deepEqual(frameAt(loop, 0), { index: 0, next: 100, finished: false })
  assert.deepEqual(frameAt(loop, 150), { index: 1, next: 150, finished: false })
  assert.deepEqual(frameAt(loop, 310), { index: 0, next: 90, finished: false })
  assert.equal(animationLength(loop), Infinity)
  const once = { frames: frames(140, 260, 700), playback: 'once' }
  assert.equal(animationLength(once), 1100)
  assert.deepEqual(frameAt(once, 500), { index: 2, next: 600, finished: false })
  assert.deepEqual(frameAt(once, 5000), { index: 2, next: Infinity, finished: true })
  const pingpong = { frames: frames(10, 10, 10), playback: 'pingpong', repeat: 2 }
  assert.deepEqual([0, 10, 20, 30, 40].map(t => frameAt(pingpong, t).index), [0, 1, 2, 1, 0])
  assert.equal(animationLength(pingpong), 80)
  assert.equal(frameAt(pingpong, 80).finished, true)
  assert.deepEqual(frameAt({ frames: frames(125), playback: 'loop' }, 9000), { index: 0, next: Infinity, finished: false })
})

test('pacing is drawn from the configured ranges with injected randomness', () => {
  assert.equal(between(PACE.workGap, () => 0), 12_000)
  assert.equal(between(PACE.workGap, () => 1), 30_000)
  assert.equal(between(PACE.workLength, () => 0.5), 4_250)
  assert.equal(pick(['a', 'b'], () => 0.99), 'b')
  assert.equal(pick(['a', 'b'], () => 1), 'b')
})

test('motions stay small and return to rest', () => {
  for (const motion of ['float', 'hop', 'dangle', 'breathe', 'sway', 'shake']) {
    for (let t = 0; t < 5000; t += 37) {
      const value = motionAt(motion, t)
      assert.ok(Math.abs(value.dx) <= 3 && Math.abs(value.dy) <= 12 && Math.abs(value.rotate) <= 6 && Math.abs(value.scaleY - 1) <= 0.03, `${motion} ${t}`)
    }
  }
  assert.equal(Math.abs(motionAt('float', 0).dy), 0)
  assert.equal(motionAt('dangle', 0).origin, 'top')
  assert.equal(motionAt('shake', 2000).dx, 0)
})
