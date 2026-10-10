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
import { StoredEventSchema, buildSnapshot, dropRetiredFields, normalizeEvent, occurrencesIn, overlaps } from './model.js'

/**
 * Domain layout: events keyed by `uid`.
 *
 * The version stays 1 although the former `courses` table is gone: stored event
 * records are still readable, and a backend reads only the tables this spec
 * declares, so an existing store opens as it did and simply loses the retired
 * table at the next write. Bumping the version instead would reject every store
 * written before the change (the JSON backend requires an exact version on the
 * whole-unit layout) over a table that is no longer read.
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
  },
})

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
  }

  /**
   * Open the domain, resolve the table handles, and fold records written before
   * the record contract changed into the shape it now guarantees.
   * @returns resolution once stored records are loaded, validated and folded.
   */
  async open() {
    const domain = await this.ctx.storageDomain.open(calendarDomain)
    this.domain = domain
    this.tables = { events: domain.table('events') }
    await this.foldRetiredFields()
    return domain
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
    await this.domain?.close()
  }

  /** @returns the table handles; a caller before `open` is a bug and throws. */
  requireTables() {
    if (!this.tables) throw new Error('calendar storage is not open yet')
    return this.tables
  }

  /** @returns the public snapshot of everything stored. */
  snapshot() {
    const { events } = this.requireTables()
    return buildSnapshot([...events.entries()].map(([, event]) => event))
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
  getEvent(uid) {
    return this.requireTables().events.get(uid)
  }

  /**
   * Insert or replace one event.
   * @param input - Event fields; validated and defaulted before the write.
   * @returns the stored record.
   */
  async putEvent(input) {
    const record = normalizeEvent(input)
    await this.requireTables().events.put(record.uid, record)
    return record
  }

  /**
   * Remove one event.
   * @param uid - Event identifier.
   * @returns true when a record was removed.
   */
  async deleteEvent(uid) {
    return await this.requireTables().events.delete(uid)
  }

  /**
   * Record a per-date change to a series — the `RECURRENCE-ID` case: the
   * occurrence the series produces on `date` is moved, renamed or relocated.
   * Fields left out of `patch` keep following the series, and later edits to the
   * series still reach this occurrence.
   * @param uid - Identifier of the series event.
   * @param date - Date the series produces, `YYYY-MM-DD`.
   * @param patch - Fields to change: `title`, `start`, `end`, `location`, `description`.
   * @returns the stored record.
   */
  async applyOverride(uid, date, patch) {
    const event = this.getEvent(uid)
    if (!event) throw new Error(`no event ${uid} to override`)
    const kept = (event.overrides ?? []).filter(entry => entry.date !== date)
    const overrides = [...kept, { ...patch, date }].sort((left, right) => left.date.localeCompare(right.date))
    return await this.putEvent({ ...event, overrides })
  }

  /**
   * Drop a per-date change, so that occurrence follows the series again.
   * @param uid - Identifier of the series event.
   * @param date - Date the series produces, `YYYY-MM-DD`.
   * @returns the stored record.
   */
  async removeOverride(uid, date) {
    const event = this.getEvent(uid)
    if (!event) throw new Error(`no event ${uid} to un-override`)
    const overrides = (event.overrides ?? []).filter(entry => entry.date !== date)
    return await this.putEvent({ ...event, overrides: overrides.length ? overrides : undefined })
  }

  /**
   * Cancel one date a series produces — that occurrence does not happen. A move
   * that had been scheduled for that date goes with it, because there is nothing
   * left to move.
   * @param uid - Identifier of the series event.
   * @param date - Date the series produces, `YYYY-MM-DD`.
   * @returns the stored record.
   */
  async cancelOccurrence(uid, date) {
    const event = this.getEvent(uid)
    if (!event) throw new Error(`no event ${uid} to cancel`)
    if (!event.recurrence) throw new Error(`${uid} does not repeat; delete it instead of cancelling one date`)
    const exceptions = [...new Set([...(event.exceptions ?? []), date])].sort()
    const overrides = (event.overrides ?? []).filter(entry => entry.date !== date)
    return await this.putEvent({ ...event, exceptions, overrides: overrides.length ? overrides : undefined })
  }

  /**
   * Undo a cancellation, so that occurrence follows the series again.
   * @param uid - Identifier of the series event.
   * @param date - Date the series produces, `YYYY-MM-DD`.
   * @returns the stored record.
   */
  async restoreOccurrence(uid, date) {
    const event = this.getEvent(uid)
    if (!event) throw new Error(`no event ${uid} to restore`)
    const exceptions = (event.exceptions ?? []).filter(item => item !== date)
    return await this.putEvent({ ...event, exceptions: exceptions.length ? exceptions : undefined })
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
   * @param snapshot - `{ events }`; `schemaVersion` is accepted and ignored for now.
   * @param options - `source` for records that carry none; `replace` to also drop
   *   that source's records which the snapshot omits.
   * @returns counts of the events written and removed.
   */
  async importSnapshot(snapshot, options = {}) {
    const source = typeof options.source === 'string' && options.source ? options.source : 'import'
    if (!Array.isArray(snapshot?.events)) {
      throw new Error('calendar snapshot must carry an events array')
    }
    const events = snapshot.events.map(event => normalizeEvent({ source, ...event }))
    const { events: eventTable } = this.requireTables()
    for (const event of events) await eventTable.put(event.uid, event)
    let removedEvents = 0
    if (options.replace === true) {
      const incoming = new Set(events.map(event => event.uid))
      const stale = [...eventTable.entries()]
        .filter(([uid, event]) => event.source === source && !incoming.has(uid))
        .map(([uid]) => uid)
      for (const uid of stale) {
        await eventTable.delete(uid)
        removedEvents += 1
      }
    }
    return { events: events.length, removedEvents }
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
