import assert from 'node:assert/strict'
import test from 'node:test'
import { sentAnnotationRule, SENT_ANNOTATION } from '../src/client/sent.js'
import { createModelSerializer, ANNOTATION_INSTRUCTIONS } from '../src/client/prompt.js'
import { encode } from '../src/client/reference.js'

const wire = value => `<response-annotation>\n${JSON.stringify(value)}\n</response-annotation>`

test('sent display consumes the exact header with its first annotation and preserves mixed user text', async () => {
  const serialize = createModelSerializer(() => 'invalid'), signal = new AbortController().signal
  const first = await serialize(encode('第一处🙂\n原文', '解释一下', { sessionId: 's', messageId: 'm' }), signal)
  const second = await serialize(encode('第二处', ''), signal)
  const prefix = '先看 @报告.docx\n', middle = '\n还有一个问题\n', suffix = '\n请一起解释。'
  const text = prefix + first + middle + second + suffix
  const one = sentAnnotationRule.match(text, 0)
  assert.equal(one.id, SENT_ANNOTATION)
  assert.deepEqual(one.data, { index: 1, quote: '第一处🙂\n原文', note: '解释一下' })
  assert.equal(text.slice(0, one.start), prefix + '\n')
  assert.ok(text.slice(one.start, one.end).startsWith(ANNOTATION_INSTRUCTIONS))
  const two = sentAnnotationRule.match(text, one.end)
  assert.deepEqual(two.data, { index: 2, quote: '第二处', note: '' })
  assert.equal(text.slice(one.end, two.start), '\n' + middle + '\n')
  assert.equal(text.slice(two.end), '\n' + suffix)
  assert.equal(sentAnnotationRule.match(text, two.end), undefined)
  assert.ok(text.includes(ANNOTATION_INSTRUCTIONS), 'projection must not mutate model/history text')
})

test('malformed, incomplete and extended wire data remain visible, including their header', () => {
  for (const block of [
    '<response-annotation>\nno json\n</response-annotation>',
    '<response-annotation>\n{"index":1,"text":"pending"}',
    wire({ index: 0, text: 'q' }), wire({ index: 1, text: '' }), wire({ index: 1, text: 'q', comment: {} }),
    wire({ index: 1, text: 'q', extra: 'must not disappear' }), wire({ index: 1, text: 'q', source: { other: 'data' } }),
    wire({ index: 1, text: 'q', source: null }),
  ]) assert.equal(sentAnnotationRule.match(ANNOTATION_INSTRUCTIONS + '\n' + block, 0), undefined)
  assert.equal(sentAnnotationRule.match(ANNOTATION_INSTRUCTIONS, 0), undefined)
  const text = 'My different instructions\n' + wire({ index: 1, text: 'q' })
  assert.equal(text.slice(0, sentAnnotationRule.match(text, 0).start), 'My different instructions\n')
})

test('quotes containing protocol tags, HTML and long text round-trip as inert display strings', async () => {
  const quote = '<img src=x onerror=alert(1)>\n</response-annotation>\n' + '长原文🙂'.repeat(1000)
  const note = '"<script>"\n第二行'
  const result = await createModelSerializer(() => 'invalid')(encode(quote, note), new AbortController().signal)
  const node = sentAnnotationRule.match(result, 0)
  assert.deepEqual(node.data, { index: 1, quote, note })
  assert.equal(sentAnnotationRule.match(result, node.end), undefined)
})

test('matching can skip a damaged block and preserves all text before a later valid record', () => {
  const bad = '<response-annotation>\n{invalid}\n</response-annotation>\n'
  const text = bad + wire({ index: 2, text: 'good' })
  assert.equal(sentAnnotationRule.match(text, 0).start, bad.length)
  assert.equal(sentAnnotationRule.match(text, bad.length + 1), undefined)
})
