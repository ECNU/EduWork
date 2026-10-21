import test from 'node:test'
import assert from 'node:assert/strict'
import { NotificationRegistry, SOURCE_QUEUE_LIMIT, SOURCE_LIMIT } from '../lib/registry.js'
import { TaskNotifications, validateAttentionRequest, ATTENTION_SOURCE_LIMIT, ATTENTION_QUEUE_LIMIT, ATTENTION_MAX_BYTES } from '../../../dsh-electron/src/task-notifications.mjs'
import { DesktopAttention, notificationDefaults } from '../../desktop-services/lib/attention.js'
const definition = (source, scope = 'default') => ({ version: 1, source, scope, label: source,
  events: ['normal', 'action'].map(id => ({ id, label: id, level: 'info', requiresAction: id === 'action', actions: ['open'] })), onAction: ({ target }) => target })
const notice = (id, event = 'normal') => ({ id: String(id), event, title: String(id), target: { id } })
const request = items => ({ action: 'sync', instance: 'test', items, running: [], preferences: notificationDefaults })

test('all account scopes share one source FIFO; overflow never removes a sibling source', async () => {
  const r = new NotificationRegistry(), a = r.register(definition('mail', 'a')), b = r.register(definition('mail', 'b')), studio = r.register(definition('studio'))
  const other = await studio.publish(notice('other'))
  const first = await a.publish(notice('first', 'action'))
  for (let i = 0; i < 200; i++) await b.publish(notice(i))
  assert.equal(r.snapshot().filter(row => row.source === 'mail').length, 200)
  assert.equal(r.records.get(first.key).evicted, true, 'requiresAction does not protect capacity')
  assert.equal(r.records.get(first.key).resolved, false, 'eviction does not resolve business intent')
  assert.equal(r.snapshot().some(row => row.key === other.key), true)
  assert.equal((await a.publish(notice('first', 'action'))).status, 'discarded')
  assert.equal(await r.activate(first.key), null)
})

test('normal-to-action and action-to-normal updates stay within per-source capacity', async () => {
  const r = new NotificationRegistry(), h = r.register(definition('mail'))
  const first = await h.publish(notice('old'))
  r.seen(first.key, 1)
  for (let i = 0; i < 200; i++) await h.publish(notice(i, 'action'))
  await h.update(notice('old', 'action'))
  assert.equal(r.snapshot().length, 200)
  assert.equal(r.snapshot().some(row => row.key === first.key), true)
  await h.update(notice('old'))
  assert.equal(r.snapshot().length, 199)
})

test('disabled source history is bounded separately and never replays when re-enabled', async () => {
  const preferences = { 'mail/*': false }, r = new NotificationRegistry({ preferences: () => preferences })
  const mail = r.register(definition('mail')), studio = r.register(definition('studio'))
  for (let i = 0; i < 1100; i++) assert.equal((await mail.publish(notice(i))).status, 'disabled')
  const other = await studio.publish(notice('other'))
  assert.equal(r.records.size, 1001)
  assert.equal(r.snapshot().length, 1)
  preferences['mail/*'] = true; r.changed()
  assert.equal(r.snapshot().length, 1)
  assert.equal(r.snapshot()[0].key, other.key)
  await mail.publish(notice('new'))
  assert.equal(r.snapshot().length, 2)
  preferences['mail/*'] = false; r.changed(); preferences['mail/*'] = true; r.changed()
  assert.equal(r.snapshot().length, 1, 'turning a source off clears its display backlog')
})

test('withdraw cancels in-flight publication; a newer target wins even if its ready completes first', async () => {
  const r = new NotificationRegistry(), h = r.register(definition('mail')), releases = []
  r.transport = { ready: () => new Promise(resolve => releases.push(resolve)), flush: async () => {} }
  const pending = h.publish(notice('cancelled'))
  h.withdraw('cancelled'); releases.shift()()
  assert.equal((await pending).status, 'resolved'); assert.equal(r.snapshot().length, 0)
  const first = h.publish({ ...notice('same'), target: { version: 1 } })
  const second = h.publish({ ...notice('same'), target: { version: 2 } })
  releases[1](); const result = await second; releases[0](); await first
  assert.deepEqual((await r.activate(result.key)).target, { version: 2 })
})

test('full queues across all sources still synchronize alongside 200 Agent decisions', async () => {
  assert.equal(SOURCE_LIMIT, ATTENTION_SOURCE_LIMIT); assert.equal(SOURCE_QUEUE_LIMIT, ATTENTION_QUEUE_LIMIT)
  const r = new NotificationRegistry()
  for (let s = 0; s < SOURCE_LIMIT; s++) {
    const source = definition('source-' + s)
    source.events.forEach(event => { event.label = '\ud800'.repeat(120) })
    const h = r.register(source)
    for (let i = 0; i < 200; i++) await h.publish({ ...notice(i), title: '\ud800'.repeat(120), preview: '\ud800'.repeat(400) })
  }
  assert.throws(() => r.register(definition('overflow-source')), /source limit/)
  const shell = new TaskNotifications({ foreground: () => true, show() {}, publish() {}, dismiss() {}, changed() {} })
  const host = new DesktopAttention({ notifications: r, bridge: async body => shell.handle(body), preferences: () => notificationDefaults, schedule: () => 1, cancel() {} })
  host.pluginSupported = true
  for (let i = 0; i < 200; i++) host.put({ key: 'agent-' + i, kind: 'approval', sessionId: 's', title: '文'.repeat(119) + '😀' })
  assert.equal(await host.flush(), true)
  assert.equal(shell.items.size, 200 * (SOURCE_LIMIT + 1))
  const body = request([...shell.items.values()]); validateAttentionRequest(body)
  assert.ok(Buffer.byteLength(JSON.stringify(body)) < ATTENTION_MAX_BYTES)
  assert.equal(body.items.every(item => item.title.isWellFormed()), true)
  const extra = { ...r.snapshot()[0], key: 'plugin:' + 'f'.repeat(64) }
  assert.throws(() => validateAttentionRequest(request([...r.snapshot().slice(0, 200), extra])), /queue size/)
  host.close()
})

test('a publication replaced while flushing reports resolved and cannot overwrite the newer target', async () => {
  const r = new NotificationRegistry(), h = r.register(definition('mail')), flushes = []
  r.transport = { ready: async () => {}, flush: () => new Promise(resolve => flushes.push(resolve)) }
  const first = h.publish({ ...notice('same'), target: { version: 1 } })
  await new Promise(resolve => setImmediate(resolve))
  const second = h.publish({ ...notice('same'), target: { version: 2 } })
  await new Promise(resolve => setImmediate(resolve))
  flushes[1](); const latest = await second
  flushes[0](); assert.equal((await first).status, 'resolved')
  assert.deepEqual((await r.activate(latest.key)).target, { version: 2 })
})

test('plugin sources dispatch in round-robin FIFO and do not silently consume waiting notifications', async () => {
  const r = new NotificationRegistry(), a = r.register(definition('mail')), b = r.register(definition('studio'))
  for (let i = 0; i < 3; i++) await a.publish(notice(i))
  await b.publish(notice('s'))
  let now = 0; const seen = []
  const shell = new TaskNotifications({ foreground: () => false, show() {}, publish: value => seen.push(value.key), dismiss() {}, changed() {}, now: () => now })
  for (let i = 0; i < 4; i++) { shell.handle(request(r.snapshot())); now += 5000 }
  assert.deepEqual(seen.map(key => r.records.get(key).data.id), ['0', 's', '1', '2'])
})
