// Bounded reading for the new-mail reminder. Deliberately free of IMAP imports:
// the byte cap has to be provable with a synthetic stream, because the point of
// the cap is that a preview stops the download instead of buffering a whole body
// and truncating afterwards.

export const PREVIEW_BYTES = 64 * 1024
export const PREVIEW_CHARS = 160

const filename = node => node?.dispositionParameters?.filename ?? node?.parameters?.name
const children = node => Array.isArray(node?.childNodes) ? node.childNodes : []
const textual = node => typeof node?.type === 'string' && node.type.toLowerCase().startsWith('text/')

/** An inline part, not an attachment, that the user could read. */
function readable(node) {
  if (!textual(node)) return false
  const name = filename(node)
  return node.disposition !== 'attachment' && !(typeof name === 'string' && name !== '')
}

/**
 * The first inline text leaf of a body structure, plain text before HTML.
 * ImapFlow only numbers parts below the root, so a single-part message gets "1",
 * which is also what `download(uid, '1')` resolves to for such a message.
 */
export function pickTextPart(node, path = '1', output = []) {
  if (node === null || typeof node !== 'object') return output
  const part = typeof node.part === 'string' && node.part !== '' ? node.part : path
  if (readable(node) && !output.some(entry => entry.part === part)) {
    output.push({ part, type: node.type.toLowerCase(), charset: node.parameters?.charset })
  }
  children(node).forEach((child, index) => {
    pickTextPart(child, part === '1' ? String(index + 1) : `${part}.${index + 1}`, output)
  })
  return output
}

/** Text leaves: plain text before HTML, then anything else, each in MIME order. */
export function textLeaves(node) {
  return [...pickTextPart(node)]
    .sort((left, right) => rank(left.type) - rank(right.type) || left.part.localeCompare(right.part, 'en', { numeric: true }))
}
const rank = type => type === 'text/plain' ? 0 : type === 'text/html' ? 1 : 2

/**
 * Consume at most `maxBytes` of a download, then stop and destroy the stream: a
 * 2 MiB body must cost 64 KiB, not 2 MiB of buffering and a truncation.
 */
export async function readBounded(stream, { maxBytes = PREVIEW_BYTES, signal } = {}) {
  const chunks = []
  let bytes = 0, truncated = false
  try {
    for await (const chunk of stream) {
      if (signal?.aborted) throw signal.reason ?? new Error('Mail preview cancelled')
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      const room = maxBytes - bytes
      if (buffer.length >= room) {
        chunks.push(buffer.subarray(0, room))
        bytes = maxBytes
        truncated = true
        break
      }
      chunks.push(buffer)
      bytes += buffer.length
    }
  } finally {
    // Breaking out of a fetch leaves the rest of the body unread; drop it rather
    // than letting the socket keep streaming into a discarded stream.
    try { stream.destroy?.() } catch { /* already closed */ }
  }
  return { text: Buffer.concat(chunks, bytes).toString('utf8'), bytes, truncated }
}

const entities = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" }

/** One readable line from either a plain-text or an HTML part. */
export function normalizeExcerpt(text, { chars = PREVIEW_CHARS, html = false } = {}) {
  let value = String(text ?? '')
  if (html) {
    value = value
      .replace(/<(script|style|head|title)[\s\S]*?<\/\1\s*>/giu, ' ')
      .replace(/<(?:br|\/p|\/div|\/tr|\/li|\/h[1-6])[^>]*>/giu, ' ')
      .replace(/<[^>]*>/gu, ' ')
      .replace(/&(#39|[a-z]+);/giu, (match, name) => entities[String(name).toLowerCase()] ?? ' ')
  }
  const flat = value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim()
  if (chars <= 0) return ''
  const points = [...flat]
  return points.length > chars ? points.slice(0, chars).join('') : flat
}
