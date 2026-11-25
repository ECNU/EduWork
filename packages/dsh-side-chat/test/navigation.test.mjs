import assert from 'node:assert/strict'
import test from 'node:test'
import { SideChatRegistry } from '../src/client/controller.js'
import { SideChatNavigation } from '../src/client/navigation.js'

function fixture({ closeFails = false } = {}) {
  let sequence = 0, mounted = 'source', active
  const pending = [], closed = [], tabs = []
  const registry = new SideChatRegistry({ owner: () => String(++sequence).padStart(32, 'x'), request: input => {
    if (input.action === 'close') { closed.push(input); return closeFails ? Promise.reject(new Error('archive failed')) : Promise.resolve({}) }
    return new Promise(resolve => pending.push({ input, finish: () => resolve({ sessionId: `side-${input.owner}` }) }))
  } })
  const sidebar = {
    mounted: { getSnapshot: () => mounted },
    active: () => active,
    tabsIn: () => tabs,
    openResource: contentId => {
      let tab = tabs.find(item => item.contentId === contentId)
      if (!tab) { tab = { id: `tab-${tabs.length}`, contentId }; tabs.push(tab) }
      active = tab
    },
    focus: id => { active = tabs.find(tab => tab.id === id) },
  }
  return { registry, sidebar, pending, closed, tabs, setMounted: value => { mounted = value },
    navigation: new SideChatNavigation({ registry, sidebar, title: topic => topic }) }
}

test('late earlier creation adds its tab without stealing the newest focus or reference', async () => {
  const f = fixture()
  const old = f.navigation.open({ sourceSessionId: 'source', atSeq: 1, reference: { ref: 'old' } })
  const next = f.navigation.open({ sourceSessionId: 'source', atSeq: 2, reference: { ref: 'new' } })
  f.pending[1].finish()
  const newest = await next
  assert.ok(f.sidebar.active().contentId.endsWith(newest.sessionId))
  f.pending[0].finish()
  const earlier = await old
  assert.equal(f.tabs.length, 2)
  assert.ok(f.sidebar.active().contentId.endsWith(newest.sessionId))
  assert.equal(f.registry.findSession(earlier.sessionId).snapshot.references[0].reference.ref, 'old')
  assert.equal(f.registry.findSession(newest.sessionId).snapshot.references[0].reference.ref, 'new')
})

test('navigating away during a new creation archives its orphan after all waiters finish', async () => {
  const f = fixture()
  const first = f.navigation.open({ sourceSessionId: 'source', atSeq: 3, reference: { ref: 'first' } })
  const second = f.navigation.open({ sourceSessionId: 'source', atSeq: 2, reference: { ref: 'second' } })
  assert.equal(f.pending.length, 1)
  const results = Promise.allSettled([first, second])
  f.setMounted('other')
  f.pending[0].finish()
  assert.deepEqual((await results).map(result => result.status), ['rejected', 'rejected'])
  assert.equal(f.closed.length, 1)
  assert.equal(f.tabs.length, 0)
  assert.equal(f.registry.all().length, 0)
})

test('a failed orphan cleanup keeps the navigation outcome and stays retryable', async () => {
  const f = fixture({ closeFails: true })
  const opening = f.navigation.open({ sourceSessionId: 'source', atSeq: 3 })
  f.setMounted('other')
  f.pending[0].finish()
  await assert.rejects(opening, /expired/)
  const [owner] = f.registry.all()
  assert.equal(owner.snapshot.phase, 'closing')
  assert.equal(owner.snapshot.error, undefined)
})

test('navigating away while reusing an existing tab never closes it', async () => {
  const f = fixture()
  const opening = f.navigation.open({ sourceSessionId: 'source', atSeq: 3 })
  f.pending[0].finish()
  const chat = await opening
  f.setMounted('other')
  await assert.rejects(f.navigation.open({ sourceSessionId: 'source', atSeq: 2 }), /expired/)
  assert.equal(f.closed.length, 0)
  assert.equal(f.registry.findSession(chat.sessionId).snapshot.phase, 'open')
})
