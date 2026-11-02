import test from 'node:test'
import assert from 'node:assert/strict'
import { describeArrival, plain, clip, readingPayload, TITLE_LIMIT, PREVIEW_LIMIT, TARGET_LIMIT } from '../lib/text.js'

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
  assert.equal(text.title, '成绩单已更新')
  assert.equal(text.preview, '教务处')
})

test('an empty subject still produces a usable title', () => {
  assert.equal(describeArrival({ subject: '', from: '', count: 1 }).title, '（无主题）')
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
