import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import { watchHungWindow } from '../src/hung-window.mjs'

function fixture(answers) {
  const window = new EventEmitter(), calls = [], logs = [], timers = []
  window.isDestroyed = () => false
  window.webContents = Object.assign(new EventEmitter(), { getOSProcessId: () => 42, reload: () => calls.push('reload'),
    forcefullyCrashRenderer: () => { calls.push('crash'); window.webContents.emit('render-process-gone', {}, { reason: 'killed' }) } })
  const hang = watchHungWindow({ window, log: line => logs.push(line), graceMs: 30_000,
    ask: async () => { calls.push('ask'); return answers.shift() },
    metrics: () => [{ pid: 42, memory: { workingSetSize: 2048 * 1024, peakWorkingSetSize: 3072 * 1024, privateBytes: 1900 * 1024 } }, { pid: 7, memory: { workingSetSize: 512 * 1024 } }],
    systemMemory: () => ({ total: 16384 * 1024, free: 300 * 1024 }),
    setTimer: callback => { timers.push(callback); return timers.length }, clearTimer: id => { timers[id - 1] = null } })
  const fire = async () => { const callback = timers.find(Boolean); timers.fill(null); await callback?.(); await new Promise(r => setImmediate(r)) }
  return { window, calls, logs, timers, hang, fire }
}

test('a page stuck past the grace period logs memory and reloads on request', async () => {
  const f = fixture([true])
  f.window.emit('unresponsive')
  await f.fire()
  assert.match(f.logs.join('\n'), /still unresponsive after 30s: page 2048MB \(peak 3072MB, private 1900MB\), all processes 2560MB, system free 300MB of 16384MB/)
  assert.deepEqual(f.calls, ['ask', 'crash', 'reload'])
  // The renderer exit caused by the reload is not reported as a failure, once.
  assert.equal(f.hang.ownExit(), true)
  assert.equal(f.hang.ownExit(), false)
})

test('recovering in time asks nothing; waiting asks again while still stuck', async () => {
  const quick = fixture([])
  quick.window.emit('unresponsive')
  quick.window.emit('responsive')
  assert.deepEqual(quick.timers.filter(Boolean), [])
  const slow = fixture([false, true])
  slow.window.emit('unresponsive')
  await slow.fire()
  assert.deepEqual(slow.calls, ['ask'])
  await slow.fire()
  assert.deepEqual(slow.calls, ['ask', 'ask', 'crash', 'reload'])
})
