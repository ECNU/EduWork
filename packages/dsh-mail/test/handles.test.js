import assert from 'node:assert/strict'
import test from 'node:test'
import {
  attachmentHandle, messageHandle, parseAttachmentHandle, parseMessageHandle, parseSearchCursor, searchCursor,
} from '../src/host/handles.js'

test('message handles round-trip unicode folders and UIDVALIDITY', () => {
  const handle = messageHandle({ folder: '收件箱/项目', uidValidity: 9223372036854775807n, uid: 42 })
  assert.deepEqual(parseMessageHandle(handle), { folder: '收件箱/项目', uidValidity: '9223372036854775807', uid: 42 })
})

test('invalid and stale-shaped handles fail closed', () => {
  assert.throws(() => parseMessageHandle('INBOX:4'), /Invalid mail handle/)
  assert.throws(() => parseMessageHandle('dshmail:m1:e30'), /Invalid mail handle/)
})

test('attachment handles bind message, part and bounded metadata', () => {
  const message = messageHandle({ folder: 'INBOX', uidValidity: '10', uid: 7 })
  const handle = attachmentHandle({ message, part: '2.1', filename: 'report.pdf', contentType: 'application/pdf', size: 1234 })
  assert.deepEqual(parseAttachmentHandle(handle), { message, part: '2.1', filename: 'report.pdf', contentType: 'application/pdf', size: 1234 })
})

test('search cursors carry one complete stable continuation', () => {
  const cursor = searchCursor({
    folder: '收件箱/项目', uidValidity: 9223372036854775807n, boundary: 42,
    query: '项目', since: '2024-01-01T00:00:00.000Z', before: '2025-01-01T00:00:00.000Z',
    unreadOnly: true, order: 'newest',
  })
  assert.deepEqual(parseSearchCursor(cursor), {
    folder: '收件箱/项目', uidValidity: '9223372036854775807', boundary: 42,
    query: '项目', since: '2024-01-01T00:00:00.000Z', before: '2025-01-01T00:00:00.000Z',
    unreadOnly: true, order: 'newest',
  })
  assert.throws(() => parseSearchCursor('dshmail:s1:e30'), /Invalid search cursor/)
})
