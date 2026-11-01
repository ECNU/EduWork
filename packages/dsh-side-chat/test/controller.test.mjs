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

test('snapshot routing prefers the focused eligible chat and otherwise preserves creation order', async () => {
  let count = 0
  const registry = new SideChatRegistry({ owner: () => String(++count).padStart(32, 'r'), request: async input => input.action === 'open'
    ? { sessionId: `side-${input.owner}` } : {} })
  const create = async seq => {
    const owner = registry.select('source', seq)
    const chat = await owner.open('source', seq)
    return { owner, chat }
  }
  const a = await create(10), b = await create(20), c = await create(30)
  assert.equal(registry.select('source', 25, addressOf(a.chat.sessionId)), c.owner)
  assert.equal(registry.select('source', 15, addressOf(b.chat.sessionId)), b.owner)
  assert.equal(registry.select('source', 15, addressOf(c.chat.sessionId)), c.owner)
  assert.equal(registry.select('source', 15, addressOf(a.chat.sessionId)), b.owner)
  assert.equal(registry.select('source', 5, addressOf(c.chat.sessionId)), c.owner)
  assert.equal(registry.select('source', 15, 'unrelated-tab'), b.owner)
  const d = registry.select('source', 40, addressOf(c.chat.sessionId))
  assert.notEqual(d, a.owner); assert.notEqual(d, b.owner); assert.notEqual(d, c.owner)
  assert.deepEqual(registry.all(), [a.owner, b.owner, c.owner, d])
  await b.owner.close()
  assert.equal(registry.select('source', 15, addressOf(a.chat.sessionId)), c.owner)
  assert.equal(a.owner.snapshot.phase, 'open')
  assert.equal(c.owner.snapshot.phase, 'open')
})

test('concurrent references to a covered pending snapshot share its creation', async () => {
  let resolveOpen, opens = 0
  const registry = new SideChatRegistry({ owner: () => 'w'.repeat(32), request: input => {
    if (input.action !== 'open') return Promise.resolve({})
    opens++
    return new Promise(resolve => { resolveOpen = resolve })
  } })
  const first = registry.select('source', 20)
  const opening = first.open('source', 20)
  const selected = registry.select('source', 10)
  assert.equal(selected, first)
  const second = selected.open('source', selected.snapshot.chat.atSeq)
  assert.equal(opens, 1)
  resolveOpen({ sessionId: 'side-pending' })
  assert.equal((await opening).sessionId, (await second).sessionId)
})

test('live selections require a captured prefix from the same response', async () => {
  let count = 0
  const registry = new SideChatRegistry({ owner: () => String(++count).padStart(32, 'l'), request: async input => input.action === 'open'
    ? { sessionId: `side-${input.owner}` } : {} })
  const durable = registry.select('source', 5)
  await durable.open('source', 5)
  const first = registry.select('source', 5, addressOf(durable.snapshot.chat.sessionId), { key: 'step-1', prefix: 'hello', text: 'hello world' })
  assert.notEqual(first, durable)
  await first.open('source', 5)
  assert.equal(registry.select('source', 5, undefined, { key: 'step-1', prefix: 'hello wor', text: 'hello world plus' }), first)
  const next = registry.select('source', 5, addressOf(first.snapshot.chat.sessionId), { key: 'step-1', prefix: 'hello world plus', text: 'hello world plus' })
  assert.notEqual(next, first)
  await next.open('source', 5)
  assert.equal(registry.select('source', 5, addressOf(next.snapshot.chat.sessionId), { key: 'step-1', prefix: 'hello', text: 'hello world plus' }), next)
  assert.notEqual(registry.select('source', 5, undefined, { key: 'other-step', prefix: 'hello', text: 'hello' }), first)
  assert.notEqual(registry.select('source', 5, undefined, {}), first, 'legacy live references cannot assert coverage')
})

test('closing releases snapshot and controller without disturbing other snapshot order', async () => {
  let count = 0
  const registry = new SideChatRegistry({ owner: () => String(++count).padStart(32, 'm'), request: async input => input.action === 'open'
    ? { sessionId: `side-${input.owner}` } : {} })
  const first = registry.select('source', 1, undefined, { key: 'step', prefix: 'one', text: 'one private content' })
  await first.open('source', 1)
  const second = registry.select('source', 2)
  await second.open('source', 2)
  await first.close()
  assert.equal(first.liveSnapshot, undefined)
  assert.deepEqual(registry.all(), [second])
  await second.close()
  assert.equal(registry.controllers.has('source'), false)
  assert.deepEqual(registry.all(), [])
})

test('an idle error stays available for notification and is released after dismissal', () => {
  const registry = new SideChatRegistry({ owner: () => 'n'.repeat(32), request: async () => ({}) })
  const owner = registry.forSource('source')
  owner.update({ error: 'failed' })
  assert.equal(registry.findSource('source').snapshot.error, 'failed')
  owner.update({ error: undefined })
  assert.deepEqual(registry.all(), [])
})

test('failed archive retains owner for retry and clears memory after success', async () => {
  let failure = true
  const registry = new SideChatRegistry({ owner: () => 't'.repeat(32), request: async input => {
    if (input.action === 'close' && failure) throw new Error('archive failed')
    return input.action === 'open' ? { sessionId: 'side-retry' } : {}
  } })
  const owner = registry.select('source', 1, undefined, { key: 'step', prefix: 'one', text: 'one private content' })
  await owner.open('source', 1)
  await assert.rejects(owner.close(), /archive failed/)
  assert.equal(registry.findSession('side-retry'), owner)
  assert.ok(owner.liveSnapshot)
  failure = false
  await registry.retryCleanup()
  assert.equal(owner.liveSnapshot, undefined)
  assert.deepEqual(registry.all(), [])
})

test('a closed pending opener is removed only after its late result is handled', async () => {
  let resolveOpen, closeCount = 0
  const registry = new SideChatRegistry({ owner: () => 'p'.repeat(32), request: input => {
    if (input.action === 'open') return new Promise(resolve => { resolveOpen = resolve })
    closeCount++
    return Promise.resolve({})
  } })
  const owner = registry.select('source', 1, undefined, { key: 'step', prefix: 'one', text: 'one private content' })
  const opening = owner.open('source', 1)
  const rejected = assert.rejects(opening, /expired/)
  await owner.close()
  assert.equal(owner.liveSnapshot, undefined)
  assert.deepEqual(registry.all(), [owner])
  resolveOpen({ sessionId: 'side-late' })
  await rejected
  assert.equal(closeCount, 2)
  assert.deepEqual(registry.all(), [])
})

test('late cleanup of a closed opener preserves a new snapshot from the same source', async () => {
  let finishOld, sequence = 0
  const registry = new SideChatRegistry({ owner: () => String(++sequence).padStart(32, 'u'), request: input => {
    if (input.action !== 'open') return Promise.resolve({})
    if (input.atSeq === 1) return new Promise(resolve => { finishOld = resolve })
    return Promise.resolve({ sessionId: 'side-new' })
  } })
  const old = registry.select('source', 1)
  const opening = old.open('source', 1)
  const rejected = assert.rejects(opening, /expired/)
  await old.close()
  const fresh = registry.select('source', 2)
  await fresh.open('source', 2)
  finishOld({ sessionId: 'side-old' })
  await rejected
  assert.deepEqual(registry.all(), [fresh])
  assert.equal(registry.findSession('side-new'), fresh)
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
