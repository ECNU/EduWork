import test from 'node:test'
import assert from 'node:assert/strict'
import { bindSettingsOpenAction, openSettingsWhenSettled } from '../src/client/desktop-actions.ts'
import { settingsFixture } from './settings-fixture.mjs'

function sessionFixture(initial = 'pending') {
  let snapshot = { ids: [], byId: {}, phase: initial, projectionsBySession: {} }
  const listeners = new Set()
  const notify = () => { for (const listener of [...listeners]) listener() }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    ready() {
      snapshot = { ...snapshot, phase: 'ready' }
      notify()
    },
  }
}

function frameFixture() {
  const callbacks = []
  return {
    frame: callback => { callbacks.push(callback) },
    run() { callbacks.splice(0).forEach(callback => callback()) },
  }
}

function timerFixture() {
  let callback
  let now = 0
  let deadline
  return {
    setTimer(next, ms) {
      callback = next
      deadline = now + ms
      return 1
    },
    clearTimer() { callback = undefined },
    fire() { callback?.() },
    advance(ms) {
      now += ms
      if (callback && now >= deadline) {
        const run = callback
        callback = undefined
        run()
      }
    },
  }
}

test('a ready shell opens settings after the next frame', () => {
  let opened = 0
  const frames = frameFixture()
  const dispose = openSettingsWhenSettled({
    open: () => { opened += 1 },
    sessions: sessionFixture('ready'),
    isOnboardingVisible: () => false,
    frame: frames.frame,
  })
  assert.equal(opened, 0)
  frames.run()
  assert.equal(opened, 1)
  dispose()
})

test('a loading shell waits for sessions readiness before opening', () => {
  let opened = 0
  const sessions = sessionFixture()
  const frames = frameFixture()
  openSettingsWhenSettled({
    open: () => { opened += 1 },
    sessions,
    isOnboardingVisible: () => false,
    frame: frames.frame,
  })
  assert.equal(opened, 0)
  sessions.ready()
  assert.equal(opened, 0)
  frames.run()
  assert.equal(opened, 1)
})

test('a visible onboarding surface takes precedence over the tray request', () => {
  let opened = 0
  const frames = frameFixture()
  openSettingsWhenSettled({
    open: () => { opened += 1 },
    sessions: sessionFixture('ready'),
    isOnboardingVisible: () => true,
    frame: frames.frame,
  })
  frames.run()
  assert.equal(opened, 0)
})

test('a tray request queued behind onboarding opens after the onboarding surface disappears', () => {
  let opened = 0
  let visible = true
  let finishOnboarding
  const frames = frameFixture()
  openSettingsWhenSettled({
    open: () => { opened += 1 },
    sessions: sessionFixture('ready'),
    isOnboardingVisible: () => visible,
    frame: frames.frame,
    watchOnboardingEnd: callback => {
      finishOnboarding = callback
      return () => {}
    },
  })
  frames.run()
  assert.equal(opened, 0)
  visible = false
  finishOnboarding()
  assert.equal(opened, 1)
})

test('disposing cancels a queued onboarding wait', () => {
  let opened = 0
  let finishOnboarding
  const frames = frameFixture()
  const dispose = openSettingsWhenSettled({
    open: () => { opened += 1 },
    sessions: sessionFixture('ready'),
    isOnboardingVisible: () => true,
    frame: frames.frame,
    watchOnboardingEnd: callback => {
      finishOnboarding = callback
      return () => {}
    },
  })
  frames.run()
  dispose()
  finishOnboarding()
  assert.equal(opened, 0)
})

test('a session list that never becomes ready opens at the fallback deadline', () => {
  let opened = 0
  const timers = timerFixture()
  const frames = frameFixture()
  openSettingsWhenSettled({
    open: () => { opened += 1 },
    sessions: sessionFixture(),
    isOnboardingVisible: () => false,
    frame: frames.frame,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    onFallback: () => {},
  })
  assert.equal(opened, 0)
  timers.fire()
  frames.run()
  assert.equal(opened, 1)
})

test('a session fallback still waits for a visible onboarding surface', () => {
  let opened = 0
  let visible = true
  let finishOnboarding
  const timers = timerFixture()
  const frames = frameFixture()
  openSettingsWhenSettled({
    open: () => { opened += 1 },
    sessions: sessionFixture(),
    isOnboardingVisible: () => visible,
    frame: frames.frame,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    watchOnboardingEnd: callback => {
      finishOnboarding = callback
      return () => {}
    },
    onFallback: () => {},
  })
  timers.fire()
  frames.run()
  assert.equal(opened, 0)
  visible = false
  finishOnboarding()
  assert.equal(opened, 1)
})

test('disposing cancels the fallback deadline', () => {
  let opened = 0
  const timers = timerFixture()
  const frames = frameFixture()
  const dispose = openSettingsWhenSettled({
    open: () => { opened += 1 },
    sessions: sessionFixture(),
    isOnboardingVisible: () => false,
    frame: frames.frame,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    onFallback: () => {},
  })
  dispose()
  timers.fire()
  frames.run()
  assert.equal(opened, 0)
})

test('disposing before readiness cancels the tray request', () => {
  let opened = 0
  const sessions = sessionFixture()
  const frames = frameFixture()
  const dispose = openSettingsWhenSettled({
    open: () => { opened += 1 },
    sessions,
    isOnboardingVisible: () => false,
    frame: frames.frame,
  })
  dispose()
  sessions.ready()
  frames.run()
  assert.equal(opened, 0)
})

test('disposing before the scheduled frame cancels the open', () => {
  let opened = 0
  const frames = frameFixture()
  const dispose = openSettingsWhenSettled({
    open: () => { opened += 1 },
    sessions: sessionFixture('ready'),
    isOnboardingVisible: () => false,
    frame: frames.frame,
  })
  dispose()
  frames.run()
  assert.equal(opened, 0)
})

test('repeated tray requests keep the first session-readiness deadline', () => {
  globalThis.window = Object.assign(new EventTarget(), { __eduworkTrayActions: [] })
  const settings = settingsFixture()
  const timers = timerFixture()
  const frames = frameFixture()
  const dispose = bindSettingsOpenAction({
    slots: settings.slots,
    sessions: sessionFixture(),
    frame: frames.frame,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  })
  const request = () => {
    window.__eduworkTrayActions.push('open-settings')
    window.dispatchEvent(new Event('eduwork:tray-action'))
  }
  request()
  timers.advance(4000)
  request()
  timers.advance(999)
  frames.run()
  assert.equal(settings.opened(), 0)
  timers.advance(1)
  frames.run()
  assert.equal(settings.opened(), 1)
  settings.owner.actions.close()
  request()
  timers.advance(5000)
  frames.run()
  assert.equal(settings.opened(), 2)
  dispose()
})

test('disposing the desktop binding cancels a request behind onboarding', () => {
  globalThis.window = Object.assign(new EventTarget(), { __eduworkTrayActions: [] })
  const settings = settingsFixture()
  let visible = true
  let finishOnboarding
  const frames = frameFixture()
  const dispose = bindSettingsOpenAction({
    slots: settings.slots,
    sessions: sessionFixture('ready'),
    isOnboardingVisible: () => visible,
    frame: frames.frame,
    watchOnboardingEnd: callback => { finishOnboarding = callback; return () => {} },
  })
  window.__eduworkTrayActions.push('open-settings')
  window.dispatchEvent(new Event('eduwork:tray-action'))
  frames.run()
  dispose()
  visible = false
  finishOnboarding()
  assert.equal(settings.opened(), 0)
})

for (const entry of ['tray', 'sidebar']) {
  test(`opening settings from the ${entry} leaves no delayed reopen after closing`, () => {
    globalThis.window = Object.assign(new EventTarget(), { __eduworkTrayActions: [] })
    const settings = settingsFixture()
    const timers = timerFixture()
    const frames = frameFixture()
    const dispose = bindSettingsOpenAction({
      slots: settings.slots,
      sessions: sessionFixture(),
      frame: frames.frame,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    })
    const request = () => {
      window.__eduworkTrayActions.push('open-settings')
      window.dispatchEvent(new Event('eduwork:tray-action'))
    }
    request()
    if (entry === 'tray') {
      timers.advance(5000)
      frames.run()
      request()
    } else settings.owner.actions.open()
    settings.owner.actions.close()
    timers.advance(5000)
    frames.run()
    assert.equal(settings.owner.getSnapshot().open, false)
    assert.equal(settings.opened(), 1)
    dispose()
  })
}
