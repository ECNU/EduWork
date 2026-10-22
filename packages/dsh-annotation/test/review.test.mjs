import assert from 'node:assert/strict'
import test from 'node:test'
import { envelope, fragment, prepareMessage, projectAnnotations, REF_OPEN, REF_CLOSE } from '../src/protocol.js'
import { sentAnnotationRule } from '../src/client/sent.js'

const message = text => ({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })
const wire = value => `${REF_OPEN}${JSON.stringify(value)}${REF_CLOSE}`

test('unknown fields are not hidden or dropped by pre-step, including nested metadata', () => {
  const values = [
    { text: 'quote', extra: 'must survive' },
    { text: 'quote', source: { sessionId: 's', messageId: 'm', extra: 'must survive' } },
    { text: 'quote', context: { before: '', after: '', extra: 'must survive' } },
  ]
  const texts = values.flatMap(value => [wire(value), envelope([value], 'question')])
  texts.push(envelope([{ text: 'quote' }], 'question').replace('"version":1', '"extra":"must survive","version":1'))
  for (const text of texts) {
    const input = message(text)
    assert.equal(projectAnnotations(text), undefined)
    assert.equal(prepareMessage(input), input)
    assert.equal(sentAnnotationRule.match(text, 0), undefined)
  }
})

test('native user-text fallback renders pending fragments and leaves normal text and file references to DSH', () => {
  const prefix = '请看 @文件.txt\n', middle = '\n再看另一处\n', suffix = '\n我的问题'
  const one = fragment({ quote: 'first', note: 'explain' }), two = fragment({ quote: 'second', note: '' })
  const text = prefix + one + middle + two + suffix
  const first = sentAnnotationRule.match(text, 0)
  assert.deepEqual(first.data.items, [{ index: 1, quote: 'first', note: 'explain' }])
  const second = sentAnnotationRule.match(text, first.end)
  assert.deepEqual(second.data.items, [{ index: 2, quote: 'second', note: '' }])
  assert.equal(text.slice(0, first.start), prefix + '\n')
  assert.equal(text.slice(first.end, second.start), '\n' + middle + '\n')
  assert.equal(text.slice(second.end), '\n' + suffix)
  assert.equal(sentAnnotationRule.match(text, second.end), undefined)
})

test('native user-text fallback consumes the complete envelope only and keeps code examples unchanged', () => {
  const text = envelope([{ text: 'first', comment: 'why' }, { text: 'second' }], '普通问题')
  const result = sentAnnotationRule.match(text, 0)
  assert.deepEqual(result.data.items, [{ index: 1, quote: 'first', note: 'why' }, { index: 2, quote: 'second', note: '' }])
  assert.equal(text.slice(result.end), '\n\n普通问题')
  assert.equal(sentAnnotationRule.match(text, result.end), undefined)
  for (const sample of ['```xml\n'+text+'\n```', '`'+wire({text:'example'})+'`']) {
    assert.equal(sentAnnotationRule.match(sample, 0), undefined)
  }
})
