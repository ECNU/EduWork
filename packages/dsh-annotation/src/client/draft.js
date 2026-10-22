import { SOURCE, decode } from './reference.js'

// The official composer is the only annotation store. Numbers are a projection
// of its current order, so native delete/undo/restore never leave stale badges.
export function annotations(occurrences) {
  return occurrences.filter(item => item.source === SOURCE).flatMap(item => {
    const annotation = decode(item.ref)
    return annotation ? [{ ...item, annotation }] : []
  }).map((item, index) => ({ ...item, number: index + 1 }))
}

// Public DSH Occurrence offsets use clipboard text; TokenSpan uses detection
// coordinates, where each reference chip occupies ONE character. Keep this
// adapter isolated. Never reach into Lexical or replace the whole draft.
// Command chips have a separate coordinate contribution; edits are intentionally
// limited to plain input, rather than guessing it from command display text.
export function occurrenceSpan(state, expected) {
  if (state.phase !== 'plain' || state.claim || !Number.isInteger(state.draftRev)) return undefined
  let reduction = 0, previousEnd = 0
  for (const item of state.occurrences) {
    if (!Number.isInteger(item.offset) || !Number.isInteger(item.length) || item.length < 1
      || item.offset < previousEnd || item.offset + item.length > state.draft.length
      || state.draft.slice(item.offset, item.offset + item.length) !== item.clipboardText) return undefined
    if (item.occurrenceId === expected.occurrenceId) {
      if (item.source !== SOURCE || item.ref !== expected.ref) return undefined
      const start = item.offset - reduction
      return { start, end: start + 1, draftRev: state.draftRev }
    }
    previousEnd = item.offset + item.length
    reduction += item.length - 1
  }
  return undefined
}

// A finalized response is resolved through DSH's public Chat snapshot, not by
// matching text. Only the closing response has an official per-message action
// slot; streamed/intermediate/user/tool rows deliberately have no annotation UI.
export function messageOrigin(chat, key, sessionId) {
  const node = chat?.nodes.get(key)
  if (node?.kind !== 'assistant-step' || node.data.status !== 'settled') return undefined
  const messageId = node.data.finalNode?.messageId
  if (!messageId) return undefined
  return closingMessage(chat, node.data.turn) === messageId ? { sessionId, messageId } : undefined
}

export function closingMessage(chat, turn) {
  for (const tailKey of chat?.locations.getTurn(turn) ?? []) {
    const tail = chat.nodes.get(tailKey)
    if (tail?.kind === 'turn-tail') return tail.data.closing?.finalNode.messageId
  }
  return undefined
}
