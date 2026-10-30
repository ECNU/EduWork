// Notification text is plain text with hard protocol limits: the registry caps
// a title at 120 characters and a preview at 400, and the desktop bridge rejects
// control characters. Every value is normalized here before it is published.

export const TITLE_LIMIT = 120
export const PREVIEW_LIMIT = 400
// A click target is a JSON reference of at most 4096 characters. The reading
// payload has to fit that budget after serialization, so the excerpt is clipped
// until the whole object fits.
export const TARGET_LIMIT = 4096
export const TEXT_LIMIT = 3000

/** Collapse whitespace and strip control characters without splitting emoji. */
export function plain(value) {
  return String(value ?? '')
    .toWellFormed()
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** Clip to a character budget, counting code points rather than UTF-16 units. */
export function clip(value, max) {
  const text = plain(value)
  const points = [...text]
  if (points.length <= max) return text
  return `${points.slice(0, Math.max(0, max - 1)).join('')}…`
}

/**
 * One arrival becomes one notification. A merged batch keeps the count visible
 * so the newest subject is never mistaken for the only message.
 */
export function describeArrival({ subject, from, count = 1 } = {}) {
  const sender = clip(from, 80)
  if (count > 1) {
    const newest = clip(subject, TITLE_LIMIT - 20)
    return {
      title: clip(`${count} 封新邮件`, TITLE_LIMIT),
      preview: clip(newest === '' ? `${count} 封新邮件` : `${count} 封新邮件，最新：${newest}`, PREVIEW_LIMIT),
    }
  }
  const title = clip(subject === '' || subject === undefined ? '（无主题）' : subject, TITLE_LIMIT)
  return { title, preview: sender === '' ? '' : clip(sender, PREVIEW_LIMIT) }
}

/**
 * The client receives exactly what `onAction` returns, so the opened message
 * travels back as a bounded reference plus an excerpt. The full body never
 * leaves the Host this way: the excerpt is clipped until the serialized target
 * fits the protocol budget.
 */
export function readingPayload(message, { folder, uid, limit = TARGET_LIMIT } = {}) {
  const payload = {
    folder: String(folder ?? ''),
    uid: Number(uid),
    subject: clip(message?.subject, TITLE_LIMIT),
    from: clip(message?.from, TITLE_LIMIT),
    date: clip(message?.date, 40),
    text: clip(message?.body, TEXT_LIMIT),
    truncated: message?.truncated === true,
    attachments: Array.isArray(message?.attachments)
      ? message.attachments.slice(0, 20).map(name => clip(name, 120))
      : [],
  }
  // Serialization grows with the number of attachments and the subject, so trim
  // the excerpt rather than guessing a safe constant.
  let text = payload.text
  while (text !== '' && JSON.stringify({ ...payload, text }).length > limit) {
    const points = [...text]
    if (points.length <= 1) { text = ''; break }
    text = clip(points.slice(0, Math.floor(points.length / 2)).join(''), points.length)
  }
  return { ...payload, text }
}
