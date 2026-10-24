import assert from 'node:assert/strict'
import test from 'node:test'
import { SideChatController } from '../src/client/controller.js'
import { disallowedSideTool, SIDE_BOUNDARY } from '../src/boundary.js'

test('window controller preserves the current chat and closes explicitly', async () => {
  const requests = []
  const controller = new SideChatController({ owner: () => 'a'.repeat(32), request: async input => {
    requests.push(input)
    return input.action === 'open' ? { sessionId: 'side-fixture', leaseMs: 45_000 } : {}
  } })
  const chat = await controller.open('source', 3)
  assert.equal((await controller.open('source', 3)), chat)
  await assert.rejects(controller.open('source', 5), /onlyOne/)
  assert.equal(requests.filter(item => item.action === 'open').length, 1)
  await controller.heartbeat()
  await Promise.all([controller.close(), controller.close()])
  assert.equal(requests.filter(item => item.action === 'close').length, 1)
  assert.equal(controller.snapshot.chat, undefined)
})

test('closing while creation is in flight never publishes the late reply', async () => {
  let finish
  const controller = new SideChatController({ owner: () => 'b'.repeat(32), request: input => input.action === 'open'
    ? new Promise(resolve => { finish = resolve }) : Promise.resolve({}) })
  const opening = controller.open('source', 1)
  await controller.close()
  finish({ sessionId: 'side-late' })
  await assert.rejects(opening, /expired/)
  assert.equal(controller.snapshot.chat, undefined)
})

test('failed cleanup is retryable and cannot open a replacement chat', async () => {
  let failure = true
  const controller = new SideChatController({ owner: () => 'c'.repeat(32), request: async input => {
    if (input.action === 'close' && failure) throw new Error('network')
    return { sessionId: 'side-fixture' }
  } })
  await controller.open('source', 1)
  await assert.rejects(controller.close(), /network/)
  assert.equal(controller.snapshot.phase, 'closing')
  await assert.rejects(controller.open('source', 1), /onlyOne/)
  failure = false
  await controller.heartbeat()
  assert.equal(controller.snapshot.chat, undefined)
})

test('an expired lease drops the chat, while a transient error retains it', async () => {
  let status = 503
  const controller = new SideChatController({ owner: () => 'd'.repeat(32), request: async input => {
    if (input.action === 'heartbeat') { const error = new Error('offline'); error.status = status; throw error }
    return { sessionId: 'side-fixture' }
  } })
  await controller.open('source', 1)
  await controller.heartbeat()
  assert.equal(controller.snapshot.chat.sessionId, 'side-fixture')
  status = 410
  await controller.heartbeat()
  assert.equal(controller.snapshot.chat, undefined)
  assert.equal(controller.snapshot.error, 'expired')
})

test('side policy separates inherited instructions and excludes persistent delegation', () => {
  assert.match(SIDE_BOUNDARY, /Only new requests/)
  for (const name of ['subagent_spawn', 'subagent', 'schedule_create', 'jobs_start', 'create_worktree']) assert.equal(disallowedSideTool(name), true)
  for (const name of ['read', 'grep', 'web_search', 'calendar_list_events']) assert.equal(disallowedSideTool(name), false)
})

test('selected references belong to the live side chat and are cleared on close', async () => {
  const controller = new SideChatController({ owner: () => 'e'.repeat(32), request: async () => ({ sessionId: 'side-fixture' }) })
  assert.throws(() => controller.queueReference('side-fixture', {}), /expired/)
  await controller.open('source', 1)
  const reference = { source: 'eduwork-annotation', ref: 'synthetic-reference' }
  assert.throws(() => controller.queueReference('other', reference), /expired/)
  const first = controller.queueReference('side-fixture', reference)
  const second = controller.queueReference('side-fixture', reference)
  controller.consumeReference(first)
  assert.deepEqual(controller.snapshot.references.map(item => item.id), [second])
  assert.equal(controller.snapshot.references[0].reference, reference)
  await controller.close()
  assert.deepEqual(controller.snapshot.references, [])
  assert.throws(() => controller.queueReference('side-fixture', reference), /expired/)
})

test('a heartbeat racing intentional close does not report an expired chat', async () => {
  let rejectHeartbeat, finishClose
  const controller = new SideChatController({ owner: () => 'f'.repeat(32), request: input => {
    if (input.action === 'heartbeat') return new Promise((_, reject) => { rejectHeartbeat = reject })
    if (input.action === 'close') return new Promise(resolve => { finishClose = resolve })
    return Promise.resolve({ sessionId: 'side-fixture' })
  } })
  await controller.open('source', 1)
  const heartbeat = controller.heartbeat()
  const closing = controller.close()
  rejectHeartbeat(Object.assign(new Error('gone'), { status: 410 }))
  await heartbeat
  assert.equal(controller.snapshot.error, undefined)
  finishClose({})
  await closing
  assert.equal(controller.snapshot.error, undefined)
})
