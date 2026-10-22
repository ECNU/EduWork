import test from 'node:test'
import assert from 'node:assert/strict'
import { NotificationRegistry } from '../lib/registry.js'
import { NotificationActions } from '../lib/client-actions.js'
import { TaskNotifications } from '../../../dsh-electron/src/task-notifications.mjs'
import { DesktopAttention, notificationDefaults } from '../../desktop-services/lib/attention.js'
import { petStatus } from '../../../dsh-electron/src/desktop-pet-core.mjs'
import { deriveStatus } from '../../../packages/dsh-desktop-pet/lib/pet-state.js'
import { StudioNotifications } from '../../../packages/dsh-knowledge-studio/lib/notifications.js'

const definition = (extra = {}) => ({ version: 1, source: 'mail', scope: 'account-a', label: '邮件',
  events: [{ id: 'received', label: '收到新邮件', level: 'info', requiresAction: false, actions: ['open'] }],
  onAction: ({ target }) => target, ...extra })
const notice = (extra = {}) => ({ id: 'uid:42', event: 'received', title: 'Private sender', preview: 'Private message', target: { folder: 'INBOX', uid: 42 }, ...extra })
function fixture({ foreground = false, supported = true, preferences = notificationDefaults, eventPreferences = {} } = {}) {
  let clock = 10000
  const popups = [], registry = new NotificationRegistry({ preferences: () => eventPreferences, now: () => clock })
  const shell = new TaskNotifications({ foreground: () => foreground, show() {}, publish: row => popups.push(row), dismiss() {}, changed() {}, now: () => clock })
  const attention = new DesktopAttention({ notifications: registry, bridge: async body => {
    const response = shell.handle(body)
    if (!supported) delete response.pluginNotifications
    return response
  }, preferences: () => preferences, schedule: () => 0, cancel() {} })
  registry.transport = {
    ready: async () => { if (!await attention.flush()) throw Error('Unavailable'); if (!attention.pluginSupported) throw Error('Unsupported protocol') },
    flush: async () => { if (!await attention.flush()) throw Error('Unavailable') },
  }
  return { registry, attention, shell, popups, advance: () => { clock += 6000 } }
}

test('new mail event uses the same tray/pet state, private previews and plugin-owned click handler', async () => {
  const f = fixture(), handle = f.registry.register(definition())
  const { key } = await handle.publish(notice())
  assert.equal(f.shell.items.size, 1)
  assert.equal(f.popups[0].title, '收到新邮件')
  assert.ok(!f.popups[0].content.includes('Private'))
  assert.equal(petStatus(f.shell).items[0].title, '')
  assert.equal(deriveStatus(petStatus(f.shell).items, 0).target.key, key)
  f.shell.activate(key)
  const view = await f.attention.view({ sessionId: '' })
  assert.deepEqual(view.target.plugin.target, { folder: 'INBOX', uid: 42 })
  assert.equal(view.target.plugin.scope, 'account-a')
  await f.attention.view({ sessionId: '', openedKey: key })
  await f.attention.flush()
  assert.equal(f.shell.items.size, 0)
  await handle.publish(notice())
  assert.equal(f.shell.items.size, 0, 'viewed duplicates do not reappear')
})

test('duplicate delivery and content updates are quiet; explicit renotify can alert again', async () => {
  const f = fixture(), handle = f.registry.register(definition())
  await handle.publish(notice()); f.advance()
  await handle.publish(notice())
  await handle.update(notice({ title: 'Updated' }))
  assert.equal(f.popups.length, 1)
  assert.equal([...f.shell.items.values()][0].title, 'Updated')
  await handle.update(notice({ title: 'Updated' }), { renotify: true })
  assert.equal(f.popups.length, 2)
  handle.withdraw('uid:42'); await f.attention.flush()
  assert.equal(f.shell.items.size, 0)
  await handle.publish(notice({ title: 'Updated' }))
  assert.equal(f.shell.items.size, 0, 'withdrawn duplicates stay withdrawn')
})

test('old shell rejects plugin delivery explicitly while Agent approvals still sync', async () => {
  const f = fixture({ supported: false }), handle = f.registry.register(definition())
  await assert.rejects(handle.publish(notice()), /Unsupported/)
  f.attention.put({ key: 'approval:s:1', kind: 'approval', sessionId: 's', title: '' })
  assert.equal(await f.attention.flush(), true)
  assert.equal(f.shell.items.get('approval:s:1').kind, 'approval')
})

test('turning off OS popups keeps the tray and pet; disabling an event suppresses all channels', async () => {
  const f = fixture({ preferences: { ...notificationDefaults, enabled: false } }), handle = f.registry.register(definition())
  await handle.publish(notice())
  assert.equal(f.popups.length, 0); assert.equal(f.shell.menu().length, 1)
  assert.equal(petStatus(f.shell).items.length, 1)
  const g = fixture({ eventPreferences: { 'mail/received': false } })
  assert.equal((await g.registry.register(definition()).publish(notice())).status, 'disabled')
  assert.equal(g.shell.items.size, 0)
})

test('ordinary mail cannot replace a waiting Agent approval in popups or pet selection', async () => {
  const f = fixture()
  f.attention.put({ key: 'approval:s:1', kind: 'approval', sessionId: 's', title: '' })
  await f.attention.flush(); f.advance()
  await f.registry.register(definition()).publish(notice())
  assert.equal(f.popups.length, 1)
  assert.equal(f.shell.menu().length, 2)
  assert.equal(deriveStatus(petStatus(f.shell).items, 0).target.key, 'approval:s:1')
})

test('account scopes isolate identical ids; disposed handles reject in-flight publication and stale clicks', async () => {
  const registry = new NotificationRegistry()
  let release, entered
  const waiting = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { entered = resolve })
  const a = registry.register(definition({ onAction: async ({ target }) => { entered(); await waiting; return target } }))
  const b = registry.register(definition({ scope: 'account-b' }))
  const first = await a.publish(notice()), second = await b.publish(notice())
  assert.notEqual(first.key, second.key)
  const clicked = registry.activate(first.key)
  await started; a.dispose(); release()
  assert.equal(await clicked, null)
  await assert.rejects(a.publish(notice()), /disposed/)
  assert.equal(registry.snapshot().length, 1)
  assert.equal((await registry.activate(second.key)).scope, 'account-b')
  let proceed
  registry.transport = { ready: () => new Promise(resolve => { proceed = resolve }), flush: async () => {} }
  const publishing = b.publish(notice({ id: 'late' }))
  b.dispose(); proceed()
  await assert.rejects(publishing, /disposed/)
  assert.equal(registry.snapshot().length, 0)
})

test('viewed and resolved differ for action-required events; stale acknowledgement does not consume a revision', async () => {
  const registry = new NotificationRegistry()
  const handle = registry.register(definition({ events: [{ id: 'received', label: 'Confirm', level: 'warning', requiresAction: true, actions: ['open'] }] }))
  const { key } = await handle.publish(notice())
  registry.seen(key, 1)
  assert.equal(registry.snapshot().length, 1)
  await handle.update(notice({ title: 'Changed' }), { renotify: true })
  registry.seen(key, 1)
  assert.equal(registry.records.get(key).viewed, false)
  handle.resolve('uid:42')
  assert.equal(registry.snapshot().length, 0)
})

test('visibility is validated by the source and account scope', async () => {
  const registry = new NotificationRegistry()
  const handle = registry.register(definition({ onView: (target, view) => target.uid === view.uid }))
  const { key } = await handle.publish(notice())
  registry.observeViews([{ source: 'mail', scope: 'account-b', target: { uid: 42 } }])
  assert.equal(registry.snapshot().length, 1)
  registry.observeViews([{ source: 'mail', scope: 'account-a', target: { uid: 43 } }])
  assert.equal(registry.snapshot().length, 1)
  registry.observeViews([{ source: 'mail', scope: 'account-a', target: { uid: 42 } }])
  assert.equal(registry.snapshot().length, 0)
  assert.equal(registry.records.get(key).resolved, false)
})

test('only a foreground view may consume plugin notices; a failing view callback cannot break Agent clicks', async () => {
  for (const foreground of [false, true]) {
    const f = fixture({ foreground })
    await f.registry.register(definition({ onView: () => true })).publish(notice())
    await f.attention.view({ sessionId: '', visible: [{ source: 'mail', scope: 'account-a', target: {} }] })
    assert.equal(f.registry.snapshot().length, foreground ? 0 : 1)
  }
  const f = fixture({ foreground: true })
  await f.registry.register(definition({ onView: () => { throw Error('plugin broken') } })).publish(notice())
  f.attention.put({ key: 'approval:s:1', kind: 'approval', sessionId: 's', title: '' })
  await f.attention.flush()
  f.shell.activate('approval:s:1')
  const view = await f.attention.view({ sessionId: '', visible: [{ source: 'mail', scope: 'account-a', target: {} }] })
  assert.equal(view.target.key, 'approval:s:1')
})

test('source FIFO overflow removes its oldest notice without displacing core decisions', async () => {
  const f = fixture(), handle = f.registry.register(definition())
  for (let i = 0; i < 200; i++) {
    f.attention.put({ key: `approval:s:${i}`, kind: 'approval', sessionId: 's', title: '' })
    await handle.publish(notice({ id: `${i}` }))
  }
  assert.equal(f.shell.items.size, 400)
  const oldest = f.registry.snapshot()[0].key
  assert.equal((await handle.publish(notice({ id: 'overflow' }))).status, 'accepted')
  assert.equal(f.shell.items.size, 400)
  assert.equal(f.shell.items.has(oldest), false)
  assert.equal([...f.shell.items.values()].filter(item => item.kind === 'approval').length, 200)
})

test('no desktop adapter is not claimed as a delivered notification', async () => {
  const registry = new NotificationRegistry(), handle = registry.register(definition())
  assert.equal((await handle.publish(notice())).delivery, 'none')
  assert.equal(registry.snapshot().length, 1)
})

test('disposed client handlers cancel in-flight navigation; one broken visibility provider does not affect others', async () => {
  const actions = new NotificationActions()
  let proceed, started, navigated = false
  const entered = new Promise(resolve => { started = resolve })
  const waiting = new Promise(resolve => { proceed = resolve })
  const dispose = actions.register('mail', async ({ signal }) => {
    started(); await waiting
    if (!signal.aborted) navigated = true
  }, () => { throw Error('broken') })
  actions.register('calendar', () => {}, () => ({ target: { date: '2026-01-01' } }))
  assert.equal(actions.visible()[0].source, 'calendar')
  const pending = actions.dispatch({ source: 'mail' })
  await entered; dispose(); proceed()
  await assert.rejects(pending, /disposed/)
  assert.equal(navigated, false)
  actions.close()
  assert.equal(actions.handlers.size, 0)
})

test('bad protocols and undeclared actions fail, a stale click cannot open a changed record', async () => {
  const registry = new NotificationRegistry()
  assert.throws(() => registry.register(definition({ version: 2 })), /protocol/)
  let release
  const waiting = new Promise(resolve => { release = resolve })
  const handle = registry.register(definition({ onAction: async ({ target }) => { await waiting; return target } }))
  await assert.rejects(handle.publish(notice({ action: 'execute' })), /Invalid/)
  const { key } = await handle.publish(notice())
  const clicked = registry.activate(key)
  await handle.update(notice({ target: { uid: 43 } }))
  release()
  assert.equal(await clicked, null)
  handle.dispose()
})

test('client navigation is registered and removed by the source; no business branches are needed', async () => {
  const actions = new NotificationActions(), called = []
  const dispose = actions.register('mail', action => called.push(action.target), () => ({ scope: 'account-a', target: { uid: 42 } }))
  await actions.dispatch({ source: 'mail', target: { uid: 42 } })
  assert.deepEqual(called, [{ uid: 42 }])
  assert.equal(actions.visible()[0].source, 'mail')
  dispose()
  await assert.rejects(actions.dispatch({ source: 'mail' }), /unavailable/)
})

test('disabling an event while its action is validating prevents late navigation', async () => {
  const preferences = {}
  const registry = new NotificationRegistry({ preferences: () => preferences })
  let release
  const waiting = new Promise(resolve => { release = resolve })
  const handle = registry.register(definition({ onAction: async ({ target }) => { await waiting; return target } }))
  const { key } = await handle.publish(notice())
  const clicked = registry.activate(key)
  preferences['mail/received'] = false
  release()
  assert.equal(await clicked, null)
  handle.dispose()
})

test('Studio retains history filtering, settled-result semantics, deletion and running activity', async () => {
  let rows = [{ id: 'artifact_a', sessionId: 's', version: 1, status: 'completed', title: 'Studio', updatedAt: new Date(5000).toISOString() }]
  const registry = new NotificationRegistry({ legacyPreferences: () => ({ studio: false, failed: true }) })
  const handle = registry.register({ version: 1, source: 'studio', label: 'Studio',
    events: [{ id: 'completed', label: 'Completed', level: 'success', requiresAction: false, actions: ['open'], legacyPreference: 'studio' },
      { id: 'failed', label: 'Failed', level: 'error', requiresAction: false, actions: ['open'], legacyPreference: 'failed' }], onAction: () => ({}) })
  const service = { ctx: { workspaceRegistry: { list: () => [{ id: 'w' }] } }, listArtifacts: async () => ({ artifacts: rows }) }
  const observer = new StudioNotifications(service, handle, { now: () => 10000 })
  await observer.refresh(); assert.equal(registry.snapshot().length, 0)
  rows[0] = { ...rows[0], version: 2, updatedAt: new Date(11000).toISOString(), lifecycle: { state: 'open' } }
  await observer.refresh(); assert.equal(registry.snapshot().length, 0)
  rows[0].lifecycle.state = 'settled'
  await observer.refresh(); assert.equal(registry.snapshot().length, 0, 'old Studio completion preference is retained')
  rows[0].status = 'failed'
  await observer.refresh(); assert.equal(registry.snapshot()[0].event, 'failed')
  rows = [{ ...rows[0], version: 3, status: 'running' }]
  await observer.refresh(); assert.equal(registry.snapshot().length, 0); assert.equal(registry.running().length, 1)
  rows = []; await observer.refresh()
  assert.equal(registry.running().length, 0); assert.equal(registry.snapshot().length, 0)
})
