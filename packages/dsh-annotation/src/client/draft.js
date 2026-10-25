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

// Side questions may quote a running/intermediate reply. Only durable message
// boundaries enter its history; live output travels as the selected quotation.
// Ordinary annotation badges still belong only to finalized closing replies.
export function selectionSource(chat, key, sessionId) {
  const node = chat?.nodes.get(key)
  if (node?.kind !== 'assistant-step') return undefined
  const origin = messageOrigin(chat, key, sessionId)
  if (origin) {
    for (const tail of chat.nodes.values()) {
      if (tail.kind === 'turn-tail' && tail.data.closing?.finalNode.messageId === origin.messageId
        && Number.isSafeInteger(tail.data.seq)) return { origin, atSeq: tail.data.seq, canAnnotate: true }
    }
  }
  const final = node.data.finalNode
  if (node.data.status === 'settled' && final?.messageId && Number.isSafeInteger(final.seq)) {
    return { origin: { sessionId, messageId: final.messageId }, atSeq: final.seq, canAnnotate: false }
  }
  if (node.data.status !== 'running' || !Number.isFinite(node.anchorSeq)) return undefined
  let atSeq
  for (const candidate of chat.nodes.values()) {
    if (!['user', 'steering'].includes(candidate.kind) || !Number.isSafeInteger(candidate.data.seq)
      || candidate.data.seq > node.anchorSeq) continue
    if (atSeq === undefined || candidate.data.seq > atSeq) atSeq = candidate.data.seq
  }
  return atSeq === undefined ? undefined : { atSeq, canAnnotate: false }
}

export function closingMessage(chat, turn) {
  for (const tailKey of chat?.locations.getTurn(turn) ?? []) {
    const tail = chat.nodes.get(tailKey)
    if (tail?.kind === 'turn-tail') return tail.data.closing?.finalNode.messageId
  }
  return undefined
}
