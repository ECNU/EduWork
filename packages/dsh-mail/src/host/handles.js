const MESSAGE_PREFIX = 'dshmail:m1:'
const ATTACHMENT_PREFIX = 'dshmail:a1:'
const SEARCH_PREFIX = 'dshmail:s1:'

function encode(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decode(text, prefix) {
  if (typeof text !== 'string' || !text.startsWith(prefix)) throw new Error('Invalid mail handle')
  let value
  try {
    value = JSON.parse(Buffer.from(text.slice(prefix.length), 'base64url').toString('utf8'))
  } catch {
    throw new Error('Invalid mail handle')
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid mail handle')
  return value
}

export function messageHandle({ folder, uidValidity, uid }) {
  if (typeof folder !== 'string' || folder === '' || folder.length > 512) throw new Error('Invalid folder')
  if (!Number.isSafeInteger(uid) || uid <= 0) throw new Error('Invalid uid')
  const validity = String(uidValidity)
  if (!/^\d+$/.test(validity)) throw new Error('Invalid UIDVALIDITY')
  return MESSAGE_PREFIX + encode({ f: folder, v: validity, u: uid })
}

export function parseMessageHandle(handle) {
  const value = decode(handle, MESSAGE_PREFIX)
  if (typeof value.f !== 'string' || value.f === '' || value.f.length > 512
    || typeof value.v !== 'string' || !/^\d+$/.test(value.v)
    || !Number.isSafeInteger(value.u) || value.u <= 0) throw new Error('Invalid mail handle')
  return { folder: value.f, uidValidity: value.v, uid: value.u }
}

export function attachmentHandle({ message, part, filename, contentType, size }) {
  if (typeof message !== 'string' || typeof part !== 'string' || part === '' || part.length > 64) throw new Error('Invalid attachment')
  return ATTACHMENT_PREFIX + encode({ m: message, p: part, n: String(filename ?? ''), t: String(contentType ?? ''), s: Number(size ?? 0) })
}

export function parseAttachmentHandle(handle) {
  const value = decode(handle, ATTACHMENT_PREFIX)
  if (typeof value.m !== 'string' || typeof value.p !== 'string' || value.p === '' || value.p.length > 64
    || typeof value.n !== 'string' || typeof value.t !== 'string'
    || !Number.isFinite(value.s) || value.s < 0) throw new Error('Invalid attachment handle')
  return { message: value.m, part: value.p, filename: value.n, contentType: value.t, size: value.s }
}

export function searchCursor({ folder, uidValidity, boundary, query = '', since = '', before = '', unreadOnly = false, order = 'newest' }) {
  const validity = String(uidValidity)
  if (typeof folder !== 'string' || folder === '' || folder.length > 512
    || typeof query !== 'string' || query.length > 256
    || typeof since !== 'string' || since.length > 32
    || typeof before !== 'string' || before.length > 32
    || !/^\d+$/.test(validity)
    || !Number.isSafeInteger(boundary) || boundary <= 0
    || typeof unreadOnly !== 'boolean'
    || !['newest', 'oldest'].includes(order)) throw new Error('Invalid search cursor')
  return SEARCH_PREFIX + encode({ f: folder, v: validity, u: boundary, q: query, s: since, b: before, n: unreadOnly, o: order })
}

export function parseSearchCursor(cursor) {
  const value = decode(cursor, SEARCH_PREFIX)
  if (typeof value.f !== 'string' || value.f === '' || value.f.length > 512
    || typeof value.v !== 'string' || !/^\d+$/.test(value.v)
    || !Number.isSafeInteger(value.u) || value.u <= 0
    || typeof value.q !== 'string' || value.q.length > 256
    || typeof value.s !== 'string' || value.s.length > 32
    || typeof value.b !== 'string' || value.b.length > 32
    || typeof value.n !== 'boolean'
    || !['newest', 'oldest'].includes(value.o)) throw new Error('Invalid search cursor')
  return {
    folder: value.f,
    uidValidity: value.v,
    boundary: value.u,
    query: value.q,
    since: value.s,
    before: value.b,
    unreadOnly: value.n,
    order: value.o,
  }
}
