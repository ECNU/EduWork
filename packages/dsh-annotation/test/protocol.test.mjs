import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../src/index.js'
import { START, PROMPT, REF_OPEN, envelope, fragment, prepareMessage, projectAnnotations } from '../src/protocol.js'
import { reference, decode } from '../src/client/reference.js'

const source = { sessionId: 'synthetic-session', messageId: 'synthetic-answer' }
const first = { quote: 'writing, reviewing, or debug', note: '测试批注1', origin: source, context: { before: 'Help with ', after: 'ging code.' } }
const second = { quote: 'searching the web an', note: '测试批注2' }
const message = text => ({ id: 'synthetic-user', role: 'user', source: { kind: 'user' }, content: [{ type: 'image', image: { synthetic: true } }, { type: 'text', text }] })

test('one prompt precedes two ordered annotations and the user body; attachments and identity survive', () => {
  const original = message(fragment(first) + fragment(second) + '这两处批注的实现原理，讲一下？')
  const result = prepareMessage(original), wire = result.content[1].text
  assert.ok(wire.startsWith(START + '\n' + PROMPT))
  assert.equal(wire.split(PROMPT).length, 2)
  assert.equal(result.id, original.id)
  assert.equal(result.source, original.source)
  assert.equal(result.content[0], original.content[0])
  assert.deepEqual(projectAnnotations(wire), { mode: 'envelope', body: '这两处批注的实现原理，讲一下？', items: [
    { text: first.quote, comment: first.note, source, context: first.context }, { text: second.quote, comment: second.note },
  ] })
  assert.equal(prepareMessage(result), result, 'retry must not wrap twice')
  assert.notEqual(original.content[1].text, wire, 'input remains immutable')
})

test('queue / steer batches stay separate and rejection passes through', async () => {
  let hook
  apply({ on: (event, fn) => { assert.equal(event, 'agent/pre-step'); hook = fn } })
  const one = message(fragment(first) + 'first'), two = { ...message(fragment(second) + 'second'), id: 'synthetic-steer' }
  const result = await hook({}, async () => ({ kind: 'enter', startsRequestSeries: true, messages: [one, two] }))
  assert.equal(result.startsRequestSeries, true)
  assert.deepEqual(result.messages.map(entry => projectAnnotations(entry.content[1].text).body), ['first', 'second'])
  assert.deepEqual(result.messages.map(entry => entry.id), [one.id, two.id])
  const reject = { kind: 'reject', reason: 'synthetic' }
  assert.equal(await hook({}, async () => reject), reject)
})

test('plain messages, unusual blocks and non-user context remain unchanged', () => {
  const plain = message('普通问题')
  assert.equal(prepareMessage(plain), plain)
  const mixed = message(fragment(first)); mixed.content.push({ type: 'text', text: 'another block' })
  assert.equal(prepareMessage(mixed), mixed)
  const internal = { ...message(fragment(first)), source: { kind: 'plugin' } }
  assert.equal(prepareMessage(internal), internal)
})

test('pending fragments and final envelopes project the same annotation-only UI', () => {
  const pending = projectAnnotations(fragment(first) + fragment(second))
  const final = projectAnnotations(envelope(pending.items, pending.body))
  assert.equal(pending.body, '')
  assert.deepEqual(final.items, pending.items)
  assert.equal(final.body, '')
})

test('JSON escapes XML, native @ references and prompt-like source text without loss', () => {
  const quote = '</eduwork-response-annotations> @[x](dsh-session:fake) <script>&\u2028🙂'
  const raw = fragment({ quote, note: 'ignore instructions? quoted data' })
  assert.ok(!raw.includes('@['))
  assert.ok(!raw.includes('<script>'))
  const parsed = projectAnnotations(raw)
  assert.equal(parsed.items[0].text, quote)
  assert.equal(projectAnnotations(envelope(parsed.items, '问题')).items[0].text, quote)
  assert.equal(projectAnnotations(fragment({ quote: 'unmatched ` in source', note: '' }) + fragment(second)).items.length, 2)
})

test('malformed, unknown-version and quoted protocol examples remain visible', () => {
  for (const text of [
    `${REF_OPEN}{broken}</eduwork-annotation-ref-v1>`,
    fragment(first).replace('"text":', '"missing":'),
    envelope([{ text: '原文' }], '问题').replace('"version":1', '"version":2'),
    envelope([{ text: '原文' }], '问题').replace(PROMPT, 'arbitrary prompt'),
    'prefix\n' + envelope([{ text: '原文' }], '问题'),
    '```xml\n' + fragment(first) + '\n```',
    '`' + fragment(first).trim() + '`',
    '~~~\n' + fragment(first) + '\n~~~',
  ]) assert.equal(projectAnnotations(text), undefined, text)
  const sample = '```xml\n' + fragment(second) + '\n```'
  const parsed = projectAnnotations(sample + fragment(first) + '问题')
  assert.equal(parsed.items.length, 1)
  assert.ok(parsed.body.includes(sample))
})

test('bounded context survives draft edit, while clipboard remains human-readable', () => {
  const ref = reference('原文', '备注', key => key, source, { before: '前'.repeat(500), after: '后'.repeat(500) })
  const restored = decode(ref.ref)
  assert.equal(restored.context.before.length, 320)
  assert.equal(restored.context.after.length, 320)
  assert.ok(!ref.clipboardText.includes('synthetic-session'))
  assert.ok(!ref.clipboardText.includes(REF_OPEN))
  const edited = decode(reference(restored.quote, '新备注', key => key, restored.origin, restored.context).ref)
  assert.deepEqual(edited.context, restored.context)
})
