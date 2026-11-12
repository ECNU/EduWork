import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createSoftwareUpdateScheduler } from '../src/software-update-scheduler.mjs'

function fixture(t, overrides = {}) {
  let time = 0, connected = true, exiting = false, sequence = 0
  const timers = new Map(), checks = [], powerMonitor = new EventEmitter()
  const update = { enabled: true, userEnabled: true, canToggle: true, state: 'up_to_date', policy: 'stable' }
  const status = () => ({ update: { ...update } })
  const scheduler = createSoftwareUpdateScheduler({
    now: () => time, online: () => connected, quitting: () => exiting, powerMonitor,
    interval: 1000, pollInterval: 10, busyInterval: 1, minimumGap: 10, retryDelays: [20, 40, 80],
    setTimer(fn, delay) { const id = ++sequence; timers.set(id, { fn, at: time + delay }); return id },
    clearTimer: id => timers.delete(id), readStatus: async () => status(),
    check: async guard => {
      if (!guard()) return { started: false, status: status() }
      checks.push({ time, policy: update.policy })
      return { started: true, status: status() }
    }, ...overrides,
  })
  t.after(() => scheduler.close())
  return { scheduler, update, status, checks, timers, powerMonitor,
    set time(value) { time = value }, set online(value) { connected = value }, set quitting(value) { exiting = value },
    async at(value) { time = value; await scheduler.wake() },
  }
}

test('one timer checks at the interval with no window or renderer, and repeated starts are idempotent', async t => {
  const f = fixture(t)
  f.scheduler.start(); f.scheduler.start()
  await f.scheduler.wake()
  assert.equal(f.powerMonitor.listenerCount('resume'), 1)
  await f.at(999); assert.equal(f.checks.length, 0)
  f.time = 1000
  const [id, task] = [...f.timers][0]; f.timers.delete(id); task.fn()
  await f.scheduler.wake()
  assert.equal(f.checks.length, 1)
  await f.at(1999); assert.equal(f.checks.length, 1)
  await f.at(2000); assert.equal(f.checks.length, 2)
  assert.equal(f.timers.size, 1)
})

test('resume and network recovery coalesce; a fresh check is not repeated', async t => {
  const f = fixture(t)
  f.scheduler.start(); await f.scheduler.wake()
  f.online = false; await f.at(1500); assert.equal(f.checks.length, 0)
  f.online = true; f.time = 1501
  for (let i = 0; i < 10; i++) f.powerMonitor.emit('resume')
  await Promise.all([f.scheduler.wake(), f.scheduler.wake()])
  assert.equal(f.checks.length, 1)
  f.powerMonitor.emit('resume'); await f.scheduler.wake()
  assert.equal(f.checks.length, 1)
})

test('opt-out cancels the timer, re-enable resumes it, and manual checks reset the interval', async t => {
  const f = fixture(t)
  f.scheduler.start(); await f.scheduler.wake()
  f.update.userEnabled = false; f.update.enabled = false
  f.scheduler.record('disable-software-updates', f.status())
  assert.equal(f.timers.size, 0)
  await f.at(5000); assert.equal(f.checks.length, 0)
  f.update.userEnabled = true; f.update.enabled = true
  f.scheduler.record('enable-software-updates', f.status())
  await f.at(5001); assert.equal(f.checks.length, 1)
  f.time = 5500; f.scheduler.record('check-updates', f.status())
  await f.at(6001); assert.equal(f.checks.length, 1)
  await f.at(6500); assert.equal(f.checks.length, 2)
})

test('changing channel checks the new channel without resetting the user preference', async t => {
  const f = fixture(t)
  f.scheduler.start(); await f.scheduler.wake()
  f.update.policy = 'development'
  f.scheduler.record('use-development-updates', f.status())
  await f.at(100)
  assert.deepEqual(f.checks, [{ time: 100, policy: 'development' }])
})

for (const blocked of [{ busy: true }, { installOnQuit: true }, { installOnNextStart: true },
  ...['checking', 'downloading', 'ready', 'applying', 'unrecognized'].map(state => ({ state })),
  { state: 'error', failedOperation: 'download' }, { state: 'error', failedOperation: 'install' }]) {
  test('automatic check preserves an active or pending update: ' + JSON.stringify(blocked), async t => {
    const f = fixture(t)
    Object.assign(f.update, blocked)
    f.scheduler.start(); await f.at(2000)
    assert.equal(f.checks.length, 0)
  })
}

test('asynchronous backend failures use bounded retries; successful completion restores four-hour cadence', async t => {
  const f = fixture(t)
  f.scheduler.start(); await f.scheduler.wake()
  // Simulate a manual command accepted before its network request fails.
  f.update.state = 'checking'; f.update.busy = true
  f.scheduler.record('check-updates', f.status())
  f.update.state = 'error'; f.update.busy = false; f.update.failedOperation = 'check'
  await f.at(1)
  await f.at(20); assert.equal(f.checks.length, 0)
  await f.at(21); assert.equal(f.checks.length, 1)
  await f.at(60); assert.equal(f.checks.length, 1)
  await f.at(61); assert.equal(f.checks.length, 2)
  await f.at(141); assert.equal(f.checks.length, 3)
  await f.at(1140); assert.equal(f.checks.length, 3)
  f.update.state = 'up_to_date'
  await f.at(1141); assert.equal(f.checks.length, 4)
  await f.at(2140); assert.equal(f.checks.length, 4)
  await f.at(2141); assert.equal(f.checks.length, 5)
})

test('an in-flight native check is not success; error observed later triggers retry', async t => {
  let calls = 0, update
  const f = fixture(t, { check: async () => { calls++; update.state = 'checking'; update.busy = true; return { started: true, status: { update: { ...update } } } } })
  update = f.update
  f.scheduler.start(); await f.at(1000)
  await f.at(2000); assert.equal(calls, 1)
  update.state = 'error'; update.busy = false
  await f.at(2001); await f.at(2020); assert.equal(calls, 1)
  await f.at(2021); assert.equal(calls, 2)
})

test('a queued automatic check yields to a manual action that arrived meanwhile', async t => {
  let release, enter, admitted = false
  const entered = new Promise(resolve => { enter = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const f = fixture(t, { check: async guard => { enter(); await gate; admitted = guard(); return { started: admitted, status: f.status() } } })
  f.scheduler.start(); await f.scheduler.wake()
  f.time = 1000; const pending = f.scheduler.wake(); await entered
  f.scheduler.record('check-updates', f.status())
  release(); await pending
  assert.equal(admitted, false)
})

test('exit suppresses requests and close removes timers and resume listener', async t => {
  const f = fixture(t)
  f.scheduler.start(); await f.scheduler.wake()
  f.quitting = true; await f.at(2000); assert.equal(f.checks.length, 0)
  await f.scheduler.close()
  assert.equal(f.timers.size, 0); assert.equal(f.powerMonitor.listenerCount('resume'), 0)
  f.quitting = false; await f.at(3000); assert.equal(f.checks.length, 0)
})

test('production default waits four hours and does not require a renderer timer', async t => {
  const f = fixture(t, { interval: undefined })
  f.scheduler.start(); await f.scheduler.wake()
  await f.at(4 * 60 * 60 * 1000 - 1); assert.equal(f.checks.length, 0)
  await f.at(4 * 60 * 60 * 1000); assert.equal(f.checks.length, 1)
})

test('late status cannot resurrect a disabled scheduler', async t => {
  let release
  const read = new Promise(resolve => { release = resolve })
  const f = fixture(t, { readStatus: () => read })
  f.scheduler.start()
  const pending = f.scheduler.wake()
  f.update.userEnabled = false; f.update.enabled = false
  f.scheduler.record('disable-software-updates', f.status())
  release({ update: { enabled: true, userEnabled: true, state: 'up_to_date', policy: 'stable' } })
  await pending
  assert.equal(f.timers.size, 0); assert.equal(f.checks.length, 0)
})

test('reconnection may retry a failed check early but flapping never bypasses the minimum gap', async t => {
  const f = fixture(t)
  f.scheduler.start(); await f.scheduler.wake()
  f.scheduler.checkFailed()
  f.online = false; await f.at(1)
  f.online = true; await f.at(2); assert.equal(f.checks.length, 0)
  f.online = false; await f.at(9)
  f.online = true; await f.at(10); assert.equal(f.checks.length, 1)
  f.online = false; await f.at(11)
  f.online = true; await f.at(12); assert.equal(f.checks.length, 1)
})
