import test from 'node:test'
import assert from 'node:assert/strict'
import { TaskNotifications, nativeNotificationAdapter, validateAttentionRequest } from '../src/task-notifications.mjs'
import { DesktopAttention, notificationDefaults } from '../../dsh-plugins/desktop-services/lib/attention.js'

const item = (key, kind = 'question', extras = {}) => ({ key, kind, sessionId: 'session-a', title: 'Private title', createdAt: 1, ...extras })
function setup() {
  let focused = false, time = 10000
  const popups = [], shown = [], dismissed = []
  const shell = new TaskNotifications({ foreground: () => focused, now: () => time, show: () => shown.push(true), publish: value => popups.push(value), dismiss: () => dismissed.push(true), changed() {} })
  const sync = (items, preferences = {}) => shell.handle({ action: 'sync', instance: 'host-a', items, preferences: { ...notificationDefaults, ...preferences } })
  return { shell, sync, popups, shown, dismissed, focus: value => { focused = value }, advance: () => { time += 5000 } }
}
function host(bridge = async () => ({ seen: [] })) {
  return new DesktopAttention({ bridge, preferences: () => notificationDefaults, now: () => 10000, schedule: () => 1, cancel() {} })
}

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

test('viewing a Studio artifact consumes only its own notice in a foreground window', () => {
  const f = setup(); f.focus(true)
  const a = item('a', 'studio', { artifactId: 'artifact_a' }), b = item('b', 'studio', { artifactId: 'artifact_b' })
  f.shell.handle({ action: 'view', sessionId: 'session-a', artifactId: 'artifact_a' })
  assert.deepEqual(f.sync([a, b]).seen, ['a'])
  assert.equal(f.shell.items.has('b'), true)
  f.focus(false)
  f.shell.handle({ action: 'view', sessionId: 'session-a', artifactId: 'artifact_b' })
  assert.deepEqual(f.sync([b]).seen, [])
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

test('Studio ignores history/intermediate attempts, notices independent results, and clears deleted results', () => {
  const h = host(), row = { id: 'artifact_a', sessionId: 's', version: 1, status: 'completed', title: 'Studio', updatedAt: new Date(5000).toISOString() }
  h.studio('w', [row]); assert.equal(h.items.size, 0)
  row.version = 2; row.updatedAt = new Date(11000).toISOString(); row.lifecycle = { state: 'open' }
  h.studio('w', [row]); assert.equal(h.items.size, 0)
  row.lifecycle.state = 'settled'; h.studio('w', [row]); assert.equal([...h.items.values()][0].kind, 'studio')
  h.studio('w', [row]); assert.equal(h.items.size, 1)
  h.studio('w', []); assert.equal(h.items.size, 0)
})

test('snapshot failures are contained and can recover without losing pending work', async () => {
  let fail = true
  const h = host(async () => { if (fail) throw Error('offline'); return { seen: [] } })
  h.put(item('a')); await h.flush(); assert.equal(h.dirty, true); assert.equal(h.items.size, 1)
  fail = false; await h.flush(); assert.equal(h.dirty, false)
  h.close(); h.put(item('b')); assert.equal(h.items.size, 0)
})

test('bridge contract rejects commands, arbitrary URLs, oversized or ambiguous state', () => {
  const good = { action: 'sync', instance: 'a', items: [item('a')], preferences: notificationDefaults }
  assert.equal(validateAttentionRequest(good), good)
  for (const bad of [ { ...good, command: 'run' }, { ...good, items: [item('a', 'approval', { url: 'https://example.org' })] },
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
