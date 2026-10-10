import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CREDENTIAL_PREFIX,
  authenticate,
  credentialFor,
  credentialHolders,
  digest,
  emptyCredentials,
  isCredentialShape,
  issueCredential,
  mintCredential,
  normalizeCredentials,
  revokeCredential,
  verifyCredential,
} from '../src/credentials.js'

const NOW = '2026-10-09T12:00:00.000Z'
const LATER = '2026-10-09T13:00:00.000Z'

test('a minted secret is recognisable and its digest is not the secret', () => {
  const { secret, digest: hashed } = mintCredential()
  assert.equal(isCredentialShape(secret), true)
  assert.ok(secret.startsWith(`${CREDENTIAL_PREFIX}_`))
  assert.notEqual(hashed, secret)
  assert.equal(hashed, digest(secret))
  assert.equal(hashed.length, 64, 'sha256 hex is 64 characters')
})

test('two mints never collide', () => {
  const seen = new Set()
  for (let index = 0; index < 200; index += 1) seen.add(mintCredential().secret)
  assert.equal(seen.size, 200)
})

test('a credential is issued once and the secret is not recoverable from the store', () => {
  const { store, secret } = issueCredential(emptyCredentials(), 'dev-1', NOW)
  assert.equal(credentialHolders(store).length, 1)
  const record = credentialFor(store, 'dev-1')
  assert.equal(record.digest, digest(secret))
  // The stored record must not contain the secret anywhere.
  assert.equal(JSON.stringify(store).includes(secret), false)
  assert.deepEqual(record.issuedAt, NOW)
  assert.equal(record.lastUsedAt, null)
})

test('a presented secret verifies and a wrong one does not', () => {
  const { store, secret } = issueCredential(emptyCredentials(), 'dev-1', NOW)
  const record = credentialFor(store, 'dev-1')
  assert.equal(verifyCredential(record, secret), true)
  assert.equal(verifyCredential(record, mintCredential().secret), false)
  assert.equal(verifyCredential(record, `${secret}x`), false)
  assert.equal(verifyCredential(record, secret.slice(0, -1)), false)
})

test('malformed or absent secrets are refused without throwing', () => {
  const { store, secret } = issueCredential(emptyCredentials(), 'dev-1', NOW)
  const record = credentialFor(store, 'dev-1')
  for (const value of [undefined, null, '', '   ', 42, {}, [], 'not-a-credential', `${CREDENTIAL_PREFIX}_`]) {
    assert.equal(verifyCredential(record, value), false, `${String(value)} must be refused`)
  }
  assert.equal(verifyCredential(undefined, secret), false)
  assert.equal(verifyCredential({}, secret), false)
  assert.equal(verifyCredential({ digest: '' }, secret), false)
})

test('authenticate returns the verdict and stamps the use', () => {
  const { store, secret } = issueCredential(emptyCredentials(), 'dev-1', NOW)
  const rejected = authenticate(store, 'dev-1', 'wrong', LATER)
  assert.equal(rejected.ok, false)
  assert.equal(credentialFor(rejected.store, 'dev-1').lastUsedAt, null, 'a failure must not stamp a use')

  const accepted = authenticate(store, 'dev-1', secret, LATER)
  assert.equal(accepted.ok, true)
  assert.equal(credentialFor(accepted.store, 'dev-1').lastUsedAt, LATER)
})

test('authenticate refuses an unknown device', () => {
  const { store, secret } = issueCredential(emptyCredentials(), 'dev-1', NOW)
  assert.equal(authenticate(store, 'dev-2', secret, LATER).ok, false)
})

test('re-issuing replaces the old secret rather than adding a second one', () => {
  // Otherwise a device that was re-paired leaves its previous secret working,
  // which is exactly the window re-pairing is meant to close.
  const first = issueCredential(emptyCredentials(), 'dev-1', NOW)
  const second = issueCredential(first.store, 'dev-1', LATER)
  assert.equal(credentialHolders(second.store).length, 1)
  assert.equal(authenticate(second.store, 'dev-1', first.secret, LATER).ok, false)
  assert.equal(authenticate(second.store, 'dev-1', second.secret, LATER).ok, true)
})

test('revoking drops the credential outright', () => {
  const { store, secret } = issueCredential(emptyCredentials(), 'dev-1', NOW)
  const { store: after, removed } = revokeCredential(store, 'dev-1')
  assert.equal(removed, true)
  assert.equal(credentialHolders(after).length, 0)
  assert.equal(authenticate(after, 'dev-1', secret, LATER).ok, false)
})

test('revoking a device that had no credential reports so', () => {
  assert.equal(revokeCredential(emptyCredentials(), 'nobody').removed, false)
})

test('revoking one device leaves the others alone', () => {
  let store = issueCredential(emptyCredentials(), 'dev-1', NOW).store
  const second = issueCredential(store, 'dev-2', NOW)
  store = second.store
  const { store: after } = revokeCredential(store, 'dev-1')
  assert.deepEqual(credentialHolders(after), ['dev-2'])
  assert.equal(authenticate(after, 'dev-2', second.secret, LATER).ok, true)
})

test('the store is round-trippable through JSON', () => {
  const { store } = issueCredential(emptyCredentials(), 'dev-1', NOW)
  assert.deepEqual(normalizeCredentials(JSON.parse(JSON.stringify(store))), store)
})

test('an empty or missing store normalizes to a valid one', () => {
  for (const value of [undefined, null, {}, { credentials: [] }]) {
    assert.deepEqual(normalizeCredentials(value), emptyCredentials())
  }
})

test('a duplicate credential for one device is refused', () => {
  const { store } = issueCredential(emptyCredentials(), 'dev-1', NOW)
  const doubled = { version: 1, credentials: [...store.credentials, ...store.credentials] }
  assert.throws(() => normalizeCredentials(doubled), /duplicate credential/)
})

test('an unknown store version is refused rather than guessed at', () => {
  assert.throws(() => normalizeCredentials({ version: 99, credentials: [] }), /unsupported credential store version/)
})

test('a malformed record fails loudly', () => {
  assert.throws(() => normalizeCredentials({ credentials: [{ deviceId: 'dev-1' }] }), /digest/)
  assert.throws(() => normalizeCredentials({ credentials: [{ digest: 'x', issuedAt: NOW }] }), /deviceId/)
  assert.throws(
    () => normalizeCredentials({ credentials: [{ deviceId: 'a', digest: 'b', issuedAt: 'not-a-date' }] }),
    /issuedAt/,
  )
})

test('records stay sorted by device id', () => {
  let store = issueCredential(emptyCredentials(), 'dev-c', NOW).store
  store = issueCredential(store, 'dev-a', NOW).store
  store = issueCredential(store, 'dev-b', NOW).store
  assert.deepEqual(credentialHolders(store), ['dev-a', 'dev-b', 'dev-c'])
})

test('issuing to an empty device id is refused', () => {
  assert.throws(() => issueCredential(emptyCredentials(), '', NOW), /deviceId/)
  assert.throws(() => issueCredential(emptyCredentials(), 'dev-1', 'nope'), /now/)
})
