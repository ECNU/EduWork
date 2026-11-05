import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createUpdateObserver, createProductUpdateObserver, watchUpdateDocument } from '../src/update-observer.mjs'

const snapshot = (state, update = {}) => ({ shell: 'electron', phase: state,
  update: { enabled: true, state, ...update }, contentUpdate: { enabled: true, state: 'current' } })

function fakeClock() {
  let now = 0, nextId = 1
  const tasks = new Map()
  const flush = async () => { for (let index = 0; index < 8; index++) await new Promise(resolve => setImmediate(resolve)) }
  return {
    setTimeout(callback, delay) { const id = nextId++; tasks.set(id, { at: now + Math.max(0, Number(delay) || 0), callback }); return id },
    clearTimeout(id) { tasks.delete(id) },
    async advance(delay) {
      const target = now + delay
      for (;;) {
        const [id, task] = [...tasks.entries()].filter(([, value]) => value.at <= target).sort((a, b) => a[1].at - b[1].at)[0] ?? []
        if (id === undefined) break
        tasks.delete(id)
        now = task.at
        task.callback()
        await flush()
      }
      now = target
      await flush()
    },
    get pending() { return tasks.size },
  }
}

test('subscription drives one poller, dedupes presentations and stops on unsubscribe', async () => {
  const clock = fakeClock()
  let reads = 0
  const observer = createUpdateObserver({ readStatus: async () => { reads++; return snapshot('checking') },
    setTimer: clock.setTimeout, clearTimer: clock.clearTimeout })
  const seen = []
  const off = observer.subscribe(value => seen.push(value))
  await clock.advance(0)
  assert.equal(reads, 1)
  assert.deepEqual(seen, [{ phase: 'checking' }])
  await clock.advance(350)
  assert.equal(reads, 2)
  assert.equal(seen.length, 1, 'unchanged checking state must not be re-published')
  off()
  assert.equal(clock.pending, 0)
  await clock.advance(10000)
  assert.equal(reads, 2)
  observer.dispose()
})

test('concurrent status requests coalesce into one raw read', async () => {
  const clock = fakeClock()
  let release, reads = 0
  const gate = new Promise(resolve => { release = resolve })
  const observer = createUpdateObserver({ readStatus: async () => { reads++; await gate; return snapshot('available', { latestVersion: '0.4.11' }) },
    setTimer: clock.setTimeout, clearTimer: clock.clearTimeout })
  const first = observer.status(), second = observer.status()
  await Promise.resolve()
  assert.equal(reads, 1)
  release()
  const [a, b] = await Promise.all([first, second])
  assert.deepEqual(a.update.state, 'available')
  assert.equal(b, a)
  observer.dispose()
})

test('product composition only reads the existing status action', async () => {
  const clock = fakeClock(), calls = []
  const coordinator = { action: async action => { calls.push(action); return snapshot('up_to_date') } }
  const observer = createProductUpdateObserver({ getCoordinator: () => coordinator,
    setTimer: clock.setTimeout, clearTimer: clock.clearTimeout })
  assert.deepEqual(await observer.presentation(), { phase: 'idle' })
  assert.deepEqual(calls, ['status'])
  observer.dispose()
})

test('a missing backend is idle rather than an error', async () => {
  const clock = fakeClock()
  const observer = createProductUpdateObserver({ getCoordinator: () => undefined,
    setTimer: clock.setTimeout, clearTimer: clock.clearTimeout })
  assert.deepEqual(await observer.presentation(), { phase: 'idle' })
  observer.dispose()
})

test('an action result recorded during an older read is not overwritten', async () => {
  const clock = fakeClock()
  let release, reads = 0
  const gate = new Promise(resolve => { release = resolve })
  const observer = createUpdateObserver({ readStatus: async () => {
    reads++
    if (reads === 1) { await gate; return snapshot('downloading', { downloadedBytes: 10, totalBytes: 100 }) }
    return snapshot('ready', { latestVersion: '0.4.11' })
  }, setTimer: clock.setTimeout, clearTimer: clock.clearTimeout })
  const seen = []
  observer.subscribe(value => seen.push(value))
  await clock.advance(0)
  observer.record(snapshot('ready', { latestVersion: '0.4.11' }))
  assert.deepEqual(seen.at(-1), { phase: 'ready', version: '0.4.11' })
  release()
  await clock.advance(1)
  assert.deepEqual(seen.at(-1), { phase: 'ready', version: '0.4.11' })
  assert.deepEqual((await observer.status()).update.state, 'ready')
  observer.dispose()
})

test('an initial status read failure stays on the official retry path and recovers', async () => {
  const clock = fakeClock(), diagnostics = []
  let failing = true
  const observer = createUpdateObserver({ readStatus: async () => {
    if (failing) throw Object.assign(new Error('private C:\\data\\update.json'), { code: 'EACCES' })
    return snapshot('checking')
  }, diagnose: message => diagnostics.push(message), setTimer: clock.setTimeout, clearTimer: clock.clearTimeout })
  const seen = []
  observer.subscribe(value => seen.push(value))
  await clock.advance(0)
  assert.deepEqual(seen, [], 'no invented failure copy may replace the official failed state')
  assert.equal(JSON.stringify(diagnostics).includes('private'), false)
  assert.doesNotMatch(diagnostics.join('\n'), /check/)
  await assert.rejects(observer.presentation(), error => error.message === '更新状态暂时不可用')
  await assert.rejects(observer.status(), error => error.message === '更新状态暂时不可用')
  failing = false
  await clock.advance(2500)
  assert.deepEqual(seen.at(-1), { phase: 'checking' })
  assert.deepEqual(await observer.presentation(), { phase: 'checking' })
  assert.equal((await observer.status()).update.state, 'checking')
  observer.dispose()
})

test('a later status read failure clears a stale software presentation', async () => {
  const clock = fakeClock()
  let failing = false
  const observer = createUpdateObserver({ readStatus: async () => {
    if (failing) throw Object.assign(new Error('synthetic offline'), { code: 'ENETUNREACH' })
    return snapshot('checking')
  }, setTimer: clock.setTimeout, clearTimer: clock.clearTimeout })
  const seen = []
  observer.subscribe(value => seen.push(value))
  await clock.advance(0)
  assert.deepEqual(seen, [{ phase: 'checking' }])
  failing = true
  await clock.advance(350)
  assert.deepEqual(seen, [{ phase: 'checking' }, { phase: 'idle' }])
  await assert.rejects(observer.status(), /更新状态暂时不可用/)
  await assert.rejects(observer.presentation(), /更新状态暂时不可用/)
  failing = false
  await clock.advance(350)
  assert.deepEqual(seen.at(-1), { phase: 'checking' })
  observer.dispose()
})

test('a new document receives recovery after its first read fails', async () => {
  const clock = fakeClock()
  let failing = false
  const observer = createUpdateObserver({ readStatus: async () => {
    if (failing) throw Object.assign(new Error('synthetic reload read failure'), { code: 'ENETUNREACH' })
    return snapshot('up_to_date')
  }, setTimer: clock.setTimeout, clearTimer: clock.clearTimeout })
  const oldSeen = []
  const offOld = observer.subscribe(value => oldSeen.push(value))
  await clock.advance(0)
  assert.deepEqual(oldSeen, [{ phase: 'idle' }])
  offOld()
  const newSeen = []
  observer.subscribe(value => newSeen.push(value))
  failing = true
  await assert.rejects(observer.presentation(true), /更新状态暂时不可用/)
  failing = false
  await clock.advance(0)
  assert.deepEqual(newSeen, [{ phase: 'idle' }], 'recovery must not be deduped against the previous document')
  observer.dispose()
})

test('a new document first read failure is not masked by the previous visible state', async () => {
  const clock = fakeClock()
  let reads = 0
  const observer = createUpdateObserver({ readStatus: async () => {
    reads++
    if (reads === 1) return snapshot('ready', { latestVersion: '0.4.11' })
    if (reads === 2) return snapshot('cancelled')
    return snapshot('up_to_date')
  }, setTimer: clock.setTimeout, clearTimer: clock.clearTimeout })
  const oldSeen = []
  const offOld = observer.subscribe(value => oldSeen.push(value))
  await clock.advance(0)
  assert.deepEqual(oldSeen, [{ phase: 'ready', version: '0.4.11' }])
  offOld()
  const newSeen = []
  observer.subscribe(value => newSeen.push(value))
  await assert.rejects(observer.presentation(true), /更新状态暂时不可用/)
  assert.deepEqual(newSeen, [], 'the old document visible state must not clear a new document')
  await clock.advance(0)
  assert.deepEqual(newSeen, [{ phase: 'idle' }])
  observer.dispose()
})

test('an unrecognized state is unreadable without blocking the raw status', async () => {
  const clock = fakeClock(), diagnostics = []
  const raw = { ...snapshot('cancelled'), contentUpdate: { enabled: true, state: 'ready' } }
  const observer = createUpdateObserver({ readStatus: async () => raw,
    diagnose: message => diagnostics.push(message), setTimer: clock.setTimeout, clearTimer: clock.clearTimeout })
  const seen = []
  observer.subscribe(value => seen.push(value))
  await clock.advance(0)
  assert.deepEqual(seen, [])
  assert.match(diagnostics.join('\n'), /unrecognized/)
  assert.equal(await observer.status(), raw)
  assert.equal((await observer.status()).contentUpdate.state, 'ready')
  await assert.rejects(observer.presentation(), /更新状态暂时不可用/)
  observer.dispose()
})

test('an unrecognized state after a visible presentation clears the software indicator', async () => {
  const clock = fakeClock()
  let state = 'checking'
  const observer = createUpdateObserver({ readStatus: async () => snapshot(state),
    setTimer: clock.setTimeout, clearTimer: clock.clearTimeout })
  const seen = []
  observer.subscribe(value => seen.push(value))
  await clock.advance(0)
  assert.deepEqual(seen, [{ phase: 'checking' }])
  state = 'cancelled'
  await clock.advance(350)
  assert.deepEqual(seen, [{ phase: 'checking' }, { phase: 'idle' }])
  assert.equal((await observer.status()).update.state, 'cancelled')
  observer.dispose()
})

test('dispose stops timers and ignores a late read or action result', async () => {
  const clock = fakeClock()
  let release, reads = 0
  const gate = new Promise(resolve => { release = resolve })
  const observer = createUpdateObserver({ readStatus: async () => { reads++; await gate; return snapshot('checking') },
    setTimer: clock.setTimeout, clearTimer: clock.clearTimeout })
  const seen = []
  observer.subscribe(value => seen.push(value))
  await clock.advance(0)
  observer.dispose()
  release()
  await clock.advance(1)
  assert.equal(reads, 1)
  assert.deepEqual(seen, [])
  assert.equal(clock.pending, 0)
  observer.record(snapshot('ready'))
  await assert.rejects(observer.presentation(), /更新状态暂时不可用/)
})

test('polling follows busy and idle cadence', async () => {
  const clock = fakeClock()
  let state = 'up_to_date', reads = 0
  const observer = createUpdateObserver({ readStatus: async () => { reads++; return snapshot(state) },
    setTimer: clock.setTimeout, clearTimer: clock.clearTimeout })
  observer.subscribe(() => {})
  await clock.advance(0)
  assert.equal(reads, 1)
  await clock.advance(2499)
  assert.equal(reads, 1, 'idle cadence is 2500ms')
  await clock.advance(1)
  assert.equal(reads, 2)
  state = 'downloading'
  await clock.advance(2500)
  assert.equal(reads, 3)
  await clock.advance(350)
  assert.equal(reads, 4, 'busy cadence is 350ms')
  state = 'up_to_date'
  await clock.advance(350)
  assert.equal(reads, 5)
  await clock.advance(2500)
  assert.equal(reads, 6, 'idle cadence resumes after the busy state')
  observer.dispose()
})

test('a slow read cannot overlap another poll', async () => {
  const clock = fakeClock()
  let reads = 0, release
  const observer = createUpdateObserver({ readStatus: async () => {
    reads++
    if (reads === 2) await new Promise(resolve => { release = resolve })
    return snapshot('checking')
  }, setTimer: clock.setTimeout, clearTimer: clock.clearTimeout })
  observer.subscribe(() => {})
  await clock.advance(0)
  assert.equal(reads, 1)
  await clock.advance(350)
  assert.equal(reads, 2)
  assert.equal(clock.pending, 0, 'no timer is armed while the read is outstanding')
  await clock.advance(5000)
  assert.equal(reads, 2)
  release()
  await clock.advance(0)
  assert.ok(clock.pending > 0, 'the next poll is armed only after the slow read settles')
  observer.dispose()
})

test('an active official listener makes status reuse the shared snapshot', async () => {
  const clock = fakeClock()
  let reads = 0
  const observer = createUpdateObserver({ readStatus: async () => { reads++; return snapshot('checking') },
    setTimer: clock.setTimeout, clearTimer: clock.clearTimeout })
  observer.subscribe(() => {})
  await clock.advance(0)
  assert.equal(reads, 1)
  await observer.status()
  await observer.status()
  assert.equal(reads, 1)
  observer.dispose()
})

test('fresh requests wait for an in-flight read and share one serial refresh', async () => {
  const clock = fakeClock()
  let releaseFirst, releaseSecond, reads = 0
  const first = new Promise(resolve => { releaseFirst = resolve })
  const second = new Promise(resolve => { releaseSecond = resolve })
  const observer = createUpdateObserver({ readStatus: async () => {
    reads++
    if (reads === 1) { await first; return snapshot('downloading', { downloadedBytes: 10, totalBytes: 100 }) }
    if (reads === 2) { await second; return snapshot('available', { latestVersion: '0.4.11' }) }
    return snapshot('checking')
  }, setTimer: clock.setTimeout, clearTimer: clock.clearTimeout })
  const seen = []
  observer.subscribe(value => seen.push(value))
  await clock.advance(0)
  assert.equal(reads, 1)
  const a = observer.presentation(true), b = observer.presentation(true)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(reads, 1, 'fresh requests must not bypass the in-flight read')
  releaseFirst()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(reads, 2, 'exactly one serial refresh is appended')
  const c = observer.presentation(true)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(reads, 2, 'fresh requests during the refresh share it')
  releaseSecond()
  const results = await Promise.all([a, b, c])
  for (const result of results) assert.deepEqual(result, { phase: 'available', version: '0.4.11' })
  assert.equal(reads, 2)
  assert.deepEqual(seen.at(-1), { phase: 'available', version: '0.4.11' })
  observer.dispose()
})

test('a stale cached status is not served while a slow read is outstanding', async () => {
  const clock = fakeClock()
  let nowValue = 0, reads = 0, releaseSecond
  const second = new Promise(resolve => { releaseSecond = resolve })
  const observer = createUpdateObserver({ readStatus: async () => {
    reads++
    if (reads === 1) return snapshot('checking')
    await second
    return snapshot('available', { latestVersion: '0.4.11' })
  }, now: () => nowValue, staleAfter: 5000,
  setTimer: clock.setTimeout, clearTimer: clock.clearTimeout })
  observer.subscribe(() => {})
  await clock.advance(0)
  assert.equal(reads, 1)
  nowValue = 6000
  const status = observer.status()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(reads, 2, 'a stale cache cannot be served while the read is outstanding')
  releaseSecond()
  assert.equal((await status).update.state, 'available')
  observer.dispose()
})

test('a fresh presentation request reads current state even when a cache exists', async () => {
  const clock = fakeClock()
  let reads = 0, state = 'up_to_date'
  const observer = createUpdateObserver({ readStatus: async () => { reads++; return snapshot(state) },
    setTimer: clock.setTimeout, clearTimer: clock.clearTimeout })
  observer.subscribe(() => {})
  await clock.advance(0)
  assert.equal(reads, 1)
  state = 'available'
  assert.deepEqual(await observer.presentation(true), { phase: 'available' })
  assert.equal(reads, 2, 'a reloaded renderer must receive a fresh read')
  assert.deepEqual(await observer.presentation(), { phase: 'available' })
  assert.equal(reads, 2)
  observer.dispose()
})

test('document binding rebinds only after a main-frame navigation', () => {
  const window = new EventEmitter(), webContents = new EventEmitter()
  window.webContents = webContents
  window.isDestroyed = () => false
  const sent = [], listeners = [], released = []
  const updates = { subscribe(listener) {
    listeners.push(listener)
    return () => { released.push(listener) }
  } }
  const binding = watchUpdateDocument({ window, updates, getWindow: () => window, send: value => sent.push(value) })
  binding.bind()
  assert.equal(listeners.length, 1)
  listeners[0]({ phase: 'ready', version: '0.4.11' })
  webContents.emit('did-start-navigation', {}, 'dsh-app://app/', true, true)
  webContents.emit('did-start-navigation', {}, 'dsh-app://app/', false, false)
  assert.equal(released.length, 0, 'same-document and subframe navigation keep the document')
  webContents.emit('did-start-navigation', {}, 'dsh-app://app/', false, true)
  assert.equal(released.length, 1, 'main-frame navigation releases the old document')
  binding.bind()
  assert.equal(listeners.length, 2, 'the next status binds a fresh document listener')
  listeners[1]({ phase: 'idle' })
  assert.deepEqual(sent, [{ phase: 'ready', version: '0.4.11' }, { phase: 'idle' }])
  binding.dispose()
  assert.equal(released.length, 2)
})

test('document binding does not send to a stale or destroyed window', () => {
  const window = new EventEmitter(), webContents = new EventEmitter(), other = new EventEmitter()
  window.webContents = webContents
  let current = window, destroyed = false
  window.isDestroyed = () => destroyed
  const sent = [], listeners = []
  const updates = { subscribe(listener) { listeners.push(listener); return () => {} } }
  const binding = watchUpdateDocument({ window, updates, getWindow: () => current, send: value => sent.push(value) })
  binding.bind()
  current = other
  listeners[0]({ phase: 'ready' })
  current = window
  destroyed = true
  listeners[0]({ phase: 'ready' })
  assert.deepEqual(sent, [])
  binding.dispose()
})

// Mirrors the locked DesktopUpdateSource: any event sets received; a rejected
// status only sets failed when no event has been received yet.
function officialUpdateSource(observer) {
  let received = false, failed = false, presentation, live = true
  const off = observer.subscribe(value => {
    if (!live) return
    received = true
    failed = false
    presentation = value
  })
  return {
    status() {
      return observer.presentation(true).then(value => {
        if (live && !received) presentation = value
      }, () => {
        if (live && !received) failed = true
      })
    },
    snapshot() { return { received, failed, presentation } },
    dispose() { live = false; off() },
  }
}

test('an old in-flight read cannot mask the new document first-read failure', async () => {
  const clock = fakeClock()
  let releaseOld, reads = 0, freshFailing = false
  const oldGate = new Promise(resolve => { releaseOld = resolve })
  const observer = createUpdateObserver({ readStatus: async () => {
    reads++
    if (reads === 1) { await oldGate; return snapshot('up_to_date') }
    if (freshFailing) throw Object.assign(new Error('synthetic fresh read failure'), { code: 'ENETUNREACH' })
    return snapshot('up_to_date')
  }, setTimer: clock.setTimeout, clearTimer: clock.clearTimeout })
  const oldSource = officialUpdateSource(observer)
  const oldStatus = oldSource.status()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(reads, 1)
  oldSource.dispose()
  const newSource = officialUpdateSource(observer)
  freshFailing = true
  const newStatus = newSource.status()
  releaseOld()
  await newStatus
  await oldStatus
  assert.deepEqual(newSource.snapshot(), { received: false, failed: true, presentation: undefined },
    'the pre-navigation idle must not count as an event for the new source')
  freshFailing = false
  await clock.advance(0)
  assert.deepEqual(newSource.snapshot(), { received: true, failed: false, presentation: { phase: 'idle' } })
  newSource.dispose()
  observer.dispose()
})
