// Record keys for calendar storage.
//
// A key has to survive three constraints at once: the JSON backend accepts only
// `/^[a-zA-Z0-9_-]+$/` for a per-record layout, a `source` legitimately contains
// `:` (and a `uid` may contain anything at all), and two different sources — or
// the same source in two ownership scopes — must never land on one key. So each
// part is written as the fixed-width lowercase hex of its own UTF-8 bytes and
// the parts are joined with `__`:
//
//   s__65636e75__636f75727365      a source event
//   p__65636e75__636f75727365      the personal record of the same name
//
// Fixed width is what makes the separator unambiguous: a byte is always two hex
// characters, so `__` cannot occur inside a part, and `(a__b, c)` cannot encode
// to the same key as `(a, b__c)`. The character set is therefore `[0-9a-f_]`,
// a subset of the backend's, and the first character can never be `-`.
//
// The leading `s`/`p` is the ownership scope, and it is part of the identity
// rather than decoration: a school source and a personal calendar the user named
// the same thing are different records, and without the prefix their personal
// content would collide on one key.
//
// Keys are never decoded at runtime. The readable `scope`, `source`, `uid` and
// `originalStart` live in the record value; reversibility exists so a migration
// or a debugging session can read an old key, not so the code can depend on it.

/** Encode one key part: the lowercase hex of its UTF-8 bytes. */
export function encodeKeyPart(value) {
  const bytes = new TextEncoder().encode(String(value))
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

/**
 * Whether a key was built by {@link eventKey} or {@link annotationKey}.
 *
 * The shape is what makes this answerable: a part is only ever lowercase hex, so
 * the first separator can only be the one this module put there. Keys written
 * before this encoding existed do not have that shape, and an event table key
 * cannot contain the separator at all, which is how {@link rekeyBySource} in the
 * store tells a record that still has to move from one that has already moved.
 * @param key - A storage key.
 */
export function isEncodedKey(key) {
  return /^(?:[sp]__[0-9a-f]*__[0-9a-f]*)(?:__[0-9a-f]+|-)?$/.test(String(key))
}

/** The separator between key parts. A part is fixed-width hex, so it cannot occur inside one. */
export const KEY_SEPARATOR = '__'

/** The one-character prefix standing for an ownership scope. */
export function scopePrefix(scope) {
  return scope === 'personal' ? 'p' : 's'
}

/**
 * The halves of an identity, written so they fit in a text property of an
 * interchange format — an ICS `UID` — as one token.
 *
 * The same parts and the same encoding as a storage key, minus the scope: a
 * calendar file holds the source layer, so "which scope" is not a question the
 * file has to answer. Not the same string as {@link eventKey}: that one starts
 * with a scope letter so the backend can keep the two scopes in one collection.
 * @param ref - `{ source, uid }`.
 */
export function encodeIdentity({ source, uid }) {
  return `${encodeKeyPart(source)}${KEY_SEPARATOR}${encodeKeyPart(uid)}`
}

/**
 * The identity {@link encodeIdentity} wrote, or `undefined` for anything else.
 *
 * A calendar file from anywhere else carries a `UID` that a person or another
 * program made up, so "not one of ours" is the ordinary case and is answered
 * rather than thrown at. The shape is unambiguous: both halves are lowercase hex,
 * a byte is always two characters, and the separator cannot occur inside a half —
 * which is why the separator here is `KEY_SEPARATOR` and not a bare `__` split.
 * @param value - The text of a `UID` property.
 */
export function decodeIdentity(value) {
  const text = String(value ?? '')
  const at = text.indexOf(KEY_SEPARATOR)
  if (at < 0) return undefined
  const source = decodeKeyPart(text.slice(0, at))
  const uid = decodeKeyPart(text.slice(at + KEY_SEPARATOR.length))
  // Neither half is ever empty in an identity this wrote, and `__` alone is not one.
  if (!source || !uid) return undefined
  return { source, uid }
}

/** The lowercase hex of one part back to text, or `undefined` if it is not that. */
function decodeKeyPart(value) {
  const text = String(value ?? '')
  if (!/^(?:[0-9a-f]{2})*$/.test(text)) return undefined
  const bytes = new Uint8Array(text.length / 2)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(text.slice(index * 2, index * 2 + 2), 16)
  return new TextDecoder().decode(bytes)
}

/**
 * Key of a source or personal event record.
 * @param ref - `{ scope?, source, uid }`; `scope` defaults to `'source'`.
 */
export function eventKey({ scope = 'source', source, uid }) {
  return `${scopePrefix(scope)}${KEY_SEPARATOR}${encodeKeyPart(source)}${KEY_SEPARATOR}${encodeKeyPart(uid)}`
}

/**
 * Key of one annotation: an event record's key plus the instant the series
 * produced for the occurrence it belongs to, or `-` for the whole series.
 * @param ref - `{ scope?, source, uid, originalStart? }`.
 */
export function annotationKey({ scope = 'source', source, uid, originalStart }) {
  const key = `${eventKey({ scope, source, uid })}${KEY_SEPARATOR}${originalStart ? encodeKeyPart(originalStart) : '-'}`
  if (key.length > MAX_ANNOTATION_KEY) throw new Error(`key_too_long: 笔记存储键需要 ${key.length} 字符，上限 ${MAX_ANNOTATION_KEY}`)
  return key
}


/** The backend uses one JSON filename per annotation; reserve the longest local-time suffix. */
const MAX_ANNOTATION_KEY = 250
const OCCURRENCE_SUFFIX_LENGTH = KEY_SEPARATOR.length + encodeKeyPart('9999-12-31T23:59').length

/** Validate new writes without making older, oversized event records unreadable. */
export function assertEventKeyBudget(ref) {
  const size = eventKey(ref).length + OCCURRENCE_SUFFIX_LENGTH
  if (size > MAX_ANNOTATION_KEY) {
    throw new Error(`key_too_long: 日历名称和日程编号过长，笔记存储键需要 ${size} 字符，上限 ${MAX_ANNOTATION_KEY}`)
  }
}
