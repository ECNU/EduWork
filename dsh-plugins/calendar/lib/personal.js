// The personal layer: what the user wrote, in storage the school sync cannot
// reach.
//
// This is a separate domain from `calendar` on purpose. The source layer is
// replaced wholesale by a sync (`applySnapshot` with `replace`), and the only
// reliable way to keep user content out of that replacement is to put it
// somewhere the sync has no handle for — a different domain, not a different
// field. A rule like "remember not to delete the user's rows" is exactly the
// kind of rule that breaks later; a missing handle cannot break.
//
// Records are keyed by the *identity* of what they annotate (see `keys.js`), so
// a note stays attached to the class it was written on even after the school
// moves that class: the key holds the instant the series originally produced,
// not the time the class currently happens at.
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { AnnotationSchema, PersonalPatchSchema, SCOPE } from './model.js'
import { annotationKey, eventKey } from './keys.js'
import { z } from 'zod'

export { AnnotationSchema, SCOPE }

/**
 * The personal layer's domain.
 *
 * It holds one table, `annotations`, and a table is declared when it is used
 * rather than reserved in advance: this domain is `per-record`, so a table added
 * later writes and reads its own files without rewriting anything else, and an
 * earlier version of this file reserved an `events` table that nothing could use.
 */
export const personalDomain = defineDomain({
  name: 'calendar_personal',
  version: 1,
  layout: 'per-record',
  tables: {
    annotations: domainTable(AnnotationSchema),
    source_receipts: domainTable(z.object({
      source: z.string().min(1), uid: z.string().min(1), legacyDescription: z.string().optional(), legacyExtensions: z.record(z.string(), z.unknown()).optional(),
    }).strict()),
  },
})

/**
 * Annotations, with a per-target write queue.
 *
 * The queue is not an optimisation. A read-modify-write against the storage
 * primitive is not atomic: `put` does not update the in-memory view before it
 * awaits, so two callers that each read, merge their own field and write can
 * interleave and one loses the other's field. That is why a user changing a note
 * and a reminder "at the same time" silently keeps only one of them. Every write
 * here therefore runs its read, its merge and its commit inside one queued task
 * per target key, and nothing outside this class writes these records.
 *
 * The guarantee is single-process. Two application instances sharing one storage
 * root would need compare-and-swap at the storage layer, which the table
 * interface does not offer.
 */
export class PersonalStore {
  /** @param ctx - Plugin context carrying `storageDomain`. */
  constructor(ctx) {
    this.ctx = ctx
    this.domain = undefined
    this.tables = undefined
    this.chains = new Map()
  }

  /** Open the domain and resolve its table handles. */
  async open() {
    const domain = await this.ctx.storageDomain.open(personalDomain)
    this.domain = domain
    this.tables = { annotations: domain.table('annotations'), receipts: domain.table('source_receipts') }
    return domain
  }

  /** Close the domain, draining queued writes. Idempotent. */
  async close() {
    await Promise.all(this.chains.values())
    await this.domain?.close()
  }

  /** @returns the annotation table; reading before `open` is a bug and throws. */
  requireTable() {
    if (!this.tables) throw new Error('calendar personal storage is not open yet')
    return this.tables.annotations
  }

  /**
   * Run `work` after every task already queued for `targetKey`.
   *
   * A failing task does not break the chain: the next task still runs, so one
   * rejected write cannot wedge a target forever.
   * @param targetKey - The storage key whose writes must not interleave.
   * @param work - The whole read-modify-write, not just its last step.
   */
  enqueue(targetKey, work) {
    const previous = this.chains.get(targetKey) ?? Promise.resolve()
    const run = previous.then(work, work)
    const settled = run.then(() => undefined, () => undefined)
    this.chains.set(targetKey, settled)
    void settled.then(() => { if (this.chains.get(targetKey) === settled) this.chains.delete(targetKey) })
    return run
  }

  /** @returns every annotation in a scope, as stored. */
  list(scope) {
    return [...this.requireTable().entries()]
      .map(([, record]) => record)
      .filter(record => record.scope === scope)
  }

  /** @returns the annotation under one key, or undefined. */
  get(ref) {
    return this.requireTable().get(annotationKey(ref))
  }

  /**
   * Merge a patch into the annotation one reference points at, creating it when
   * absent. The read happens inside the queued task: reading before enqueuing is
   * the exact mistake that loses a concurrent patch.
   * @param ref - `{ scope, source, uid, originalStart? }` identifying the target.
   * @param patch - Fields to merge; `undefined` values are ignored.
   * @returns the stored record.
   */
  async patch(ref, patch, clear = []) {
    patch = PersonalPatchSchema.parse(patch)
    if (!Array.isArray(clear) || clear.some(field => !['note', 'remark', 'hidden', 'reminder'].includes(field))) throw new Error('unknown personal field')
    return await this.enqueue(annotationKey(ref), () => this.writeFields(ref, patch, clear))
  }

  /** The read, merge and commit body; callers hold this target's queue. */
  async writeFields(ref, patch, clear) {
    const key = annotationKey(ref)
    const current = this.requireTable().get(key)
    const merged = { ...current, ...defined(patch), ...identityOf(ref) }
    for (const field of clear) delete merged[field]
    const record = AnnotationSchema.parse(merged)
    if (!['note', 'remark', 'hidden', 'reminder'].some(field => record[field] !== undefined)) {
      await this.requireTable().delete(key)
      return undefined
    }
    await this.requireTable().put(key, record)
    return record
  }

  /** Clear one field inside the same queue as patches, including its existence check. */
  async clearField(ref, field) {
    if (!['note', 'remark', 'hidden', 'reminder'].includes(field)) throw new Error('unknown personal field')
    return await this.enqueue(annotationKey(ref), async () => {
      if (this.get(ref)?.[field] === undefined) return false
      await this.writeFields(ref, {}, [field])
      return true
    })
  }

  /** Record source ownership once; only pre-upgrade descriptions need a review copy. */
  async rememberSource(event, legacy = false) {
    if (event.source === 'manual') return
    const key = eventKey(event)
    await this.enqueue(`receipt:${key}`, async () => {
      if (this.tables.receipts.get(key)) return
      await this.tables.receipts.put(key, { source: event.source, uid: event.uid,
        ...(legacy && event.description ? { legacyDescription: event.description } : {}),
        ...(legacy && Object.keys(event.extensions ?? {}).length ? { legacyExtensions: event.extensions } : {}) })
    })
  }

  sourceInfo(ref) { return this.tables.receipts.get(eventKey(ref)) }

  /** Drop one annotation entirely. @returns true when a record was removed. */
  async remove(ref) {
    return await this.enqueue(annotationKey(ref), async () => await this.requireTable().delete(annotationKey(ref)))
  }
}

/** The identity fields every record carries, so a value is readable on its own. */
function identityOf({ scope = 'source', source, uid, originalStart }) {
  return originalStart ? { scope, source, uid, originalStart } : { scope, source, uid }
}

/** `patch` without its absent keys: an absent field means "leave it alone". */
function defined(patch) {
  return Object.fromEntries(Object.entries(patch ?? {}).filter(([, value]) => value !== undefined))
}
