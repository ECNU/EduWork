import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeExcerpt, pickTextPart, PREVIEW_BYTES, readBounded, textLeaves } from '../src/host/preview.js'

const streamOf = (chunks) => {
  const state = { destroyed: false, sent: 0, index: 0 }
  state.stream = {
    async *[Symbol.asyncIterator]() {
      for (; state.index < chunks.length; state.index++) {
        state.sent += chunks[state.index].length
        yield chunks[state.index]
      }
    },
    destroy() { state.destroyed = true },
  }
  return state
}

test('a preview download stops at the byte cap instead of reading the whole body', async () => {
  const chunk = Buffer.alloc(64 * 1024, 0x61)
  const state = streamOf(Array.from({ length: 32 }, () => chunk))
  const result = await readBounded(state.stream, { maxBytes: PREVIEW_BYTES })
  assert.equal(result.bytes, PREVIEW_BYTES)
  assert.equal(result.truncated, true)
  // 2 MiB of body must cost one chunk of transfer and one destroyed stream.
  assert.equal(state.sent, 64 * 1024)
  assert.equal(state.destroyed, true)
  assert.equal(result.text.length, PREVIEW_BYTES)
})

test('a body smaller than the cap is read whole and not marked truncated', async () => {
  const state = streamOf([Buffer.from('hello '), Buffer.from('world')])
  const result = await readBounded(state.stream, { maxBytes: 64 })
  assert.deepEqual({ text: result.text, bytes: result.bytes, truncated: result.truncated }, { text: 'hello world', bytes: 11, truncated: false })
  assert.equal(state.destroyed, true)
})

test('the cap cuts inside a chunk rather than overshooting it', async () => {
  const state = streamOf(Array.from({ length: 10 }, () => Buffer.alloc(4096, 0x62)))
  const result = await readBounded(state.stream, { maxBytes: 10_000 })
  assert.equal(result.text.length, 10_000)
  assert.equal(result.bytes, 10_000)
  assert.equal(result.truncated, true)
  assert.equal(state.sent, 12_288)
})

test('cancelling a preview throws and still releases the stream', async () => {
  const controller = new AbortController()
  const state = streamOf(Array.from({ length: 4 }, () => Buffer.alloc(16, 0x63)))
  state.stream[Symbol.asyncIterator] = async function* () {
    for (let index = 0; index < 4; index++) {
      if (index === 2) controller.abort(new Error('Mail preview cancelled'))
      yield Buffer.alloc(16, 0x63)
    }
  }
  await assert.rejects(() => readBounded(state.stream, { maxBytes: 1024, signal: controller.signal }), /cancelled/)
  assert.equal(state.destroyed, true)
})

test('the preview part is the first inline text leaf, plain text before HTML', () => {
  const alternative = {
    type: 'multipart/alternative',
    childNodes: [
      { part: '1', type: 'text/html', parameters: { charset: 'utf-8' } },
      { part: '2', type: 'text/plain', parameters: { charset: 'utf-8' } },
    ],
  }
  assert.deepEqual(textLeaves(alternative).map(leaf => leaf.part), ['2', '1'])
  assert.equal(textLeaves(alternative)[0].type, 'text/plain')
  assert.deepEqual(pickTextPart(alternative).map(leaf => leaf.part), ['1', '2'])

  const single = { type: 'text/plain', parameters: { charset: 'utf-8' } }
  assert.equal(textLeaves(single)[0].part, '1')

  const withAttachment = {
    type: 'multipart/mixed',
    childNodes: [
      { part: '1', type: 'text/plain' },
      { part: '2', type: 'text/plain', disposition: 'attachment', dispositionParameters: { filename: 'notes.txt' } },
    ],
  }
  assert.deepEqual(textLeaves(withAttachment).map(leaf => leaf.part), ['1'])
  assert.deepEqual(textLeaves({ type: 'multipart/mixed', childNodes: [{ part: '1', type: 'image/png' }] }), [])
})

test('an excerpt is one readable line and respects the character limit', () => {
  const html = '<style>p{}</style><p>第一段 &amp; 第二段</p><div>第三段</div>'
  assert.equal(normalizeExcerpt(html, { chars: 160, html: true }), '第一段 & 第二段 第三段')
  assert.equal(normalizeExcerpt('a\n\nb\tc', { chars: 160 }), 'a b c')
  assert.equal(normalizeExcerpt('🙂🙂🙂🙂', { chars: 2 }), '🙂🙂')
  assert.equal(normalizeExcerpt('anything', { chars: 0 }), '')
})
