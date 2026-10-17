/**
 * The Host's long-term identity, kept where a restart can find it again.
 *
 * The identity is what a device pins and what the relay binds `hostId` to on the
 * first registration. A fresh key pair per boot therefore breaks both halves of
 * the design: the relay refuses the new key with `host-id-taken` (the binding is
 * first-writer-wins and there is no crypto on the relay to prove a rotation), and
 * a device that stored the old public key can no longer complete the handshake.
 * `DESIGN.md` §4.1 and §6.5 require the key to persist; this module is that.
 *
 * ## Why the credential store
 *
 * The key is a secret, so it does not belong in configuration: settings are the
 * document the operator edits, renders in a form and may sync. The harness already
 * has a seam for exactly this — `ctx.credentials`, a provider-backed store whose
 * record half is durable, owner-scoped (`<scope>/<id>`) and never readable through
 * the configuration surface. The key lives there as a `grant` record, the same
 * shape an authorization flow's private payload takes.
 *
 * ## Why a missing store is not fatal
 *
 * A composition without a credentials provider is a supported shape, and a Host
 * that refuses to start there would be worse than one that serves this boot and
 * loses its identity on the next. So the fallback is an ephemeral identity plus a
 * trace line that says so: the tunnel still works until the next restart, and the
 * operator can see why it will not survive one.
 *
 * ## Why a stored record is never silently replaced
 *
 * If the record cannot be read, rotating the key would repeat the very failure
 * this module exists to prevent — the relay would refuse the new key and every
 * paired device would be locked out. The error is raised to the caller instead, so
 * the failure is visible and the old binding stays untouched until someone
 * decides what to do with it.
 */

import { encodePublicKey, exportIdentity, generateIdentity, importIdentity } from './channel/crypto.js'

/**
 * The record's address in the credential store.
 *
 * `<scope>/<id>`: the scope is this plugin, the id names the one thing it keeps.
 * The grammar is the credential seam's, not ours — lowercase segments joined by
 * single dashes.
 */
export const HOST_IDENTITY_KEY = 'remote-access/host-identity'

/**
 * Whether a service offers the record half of the credential seam.
 *
 * The reference half (`resolve`, `describe`) is older than records and providers
 * that only implement it are not useful here: a key cannot be stored as an
 * environment reference, because there is no operator to set it. Checking both
 * methods is cheaper than catching a `TypeError` from either.
 *
 * @param credentials - the `credentials` service, or `undefined`.
 */
export function hasCredentialRecords(credentials) {
  return typeof credentials?.readRecord === 'function' && typeof credentials?.modifyRecord === 'function'
}

/**
 * Load the Host identity, creating and storing it on first use.
 *
 * @param credentials - the `credentials` service, or `undefined` when the host has
 *   none. Only the record half is used.
 * @param probe - trace writer; called with `(step, detail)`.
 * @returns `{ identity, source }`, where source is `'stored'`, `'created'` or
 *   `'ephemeral'`. The identity is the shape the handshake takes: two key pairs,
 *   each `{ publicKey, privateKey }`.
 */
export async function loadHostIdentity(credentials, probe = () => {}) {
  if (!hasCredentialRecords(credentials)) {
    probe('identity unavailable', 'no credential record store; this boot’s identity will not survive a restart')
    return { identity: await generateIdentity(), source: 'ephemeral' }
  }

  let record = await credentials.readRecord(HOST_IDENTITY_KEY)
  let source = 'stored'
  if (record === undefined) {
    // `modifyRecord` is an exclusive read-decide-replace, so two boots (or two
    // effects racing a settings change) cannot both create a key. The mutator sees
    // whatever is current at the moment the write is exclusive; returning
    // `undefined` leaves it alone.
    await credentials.modifyRecord(HOST_IDENTITY_KEY, async (current) => {
      if (current !== undefined) return undefined
      const created = await generateIdentity({ extractable: true })
      return { kind: 'grant', payload: await exportIdentity(created) }
    })
    // Read back rather than trusting the write's return value: the seam documents
    // that `undefined` leaves the entry untouched, and different providers word
    // that differently. The read is the fact.
    record = await credentials.readRecord(HOST_IDENTITY_KEY)
    if (record === undefined) {
      throw new Error('identity: the credential store accepted the write but kept no record')
    }
    source = 'created'
  }
  if (record.kind !== 'grant') {
    throw new Error(`identity: the stored record is a "${String(record.kind)}", not a grant`)
  }

  let identity
  try {
    identity = await importIdentity(record.payload)
  } catch (error) {
    probe('identity corrupt', String(error?.message ?? error))
    throw new Error(`identity: the stored host identity could not be read: ${error instanceof Error ? error.message : String(error)}`)
  }
  probe(source === 'created' ? 'identity created' : 'identity loaded', await encodePublicKey(identity.signing.publicKey))
  return { identity, source }
}
