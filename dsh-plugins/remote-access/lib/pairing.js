/**
 * One-time pairing invitations.
 *
 * An invitation is the out-of-band secret a person carries from the machine
 * running the Agent to the device being paired. Three properties are load
 * bearing and must not be relaxed:
 *
 * 1. **Single use.** Redemption consumes the invitation *before* it is
 *    validated, so a second attempt cannot observe whether the first one was
 *    valid, and a captured code cannot be replayed within its lifetime.
 *    (`dsh-remote-web-ui` deliberately keeps its grant redeemable for the whole
 *    window to tolerate mobile browser context splitting; that is exactly the
 *    behaviour this module must not have.)
 * 2. **Short lived.** An invitation expires on its own clock, independent of
 *    whether anyone redeems it.
 * 3. **Separate from what it produces.** An invitation is not a device
 *    credential and not a relay access key: redeeming one proves the person had
 *    out-of-band access, it does not by itself authorize anything. Relay access
 *    keys authorize relay use only and are never represented here.
 *
 * Codes are stored as digests, never in the clear, so a leaked registry file
 * does not hand out live invitations.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** Long enough to walk a code to another device, short enough to matter. */
export const DEFAULT_INVITATION_TTL_MS = 10 * 60 * 1000

/** 128 bits, matching the entropy of the reference implementation we inspected. */
const CODE_BYTES = 16

/** Invitations live in a registry-shaped object so callers can persist one value. */
export const INVITATION_REGISTRY_VERSION = 1

function fail(message) {
  throw new Error(`remote-access pairing: ${message}`)
}

/** A fresh, URL-safe invitation code. */
export function createInvitationCode() {
  return randomBytes(CODE_BYTES).toString('base64url')
}

/**
 * Digest used as the storage key.
 *
 * SHA-256 is enough here: the code carries 128 bits of entropy, so there is
 * nothing to brute force even though the digest is unsalted.
 */
export function invitationDigest(code) {
  if (typeof code !== 'string' || code.trim() === '') fail('an invitation code must be a non-empty string')
  return createHash('sha256').update(code.trim()).digest('hex')
}

/** Compare two digests without leaking how far they matched. */
function digestsEqual(left, right) {
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')
  // Length is fixed by the digest, so this early return reveals nothing.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function normalizeInvitations(raw) {
  const source = raw === null || raw === undefined
    ? { version: INVITATION_REGISTRY_VERSION, invitations: [] }
    : raw
  if (typeof source !== 'object' || Array.isArray(source)) fail('the invitation registry must be an object')
  const version = source.version === undefined ? INVITATION_REGISTRY_VERSION : source.version
  if (version !== INVITATION_REGISTRY_VERSION) fail(`unsupported invitation registry version ${version}`)
  if (source.invitations !== undefined && !Array.isArray(source.invitations)) {
    fail('invitations must be an array')
  }
  const invitations = (source.invitations ?? []).map((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      fail('an invitation must be an object')
    }
    if (typeof entry.digest !== 'string' || !/^[0-9a-f]{64}$/.test(entry.digest)) {
      fail('an invitation digest must be a 64-character hex string')
    }
    if (typeof entry.expiresAt !== 'string' || Number.isNaN(Date.parse(entry.expiresAt))) {
      fail('an invitation expiresAt must be an ISO timestamp')
    }
    return {
      digest: entry.digest,
      expiresAt: entry.expiresAt,
      label: typeof entry.label === 'string' && entry.label.trim() !== '' ? entry.label.trim() : undefined,
    }
  })
  invitations.sort((left, right) => left.digest.localeCompare(right.digest))
  return { version: INVITATION_REGISTRY_VERSION, invitations }
}

export function emptyInvitations() {
  return { version: INVITATION_REGISTRY_VERSION, invitations: [] }
}

export function listInvitations(invitations) {
  return normalizeInvitations(invitations).invitations
}

/** Invitations that have not expired yet. */
export function liveInvitations(invitations, now) {
  const cutoff = Date.parse(now)
  if (Number.isNaN(cutoff)) fail('now must be an ISO timestamp')
  return listInvitations(invitations).filter(entry => Date.parse(entry.expiresAt) > cutoff)
}

/**
 * Mint an invitation.
 *
 * Returns the registry to persist and the code to show **once**. The code is not
 * recoverable from the registry afterwards, by design.
 */
export function createInvitation(invitations, { now, ttlMs = DEFAULT_INVITATION_TTL_MS, label, code } = {}) {
  if (Number.isNaN(Date.parse(now))) fail('now must be an ISO timestamp')
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) fail('ttlMs must be a positive number')
  const plaintext = code === undefined ? createInvitationCode() : code
  const digest = invitationDigest(plaintext)
  const current = normalizeInvitations(invitations)
  if (current.invitations.some(entry => entry.digest === digest)) {
    fail('this invitation code already exists; codes must not repeat')
  }
  const expiresAt = new Date(Date.parse(now) + ttlMs).toISOString()
  const next = normalizeInvitations({
    version: INVITATION_REGISTRY_VERSION,
    invitations: [...current.invitations, { digest, expiresAt, label }],
  })
  return { invitations: next, code: plaintext, expiresAt }
}

/**
 * Redeem an invitation.
 *
 * The matching entry is removed from the registry **before** expiry is checked,
 * and the returned registry is the one the caller must persist even when this
 * call throws. That ordering is the whole point: a replay, a late attempt and a
 * typo all consume the invitation the same way, so nothing distinguishes them.
 *
 * Returns `{ invitations, label }` on success. Throws on failure — callers must
 * still persist `error.invitations` when present.
 */
export function redeemInvitation(invitations, code, now) {
  if (Number.isNaN(Date.parse(now))) fail('now must be an ISO timestamp')
  const current = normalizeInvitations(invitations)
  const digest = invitationDigest(code)
  const match = current.invitations.find(entry => digestsEqual(entry.digest, digest))
  if (match === undefined) {
    fail('no such invitation')
  }
  const remaining = normalizeInvitations({
    version: INVITATION_REGISTRY_VERSION,
    invitations: current.invitations.filter(entry => !digestsEqual(entry.digest, digest)),
  })
  if (Date.parse(match.expiresAt) <= Date.parse(now)) {
    const error = new Error('remote-access pairing: this invitation has expired')
    error.invitations = remaining
    throw error
  }
  return { invitations: remaining, label: match.label }
}

/** Drop expired entries. Returns the registry and how many were removed. */
export function pruneInvitations(invitations, now) {
  if (Number.isNaN(Date.parse(now))) fail('now must be an ISO timestamp')
  const current = normalizeInvitations(invitations)
  const cutoff = Date.parse(now)
  const kept = current.invitations.filter(entry => Date.parse(entry.expiresAt) > cutoff)
  return {
    invitations: normalizeInvitations({ version: INVITATION_REGISTRY_VERSION, invitations: kept }),
    removed: current.invitations.length - kept.length,
  }
}
