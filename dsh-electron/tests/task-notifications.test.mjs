import test from 'node:test'
import assert from 'node:assert/strict'
import { TaskNotifications, nativeNotificationAdapter, validateAttentionRequest } from '../src/task-notifications.mjs'
import { DesktopAttention, notificationDefaults } from '../../dsh-plugins/desktop-services/lib/attention.js'

const item = (key, kind = 'question', extras = {}) => ({ key, kind, sessionId: 'session-a', title: 'Private title', createdAt: 1, ...extras })
function setup() {
  let focused = false, time = 10000
  const popups = [], shown = [], dismissed = []
  const shell = new TaskNotifications({ foreground: () => focused, now: () => time, show: () => shown.push(true), publish: value => popups.push(value), dismiss: () => dismissed.push(true), changed() {} })
  const sync = (items, preferences = {}, running = []) => shell.handle({ action: 'sync', instance: 'host-a', items, running, preferences: { ...notificationDefaults, ...preferences } })
  return { shell, sync, popups, shown, dismissed, focus: value => { focused = value }, advance: () => { time += 5000 } }
}
function host(bridge = async () => ({ seen: [] }), goal) {
  return new DesktopAttention({ bridge, preferences: () => notificationDefaults, goal, now: () => 10000, schedule: () => 1, cancel() {} })
}

test('awaiting a concurrent notification flush waits until its new items reach the desktop', async () => {
  const f = setup()
  let release, first = true, settled = false
  const blocked = new Promise(resolve => { release = resolve })
  const h = host(async body => {
    if (first) { first = false; await blocked }
    return f.shell.handle(body)
  })
  const initial = h.flush()
  h.put(item('queued-approval', 'approval'))
  const updated = h.flush().then(result => { settled = true; return result })
  try {
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(settled, false, 'an earlier in-flight snapshot cannot acknowledge a newly added notice')
    release()
    assert.equal(await updated, true)
    assert.equal(f.shell.items.get('queued-approval')?.kind, 'approval')
  } finally { release(); await Promise.allSettled([initial, updated]); h.close() }
})

test('foreground suppresses popups; only viewing the matching conversation consumes a completed notice', () => {
  const f = setup(); f.focus(true)
  f.shell.handle({ action: 'view', sessionId: 'another-session' })
  assert.deepEqual(f.sync([item('done', 'completed'), item('ask')]).seen, [])
  assert.equal(f.popups.length, 0); assert.equal(f.shell.menu().length, 2)
  f.shell.handle({ action: 'view', sessionId: 'session-a' })
  assert.deepEqual(f.sync([item('done', 'completed'), item('ask')]).seen, ['done'])
  assert.equal(f.shell.menu().length, 1)
  f.focus(false); f.sync([item('ask')]); assert.equal(f.popups.length, 0)
})

test('background coalesces and deduplicates, protects previews, and respects opt-out', () => {
  const f = setup()
  f.sync([item('a'), item('b', 'completed')]); f.sync([item('a'), item('b', 'completed')])
  assert.equal(f.popups.length, 1); assert.match(f.popups[0].title, /2/)
  assert.equal(f.popups[0].content.includes('Private'), false); assert.equal(f.popups[0].sound, false)
  f.advance(); f.sync([item('c')], { enabled: false }); assert.equal(f.popups.length, 1)
  assert.equal(f.shell.menu().length, 1)
  f.sync([item('c')], { enabled: true }); assert.equal(f.popups.length, 1)
  f.advance(); f.sync([item('d')], { preview: true }); assert.equal(f.popups[1].content, 'Private title')
})

test('resolved or cancelled requests leave tray; stale clicks do not reopen an action', async () => {
  const f = setup(), h = host(body => f.shell.handle(body))
  h.put(item('ask')); await h.flush()
  f.shell.activate('ask'); h.remove('ask')
  assert.equal((await h.view({ sessionId: '' })).target, null)
  await h.flush(); f.shell.activate('ask')
  assert.equal(f.shown.length, 1); assert.equal(f.shell.menu().length, 0)
})

test('request acknowledgement never decides it; its authoritative end does', async () => {
  const f = setup(), h = host(body => f.shell.handle(body))
  h.put(item('ask')); await h.flush(); f.shell.activate('ask')
  const view = await h.view({ sessionId: '' }); assert.equal(view.target.key, 'ask')
  await h.view({ sessionId: 'session-a', openedKey: 'ask' }); assert.equal(h.items.size, 1)
  h.remove('ask'); await h.flush(); assert.equal(f.shell.items.size, 0)
})

test('only live root turn boundaries notify; failures, limits, cancel, and restored history stay distinct', () => {
  const h = host(), session = { id: 's' }
  const event = (type, data, root = true) => h.event(session, { type, data }, root)
  event('turn/end', { turn: 1, reason: { kind: 'completed' } }); assert.equal(h.items.size, 0)
  event('turn/start', { turn: 2 }, false); event('turn/end', { turn: 2, reason: { kind: 'completed' } }, false); assert.equal(h.items.size, 0)
  for (const [kind, expected] of [['completed', 'completed'], ['error', 'failed'], ['blocked', 'failed'], ['max-tokens', 'failed'], ['aborted', null], ['interrupted', null]]) {
    event('turn/start', { turn: 3 }); event('turn/end', { turn: 3, reason: { kind } })
    assert.equal([...h.items.values()][0]?.kind ?? null, expected)
  }
  event('approval/asked', { id: 'p' }); assert.equal(h.items.size, 1)
  event('approval/decided', { id: 'p', outcome: 'rejected' }); assert.equal(h.items.size, 0)
})

test('question observer preserves the real answer, rejection, and abort lifetime', async () => {
  const h = host(), controller = new AbortController()
  let finish
  const answer = { answers: [{ id: 'q', selected: ['yes'] }] }
  const waiting = h.question({ agent: { id: 's' }, signal: controller.signal }, () => new Promise(resolve => { finish = resolve }))
  assert.equal(h.items.size, 1); controller.abort(); assert.equal(h.items.size, 0)
  finish(answer); assert.equal(await waiting, answer)
  const failure = Error('answerer unavailable')
  await assert.rejects(h.question({ agent: { id: 's' } }, async () => { throw failure }), error => error === failure)
  assert.equal(h.items.size, 0)
})

test('snapshot failures are contained and can recover without losing pending work', async () => {
  let fail = true
  const h = host(async () => { if (fail) throw Error('offline'); return { seen: [] } })
  h.put(item('a')); await h.flush(); assert.equal(h.dirty, true); assert.equal(h.items.size, 1)
  fail = false; await h.flush(); assert.equal(h.dirty, false)
  h.close(); h.put(item('b')); assert.equal(h.items.size, 0)
})

test('bridge contract rejects commands, arbitrary URLs, oversized or ambiguous state', () => {
  const good = { action: 'sync', instance: 'a', items: [item('a')], running: ['session-b'], preferences: notificationDefaults }
  assert.equal(validateAttentionRequest(good), good)
  for (const bad of [ { ...good, command: 'run' }, { ...good, items: [item('a', 'approval', { url: 'https://example.org' })] },
    { ...good, running: undefined }, { ...good, running: ['s', 's'] }, { ...good, running: [''] }, { ...good, running: ['a\nb'] },
    { ...good, items: [item('a'), item('a')] }, { ...good, preferences: { ...notificationDefaults, sound: 'yes' } },
    { action: 'view', sessionId: '../a', url: 'file://secret' } ]) assert.throws(() => validateAttentionRequest(bad))
})

test('Windows uses tray quiet-time flags; macOS failure never bypasses native controls', () => {
  const balloons = [], clicked = [], failed = [], notifications = []
  const tray = { displayBalloon: value => balloons.push(value), removeBalloon() {} }
  const options = { getTray: () => tray, productName: 'Fixture', activate: key => clicked.push(key), failed: () => failed.push(true) }
  const win = nativeNotificationAdapter({ ...options, platform: 'win32' })
  win.publish({ title: 'Ready', content: 'Open', sound: false, key: 'a' }); win.balloonClick()
  assert.equal(balloons[0].respectQuietTime, true); assert.equal(balloons[0].noSound, true); assert.deepEqual(clicked, ['a'])
  win.dismiss(); win.balloonClick(); assert.equal(clicked.length, 1)
  class Native {
    static isSupported() { return true }
    constructor(value) { this.value = value; this.events = {}; notifications.push(this) }
    on(name, callback) { this.events[name] = callback }
    show() {} close() {}
  }
  const mac = nativeNotificationAdapter({ ...options, platform: 'darwin', Notification: Native })
  mac.publish({ title: 'Ready', content: 'Open', sound: false, key: 'b' })
  assert.equal(notifications[0].value.silent, true)
  notifications[0].events.failed(); assert.equal(failed.length, 1)
  notifications[0].events.click(); assert.equal(clicked.at(-1), 'b')
})

test('Windows serializes balloons and a dismissed bubble cannot click the next target', () => {
  const shown = [], clicks = []
  const adapter = nativeNotificationAdapter({ platform: 'win32', productName: 'test',
    getTray: () => ({ displayBalloon: value => shown.push(value), removeBalloon() {} }),
    activate: key => clicks.push(key), failed() {} })
  adapter.publish({ title: 'First', content: '', key: 'a' })
  assert.equal(adapter.publish({ title: 'Second', content: '', key: 'b' }), false)
  adapter.dismiss()
  assert.equal(adapter.publish({ title: 'Second', content: '', key: 'b' }), false)
  adapter.balloonClick()
  assert.deepEqual(clicks, [])
  adapter.publish({ title: 'Second', content: '', key: 'b' })
  adapter.balloonClick(); assert.deepEqual(clicks, ['b'])
  adapter.publish({ title: 'Third', content: '', key: 'c' })
  adapter.balloonClosed(); adapter.balloonClick()
  assert.deepEqual(clicks, ['b']); assert.equal(shown.length, 3)
})

test('a busy display adapter leaves the queued notification eligible for the next sync', () => {
  const f = setup(); let busy = true
  f.shell.publish = value => { if (busy) return false; f.popups.push(value) }
  f.sync([item('a')]); assert.equal(f.shell.notified.has('a'), false)
  busy = false; f.advance(); f.sync([item('a')]); assert.equal(f.popups.length, 1)
})

test('missing Windows hide events cannot stall queues or redirect late clicks to another item', () => {
  let now = 0, reopened = 0
  const clicks = [], shown = []
  const adapter = nativeNotificationAdapter({ platform: 'win32', productName: 'test', now: () => now,
    getTray: () => ({ displayBalloon: value => shown.push(value), removeBalloon() {} }),
    activate: key => clicks.push(key), show: () => reopened++, failed() {} })
  adapter.publish({ title: 'Suppressed', content: '', key: 'old' })
  now = 59999
  assert.equal(adapter.publish({ title: 'Next', content: '', key: 'next' }), false)
  now = 60000
  assert.notEqual(adapter.publish({ title: 'Next', content: '', key: 'next' }), false)
  adapter.balloonClick() // The event may still belong to the old balloon.
  assert.deepEqual(clicks, []); assert.equal(reopened, 1); assert.equal(shown.length, 2)
  adapter.balloonClosed()
  adapter.publish({ title: 'Third', content: '', key: 'third' })
  adapter.balloonClick()
  assert.deepEqual(clicks, []); assert.equal(reopened, 2)
})

test('an armed goal holds its turn until the driver continues, blocks or completes it', () => {
  let view
  const h = host(undefined, id => view?.[id]), round = (id, turn) => { h.event({ id }, { type: 'turn/start', data: { turn } }, true); h.event({ id }, { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } }, true) }
  const kinds = () => [...h.items.values()].map(item => item.kind), armed = { phase: 'active', activation: 'armed', roundsStarted: 3, maxGoalRounds: 3 }
  view = { a: armed, b: armed, c: armed, d: armed }
  // The next round starts: nothing to report yet. At the limit the driver blocks the goal after the turn.
  round('a', 1); round('a', 2); assert.deepEqual(kinds(), [])
  h.goalChanged('a', 'edit'); assert.deepEqual(kinds(), [])
  h.goalChanged('a', 'block'); h.goalChanged('a', 'block'); assert.deepEqual(kinds(), ['failed'])
  round('b', 1); h.goalChanged('b', 'complete'); assert.deepEqual(kinds(), ['failed', 'completed'])
  // A pause or clear is the user's own stop; a goal never held here is not reported.
  round('c', 1); h.goalChanged('c', 'pause'); h.goalChanged('d', 'block'); assert.deepEqual(kinds(), ['failed', 'completed'])
  view = { e: { ...armed, activation: 'disarmed' }, f: { ...armed, phase: 'blocked', activation: 'disarmed' } }
  round('e', 1); round('f', 1); assert.deepEqual(kinds(), ['failed', 'completed', 'completed', 'failed'])
})

test('a working background subagent holds completion for the turn it wakes', () => {
  const h = host(), root = (type, data) => h.event({ id: 'a' }, { type, data }, true)
  root('turn/start', { turn: 1 }); h.subagent('child', 'turn/start', 'a'); h.subagent('fork', 'turn/start', undefined)
  root('turn/end', { turn: 1, reason: { kind: 'completed' } })
  assert.equal(h.items.size, 0)
  h.subagent('grandchild', 'turn/start', 'a'); h.subagent('child', 'turn/end'); h.subagent('grandchild', 'turn/end'); h.subagent('fork', 'turn/end')
  assert.equal(h.delegated.size, 0)
  // The settled subagent wakes the conversation, which then finishes for real.
  root('turn/start', { turn: 2 }); root('turn/end', { turn: 2, reason: { kind: 'completed' } })
  assert.equal([...h.items.values()][0].kind, 'completed')
  root('turn/start', { turn: 3 }); h.subagent('child', 'turn/start', 'a'); root('turn/end', { turn: 3, reason: { kind: 'error' } })
  assert.equal([...h.items.values()][0].kind, 'failed')
})

test('a result finished in the conversation on screen is acknowledged once, without a pending entry', () => {
  const f = setup(), changes = []
  f.shell.changed = () => changes.push(f.shell.acknowledged)
  f.focus(true); f.shell.handle({ action: 'view', sessionId: 'session-a' })
  assert.deepEqual(f.sync([item('done', 'completed')]).seen, ['done']); assert.equal(f.shell.acknowledged, 1); assert.equal(f.shell.items.size, 0)
  f.sync([item('bad', 'failed')]); assert.equal(f.shell.acknowledged, 1)
  f.focus(false); f.sync([item('later', 'completed')]); f.focus(true)
  f.sync([item('later', 'completed')]); assert.equal(f.shell.acknowledged, 1)
  assert.equal(changes[0], 1)
})

test('running includes live root turns and optional plugin activity without subagent duplicates', async () => {
  const h = host(), session = { id: 'root' }
  h.notifications = { running: () => ['plugin:task'] }
  h.event(session, { type: 'turn/start', data: { turn: 1 } }, true)
  h.event({ id: 'child' }, { type: 'turn/start', data: { turn: 1 } }, false)
  assert.deepEqual(h.running(), ['root', 'plugin:task'])
  h.event(session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }, true)
  assert.deepEqual(h.running(), ['plugin:task'])
})
