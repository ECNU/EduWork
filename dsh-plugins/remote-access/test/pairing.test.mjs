import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_INVITATION_TTL_MS,
  createInvitation,
  createInvitationCode,
  emptyInvitations,
  invitationDigest,
  listInvitations,
  liveInvitations,
  pruneInvitations,
  redeemInvitation,
} from '../lib/pairing.js'

const NOW = '2026-10-09T12:00:00.000Z'
const LATER = '2026-10-09T12:05:00.000Z'
const TOO_LATE = '2026-10-09T12:30:00.000Z'

function mint(overrides = {}) {
  return createInvitation(emptyInvitations(), { now: NOW, ...overrides })
}

test('a code carries 128 bits of entropy', () => {
  // 16 random bytes in base64url: 22 characters, no padding.
  const code = createInvitationCode()
  assert.equal(code.length, 22)
  assert.match(code, /^[A-Za-z0-9_-]+$/)
})

test('codes do not repeat', () => {
  const seen = new Set()
  for (let index = 0; index < 200; index += 1) seen.add(createInvitationCode())
  assert.equal(seen.size, 200)
})

test('the plaintext code is not recoverable from the registry', () => {
  // A leaked registry file must not hand out live invitations.
  const { invitations, code } = mint()
  const serialized = JSON.stringify(invitations)
  assert.ok(!serialized.includes(code), 'the registry must not contain the code')
  assert.ok(serialized.includes(invitationDigest(code)), 'the registry stores the digest instead')
})

test('an invitation carries its label and expiry', () => {
  const { invitations, code, expiresAt } = mint({ label: '书房平板' })
  assert.equal(expiresAt, '2026-10-09T12:10:00.000Z')
  assert.equal(expiresAt, new Date(Date.parse(NOW) + DEFAULT_INVITATION_TTL_MS).toISOString())
  const [entry] = listInvitations(invitations)
  assert.equal(entry.label, '书房平板')
  assert.equal(entry.digest, invitationDigest(code))
})

test('a custom lifetime is honoured', () => {
  const { expiresAt } = mint({ ttlMs: 60_000 })
  assert.equal(expiresAt, '2026-10-09T12:01:00.000Z')
})

test('a non-positive lifetime is refused', () => {
  assert.throws(() => mint({ ttlMs: 0 }), /positive number/)
  assert.throws(() => mint({ ttlMs: -1 }), /positive number/)
})

test('redeeming consumes the invitation', () => {
  const { invitations, code } = mint({ label: '手机' })
  const outcome = redeemInvitation(invitations, code, LATER)
  assert.equal(outcome.label, '手机')
  assert.deepEqual(listInvitations(outcome.invitations), [])
})

test('an invitation cannot be redeemed twice', () => {
  // The whole point of pairing: a captured code is worthless after first use.
  const { invitations, code } = mint()
  const first = redeemInvitation(invitations, code, LATER)
  assert.throws(() => redeemInvitation(first.invitations, code, LATER), /no such invitation/)
})

test('an expired invitation is refused', () => {
  const { invitations, code } = mint()
  assert.throws(() => redeemInvitation(invitations, code, TOO_LATE), /expired/)
})

test('an expired invitation is still consumed by the failed attempt', () => {
  // Redemption removes the entry before checking expiry, so a late attempt and a
  // replay leave the registry in the same state.
  const { invitations, code } = mint()
  let thrown
  try {
    redeemInvitation(invitations, code, TOO_LATE)
  } catch (error) {
    thrown = error
  }
  assert.ok(thrown, 'the late attempt must fail')
  assert.ok(thrown.invitations, 'the error must carry the registry to persist')
  assert.deepEqual(listInvitations(thrown.invitations), [])
})

test('an unknown code is refused and changes nothing', () => {
  const { invitations } = mint()
  assert.throws(() => redeemInvitation(invitations, createInvitationCode(), LATER), /no such invitation/)
  assert.equal(listInvitations(invitations).length, 1)
})

test('a near-miss code is refused', () => {
  const { invitations, code } = mint()
  const tampered = `${code.slice(0, -1)}${code.endsWith('A') ? 'B' : 'A'}`
  assert.throws(() => redeemInvitation(invitations, tampered, LATER), /no such invitation/)
})

test('an empty or non-string code is refused', () => {
  assert.throws(() => invitationDigest(''), /non-empty string/)
  assert.throws(() => invitationDigest('   '), /non-empty string/)
  assert.throws(() => invitationDigest(42), /non-empty string/)
})

test('surrounding whitespace in a pasted code is tolerated', () => {
  const { invitations, code } = mint()
  const outcome = redeemInvitation(invitations, `  ${code}\n`, LATER)
  assert.deepEqual(listInvitations(outcome.invitations), [])
})

test('two invitations can coexist and are redeemed independently', () => {
  const first = mint({ label: 'a' })
  const second = createInvitation(first.invitations, { now: NOW, label: 'b' })
  const redeemed = redeemInvitation(second.invitations, first.code, LATER)
  assert.equal(redeemed.label, 'a')
  assert.equal(listInvitations(redeemed.invitations).length, 1)
  const after = redeemInvitation(redeemed.invitations, second.code, LATER)
  assert.equal(after.label, 'b')
  assert.deepEqual(listInvitations(after.invitations), [])
})

test('reusing a code that is still live is refused at mint time', () => {
  const first = mint()
  assert.throws(
    () => createInvitation(first.invitations, { now: NOW, code: first.code }),
    /must not repeat/,
  )
})

test('liveInvitations filters by expiry without consuming', () => {
  const { invitations } = mint()
  assert.equal(liveInvitations(invitations, LATER).length, 1)
  assert.equal(liveInvitations(invitations, TOO_LATE).length, 0)
  assert.equal(listInvitations(invitations).length, 1, 'filtering must not mutate')
})

test('pruneInvitations removes only expired entries and reports the count', () => {
  const first = mint({ label: 'old' })
  const second = createInvitation(first.invitations, { now: NOW, ttlMs: 60 * 60 * 1000, label: 'fresh' })
  const pruned = pruneInvitations(second.invitations, TOO_LATE)
  assert.equal(pruned.removed, 1)
  assert.deepEqual(listInvitations(pruned.invitations).map(entry => entry.label), ['fresh'])
})

test('the registry round-trips through JSON', () => {
  const { invitations } = mint({ label: '平板' })
  assert.deepEqual(JSON.parse(JSON.stringify(invitations)), invitations)
})

test('an unsupported registry version is refused', () => {
  assert.throws(() => liveInvitations({ version: 99, invitations: [] }, NOW), /unsupported/)
})

test('a malformed digest is refused', () => {
  assert.throws(
    () => liveInvitations({ invitations: [{ digest: 'nope', expiresAt: NOW }] }, NOW),
    /64-character hex/,
  )
})

test('an unparseable expiry is refused', () => {
  assert.throws(
    () => liveInvitations({ invitations: [{ digest: invitationDigest('x'), expiresAt: 'later' }] }, NOW),
    /ISO timestamp/,
  )
})

test('a missing registry normalizes to an empty one', () => {
  assert.deepEqual(listInvitations(undefined), [])
  assert.deepEqual(listInvitations(null), [])
  assert.deepEqual(listInvitations({}), [])
})

test('an invalid now is refused everywhere', () => {
  const { invitations, code } = mint()
  assert.throws(() => liveInvitations(invitations, 'nope'), /ISO timestamp/)
  assert.throws(() => redeemInvitation(invitations, code, 'nope'), /ISO timestamp/)
  assert.throws(() => pruneInvitations(invitations, 'nope'), /ISO timestamp/)
  assert.throws(() => createInvitation(invitations, { now: 'nope' }), /ISO timestamp/)
})
