import assert from 'node:assert/strict'
import test from 'node:test'
import { SideChatController, SideChatRegistry, addressOf } from '../src/client/controller.js'
import { disallowedSideTool, SIDE_BOUNDARY } from '../src/boundary.js'

test('window controller preserves the current chat and closes explicitly', async () => {
  const requests = []
  const controller = new SideChatController({ owner: () => 'a'.repeat(32), request: async input => {
    requests.push(input)
    return input.action === 'open' ? { sessionId: 'side-fixture' } : {}
  } })
  const chat = await controller.open('source', 3)
  assert.equal((await controller.open('source', 3)), chat)
  await assert.rejects(controller.open('source', 5), /onlyOne/)
  assert.equal(requests.filter(item => item.action === 'open').length, 1)
  await controller.retryCleanup()
  await Promise.all([controller.close(), controller.close()])
  assert.equal(requests.filter(item => item.action === 'close').length, 1)
  assert.equal(controller.snapshot.chat, undefined)
})

test('different source conversations own independent chats, drafts and closing state', async () => {
  let sequence = 0
  const registry = new SideChatRegistry({ owner: () => String(++sequence).padStart(32, 'x'), request: async input => input.action === 'open'
    ? { sessionId: `side-${input.sourceSessionId}` } : {} })
  const a = registry.forSource('source-a'), b = registry.forSource('source-b')
  await Promise.all([a.open('source-a', 1), b.open('source-b', 2)])
  a.queueReference('side-source-a', { ref: 'a-draft' })
  b.queueReference('side-source-b', { ref: 'b-draft' })
  assert.notEqual(a.snapshot.chat.owner, b.snapshot.chat.owner)
  assert.equal(registry.forSource('source-a'), a)
  assert.equal(registry.findSession('side-source-b'), b)
  assert.equal(registry.findAddress(addressOf('side-source-a')), a)
  await a.close()
  assert.equal(registry.findSession('side-source-a'), undefined)
  assert.equal(b.snapshot.phase, 'open')
  assert.deepEqual(b.snapshot.references.map(item => item.reference.ref), ['b-draft'])
  assert.equal(registry.findAddress(addressOf('side-source-b')), b)
})

test('failed cleanup in one source does not block creating or closing another side chat', async () => {
  let sequence = 0, fail = true
  const registry = new SideChatRegistry({ owner: () => String(++sequence).padStart(32, 'y'), request: async input => {
    if (input.action === 'close' && input.sessionId === 'side-a' && fail) throw new Error('network')
    return input.action === 'open' ? { sessionId: `side-${input.sourceSessionId}` } : {}
  } })
  const a = registry.forSource('a')
  await a.open('a', 1)
  await assert.rejects(a.close(), /network/)
  const b = registry.forSource('b')
  await b.open('b', 1)
  await b.close()
  assert.equal(a.snapshot.phase, 'closing')
  assert.equal(b.snapshot.phase, 'idle')
  fail = false
  await registry.retryCleanup()
  assert.equal(a.snapshot.phase, 'idle')
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

for (const outcome of ['reply', 'failure']) {
  test(`a late opening ${outcome} cannot close a replacement chat or clear its draft`, async () => {
    let finishOld, owner = 0
    const requests = []
    const controller = new SideChatController({ owner: () => String(++owner).padStart(32, 'x'), request: async input => {
      requests.push(input)
      if (input.action !== 'open') return {}
      if (input.sourceSessionId === 'old-source') return new Promise((resolve, reject) => {
        finishOld = () => outcome === 'reply' ? resolve({ sessionId: 'side-old' }) : reject(new Error('network'))
      })
      return { sessionId: 'side-new' }
    } })
    const opening = controller.open('old-source', 1)
    const rejected = assert.rejects(opening, outcome === 'reply' ? /expired/ : /network/)
    await controller.close()
    const replacement = await controller.open('new-source', 2)
    const reference = { source: 'eduwork-annotation', ref: 'synthetic-new-draft' }
    const id = controller.queueReference(replacement.sessionId, reference)
    finishOld()
    await rejected
    assert.equal(controller.snapshot.chat, replacement)
    assert.equal(controller.snapshot.phase, 'open')
    assert.equal(controller.snapshot.error, undefined)
    assert.deepEqual(controller.snapshot.references, [{ id, sessionId: replacement.sessionId, reference }])
    assert.equal(requests.some(input => input.action === 'close' && input.owner === replacement.owner), false)
    if (outcome === 'reply') assert.ok(requests.some(input => input.action === 'close' && input.sessionId === 'side-old'))
  })
}

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
  await controller.retryCleanup()
  assert.equal(controller.snapshot.chat, undefined)
})

test('cleanup polling never renews or closes an open chat and preserves its draft', async () => {
  const requests = []
  const controller = new SideChatController({ owner: () => 'd'.repeat(32), request: async input => {
    requests.push(input.action)
    return { sessionId: 'side-fixture' }
  } })
  const chat = await controller.open('source', 1)
  const id = controller.queueReference(chat.sessionId, { source: 'eduwork-annotation', ref: 'draft' })
  for (let poll = 0; poll < 100; poll++) await controller.retryCleanup()
  assert.equal(controller.snapshot.chat, chat)
  assert.equal(controller.snapshot.references[0].id, id)
  assert.equal(controller.snapshot.error, undefined)
  assert.deepEqual(requests, ['open'])
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

test('cleanup polling shares an in-flight explicit close without creating a notice', async () => {
  let finishClose, closes = 0
  const controller = new SideChatController({ owner: () => 'f'.repeat(32), request: input => {
    if (input.action === 'close') { closes++; return new Promise(resolve => { finishClose = resolve }) }
    return Promise.resolve({ sessionId: 'side-fixture' })
  } })
  await controller.open('source', 1)
  const closing = controller.close()
  const retry = controller.retryCleanup()
  assert.equal(closes, 1)
  assert.equal(controller.snapshot.error, undefined)
  finishClose({})
  await Promise.all([closing, retry])
  assert.equal(controller.snapshot.error, undefined)
})
