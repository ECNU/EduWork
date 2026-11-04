import test from 'node:test'
import assert from 'node:assert/strict'
import { describeArrival, localStamp, plain, clip, readingPayload, TITLE_LIMIT, PREVIEW_LIMIT, TARGET_LIMIT } from '../lib/text.js'

test('plain collapses whitespace and drops control characters', () => {
  assert.equal(plain('  a\u0000b\tc\u007f  d\n'), 'a b c d')
  assert.equal(plain(undefined), '')
})

test('plain keeps a complete emoji pair', () => {
  assert.equal(plain('提醒 🐳 到达'), '提醒 🐳 到达')
})

test('clip counts code points, not UTF-16 units', () => {
  const kept = clip('🐳🐳🐳🐳', 2)
  assert.equal([...kept].length, 2)
  assert.equal(kept, '🐳…')
  assert.equal(clip('short', 10), 'short')
})

test('a single arrival uses the subject and the sender', () => {
  const text = describeArrival({ subject: '成绩单已更新', from: '教务处', count: 1 })
  // The bubble has no surrounding context, so the title names the source.
  assert.equal(text.title, '新邮件：成绩单已更新')
  assert.equal(text.preview, '教务处')
})

test('an empty subject still produces a usable title', () => {
  assert.equal(describeArrival({ subject: '', from: '', count: 1 }).title, '新邮件：（无主题）')
})

test('a merged batch keeps the count and the newest subject', () => {
  const text = describeArrival({ subject: '第三封', from: '教务处', count: 3 })
  assert.equal(text.title, '3 封新邮件')
  assert.match(text.preview, /^3 封新邮件，最新：第三封$/u)
})

test('titles and previews stay inside the protocol limits', () => {
  const text = describeArrival({ subject: '主'.repeat(400), from: '发'.repeat(400), count: 1 })
  assert.ok([...text.title].length <= TITLE_LIMIT)
  assert.ok([...text.preview].length <= PREVIEW_LIMIT)
})

test('the reading payload serializes inside the target budget', () => {
  const payload = readingPayload({
    subject: '主题'.repeat(100),
    from: 'someone@example.com',
    date: '2026-10-23T06:00:00.000Z',
    body: '正文'.repeat(20_000),
    truncated: true,
    attachments: Array.from({ length: 20 }, (_, index) => `附件-${index}.pdf`),
  }, { folder: 'INBOX', uid: 42 })
  assert.ok(JSON.stringify(payload).length <= TARGET_LIMIT, 'payload must fit the 4096-character target budget')
  assert.equal(payload.uid, 42)
  assert.equal(payload.folder, 'INBOX')
  assert.ok([...payload.subject].length <= TITLE_LIMIT)
  assert.equal(payload.attachments.length, 20)
})

test('a short message keeps its whole body', () => {
  const payload = readingPayload({ subject: 's', from: 'f', date: 'd', body: '短正文', attachments: [] }, { folder: 'INBOX', uid: 7 })
  assert.equal(payload.text, '短正文')
  assert.equal(payload.truncated, false)
})

test('localStamp renders the envelope date in the reader zone', () => {
  assert.equal(localStamp('2026-11-02T06:28:59.000Z', { timeZone: 'Asia/Shanghai' }), '2026-11-02 14:28')
  assert.equal(localStamp('2026-11-02T06:28:59.000Z', { timeZone: 'UTC' }), '2026-11-02 06:28')
  // Midnight must read 00:00: hour12:false alone can render it as 24:00.
  assert.equal(localStamp('2026-11-01T16:00:00.000Z', { timeZone: 'Asia/Shanghai' }), '2026-11-02 00:00')
  assert.equal(localStamp(new Date('2026-11-02T06:28:59.000Z'), { timeZone: 'Asia/Shanghai' }), '2026-11-02 14:28')
})

test('localStamp keeps unparsable dates and empties visible', () => {
  // A wrong date is worse than a raw one, so unknown shapes pass through.
  assert.equal(localStamp('not a date'), 'not a date')
  assert.equal(localStamp(''), '')
  assert.equal(localStamp(undefined), '')
  assert.equal(localStamp(null), '')
})

test('the reading payload carries a formatted date', () => {
  const payload = readingPayload({
    subject: 's', from: 'f', date: 'd', body: '正文', attachments: [],
  }, { folder: 'INBOX', uid: 7 })
  assert.equal(payload.date, 'd')
})