import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseSessionReferenceText } from '@deepseek-ai/dsh-session-reference'
import { followEdit, locateMentions, restoreMentions } from '../src/client/mentions.js'

// Replay an input the way a textarea reports it: its beforeinput selection and type, then the new value.
function type(text, mentions, at, insert, remove = 0, inputType = insert ? 'insertText' : 'deleteContent') {
  const after = text.slice(0, at) + insert + text.slice(at + remove)
  return [after, followEdit(mentions, text, after, { inputType, start: at, end: at + remove })]
}
// What the Host makes of the text sent: readable text and the referenced sessions.
const host = (text, mentions) => parseSessionReferenceText(restoreMentions(text, mentions))
const ids = parsed => parsed.references.map(reference => reference.sessionId)

test('round-trips through the Host parser, escaping included', () => {
  const references = [{ sessionId: '会话-1', label: 'a]b\\c' }, { sessionId: 's2', label: 'B' }]
  const stored = '看 @a]b\\c 和 @B'
  const parsed = host(stored, locateMentions(stored, references))
  assert.equal(parsed.text, stored)
  assert.deepEqual(parsed.references, references)
})

test('a label that prefixes another stays with its own mention', () => {
  const stored = '@AB 和 @A'
  const mentions = locateMentions(stored, [{ sessionId: 'ab', label: 'AB' }, { sessionId: 'a', label: 'A' }])
  const [edited, kept] = type(stored, mentions, stored.indexOf(' 和 @A'), '', ' 和 @A'.length)
  assert.equal(edited, '@AB')
  assert.deepEqual(ids(host(edited, kept)), ['ab'])
})

test('typed text that looks like a mention stays text', () => {
  const stored = '看 @X'
  const mentions = locateMentions(stored, [{ sessionId: 'x', label: 'X' }])
  const [edited, kept] = type(stored, mentions, 0, '@X ')
  assert.equal(edited, '@X 看 @X')
  assert.equal(restoreMentions(edited, kept), `@X 看 @[X](dsh-session:${Buffer.from('"x"').toString('base64url')})`)
})

test('an edit inside a mention drops it; one next to it keeps it', () => {
  const stored = '@X'
  const mentions = locateMentions(stored, [{ sessionId: 'x', label: 'X' }])
  assert.deepEqual(type(stored, mentions, 1, 'Y')[1], [])
  assert.deepEqual(ids(host(...type(stored, mentions, 0, '@'))), ['x'])
  assert.deepEqual(ids(host(...type(stored, mentions, 2, 'X'))), ['x'])
})

test('an ambiguous @label is not taken for its reference', () => {
  const locate = (stored, references) => locateMentions(stored, references).map(mention => mention.sessionId)
  assert.deepEqual(locate('@see @B 和 @B', [{ sessionId: 'outer', label: 'see @B' }, { sessionId: 'b', label: 'B' }]), ['outer'])
  assert.deepEqual(locate('@AB 和 @A', [{ sessionId: 'a', label: 'A' }]), [])
  assert.deepEqual(locate('@X 对比 @X', [{ sessionId: 'first', label: 'X' }, { sessionId: 'second', label: 'X' }]), [])
})

test('pasting over a mention drops it even when the paste starts with the same text', () => {
  const stored = '看 @X'
  const mentions = locateMentions(stored, [{ sessionId: 'x', label: 'X' }])
  assert.deepEqual(type(stored, mentions, 2, '@XY', 2, 'insertFromPaste')[1], [])
})

test('backspace and forward delete take the side of the caret they remove', () => {
  const stored = 'a@X'
  const mentions = locateMentions(stored, [{ sessionId: 'x', label: 'X' }])
  const backspace = (at, inputType) => followEdit(mentions, stored, stored.slice(0, at - 1) + stored.slice(at), { inputType, start: at, end: at })
  assert.equal(backspace(1, 'deleteContentBackward').length, 1)
  assert.equal(followEdit(mentions, stored, 'aX', { inputType: 'deleteContentForward', start: 1, end: 1 }).length, 0)
})

test('an unannounced change keeps only mentions it cannot have touched', () => {
  const stored = '@X 和 @Y 和'
  const mentions = locateMentions(stored, [{ sessionId: 'x', label: 'X' }, { sessionId: 'y', label: 'Y' }])
  const undo = after => followEdit(mentions, stored, after, { inputType: 'historyUndo', start: 0, end: 0 }).map(mention => mention.sessionId)
  assert.deepEqual(undo('@X 和 @Y'), ['x', 'y'])
  assert.deepEqual(undo('@X 和 @Y 和 好'), ['x', 'y'])
  // Removing "@X 和 " could as well have kept X's "@" and dropped Y's: neither survives.
  assert.deepEqual(undo('@Y 和'), [])
  // A change the textarea never announced cannot be placed.
  assert.deepEqual(followEdit(mentions, stored, '@X 和 @Y', undefined), [])
})

test('replacing a selected mention drops it, even with the same or longer text', () => {
  const stored = '看 @X 吧'
  const mentions = locateMentions(stored, [{ sessionId: 'x', label: 'X' }])
  const selected = inputType => ({ inputType, start: 2, end: 4 })
  assert.deepEqual(followEdit(mentions, stored, stored, selected('insertFromPaste')), [])
  assert.deepEqual(followEdit(mentions, stored, stored, selected('insertCompositionText')), [])
  assert.deepEqual(followEdit(mentions, stored, '看 @XY 吧', selected('insertReplacementText')), [])
  assert.deepEqual(followEdit(mentions, stored, '看 @XY 吧', selected('insertFromDrop')), [])
})
