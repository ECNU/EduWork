import assert from 'node:assert/strict'
import test from 'node:test'
import { searchCursor } from '../src/host/handles.js'
import { internals } from '../src/host/mail-client.js'

test('newest-first cursor pages cover matching UIDs exactly once', () => {
  const uids = [1, 2, 3, 4, 5, 6, 7, 7]
  const first = internals.selectUidPage(uids, { order: 'newest', boundary: undefined, limit: 3 })
  const second = internals.selectUidPage(uids, { order: 'newest', boundary: first.selected.at(-1), limit: 3 })
  const third = internals.selectUidPage(uids, { order: 'newest', boundary: second.selected.at(-1), limit: 3 })
  assert.deepEqual(first, { selected: [7, 6, 5], hasMore: true })
  assert.deepEqual(second, { selected: [4, 3, 2], hasMore: true })
  assert.deepEqual(third, { selected: [1], hasMore: false })
  assert.deepEqual([...first.selected, ...second.selected, ...third.selected], [7, 6, 5, 4, 3, 2, 1])
})

test('oldest-first cursor pages advance in the opposite direction', () => {
  const first = internals.selectUidPage([4, 1, 5, 2, 3], { order: 'oldest', boundary: undefined, limit: 2 })
  const second = internals.selectUidPage([4, 1, 5, 2, 3], { order: 'oldest', boundary: first.selected.at(-1), limit: 2 })
  const third = internals.selectUidPage([4, 1, 5, 2, 3], { order: 'oldest', boundary: second.selected.at(-1), limit: 2 })
  assert.deepEqual(first, { selected: [1, 2], hasMore: true })
  assert.deepEqual(second, { selected: [3, 4], hasMore: true })
  assert.deepEqual(third, { selected: [5], hasMore: false })
})

test('search cursor carries filters and only page size may change', () => {
  const cursor = searchCursor({
    folder: 'Archive/2025', uidValidity: '9', boundary: 200, query: 'project',
    since: '2025-01-01T00:00:00.000Z', before: '2026-01-01T00:00:00.000Z', unreadOnly: false, order: 'newest',
  })
  const normalized = internals.normalizeSearchArgs({ inboxFolder: 'INBOX' }, { cursor, limit: 50 })
  assert.equal(normalized.folder, 'Archive/2025')
  assert.equal(normalized.boundary, 200)
  assert.equal(normalized.limit, 50)
  assert.equal(normalized.since.toISOString(), '2025-01-01T00:00:00.000Z')
  assert.throws(() => internals.normalizeSearchArgs({ inboxFolder: 'INBOX' }, { cursor, query: 'changed' }), /only limit may change/)
  assert.throws(() => internals.normalizeSearchArgs({ inboxFolder: 'INBOX' }, { since: '2026-01-02', until: '2026-01-01' }), /Invalid date range/)
})

test('folder metadata preserves exact server paths and selectability', () => {
  assert.deepEqual(internals.listedFolder({
    path: 'Archive/2025', name: '2025', delimiter: '/', specialUse: '\\Archive', subscribed: true,
    flags: new Set(['\\HasNoChildren']),
  }), { path: 'Archive/2025', name: '2025', delimiter: '/', specialUse: '\\Archive', subscribed: true, selectable: true })
  assert.equal(internals.listedFolder({ path: 'Groups', flags: new Set(['\\Noselect']) }).selectable, false)
})
