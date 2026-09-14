import assert from 'node:assert/strict'
import test from 'node:test'
import { isOfficePreview, isStreamPreview, isTextPreview, parseByteRange, previewLimit, previewType } from '../lib/core.js'

test('supports safe bounded inline preview formats', () => {
  assert.equal(previewType('report.PDF'), 'application/pdf')
  assert.equal(previewType('notes.md'), 'text/markdown')
  assert.equal(previewType('slides.pptx'), 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
  assert.equal(previewType('report.docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  assert.equal(previewType('book.xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  assert.equal(isOfficePreview(previewType('report.docx')), true)
  assert.equal(isTextPreview('application/json'), true)
  assert.equal(previewType('movie.mp4'), 'video/mp4')
  assert.equal(isStreamPreview('video/mp4'), true)
  assert.ok(previewLimit('text/plain') < previewLimit('image/png'))
})

test('parses one bounded HTTP byte range for media streaming', () => {
  assert.deepEqual(parseByteRange('bytes=10-19', 100), { start: 10, end: 19 })
  assert.deepEqual(parseByteRange('bytes=90-', 100), { start: 90, end: 99 })
  assert.deepEqual(parseByteRange('bytes=-10', 100), { start: 90, end: 99 })
  assert.equal(parseByteRange('bytes=100-101', 100), null)
  assert.equal(parseByteRange('bytes=1-2,4-5', 100), null)
})
