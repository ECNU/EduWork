export const SOURCE = 'eduwork-annotation'
export const MAX_NOTE = 2000

const LABEL_CHARS = 16

function clean(text, max) {
  const value = String(text ?? '').replace(/\r\n?/g, '\n').replace(/[\uE100-\uE11D\uFFFC]/gu, '').trim()
  return max === undefined ? value : value.slice(0, max)
}

// The chip's ref carries the whole annotation, so undo, session switches and
// failed-send restoration need no plugin-side store.
export function encode(quote, note) {
  const q = clean(quote)
  if (q === '') return undefined
  const n = clean(note, MAX_NOTE)
  return JSON.stringify(n === '' ? { q } : { q, n })
}

export function decode(ref) {
  try {
    const value = JSON.parse(ref)
    if (typeof value?.q !== 'string' || value.q === '') return undefined
    return { quote: value.q, note: typeof value.n === 'string' ? value.n : '' }
  } catch {
    return undefined
  }
}

// Copy/paste and plain-text draft restores carry only this projection, so it
// must stand on its own as the model input.
export function text(annotation, t) {
  const quoted = annotation.quote.split('\n').map(line => `> ${line}`).join('\n')
  return `\n${quoted}\n${annotation.note === '' ? '' : `${t('notePrefix')}${annotation.note}\n`}`
}

export function label(annotation, t) {
  const flat = annotation.quote.replace(/\s+/g, ' ')
  const head = flat.length > LABEL_CHARS ? `${flat.slice(0, LABEL_CHARS)}…` : flat
  return annotation.note === '' ? `“${head}”` : `“${head}” · ${t('noted')}`
}

export function reference(quote, note, t) {
  const ref = encode(quote, note)
  if (ref === undefined) return undefined
  const annotation = decode(ref)
  return { source: SOURCE, ref, label: label(annotation, t), clipboardText: text(annotation, t) }
}
