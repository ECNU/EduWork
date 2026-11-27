// Conversations a message references, tracked through an edit.
//
// The Host stores a referenced conversation as readable `@label` text plus a
// separate snapshot message, so the editor shows plain text. The draft keeps
// where each reference sits and follows the user's edits; a reference whose
// `@label` survives untouched is sent again in the Host's canonical form, so
// the branch captures a fresh snapshot. Wherever that cannot be told for
// certain the reference is dropped rather than guessed: a reference sent
// that the user removed is worse than one the editor shows as gone.

/** The Host's canonical session URI: unpadded base64url of the id as a JSON string. */
const sessionUri = sessionId => `dsh-session:${btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(sessionId))))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`

const canonical = ({ sessionId, label }) => `@[${label.replace(/[\\\]]/g, '\\$&')}](${sessionUri(sessionId)})`

/**
 * Where a stored message's references sit in its text. The Host keeps only
 * the readable `@label`, so a reference is located only when its `@label`
 * occurs exactly once: a repeated or overlapping one could be text the user
 * typed, and is left out.
 */
export function locateMentions(text, references) {
  return references.flatMap(({ sessionId, label }) => {
    const mention = `@${label}`
    const start = text.indexOf(mention)
    return start >= 0 && text.indexOf(mention, start + 1) < 0 ? [{ sessionId, label, start, end: start + mention.length }] : []
  }).filter((mention, _, all) => all.every(other => other === mention || other.end <= mention.start || other.start >= mention.end))
    .sort((a, b) => a.start - b.start)
}

// Input types that replace the selection with what they insert.
const REPLACES_SELECTION = new Set(['insertText', 'insertFromPaste', 'insertFromYank', 'insertLineBreak', 'insertParagraph', 'insertCompositionText',
  'deleteByCut', 'deleteContent', 'deleteContentBackward', 'deleteContentForward', 'deleteWordBackward', 'deleteWordForward',
  'deleteSoftLineBackward', 'deleteSoftLineForward', 'deleteHardLineBackward', 'deleteHardLineForward'])

/**
 * The stretch of `before` one input replaced, from the selection and input
 * type recorded just before it; undefined when the input does not say.
 */
function changedStretch(before, after, edit) {
  if (!edit || !REPLACES_SELECTION.has(edit.inputType)) return undefined
  let { start, end } = edit
  // A deletion from a bare caret removes what lies to one side of it.
  if (start === end && edit.inputType.startsWith('delete')) {
    const removed = before.length - after.length
    if (edit.inputType.endsWith('Backward')) start -= removed
    else end += removed
  }
  const kept = before.length - end
  const fits = start >= 0 && start <= end && after.length >= start + kept
    && after.startsWith(before.slice(0, start)) && after.endsWith(before.slice(end))
  return fits ? { start, end } : undefined
}

/**
 * The widest stretch an input of another kind, such as undo, a drop, or a
 * spelling replacement, may have changed: wherever the texts differ however
 * they are matched up, and any selection it may have replaced.
 */
function possibleStretch(before, after, edit) {
  const shortest = Math.min(before.length, after.length)
  let head = 0
  while (head < shortest && before[head] === after[head]) head++
  let tail = 0
  while (tail < shortest && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++
  const start = Math.min(head, shortest - tail)
  const end = before.length - Math.min(tail, shortest - head)
  return edit.start < edit.end ? { start: Math.min(start, edit.start), end: Math.max(end, edit.end) } : { start, end }
}

/**
 * Carry mentions across one input. `edit` is the selection and input type the
 * textarea announced before it; a change it did not announce cannot be
 * placed, so no mention survives it.
 */
export function followEdit(mentions, before, after, edit) {
  if (mentions.length === 0 || !edit) return []
  const stretch = changedStretch(before, after, edit) ?? possibleStretch(before, after, edit)
  const shift = after.length - before.length
  return mentions.flatMap(mention => {
    if (mention.end <= stretch.start) return [mention]
    if (mention.start >= stretch.end) return [{ ...mention, start: mention.start + shift, end: mention.end + shift }]
    return []
  })
}

/** The text to send, with every surviving mention in canonical form. */
export function restoreMentions(text, mentions) {
  return mentions.reduceRight((restored, mention) => restored.slice(0, mention.start) + canonical(mention) + restored.slice(mention.end), text)
}
