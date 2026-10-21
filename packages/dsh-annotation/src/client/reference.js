export const SOURCE = 'eduwork-annotation'
export const MAX_NOTE = 2000

const LABEL_CHARS = 16

function clean(text, max) {
  const value = String(text ?? '').replace(/\r\n?/g, '\n').replace(/[\uE100-\uE11D\uFFFC]/gu, '').trim()
  return max === undefined ? value : value.slice(0, max)
}

// The chip's ref carries the whole annotation, so undo, session switches and
// failed-send restoration need no plugin-side store.
export function encode(quote, note, origin, context) {
  const q = clean(quote)
  if (q === '') return undefined
  const n = clean(note, MAX_NOTE)
  const o = validOrigin(origin)
  const c = validContext(context)
  return JSON.stringify({ q, ...(n === '' ? {} : { n }), ...(o ? { o } : {}), ...(c ? { c } : {}) })
}

function validContext(value) {
  return typeof value?.before === 'string' && typeof value.after === 'string'
    ? { before: clean(value.before).slice(-320), after: clean(value.after).slice(0, 320) } : undefined
}

function validOrigin(value) {
  return typeof value?.sessionId === 'string' && value.sessionId !== ''
    && typeof value.messageId === 'string' && value.messageId !== ''
    ? { sessionId: value.sessionId, messageId: value.messageId } : undefined
}

export function decode(ref) {
  try {
    const value = JSON.parse(ref)
    if (typeof value?.q !== 'string' || value.q === '') return undefined
    const origin = validOrigin(value.o)
    const context = validContext(value.c)
    return { quote: value.q, note: typeof value.n === 'string' ? value.n : '', ...(origin ? { origin } : {}), ...(context ? { context } : {}) }
  } catch {
    return undefined
  }
}

// Clipboard stays readable. The send codec uses the versioned wire protocol.
export function text(annotation, t) {
  const quoted = annotation.quote.split('\n').map(line => `> ${line}`).join('\n')
  return `\n${quoted}\n${annotation.note === '' ? '' : `${t('notePrefix')}${annotation.note}\n`}`
}

export function label(annotation, t) {
  const flat = annotation.quote.replace(/\s+/g, ' ')
  const head = flat.length > LABEL_CHARS ? `${flat.slice(0, LABEL_CHARS)}…` : flat
  return annotation.note === '' ? `“${head}”` : `“${head}” · ${t('noted')}`
}

export function reference(quote, note, t, origin, context) {
  const ref = encode(quote, note, origin, context)
  if (ref === undefined) return undefined
  const annotation = decode(ref)
  return { source: SOURCE, ref, label: label(annotation, t), clipboardText: text(annotation, t) }
}
