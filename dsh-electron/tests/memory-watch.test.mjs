import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import { watchMemory } from '../src/memory-watch.mjs'

const MB = 1024

function fixture(readings) {
  const window = new EventEmitter(), logs = []
  let tick, cleared = false, clock = 0
  window.isDestroyed = () => false
  window.webContents = { getOSProcessId: () => 42 }
  let current = readings.shift()
  const watch = watchMemory({ window, log: line => logs.push(line), keep: 3,
    metrics: () => [{ pid: 42, memory: { workingSetSize: current.page * MB } }, { pid: 7, memory: { workingSetSize: 100 * MB } }],
    systemMemory: () => ({ total: 8192 * MB, free: current.free * MB }),
    now: () => clock,
    setTimer: callback => { tick = callback; return 1 }, clearTimer: () => { cleared = true } })
  const next = () => { current = readings.shift(); clock += 15_000; tick() }
  return { window, logs, watch, next, cleared: () => cleared }
}

test('threshold crossings are logged once each and the history is written on exit', () => {
  const f = fixture([{ page: 300, free: 3000 }, { page: 1600, free: 2000 }, { page: 1800, free: 400 }, { page: 1900, free: 300 }])
  f.next(); f.next(); f.next()
  assert.deepEqual(f.logs, [
    '[desktop:memory] Desktop page uses 1600MB (all processes 1700MB, system free 2000MB of 8192MB)',
    '[desktop:memory] System memory low: free 400MB of 8192MB (page 1800MB, all processes 1900MB)',
  ])
  f.watch.dump('the page exited (oom)')
  // Only the last three samples are kept, oldest first.
  assert.equal(f.logs[2], '[desktop:memory] Memory before the page exited (oom) (seconds ago: page / all processes / system free of total):\n'
    + '  -30s 1600MB / 1700MB / 2000MB of 8192MB\n  -15s 1800MB / 1900MB / 400MB of 8192MB\n  -0s 1900MB / 2000MB / 300MB of 8192MB')
  f.window.emit('closed')
  assert.equal(f.cleared(), true)
})

test('a page that drops below the threshold warns again when it grows back', () => {
  const f = fixture([{ page: 1600, free: 3000 }, { page: 800, free: 3000 }, { page: 1700, free: 3000 }])
  f.next(); f.next()
  assert.equal(f.logs.filter(line => line.includes('Desktop page uses')).length, 2)
})

test('failing metrics never throw', () => {
  const window = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents: { getOSProcessId: () => { throw new Error('gone') } } })
  const watch = watchMemory({ window, log: () => assert.fail('nothing to log'), metrics: () => [], systemMemory: () => ({}),
    setTimer: () => 1, clearTimer: () => {} })
  watch.dump('the page exited (crashed)')
})
