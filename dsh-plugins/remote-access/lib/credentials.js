/**
 * Device credentials — the second of the four credential kinds.
 *
 * The four are deliberately separate things and the maintainer's direction is
 * that they never collapse into one token: the pairing invitation admits a
 * device once, the device credential proves which device is calling, the relay
 * access key says only "you may use this relay", and the browser session is what
 * the Host itself issues. Collapsing any two of them would mean one leak
 * escalates into the other, so this module owns exactly one of them and the
 * device registry owns none.
 *
 * Two properties matter for the acceptance items:
 *
 * - **Only a digest is stored.** The registry and this store both live in files
 *   on the Host, and a file that yields working credentials turns any read into
 *   a permanent impersonation. A secret is returned exactly once, when it is
 *   minted, and is never recoverable afterwards.
 * - **Comparison is constant time.** A byte-by-byte comparison leaks the
 *   matching prefix through timing, which is enough to walk a credential out one
 *   character at a time.
 *
 * A revoked device keeps no credential at all rather than a disabled one, so
 * "revoked" and "has no way to authenticate" are the same state and cannot drift
 * apart.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const CREDENTIALS_VERSION = 1

/**
 * Printed into every secret. A credential that leaks into a log or a screenshot
 * is recognisable, and the version lets a future scheme reject old secrets
 * without guessing at their shape.
 */
export const CREDENTIAL_PREFIX = 'edw1'

const SECRET_BYTES = 32
const DIGEST = 'sha256'

function fail(message) {
  throw new Error(`remote-access credentials: ${message}`)
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label} must be a non-empty string`)
  return value
}

function requireTimestamp(value, label) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) fail(`${label} must be an ISO timestamp`)
  return value
}

function optionalTimestamp(value, label) {
  return value === undefined || value === null ? null : requireTimestamp(value, label)
}

/** Digest of a secret, as stored. */
export function digest(secret) {
  return createHash(DIGEST).update(requireText(secret, 'secret'), 'utf8').digest('hex')
}

/**
 * Mint a credential.
 *
 * @returns `{ secret, digest }` — hand `secret` to the device once and keep only
 *          `digest`. There is no way to get the secret back.
 */
export function mintCredential() {
  const secret = `${CREDENTIAL_PREFIX}_${randomBytes(SECRET_BYTES).toString('base64url')}`
  return { secret, digest: digest(secret) }
}

/** Whether a string looks like a credential of this generation. */
export function isCredentialShape(value) {
  return typeof value === 'string' && value.startsWith(`${CREDENTIAL_PREFIX}_`)
}

/**
 * Constant-time comparison of a presented secret against a stored digest.
 *
 * Length is compared first and in the open, which is safe: the digest length is
 * fixed and public, so it reveals nothing about the secret.
 */
export function verifyCredential(record, secret) {
  if (record === undefined || record === null) return false
  if (typeof record.digest !== 'string' || record.digest === '') return false
  if (!isCredentialShape(secret)) return false
  const presented = Buffer.from(digest(secret), 'utf8')
  const stored = Buffer.from(record.digest, 'utf8')
  if (presented.length !== stored.length) return false
  return timingSafeEqual(presented, stored)
}

function normalizeRecord(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail('a credential record must be an object')
  return {
    deviceId: requireText(raw.deviceId, 'deviceId'),
    digest: requireText(raw.digest, 'digest'),
    issuedAt: requireTimestamp(raw.issuedAt, 'issuedAt'),
    lastUsedAt: optionalTimestamp(raw.lastUsedAt, 'lastUsedAt'),
  }
}

/** An empty store. */
export function emptyCredentials() {
  return { version: CREDENTIALS_VERSION, credentials: [] }
}

/** Coerce anything read from disk into a valid store. */
export function normalizeCredentials(raw) {
  if (raw === undefined || raw === null) return emptyCredentials()
  if (typeof raw !== 'object' || Array.isArray(raw)) fail('the credential store must be an object')
  if (raw.version !== undefined && raw.version !== CREDENTIALS_VERSION) {
    fail(`unsupported credential store version ${JSON.stringify(raw.version)}`)
  }
  const list = raw.credentials ?? []
  if (!Array.isArray(list)) fail('credentials must be an array')
  const records = list.map(normalizeRecord)
  const seen = new Set()
  for (const record of records) {
    if (seen.has(record.deviceId)) fail(`duplicate credential for device "${record.deviceId}"`)
    seen.add(record.deviceId)
  }
  records.sort((left, right) => left.deviceId.localeCompare(right.deviceId))
  return { version: CREDENTIALS_VERSION, credentials: records }
}

/** The credential record for a device, if any. */
export function credentialFor(store, deviceId) {
  return normalizeCredentials(store).credentials.find(record => record.deviceId === deviceId)
}

/**
 * Issue a credential, replacing any the device already had.
 *
 * Replacing rather than adding is what makes re-pairing meaningful: the old
 * secret stops working the moment a new one is issued, so a device that was
 * re-paired does not leave a second working secret behind.
 */
export function issueCredential(store, deviceId, now) {
  requireText(deviceId, 'deviceId')
  requireTimestamp(now, 'now')
  const current = normalizeCredentials(store)
  const { secret, digest: hashed } = mintCredential()
  const record = { deviceId, digest: hashed, issuedAt: now, lastUsedAt: null }
  const credentials = current.credentials.filter(entry => entry.deviceId !== deviceId)
  credentials.push(record)
  credentials.sort((left, right) => left.deviceId.localeCompare(right.deviceId))
  return { store: { version: CREDENTIALS_VERSION, credentials }, secret }
}

/**
 * Drop a device's credential.
 *
 * @returns `{ store, removed }` so the caller can tell an actual revocation from
 *          a no-op on a device that never had one.
 */
export function revokeCredential(store, deviceId) {
  requireText(deviceId, 'deviceId')
  const current = normalizeCredentials(store)
  const credentials = current.credentials.filter(entry => entry.deviceId !== deviceId)
  return {
    store: { version: CREDENTIALS_VERSION, credentials },
    removed: credentials.length !== current.credentials.length,
  }
}

/**
 * Verify a presented secret and, on success, note the use.
 *
 * The caller gets back both the verdict and the updated store, because a
 * successful authentication is the only moment the Host learns a device is
 * alive and it would be a second write to record it elsewhere.
 */
export function authenticate(store, deviceId, secret, now) {
  const current = normalizeCredentials(store)
  const record = current.credentials.find(entry => entry.deviceId === deviceId)
  if (!verifyCredential(record, secret)) return { ok: false, store: current }
  const stamped = record.lastUsedAt === now ? record : { ...record, lastUsedAt: now }
  const credentials = current.credentials.map(entry => (entry.deviceId === deviceId ? stamped : entry))
  return { ok: true, store: { version: CREDENTIALS_VERSION, credentials }, record: stamped }
}

/** Device ids that currently hold a credential, sorted. */
export function credentialHolders(store) {
  return normalizeCredentials(store).credentials.map(record => record.deviceId)
}
