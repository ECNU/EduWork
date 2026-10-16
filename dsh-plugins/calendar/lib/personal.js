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
import { AnnotationSchema, SCOPE } from './model.js'
import { annotationKey } from './keys.js'

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
    this.tables = { annotations: domain.table('annotations') }
    return domain
  }

  /** Close the domain, draining queued writes. Idempotent. */
  async close() {
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
    this.chains.set(targetKey, run.then(() => undefined, () => undefined))
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
  async patch(ref, patch) {
    return await this.enqueue(annotationKey(ref), async () => {
      const key = annotationKey(ref)
      const current = this.requireTable().get(key)
      const merged = { ...current, ...defined(patch), ...identityOf(ref) }
      const record = AnnotationSchema.parse(merged)
      await this.requireTable().put(key, record)
      return record
    })
  }

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
