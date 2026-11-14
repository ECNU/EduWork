import assert from 'node:assert/strict'
import { test } from 'node:test'
import { forkBoundary } from '../src/client/fork-boundary.js'

const turn = (n, first) => [
  { seq: first, type: 'turn/start' },
  { seq: first + 1, type: 'user/message', surfaceOp: 'append' },
  { seq: first + 2, type: 'assistant/message' },
  { seq: first + 3, type: 'turn/end' },
]

test('cuts after the previous Turn and the standalone events that follow it', () => {
  const events = [...turn(1, 0), { seq: 4, type: 'session/title' }, ...turn(2, 5)]
  assert.equal(forkBoundary(events, 5), 4)
})

test('the first Turn cuts before everything after the Session header', () => {
  assert.equal(forkBoundary([{ seq: 0, type: 'session/title' }, ...turn(1, 1)], 1), 0)
  assert.equal(forkBoundary(turn(1, 0), 0), -1)
})

test('input queued while the previous Turn ran stays out of the branch', () => {
  const events = [...turn(1, 0), { seq: 4, type: 'agent/inbox/spliced' }, { seq: 5, type: 'user/message', surfaceOp: 'append' }, ...turn(2, 6)]
  assert.equal(forkBoundary(events, 6), 3)
  // A queued entry recorded inside the previous Turn is cut with it.
  const queuedEarly = [{ seq: 0, type: 'turn/start' }, { seq: 1, type: 'agent/inbox/queued' }, { seq: 2, type: 'turn/end' }, ...turn(2, 3)]
  assert.equal(forkBoundary(queuedEarly, 3), 2)
})
