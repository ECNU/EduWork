// Read one message for the preview window: envelope for the header block, the
// first text part for the body. Every fetch happens under the caller's
// read-only mailbox lock, so opening a preview never marks mail as seen.
//
// The text helpers are exported separately because they are pure: charset
// decoding and HTML-to-text are the two places where a preview silently goes
// wrong on real Chinese enterprise mail, so both are unit-tested without IMAP.

export const BODY_LIMIT = 20_000
export const ATTACHMENT_LIMIT = 20

/** Decode a body part, falling back to UTF-8 when the label is unknown. */
export function decodeBuffer(buffer, charset) {
  const label = String(charset ?? '').trim().toLowerCase().replace(/^["']|["']$/gu, '')
  const candidates = label === '' ? ['utf-8'] : [label, 'utf-8']
  for (const candidate of candidates) {
    try {
      return new TextDecoder(candidate).decode(buffer)
    }
    catch {
      // Unknown charset label: try the next candidate.
    }
  }
  return new TextDecoder('utf-8').decode(buffer)
}

/** Flatten HTML mail into readable text. Tags are dropped, never executed. */
export function htmlToText(html) {
  return String(html ?? '')
    .replace(/<(?:style|script)[\s\S]*?<\/(?:style|script)>/giu, ' ')
    .replace(/<(?:br|\/p|\/div|\/tr|\/li|\/h[1-6]|\/blockquote)\s*\/?>/giu, '\n')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#(\d+);/gu, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/giu, '&')
    .replace(/[ \t\f\v]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .replace(/^[ \t]+|[ \t]+$/gmu, '')
    .trim()
}

/**
 * Pick the part a preview should show: the first plain-text leaf, or else the
 * first HTML leaf. Attachment leaves are skipped so a PDF never becomes the body.
 * @param {object} structure ImapFlow bodyStructure tree
 * @returns {{ part: string, type: string, charset: string } | null}
 */
export function pickBodyPart(structure) {
  let html = null
  const walk = (node, depth) => {
    if (node === null || typeof node !== 'object' || depth > 12) return null
    const type = String(node.type ?? '').toLowerCase()
    const disposition = String(node.disposition ?? '').toLowerCase()
    const attachments = Array.isArray(node.childNodes) ? node.childNodes : []
    if (attachments.length > 0) {
      for (const child of attachments) {
        const found = walk(child, depth + 1)
        if (found !== null) return found
      }
      return null
    }
    if (disposition === 'attachment' || typeof node.part !== 'string') return null
    const charset = String(node.parameters?.charset ?? 'utf-8')
    if (type === 'text/plain') return { part: node.part, type, charset }
    if (type === 'text/html' && html === null) html = { part: node.part, type, charset }
    return null
  }
  return walk(structure, 0) ?? html
}

/** Attachment file names, in body order, bounded for a preview list. */
export function attachmentNames(structure) {
  const names = []
  const walk = (node, depth) => {
    if (node === null || typeof node !== 'object' || depth > 12 || names.length >= ATTACHMENT_LIMIT) return
    const disposition = String(node.disposition ?? '').toLowerCase()
    const name = node.dispositionParameters?.filename ?? node.parameters?.name
    if (disposition === 'attachment' && typeof name === 'string' && name.trim() !== '') names.push(name.trim().slice(0, 120))
    for (const child of Array.isArray(node.childNodes) ? node.childNodes : []) walk(child, depth + 1)
  }
  walk(structure, 0)
  return names
}

/** Normalise a body for display and cap it so one preview cannot grow unbounded. */
export function normalizeBody(value, { max = BODY_LIMIT } = {}) {
  const text = String(value ?? '')
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+$/gmu, '')
    .trim()
  const points = [...text]
  if (points.length <= max) return { text, truncated: false }
  return { text: `${points.slice(0, max).join('')}\n…`, truncated: true }
}

/** `名字 <地址>` for one address list, joined and bounded. */
export function formatAddress(list) {
  if (!Array.isArray(list)) return ''
  return list
    .filter(item => item !== null && typeof item === 'object')
    .slice(0, 8)
    .map(item => {
      const name = typeof item.name === 'string' ? item.name.trim() : ''
      const address = typeof item.address === 'string' ? item.address.trim() : ''
      return name === '' ? address : address === '' ? name : `${name} <${address}>`
    })
    .filter(line => line !== '')
    .join('，')
}

/**
 * Fetch one message for the preview. The caller owns the mailbox lock, so this
 * function only reads: envelope, body structure, one body part.
 * @param {import('imapflow').ImapFlow} client connected client, mailbox locked
 * @param {string} folder exact IMAP path
 * @param {number} uid message UID
 * @param {{ max?: number }} options body character cap
 */
export async function readMessage(client, folder, uid, { max = BODY_LIMIT } = {}) {
  const lock = await client.getMailboxLock(folder, { readOnly: true })
  try {
    const message = await client.fetchOne(String(uid), { uid: true, envelope: true, bodyStructure: true }, { uid: true })
    if (message === false || message === undefined) return null
    const envelope = message.envelope ?? {}
    const part = pickBodyPart(message.bodyStructure)
    let body = ''
    if (part !== null) {
      const download = await client.download(String(uid), part.part, { uid: true })
      const chunks = []
      for await (const chunk of download.content) chunks.push(chunk)
      const decoded = decodeBuffer(Buffer.concat(chunks), part.charset)
      body = part.type === 'text/html' ? htmlToText(decoded) : decoded
    }
    const { text, truncated } = normalizeBody(body, { max })
    return {
      folder,
      uid: Number(uid),
      subject: String(envelope.subject ?? ''),
      from: formatAddress(envelope.from),
      to: formatAddress(envelope.to),
      date: envelope.date instanceof Date ? envelope.date.toISOString() : String(envelope.date ?? ''),
      body: text,
      truncated,
      attachments: attachmentNames(message.bodyStructure),
    }
  }
  finally {
    lock.release()
  }
}
