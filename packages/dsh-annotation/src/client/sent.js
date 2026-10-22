import { ANNOTATION_INSTRUCTIONS } from './prompt.js'

export const SENT_ANNOTATION = 'eduwork.annotation.sent'
const OPEN = '<response-annotation>\n'
const CLOSE = '\n</response-annotation>'
const HEADER = ANNOTATION_INSTRUCTIONS + '\n'

// Recognize only our complete wire records. Unknown fields / malformed records
// remain visible as the original text; never hide a prefix independently of its
// valid annotation. DSH owns history, queue, copy and the underlying prompt.
function payload(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object'
    || Object.keys(value).some(key => !['index', 'text', 'comment', 'source'].includes(key))
    || !Number.isSafeInteger(value.index) || value.index < 1
    || typeof value.text !== 'string' || value.text === ''
    || (value.comment !== undefined && typeof value.comment !== 'string')) return undefined
  if (value.source !== undefined && (!value.source || Array.isArray(value.source)
    || typeof value.source !== 'object' || Object.keys(value.source).some(key => key !== 'messageId')
    || typeof value.source.messageId !== 'string' || value.source.messageId === '')) return undefined
  return { index: value.index, quote: value.text, note: value.comment ?? '' }
}

export const sentAnnotationRule = {
  id: SENT_ANNOTATION,
  order: 5,
  match(text, from) {
    for (let open = text.indexOf(OPEN, from); open >= 0; open = text.indexOf(OPEN, open + OPEN.length)) {
      // The codec always writes one JSON line, with tag characters escaped.
      // Do not consume an arbitrary multiline document that happens to use tags.
      const endJSON = text.indexOf('\n', open + OPEN.length)
      if (endJSON < 0 || !text.startsWith(CLOSE, endJSON)) continue
      let data
      try { data = payload(JSON.parse(text.slice(open + OPEN.length, endJSON))) } catch { continue }
      if (!data) continue
      let start = open
      const headerStart = open - HEADER.length
      if (data.index === 1 && headerStart >= from && text.slice(headerStart, open) === HEADER) start = headerStart
      return { id: SENT_ANNOTATION, start, end: endJSON + CLOSE.length, data }
    }
    return undefined
  },
}
