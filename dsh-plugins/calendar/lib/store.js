// Local storage for calendar records.
//
// Records live in a storage-domain table, so writes are durable before they
// become visible, every stored record is validated against the schema in
// model.js at the durability boundary, and changes emit `domain/changed`. The
// module owns no file paths: the domain facility routes the domain to whatever
// backend the assembly configured.
//
// Nothing here leaves the machine. Records are never uploaded and never logged.
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { assertEventKeyBudget, eventKey, isEncodedKey } from './keys.js'
import { LocalDatesSchema, StoredEventSchema, assertOrderedRecord, assertOrderedSpan, buildSnapshot, dropRetiredFields, inheritedEndOf, normalizeEvent, occurrencesOf, occurrencesIn, overlaps } from './model.js'

/**
 * Domain layout: events keyed by source and identifier.
 *
 * The key names both, spelled by `keys.js`, because an identifier is only unique
 * within the source that issued it. The version stays 1 although the former
 * `courses` table is gone: stored event records are still readable, and a backend
 * reads only the tables this spec declares, so an existing store opens as it did
 * and simply loses the retired table at the next write. Bumping the version
 * instead would reject every store written before the change (the JSON backend
 * requires an exact version on the whole-unit layout) over a table that is no
 * longer read.
 *
 * The table is declared with {@link StoredEventSchema} rather than the public
 * record schema, for the fields this contract retired: reading one has to be
 * possible, and {@link CalendarStore.open} rewrites such a record into the
 * current shape once, after which the two schemas accept the same records.
 */
export const calendarDomain = defineDomain({
  name: 'calendar',
  version: 1,
  tables: {
    events: domainTable(StoredEventSchema),
    local_dates: domainTable(LocalDatesSchema),
    source_versions: domainTable(z.object({ revision: z.number().int().positive(), digest: z.string() }).strict()),
  },
})

/**
 * The source recorded for a record the user created themselves.
 *
 * It is the one source every caller can name without being told, which is what
 * makes it the default for the event methods the panel calls.
 */
const MANUAL_SOURCE = 'manual'

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}

/**
 * The storage key of one record: its source and its identifier together.
 *
 * A `uid` is only unique within the source that issued it — two timetables both
 * number their courses from one — so keying by `uid` alone makes the second
 * source's class overwrite the first's.
 *
 * The key itself comes from `keys.js`, the one place that decides how a pair of
 * parts becomes a name, so a record and the annotations attached to it cannot end
 * up in two encodings that drift apart. Everything in this table belongs to the
 * `source` ownership scope; the personal layer keys its own records there.
 * @param source - The source the record belongs to.
 * @param uid - The identifier within that source.
 */
function recordKey(source, uid) {
  return eventKey({ source, uid })
}

/**
 * CRUD over the calendar domain. Callers must await {@link open} (the plugin
 * does it while starting) before touching records; reads are synchronous from
 * the domain's in-memory state, writes resolve only after durability.
 */
export class CalendarStore {
  /**
   * @param ctx - Plugin context carrying `storageDomain` and the domain events.
   */
  constructor(ctx) {
    this.ctx = ctx
    this.domain = undefined
    this.tables = undefined
    /**
     * Records found on disk that cannot be placed in a layer, so they cannot be
     * named by a read or a delete. Reported rather than guessed at or dropped.
     * @type {{ key: string, uid: unknown, reason: string }[]}
     */
    this.needsReview = []
    /** Tail of the write chain; see {@link CalendarStore.enqueueWrite}. */
    this.writes = Promise.resolve()
  }

  /**
   * Open the domain, resolve the table handles, and fold records written before
   * the record contract changed into the shape it now guarantees.
   * @returns resolution once stored records are loaded, validated and folded.
   */
  async open() {
    const domain = await this.ctx.storageDomain.open(calendarDomain)
    this.domain = domain
    this.tables = { events: domain.table('events'), localDates: domain.table('local_dates'), sourceVersions: domain.table('source_versions') }
    this.needsReview = []
    await this.foldRetiredFields()
    await this.rekeyBySource()
    return domain
  }

  /**
   * Rewrite records stored under an older key into the one this contract reads.
   *
   * Two older shapes are still on disk in the field. The original keyed a record
   * by its `uid` alone; an intermediate one joined the source and the identifier
   * with a NUL. A record left under either would still be on disk but no longer
   * found, which looks to the reader like the timetable was emptied, so each is
   * moved once on the first open after the upgrade.
   *
   * Two cases are not a plain move, and both are about not losing the record that
   * is already being read:
   *
   * - The key being moved to can already hold a record. That happens when both
   *   shapes were written to one store — a build that writes the current key ran,
   *   and the store was then written by one that still writes an older key — or
   *   after a hand edit. The record at the key now in use is the one the calendar
   *   has been reading, so writing over it would replace live data with a stale
   *   copy. The stale copy is dropped instead, which loses nothing reachable.
   * - The record can have no source. `source` is optional in the schema an older
   *   store was written against, so a record written under the old contract can
   *   lack it. Deriving a key from a missing source strands the record: still on
   *   disk, but namable by no read and no delete. Its layer is unknown rather than
   *   "manual", so it is left exactly where it is and reported for a human.
   */
  async rekeyBySource() {
    const events = this.requireTables().events
    for (const [key, record] of [...events.entries()]) {
      // Already in the shape this contract reads; nothing to derive.
      if (isEncodedKey(key)) continue

      // The intermediate shape named the source in the key, so the identifier is
      // the part after the separator and the record itself need not be trusted for it.
      const fromNul = key.includes('\u0000')
      const uid = fromNul ? key.slice(key.indexOf('\u0000') + 1) : key

      if (typeof record.source !== 'string' || record.source === '') {
        this.needsReview.push({ key, uid, reason: 'missing_source' })
        continue
      }

      const target = recordKey(record.source, uid)
      // The move only has to happen once: the second open finds the encoded key.
      if (target === key) continue
      if (events.get(target)) {
        // The record at the current key is what the calendar reads; this copy is a
        // leftover from an older shape. Its content is either byte-identical (the
        // same record moved) or older (the live one was edited after the move).
        await events.delete(key)
        continue
      }
      await events.put(target, record)
      await events.delete(key)
    }
  }

  /**
   * Rewrite the records that still carry a retired field. One write per such
   * record, and none at all for a store already in the current shape: the move
   * happens on the first open after the upgrade and never runs again.
   */
  async foldRetiredFields() {
    const events = this.requireTables().events
    for (const [uid, record] of [...events.entries()]) {
      const clean = dropRetiredFields(record)
      if (clean) await events.put(uid, clean)
    }
  }

  /** Close the domain, draining queued writes. Idempotent. */
  async close() {
    await this.writes
    await this.domain?.close()
  }

  /** @returns the table handles; a caller before `open` is a bug and throws. */
  requireTables() {
    if (!this.tables) throw new Error('calendar storage is not open yet')
    return this.tables
  }

  /**
   * Run one whole read-modify-write of the event table after every write already
   * queued, and before any that follows it.
   *
   * This is not an optimisation. `put` does not update the in-memory view before
   * it awaits, so a read that happens outside the queue sees the state before an
   * earlier write landed. Two of the reader's changes started together — moving
   * one date and cancelling another, or two dates of one class — each read the
   * same record, and the second write puts back a record that never heard about
   * the first change. One of the two silently disappears.
   *
   * The queue serialises the write *and* the read it depends on, which is why the
   * read has to happen inside the task passed here rather than before it.
   *
   * One queue covers the whole table rather than one per record, because the
   * operations that write many records at once — an import, a school sync — would
   * each need to hold a set of per-record queues, and a bulk write that misses one
   * of them is the same defect in a harder place to see. Writes here are one local
   * file each, so serialising them all costs nothing a reader can observe.
   *
   * The guarantee is single-process: two application instances sharing one storage
   * root would need compare-and-swap, which the table interface does not offer.
   * @param work - The whole read-modify-write, not just its last step.
   */
  enqueueWrite(work) {
    const run = this.writes.then(work, work)
    this.writes = run.then(() => undefined, () => undefined)
    return run
  }

  /** @returns the public snapshot of everything stored. */
  snapshot() {
    const { events } = this.requireTables()
    return { ...buildSnapshot([...events.entries()].map(([, event]) => event)), needsReview: [...this.needsReview] }
  }

  /**
   * Events overlapping a range, as stored: a weekly series contributes one
   * record, not one per week.
   * @param range - Optional `{ from, to }` inclusive local-time bounds.
   * @returns matching events in display order.
   */
  listEvents(range = {}) {
    return this.snapshot().events.filter(event => overlaps(event, range))
  }

  /**
   * What a range of the calendar actually holds: every date the stored series
   * produce, minus `exceptions`, with `overrides` applied. This is what a view
   * renders, and it is computed per call — no per-week copy is stored.
   * @param range - Optional `{ from, to }` inclusive local-time bounds.
   * @returns occurrences in display order.
   */
  listOccurrences(range = {}) {
    const events = [...this.requireTables().events.entries()].map(([, event]) => event)
    return occurrencesIn(events, range)
  }

  /** @returns the stored event, or undefined. */
  getEvent(uid, source = MANUAL_SOURCE) {
    return this.requireTables().events.get(recordKey(source, uid))
  }
  /**
   * Insert or replace one event.
   * @param input - Event fields; validated and defaulted before the write.
   * @returns the stored record.
   */
  async putEvent(input) {
    const record = normalizeEvent(input)
    assertOrderedSpan(record)
    return await this.enqueueWrite(async () => {
      const stored = this.getEvent(record.uid, record.source)
      if (stored && !stored.recurrence && !record.recurrence) {
        const originalStart = stored.originalStart ?? stored.start
        if (originalStart !== record.start || stored.originalStart) record.originalStart = originalStart
      }
      return await this.commit(record)
    })
  }

  /**
   * Write one already-validated record, with no queue of its own.
   *
   * The methods that read a record, change part of it and write it back call this
   * from inside their own queued task. Queuing here as well would have that task
   * wait on itself.
   * @param record - A validated record whose key the caller has already decided.
   */
  async commit(record) {
    // The one place every stored record passes through, so the one place the span
    // rule covers every writer: the panel's editor, an agent tool, an import and a
    // school sync all arrive here. The rule is about the occurrences the record
    // produces, not only about the series, because an override can put one date
    // backwards while the record around it stays fine.
    assertOrderedRecord(record)
    assertEventKeyBudget(record)
    await this.requireTables().events.put(recordKey(record.source, record.uid), record)
    return record
  }

  /**
   * Change one record under the write queue, reading it inside that task.
   *
   * `change` receives the record as it is at the moment the queue reaches this
   * task, not as it was when the caller decided what to do — which is the whole
   * point, and the reason the read cannot happen before the call.
   * @param uid - Event identifier.
   * @param source - Which source the record belongs to.
   * @param missing - Message for the error when there is no such record.
   * @param change - Builds the new record from the current one.
   * @returns the stored record.
   */
  async updateEvent(uid, source, missing, change, changeLocal) {
    return await this.enqueueWrite(async () => {
      const event = this.getEvent(uid, source)
      if (!event) throw new Error(missing)
      const record = normalizeEvent(change(event))
      assertOrderedRecord(record)
      const key = recordKey(source, uid)
      const local = this.localDatesOf(key, event)
      const result = await this.commit(record)
      if (changeLocal) await this.requireTables().localDates.put(key, changeLocal(local))
      return result
    })
  }

  /** Older records have no ownership receipt; preserve their edits conservatively. */
  localDatesOf(key, legacy) {
    return this.requireTables().localDates.get(key) ?? {
      overrides: legacy?.overrides ?? [], exceptions: legacy?.exceptions ?? [],
    }
  }

  /**
   * Remove one event.
   *
   * It takes the queue like every other write: a delete and an edit of the same
   * record can be submitted together, and without a shared order they settle as the
   * delete reporting success while the edit's record is written back afterwards —
   * the class is gone and then it is on the calendar again.
   * @param uid - Event identifier.
   * @param source - Which source the record belongs to; `manual` for one the user
   *   created, which is the only kind the panel deletes.
   * @returns true when a record was removed.
   */
  async deleteEvent(uid, source = MANUAL_SOURCE) {
    return await this.enqueueWrite(async () => {
      const key = recordKey(source, uid)
      const removed = await this.requireTables().events.delete(key)
      await this.requireTables().localDates.delete(key)
      return removed
    })
  }

  /** Remove one imported calendar in the shared write queue. Personal data and
   * revision receipts survive: removing a calendar must not reset stale-update protection. */
  async deleteCalendar(source) {
    return this.enqueueWrite(async () => {
      const { events, localDates } = this.requireTables()
      let removedEvents = 0
      for (const [key, event] of events.entries()) {
        if (event.source !== source) continue
        await events.delete(key)
        await localDates.delete(key)
        ++removedEvents
      }
      return { removedEvents }
    })
  }

  /**
   * Record a per-date change to a series — the `RECURRENCE-ID` case: the
   * occurrence the series produces on `date` is moved, renamed or relocated.
   * Fields left out of `patch` keep following the series, and later edits to the
   * series still reach this occurrence.
   * @param uid - Identifier of the series event.
   * @param date - Date the series produces, `YYYY-MM-DD`.
   * @param patch - Fields to change: `title`, `start`, `end`, `location`, `description`.
   * @param source - Which source the record belongs to; `manual` by default.
   * @returns the stored record.
   */
  async applyOverride(uid, date, patch, source = MANUAL_SOURCE) {
    return await this.updateEvent(uid, source, `no event ${uid} to override`, event => {
      const kept = (event.overrides ?? []).filter(entry => entry.date !== date)
      const overrides = [...kept, { ...patch, date }].sort((left, right) => left.date.localeCompare(right.date))
      return { ...event, overrides }
    }, local => ({ ...local, overrides: upsertByDate(local.overrides, { ...patch, date }) }))
  }

  /**
   * Drop a per-date change, so that occurrence follows the series again.
   * @param uid - Identifier of the series event.
   * @param date - Date the series produces, `YYYY-MM-DD`.
   * @param source - Which source the record belongs to; `manual` by default.
   * @returns the stored record.
   */
  async removeOverride(uid, date, source = MANUAL_SOURCE) {
    return await this.updateEvent(uid, source, `no event ${uid} to un-override`, event => {
      const overrides = (event.overrides ?? []).filter(entry => entry.date !== date)
      return { ...event, overrides: overrides.length ? overrides : undefined }
    }, local => ({ ...local, overrides: local.overrides.filter(entry => entry.date !== date) }))
  }

  /**
   * Cancel one date a series produces — that occurrence does not happen. A move
   * that had been scheduled for that date goes with it, because there is nothing
   * left to move.
   * @param uid - Identifier of the series event.
   * @param date - Date the series produces, `YYYY-MM-DD`.
   * @param source - Which source the record belongs to; `manual` by default.
   * @returns the stored record.
   */
  async cancelOccurrence(uid, date, source = MANUAL_SOURCE) {
    return await this.updateEvent(uid, source, `no event ${uid} to cancel`, event => {
      if (!event.recurrence) throw new Error(`${uid} does not repeat; delete it instead of cancelling one date`)
      const exceptions = [...new Set([...(event.exceptions ?? []), date])].sort()
      const overrides = (event.overrides ?? []).filter(entry => entry.date !== date)
      return { ...event, exceptions, overrides: overrides.length ? overrides : undefined }
    }, local => ({
      overrides: local.overrides.filter(entry => entry.date !== date),
      exceptions: [...new Set([...local.exceptions, date])].sort(),
    }))
  }

  /**
   * Undo a cancellation, so that occurrence follows the series again.
   * @param uid - Identifier of the series event.
   * @param date - Date the series produces, `YYYY-MM-DD`.
   * @param source - Which source the record belongs to; `manual` by default.
   * @returns the stored record.
   */
  async restoreOccurrence(uid, date, source = MANUAL_SOURCE) {
    return await this.updateEvent(uid, source, `no event ${uid} to restore`, event => {
      const exceptions = (event.exceptions ?? []).filter(item => item !== date)
      return { ...event, exceptions: exceptions.length ? exceptions : undefined }
    }, local => ({ ...local, exceptions: local.exceptions.filter(entry => entry !== date) }))
  }

  /**
   * Merge a snapshot into the store, keyed by `uid`: the entry point for imports
   * and for data a source injects. A record that is already present is replaced,
   * so importing the same snapshot twice is idempotent. Every record is
   * validated before the first write, so a snapshot that is rejected part way
   * through leaves the store as it was.
   *
   * With `replace`, the snapshot is the whole truth for its `source`: events
   * already stored under that source which the snapshot does not list are
   * removed. That is what makes re-importing an updated calendar remove entries
   * that moved away, and it is also why the scope is the source: records from
   * any other source, personal ones included, are never touched.
   *
   * Removing on the strength of an absence is only safe when the snapshot is
   * known to be complete. A caller that had to leave an entry out — one in a
   * timezone this build cannot read, say — must pass `complete: false`, and then
   * nothing is removed: the entry that could not be read and the entry that is
   * genuinely gone are not distinguishable, and only one of those mistakes can be
   * undone.
   *
   * @param snapshot - `{ events }`; `schemaVersion` is accepted and ignored for now.
   * @param options - `source` for records that carry none; `replace` to also drop
   *   that source's records which the snapshot omits; `complete: false` to withhold
   *   that removal because the snapshot is known to be missing entries.
   * @returns counts of the events written and removed.
   */
  async importSnapshot(snapshot, options = {}) {
    const source = typeof options.source === 'string' && options.source ? options.source : 'import'
    if (!Array.isArray(snapshot?.events)) {
      throw new Error('calendar snapshot must carry an events array')
    }
    // Validated before the queue, so a snapshot that is rejected part way through
    // never starts writing. Nothing is read here: what the store already holds is
    // read inside the queued task below, so that a decision taken from a record is
    // taken from the record as it is when the write happens.
    const events = snapshot.events.map(event => normalizeEvent({ source, ...event }))
    return await this.enqueueWrite(async () => {
      const { events: eventTable } = this.requireTables()
      // Resolve against the latest queued state, then validate the entire plan
      // before writing anything. Input errors must not produce partial imports.
      const plans = new Map()
      for (const event of events) {
        const key = recordKey(event.source, event.uid)
        const prior = plans.get(key)
        const stored = prior?.record ?? eventTable.get(key)
        const local = prior?.local ?? this.localDatesOf(key, stored)
        const record = mergePersonalDates(local, event)
        if (stored?.originalStart && !record.recurrence) record.originalStart = stored.originalStart
        assertOrderedRecord(record)
        assertEventKeyBudget(record)
        plans.set(key, { record, local })
      }
      for (const [key, plan] of plans) {
        await this.commit(plan.record)
        await this.requireTables().localDates.put(key, plan.local)
      }
      let removedEvents = 0
      if (options.replace === true && options.complete !== false) {
        // "Which records does this snapshot no longer list" is a question about this
        // snapshot's own source, so a record of another source that happens to share
        // an identifier is not this snapshot's to remove.
        const incoming = new Set(events.map(event => recordKey(event.source, event.uid)))
        const stale = [...eventTable.entries()]
          .filter(([key, event]) => event.source === source && !incoming.has(key))
          .map(([key]) => key)
        for (const key of stale) {
          await eventTable.delete(key)
          removedEvents += 1
        }
      }
      return { events: events.length, removedEvents }
    })
  }

  /**
   * Apply a school snapshot: the entry point a timetable adapter calls.
   *
   * The rule that makes user content survive a reschedule is here, and it is a
   * rule about the *anchor* rather than a new data structure. The series' `start`
   * and `recurrence` are the original timetable and are frozen once written;
   * a later change to one class is recorded as an `override` keyed by the instant
   * the series originally produced (`RECURRENCE-ID`), and a cancelled class as an
   * `exception` (`EXDATE`). So the identity a note hangs on does not move when the
   * class does.
   *
   * An incoming entry may therefore say where it moved *from*: `movedFrom` is the
   * original instant of the class that changed. Without it a change cannot be
   * attributed to one occurrence, and this method does not guess — an entry whose
   * anchor differs from the stored one and which carries no `movedFrom` is
   * reported as unattributable instead of being applied.
   *
   * Personal records live in another domain and are not reachable from here, so
   * no code path in this method can delete one.
   *
   * @param input - `{ source, events, complete? }`: `events` are
   *   `{ uid, title, start, end?, location?, recurrence?, movedFrom?, cancelledDates? }`.
   * @returns `{ applied, moved, cancelled, unattributable }`.
   */
  async applySource(input, { isCurrent = () => true } = {}) {
    const source = input?.source
    if (typeof source !== 'string' || !source) throw new Error('a source snapshot must name its source')
    if (source === MANUAL_SOURCE) throw new Error('reserved calendar source')
    if (!Array.isArray(input?.events)) throw new Error('a source snapshot must carry an events array')
    if (input.complete === false) throw new Error('incomplete source snapshot cannot be applied')
    // The whole snapshot is one queued task. Every entry below reads the record it
    // is about to change, and two polls of the same source can overlap; inside one
    // task the read is of the record as it is when that entry is reached, which is
    // also what makes an entry see the one before it.
    return await this.enqueueWrite(async () => {
      if (!isCurrent()) throw new Error('superseded_snapshot')
      const versions = this.requireTables().sourceVersions
      const versionKey = createHash('sha256').update(source).digest('hex')
      const previous = versions.get(versionKey)
      const revision = input.revision
      if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1)) throw new Error('invalid_revision')
      if (previous && (revision === undefined || revision < previous.revision)) throw new Error('stale_revision')
      const ordered = [...input.events].sort((a, b) => a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0)
      const digest = createHash('sha256').update(JSON.stringify(canonical({ events: ordered, complete: input.complete === true }))).digest('hex')
      if (previous && previous.revision === revision && previous.digest !== digest) throw new Error('revision_conflict')
      const report = await this.applySourceEntries(source, input.events, input.complete === true)
      if (revision !== undefined && !report.unattributable.length) await versions.put(versionKey, { revision, digest })
      return report
    })
  }

  /**
   * Apply the entries of one source snapshot, in order.
   *
   * Callers reach this through {@link CalendarStore.applySource}, which is what
   * holds the write queue; this is the body so that the reads and the writes of one
   * snapshot are one unit rather than one unit each.
   * @param source - The source the snapshot came from.
   * @param incomingEvents - The snapshot's entries.
   * @returns the report described by {@link CalendarStore.applySource}.
   */
  async applySourceEntries(source, incomingEvents, complete = false) {
    const { events: eventTable } = this.requireTables()
    const report = { applied: 0, moved: 0, cancelled: 0, unattributable: [] }
    const plans = new Map()

    for (const incoming of incomingEvents) {
      const { movedFrom, cancelledDates, ...fields } = incoming
      // A record is identified by the source that sent it together with its
      // identifier: two timetables number their courses independently, so the same
      // `uid` from another source is a different class and must not be read as this
      // one. Reading by `uid` alone is what let one source's class overwrite
      // another's while keeping the first source's name on the record.
      const key = recordKey(source, incoming.uid)
      const prior = plans.get(key)
      const stored = prior?.record ?? eventTable.get(key)
      const wanted = normalizeEvent({ ...fields, source })
      // On the first sight of an event every field is the baseline; afterwards the
      // baseline is what is already stored.
      const previous = { ...(stored ?? wanted) }
      // A full snapshot replaces source exceptions as well as source records.
      // User decisions are merged from their separate receipt after planning.
      if (complete && !prior) {
        delete previous.exceptions
        delete previous.overrides
      }

      // A changed recurrence rule is a change to which classes exist, and
      // `movedFrom` cannot make that attributable: it names one occurrence, while
      // a new rule redefines all of them. Applying it would leave the anchor
      // pointing at a day the series no longer produces and orphan everything the
      // user attached, so this is reported rather than applied.
      if (stored && !sameSchedule(wanted.recurrence, stored.recurrence)) {
        report.unattributable.push({ uid: incoming.uid, reason: 'recurrence_changed' })
        continue
      }

      if (stored && movedFrom) {
        const day = dateOf(movedFrom)
        const baseline = { ...stored, overrides: undefined, exceptions: undefined }
        const originals = stored.recurrence
          ? occurrencesOf(baseline, { from: day, to: day }).map(item => item.originalStart)
          : [stored.originalStart ?? stored.start]
        if (!originals.some(anchor => anchor === movedFrom || (movedFrom.length === 10 && anchor.slice(0, 10) === movedFrom))) {
          report.unattributable.push({ uid: incoming.uid, reason: 'no_such_original_occurrence' })
          continue
        }
      }

      // A moved anchor is a change to *when* one class happens, which is what
      // `movedFrom` attributes. Without it the change reads equally well as one
      // occurrence moved or the whole series moved, and those attach the user's
      // note to different classes, so nothing is written.
      if (stored && wanted.start !== stored.start && !movedFrom) {
        report.unattributable.push({ uid: incoming.uid, reason: 'anchor_changed_without_movedFrom' })
        continue
      }

      // The stored record stays the original timetable. A change to one class
      // belongs in that class's override, so nothing here may overwrite the
      // baseline: the fields a school change can carry are compared against the
      // stored ones and only the differences are recorded against the occurrence.
      const record = { ...previous }
      if (movedFrom) {
        const date = dateOf(movedFrom)
        const patch = changedFields(previous, wanted)
        // A move that changed nothing — a poll of a class that is where it already
        // was — has no patch to record, and a patch with only a date in it is not a
        // legal override. There is nothing to move, so the date is left as it is
        // rather than given an empty entry that later reads as a move.
        if (Object.keys(patch).length > 0) record.overrides = upsertByDate(previous.overrides, { date, ...patch })
        record.exceptions = withoutDate(previous.exceptions, date)
        report.moved += 1
      } else {
        for (const field of ['title', 'end', 'location', 'description']) {
          if (fields[field] !== undefined) record[field] = wanted[field]
        }
      }
      if (Array.isArray(cancelledDates) && cancelledDates.length > 0) {
        const cancelled = cancelledDates.map(dateOf)
        record.exceptions = [...new Set([...(previous.exceptions ?? []), ...cancelled])].sort()
        // Cancelling a date takes any move of that date with it, the same way
        // `cancelOccurrence` does: the class does not happen, so there is nothing
        // left for an override to say. Keeping both would leave the date cancelled
        // and moved at once, and the moved reading is the one a view renders —
        // so the class would stay on the calendar after it was called off.
        const stillMoved = (record.overrides ?? []).filter(entry => !cancelled.includes(entry.date))
        if (stillMoved.length > 0) record.overrides = stillMoved
        else delete record.overrides
        report.cancelled += cancelled.length
      }
      // Through `commit` like every other writer, so the span rule covers a school
      // payload too: an adapter is not the last word on whether a class can end
      // before it starts, and storing one it sent puts a class on the calendar that
      // no view can draw.
      const local = prior?.local ?? this.localDatesOf(key, stored)
      const next = mergePersonalDates(local, normalizeEvent(record))
      assertOrderedRecord(next)
      assertEventKeyBudget(next)
      plans.set(key, { record: next, local })
      report.applied += 1
    }
    if (complete && report.unattributable.length > 0) {
      return { ...report, applied: 0, moved: 0, cancelled: 0, removed: 0 }
    }
    // Plan every entry before writing. A bad later entry must not leave a valid
    // prefix committed. Multiple changes to one series read the preceding plan.
    for (const [key, plan] of plans) {
      await this.commit(plan.record)
      if (!this.requireTables().localDates.get(key)) await this.requireTables().localDates.put(key, plan.local)
    }
    if (complete) {
      report.removed = 0
      for (const [key, event] of [...eventTable.entries()]) {
        if (event.source !== source || plans.has(key)) continue
        await eventTable.delete(key)
        report.removed += 1
      }
    }
    return report
  }

  /**
   * Observe durable changes.
   * @param listener - Called with each `domain/changed` payload of this domain.
   * @returns the disposer that stops observing.
   */
  onChanged(listener) {
    return this.ctx.on('domain/changed', change => {
      if (change?.domain !== calendarDomain.name) return
      listener(change)
    })
  }
}

/**
 * Whether two descriptions of a schedule are the same one.
 *
 * A schedule is either a time string or a recurrence object, so comparing them
 * needs to look inside the object: `{freq:'weekly',byDay:['tu']}` and
 * `{freq:'weekly',byDay:['we']}` are different schedules that a `===` would call
 * different for the wrong reason (a fresh object every snapshot) and a shallow
 * spread would silently replace.
 * @param a - One schedule, or `undefined`.
 * @param b - The other.
 * @returns whether they describe the same schedule.
 */
function sameSchedule(a, b) {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].every(key => sameSchedule(a[key], b[key]))
}

/** `YYYY-MM-DD` part of a local time string. */
function dateOf(value) {
  return String(value).slice(0, 10)
}

/**
 * The fields a moved class differs in, as an override patch.
 *
 * Only real differences are listed, which is what keeps "moved to a new room"
 * down to the room: `overrideOf` falls back to the series for anything absent,
 * and an empty patch would not be a legal override at all.
 * @param previous - The stored baseline.
 * @param wanted - What the school now says about this class.
 */
function changedFields(previous, wanted) {
  const patch = {}
  for (const field of ['title', 'start', 'end', 'location', 'description']) {
    if (wanted[field] !== undefined && wanted[field] !== previous[field]) patch[field] = wanted[field]
  }
  // A moved class is by definition at a different time; if the times match, the
  // change was to something else, and a patch naming no field would be rejected.
  if (patch.start !== undefined) patch.end = endOfMovedOccurrence(previous, wanted, patch)
  return patch
}

/**
 * The end an override should carry when the school moved one class.
 *
 * A school that moves a class usually sends the new `DTSTART` and keeps the old
 * `DTEND`'s *duration* implicit, so the incoming `end` still reads the time the
 * class used to finish. Recording that as the override's end leaves the occurrence
 * ending before it began — and rules enforced only at a lower layer would reject
 * the whole sync instead of fixing it, which is why the move is resolved here.
 *
 * What an occurrence inherits from its series is a duration, not a clock reading,
 * so the end is derived from the series' own span unless the school sent a
 * different one. That keeps the overnight case intact: a class running
 * 22:00–01:00 moved to 23:00 ends at 02:00, not back on its own start date.
 * @param previous - The stored baseline, whose span is the duration to keep.
 * @param wanted - What the school now says about this class.
 * @param patch - The fields the school actually changed.
 * @returns the end to record, or undefined when there is no span to keep.
 */
function endOfMovedOccurrence(previous, wanted, patch) {
  if (!previous.end || !previous.start) return patch.end
  const clock = value => (String(value).includes('T') ? String(value).slice(11, 16) : undefined)
  const previousClock = clock(previous.end)
  const wantedClock = clock(wanted.end)
  const startClock = clock(patch.start)
  // Nothing to re-derive when the record has no clock, or when the school did
  // send a new end of its own and it differs from the old one.
  if (!previousClock || !startClock) return wanted.end
  if (wantedClock !== undefined && wantedClock !== previousClock) return wanted.end
  return inheritedEndOf(patch.start, previous.start, previous.end)
}

/** Replace the entry for `entry.date`, or append it, keeping the list sorted. */
function upsertByDate(list, entry) {
  const kept = (list ?? []).filter(item => item.date !== entry.date)
  return [...kept, entry].sort((left, right) => left.date.localeCompare(right.date))
}

/**
 * Fold explicitly recorded local decisions into one record a file sent.
 *
 * The file owns the series: its title, its room, its schedule, its `start`/`end`.
 * It says nothing about a date the reader moved or called off on this device, so
 * those are carried over rather than replaced — and they are carried over *by
 * date*, so a file that has a change of its own for a different date is applied
 * instead of being swallowed by the copy of the reader's list.
 *
 * Two rules settle a date both sides have an opinion about:
 *
 * - The reader's move wins. They made it deliberately, on this device, after
 *   reading the class; the file is a periodic re-read of the same timetable.
 * - A cancelled date stays cancelled. The school still lists the class, so taking
 *   the file as the truth would put it back on the calendar every poll, and the
 *   reader would have no way to keep it off.
 *
 * Together those also make a re-import idempotent: importing the same file twice
 * leaves the reader's dates exactly where the first import put them.
 * @param stored - The local decisions, without source-owned dates.
 * @param fromFile - The record the file describes.
 * @returns the record to write.
 */
function mergePersonalDates(stored, fromFile) {
  const exceptions = [...new Set([...(stored.exceptions ?? []), ...(fromFile.exceptions ?? [])])].sort()
  const moved = new Map((fromFile.overrides ?? []).map(entry => [entry.date, entry]))
  for (const entry of stored.overrides ?? []) {
    const merged = { ...moved.get(entry.date), ...entry }
    // A local start-only move inherits duration, not the file's earlier end.
    if (entry.start !== undefined && entry.end === undefined) delete merged.end
    moved.set(entry.date, merged)
  }
  const overrides = [...moved.values()]
    // A date cannot be both called off and moved: cancelling takes the move with it,
    // the same way `cancelOccurrence` does. Keeping both would leave the moved
    // reading in charge and the class on the calendar after it was called off.
    .filter(entry => !exceptions.includes(entry.date))
    .sort((left, right) => left.date.localeCompare(right.date))
  const merged = { ...fromFile }
  if (overrides.length > 0) merged.overrides = overrides
  else delete merged.overrides
  if (exceptions.length > 0) merged.exceptions = exceptions
  else delete merged.exceptions
  return merged
}

/** The list without one date; `undefined` when nothing is left. */
function withoutDate(list, date) {
  const kept = (list ?? []).filter(item => item !== date)
  return kept.length ? kept : undefined
}
