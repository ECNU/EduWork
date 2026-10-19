// Host half of the calendar plugin.
//
// It owns the records and exposes them as the `calendar` service, so the client
// half, future tools and the reminder work all read one source of truth. The
// panel itself stays in the client half; this file registers no UI and no tool.
//
// The domain is opened during initialization: the service becomes visible only
// once stored records are loaded and validated, and a domain that cannot be
// opened fails this plugin loudly instead of handing out a half-working
// service. Nothing here leaves the machine.
//
// Methods marked `Remote` below take exactly one object argument and return one
// JSON value, which is the shape the remote gateway carries. Their parameter
// names and schemas live in `lib/typert-schemas.js`, their descriptors in
// `lib/typert-descriptors.js`, and their line numbers here are what the
// descriptors point at.
import { Service } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { buildIcs, parseIcs } from './ics.js'
import { SCHEMA_VERSION, seriesInstants, normalizeEvent, assertOrderedRecord, EventPatchSchema, patchEvent } from './model.js'
import { PersonalStore } from './personal.js'
import { CalendarStore } from './store.js'
import { SourceRegistry } from './sources.js'
import { reminderPlan, bindReminderScheduler } from './reminders.js'
import { ReminderDelivery } from './reminder-delivery.js'
import { applySourceInput } from './typert-schemas.js'

export const name = 'dsh-calendar'

const remoteInitializers = []

function assertImportSources(events, source) {
  const managed = value => typeof value === 'string' && value.startsWith('sync:')
  if (managed(source) || (Array.isArray(events) && events.some(event => managed(event?.source)))) {
    throw new Error('source_handle_required: 托管日历须通过登记来源更新，不能通过文件或旧批量入口覆盖')
  }
}

/** The calendar service (`ctx.calendar`). Reads are synchronous; writes resolve after the record is durable. */
export class CalendarService extends TypertRemoteService {
  static inject = ['storageDomain']

  /**
   * @param ctx - Plugin context.
   */
  constructor(ctx) {
    super(ctx, 'calendar')
    for (const initialize of remoteInitializers) initialize.call(this)
    this.lifetime = new AbortController()
    this.revision = 0
    this.listeners = new Set()
    ctx.on('domain/changed', change => {
      if (!['calendar', 'calendar_personal'].includes(change?.domain)) return
      this.invalidate(change)
    })
    this.store = new CalendarStore(ctx)
    this.personal = new PersonalStore(ctx)
    this.sources = new SourceRegistry(async (batch, guard) => {
      const report = await this.store.applySource(applySourceInput.parse(batch), guard)
      if (guard.isCurrent()) await this.rememberSources()
      return report
    }, () => this.invalidate())
    ctx.effect(() => async () => {
      this.lifetime.abort()
      this.reminderBinding?.dispose()
      await this.reminderDelivery?.close()
      this.sources.close()
      await this.personal.close()
      await this.store.close()
    }, 'dsh-calendar: close the calendar domains')
  }

  invalidate(change = {}) {
    ++this.revision
    for (const listener of this.listeners) {
      try { listener({ ...change, revision: this.revision }) } catch { /* Observers cannot reject writes. */ }
    }
  }

  /** Host-only: register identity and receive a source-bound writer. */
  registerSource(config) { return this.sources.register(config) }

  sourceStatuses() { return this.sources.statuses() }

  /** Relative rules use the current occurrence time; fixed rules retain their own time. */
  reminderPlan(range) { return reminderPlan(this, range) }

  /** Delivery is optional; the adapter owns persistence, Session selection and dispatch. */
  registerReminderScheduler(adapter, range) {
    if (this.reminderBinding) throw new Error('calendar reminder scheduler is already registered')
    const binding = bindReminderScheduler(this, adapter, range)
    this.reminderBinding = binding
    const dispose = binding.dispose
    binding.dispose = () => { dispose(); if (this.reminderBinding === binding) this.reminderBinding = undefined }
    return binding
  }

  /** Open the domains before the service is handed to anyone. */
  async [Service.init]() {
    await this.store.open()
    await this.personal.open()
    for (const event of this.store.snapshot().events) await this.personal.rememberSource(event, true)
    this.reminderDelivery = new ReminderDelivery(this, this.ctx)
    await this.reminderDelivery.open()
  }

  /** Host-only drain used by integrations after changing schedules. */
  checkReminders() { return this.reminderDelivery.refresh() }

  /** Durable reminder history; receipt ids identify one scheduled delivery. */
  reminders() { return this.reminderDelivery.inbox() }

  ackReminder(input) { return this.reminderDelivery.ack(input.id) }

  /** @returns the public snapshot: `{ schemaVersion, events }`. */
  snapshot() {
    const snapshot = this.store.snapshot()
    return { ...snapshot, events: snapshot.events.filter(event => this.isSourceVisible(event.source)) }
  }

  isSourceVisible(source) { return !source?.startsWith('sync:') || this.sources.isRegistered(source) }

  /**
   * @param range - Optional `{ from, to }` inclusive local-time bounds.
   * @returns events overlapping the range, as stored.
   */
  listEvents(range) {
    return this.store.listEvents(range).filter(event => this.isSourceVisible(event.source))
  }

  /**
   * One range of the calendar as a view needs it. `listEvents` and the store
   * keep the plain record queries; this is the payload that crosses to the
   * client half, and its shape is the one `lib/typert-schemas.js` declares.
   * @param range - Optional `{ from, to }` inclusive local-time bounds.
   * @returns `{ schemaVersion, occurrences }`.
   */
  occurrences(range) {
    return {
      schemaVersion: SCHEMA_VERSION,
      occurrences: this.store.listOccurrences(range).filter(occurrence => this.isSourceVisible(occurrence.source)).map(occurrence => {
        const personal = this.personalFor(occurrence)
        return Object.keys(personal).length ? { ...occurrence, personal } : occurrence
      }).filter(occurrence => range?.includeHidden === true || !occurrence.personal?.hidden),
    }
  }

  /**
   * Import calendar text. The records keep the source they were imported under,
   * so a second import of the same source replaces the first one instead of
   * piling up next to it; anything the text did not carry is reported rather
   * than dropped quietly.
   *
   * A file the reader could only partly read does not replace its source. The
   * entries that could not be read are indistinguishable from entries the file no
   * longer lists, and acting on that gap would delete classes that are still there.
   * So a partial read writes what it could read and removes nothing; the next
   * import of a file that reads cleanly is what settles the question.
   * @param input - `{ text, source?, replace? }`; `source` defaults to `ics` and
   *   `replace` to true.
   * @returns `{ events, removedEvents, skipped, degraded }`.
   */
  async importIcs(input) {
    const source = input.source ?? 'ics'
    if (source === 'manual' || source.startsWith('sync:')) throw new Error('reserved calendar source')
    const parsed = parseIcs(input.text, { source })
    assertImportSources(parsed.events, source)
    const written = await this.store.importSnapshot(parsed, {
      source,
      replace: input.replace !== false,
      complete: parsed.skipped.length === 0,
    })
    await this.rememberSources()
    return { ...written, skipped: parsed.skipped, degraded: parsed.degraded }
  }

  /**
   * Export the records as calendar text.
   * @param options - `{ name? }`, the calendar name written as `X-WR-CALNAME`.
   * @returns `{ text }`.
   */
  exportIcs(options = {}) {
    const snapshot = this.snapshot()
    return {
      text: buildIcs(snapshot, { name: options.name ?? '我的日历' }),
    }
  }

  /**
   * @param input - `{ uid, source? }`.
   * @returns the stored event, or undefined.
   */
  getEvent(input) {
    return this.store.getEvent(input.uid, input.source)
  }

  /**
   * Insert or replace one complete event. Editors must use updateEvent so
   * unrelated fields cannot be replaced by an older client snapshot. The caller owns the `uid`, so a record
   * can be written, corrected and replayed without asking the store for an
   * identity first.
   * @param event - Event fields.
   * @returns the stored event.
   */
  async putEvent(event) {
    const record = normalizeEvent(event)
    assertOrderedRecord(record)
    const existing = this.store.getEvent(record.uid, record.source)
    if (existing && record.source !== 'manual') {
      // This is a user edit, not a source import. Keep source DESCRIPTION intact.
      const remark = record.description !== existing.description ? { text: record.description ?? '' } : undefined
      const saved = await this.store.putEvent({ ...record, description: existing.description })
      if (remark) await this.personal.patch({ source: record.source, uid: record.uid }, { remark })
      return saved
    }
    const saved = await this.store.putEvent(record)
    await this.personal.rememberSource(saved)
    return saved
  }

  /** Apply a sparse edit after reading the latest record inside the write queue. */
  async updateEvent(input) {
    const patch = EventPatchSchema.parse(input.patch)
    return this.store.enqueueWrite(async () => {
      const existing = this.store.getEvent(input.uid, input.source)
      if (!existing) throw new Error(`event_not_found: ${input.uid}`)
      const eventPatch = { ...patch }
      const privateRemark = existing.source !== 'manual' && patch.description !== undefined
      if (privateRemark) delete eventPatch.description
      // Validate all event changes before persisting either layer. A remark-only
      // edit never writes the source event, even when a sync is running.
      const record = patchEvent(existing, eventPatch)
      if (Object.keys(eventPatch).length) await this.store.commit(record)
      if (privateRemark) await this.personal.patch({ source: existing.source, uid: existing.uid }, {
        remark: { text: patch.description ?? '' },
      })
      return record
    })
  }

  /** Remove one event identified by source and uid. */
  async deleteEvent(input) {
    return { removed: await this.store.deleteEvent(input.uid, input.source) }
  }

  /** Remove an imported calendar, retaining the user's annotations for recovery. */
  async deleteCalendar(input) {
    const source = input?.source
    if (typeof source !== 'string' || !source.trim()) throw new Error('请选择要删除的导入日历')
    if (source === 'manual' || source.startsWith('sync:')) throw new Error('不能删除个人默认日历或学校同步日历')
    return this.store.deleteCalendar(source)
  }

  /**
   * Move, rename or relocate one date a series produces.
   * @param input - `{ uid, date, patch, source? }`: the series, the date it
   *   produces, and the fields to change.
   * @returns the stored record.
   */
  applyOverride(input) {
    return this.store.applyOverride(input.uid, input.date, input.patch, input.source)
  }

  /**
   * Drop a per-date change, so that occurrence follows the series again.
   * @param input - `{ uid, date, source? }`.
   * @returns the stored record.
   */
  removeOverride(input) {
    return this.store.removeOverride(input.uid, input.date, input.source)
  }

  /**
   * Cancel one date a series produces, so that occurrence does not happen.
   * @param input - `{ uid, date, source? }`.
   * @returns the stored record.
   */
  cancelOccurrence(input) {
    return this.store.cancelOccurrence(input.uid, input.date, input.source)
  }

  /**
   * Undo a cancellation, so that occurrence follows the series again.
   * @param input - `{ uid, date, source? }`.
   * @returns the stored record.
   */
  restoreOccurrence(input) {
    return this.store.restoreOccurrence(input.uid, input.date, input.source)
  }

  /**
   * Merge a snapshot in, keyed by source and `uid`.
   * @param snapshot - `{ events }`.
   * @param options - `source` and `replace`, as in `importIcs`.
   * @returns counts of the records written and removed.
   */
  async importSnapshot(snapshot, options) {
    assertImportSources(snapshot?.events, options?.source)
    const report = await this.store.importSnapshot(snapshot, options)
    await this.rememberSources()
    return report
  }

  /**
   * Observe durable changes.
   * @param listener - Called with each change of this domain.
   * @returns the disposer that stops observing.
   */
  onChanged(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Bounded invalidation stream carried by the existing Remote stream transport. */
  async *changes(signal) {
    signal = signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal
    let pending = true
    let wake
    const notify = () => { pending = true; wake?.() }
    const dispose = this.onChanged(notify)
    const stop = () => wake?.()
    signal?.addEventListener('abort', stop, { once: true })
    try {
      while (!signal?.aborted) {
        if (!pending) await new Promise(resolve => { wake = resolve })
        wake = undefined
        if (signal?.aborted) break
        pending = false
        yield { revision: this.revision }
      }
    } finally {
      dispose()
      signal?.removeEventListener('abort', stop)
    }
  }

  /**
   * Apply a school snapshot. The one entry point a timetable adapter needs.
   *
   * The original timetable is frozen on the first call; later changes to one
   * class arrive as `movedFrom` / `cancelledDates` and are recorded against the
   * instant the series originally produced, so everything the user attached to
   * that class stays attached when the class moves.
   * @param input - `{ source, events, complete? }`, as in `CalendarStore.applySource`.
   * @returns `{ applied, moved, cancelled, unattributable }`; a non-empty
   *   `unattributable` means data arrived that could not be attributed to one
   *   occurrence, and nothing was changed for those entries.
   */
  async applySource(input) {
    if (input?.source?.startsWith('sync:')) throw new Error('source_handle_required')
    if (!Array.isArray(input?.events)) throw new Error('a source snapshot must carry an events array')
    const report = await this.store.applySource(applySourceInput.parse(input))
    await this.rememberSources()
    return report
  }

  /** Agent/user batch imports have their own namespace; managed sources require Host opt-in. */
  async importSource(input) {
    if (typeof input?.source !== 'string') throw new Error('source required')
    if (input.source.startsWith('sync:')) {
      const { source, ...batch } = input
      const result = await this.sources.agentApply(source, batch)
      if (result.state !== 'ready') throw new Error(result.error ?? 'superseded_snapshot')
      return result.report
    }
    if (!/^agent:.+/.test(input.source)) throw new Error('reserved calendar source: use agent:<stable-name>')
    return this.applySource(input)
  }

  async rememberSources() {
    for (const event of this.store.snapshot().events) await this.personal.rememberSource(event)
  }

  /** Patch independent personal fields; clear removes overrides to restore inheritance. */
  async setPersonal(input) {
    const { patch = {}, clear = [], ...ref } = input
    return { annotation: await this.personal.patch(ref, patch, clear) ?? null }
  }

  /** Resolve inheritance at read time, retaining explicit false and off values. */
  personalFor(input) {
    const { scope = 'source', source, uid, originalStart } = input
    const series = this.personal.get({ scope, source, uid })
    const once = originalStart ? this.personal.get({ scope, source, uid, originalStart }) : undefined
    const result = {}
    for (const field of ['note', 'remark', 'hidden', 'reminder']) {
      const value = once?.[field] ?? series?.[field]
      if (value !== undefined) result[field] = value
    }
    const legacy = this.personal.sourceInfo({ source, uid })
    if (legacy?.legacyDescription !== undefined) result.legacyDescription = legacy.legacyDescription
    if (legacy?.legacyExtensions !== undefined) result.legacyExtensions = legacy.legacyExtensions
    return result
  }

  /**
   * Write the user's own content against one occurrence, or a whole series.
   *
   * `originalStart` is the occurrence's identity, not its current time: the note
   * follows the class when the school moves it. Omitting the field targets the
   * whole series.
   * @param input - `{ scope?, source, uid, originalStart?, text }`.
   * @returns the stored annotation.
   */
  putNote(input) {
    const { text, ...ref } = input
    if (typeof text !== 'string') throw new Error('a note needs text')
    return this.personal.patch(ref, { note: { text } })
  }

  /**
   * Drop the user's content for one occurrence, or a whole series.
   *
   * Clearing is a removal rather than an empty note, so "never wrote one" and
   * "emptied it" are the same state and no blank record is left behind.
   * @param input - `{ scope?, source, uid, originalStart? }`.
   * @returns `{ removed }`.
   */
  async removeNote(input) {
    return { removed: await this.personal.clearField(input, 'note') }
  }

  /**
   * The user's notes, optionally narrowed to one event or one occurrence.
   * @param input - `{ scope?, source?, uid?, originalStart? }`.
   * @returns matching annotations in the scope.
   */
  notes(input = {}) {
    const scope = input.scope ?? 'source'
    return this.personal.list(scope).filter(record => {
      if (input.source !== undefined && record.source !== input.source) return false
      if (input.uid !== undefined && record.uid !== input.uid) return false
      if (input.originalStart !== undefined && record.originalStart !== input.originalStart) return false
      return true
    })
  }

  /**
   * The annotations whose class no longer exists in the source layer.
   *
   * A reschedule keeps the class's identity, so a moved class is still linked. An
   * annotation is reported here when its `originalStart` is not one of the
   * instants its series produces — the case where personal content would
   * otherwise disappear silently. Nothing is deleted: the report exists so the
   * content can be shown and the association decided by a person.
   * @returns `[{ scope, source, uid, originalStart, reason }]`.
   */
  unlinkedNotes() {
    const events = this.store.snapshot().events
    const report = []
    for (const scope of ['source', 'personal']) {
      for (const record of this.personal.list(scope)) {
        const event = events.find(row => row.uid === record.uid && (row.source ?? 'manual') === record.source)
        if (!event) {
          report.push({ ...record, reason: 'source_record_gone' })
          continue
        }
        // Asked against the series' own instants, not against a windowed
        // rendering: a class moved by an override still owns the instant it was
        // originally scheduled for, so its note is linked, not orphaned.
        if (record.originalStart && !seriesInstants(event).includes(record.originalStart)) {
          report.push({ ...record, reason: 'no_such_occurrence' })
        }
      }
    }
    return report
  }
}

// Mark the methods the client half may call. `Remote` records a versioned
// descriptor on the prototype and hands the instance initializer back here, so
// the exported surface is declared next to the class that implements it. The
// matching wire schemas are in `lib/typert-schemas.js`: a method marked here
// without a descriptor is not callable, and the descriptor test compares the two
// lists.
Remote('snapshot')(CalendarService.prototype.snapshot, {
  kind: 'method', name: 'snapshot', static: false, private: false,
  addInitializer(initializer) { remoteInitializers.push(initializer) },
})

Remote('deleteCalendar')(CalendarService.prototype.deleteCalendar, {
  kind: 'method', name: 'deleteCalendar', static: false, private: false,
  addInitializer(initializer) { remoteInitializers.push(initializer) },
})

Remote('occurrences')(CalendarService.prototype.occurrences, {
  kind: 'method', name: 'occurrences', static: false, private: false,
  addInitializer(initializer) { remoteInitializers.push(initializer) },
})

Remote('importIcs')(CalendarService.prototype.importIcs, {
  kind: 'method', name: 'importIcs', static: false, private: false,
  addInitializer(initializer) { remoteInitializers.push(initializer) },
})

Remote('exportIcs')(CalendarService.prototype.exportIcs, {
  kind: 'method', name: 'exportIcs', static: false, private: false,
  addInitializer(initializer) { remoteInitializers.push(initializer) },
})

Remote('applyOverride')(CalendarService.prototype.applyOverride, {
  kind: 'method', name: 'applyOverride', static: false, private: false,
  addInitializer(initializer) { remoteInitializers.push(initializer) },
})

Remote('removeOverride')(CalendarService.prototype.removeOverride, {
  kind: 'method', name: 'removeOverride', static: false, private: false,
  addInitializer(initializer) { remoteInitializers.push(initializer) },
})

Remote('cancelOccurrence')(CalendarService.prototype.cancelOccurrence, {
  kind: 'method', name: 'cancelOccurrence', static: false, private: false,
  addInitializer(initializer) { remoteInitializers.push(initializer) },
})

Remote('restoreOccurrence')(CalendarService.prototype.restoreOccurrence, {
  kind: 'method', name: 'restoreOccurrence', static: false, private: false,
  addInitializer(initializer) { remoteInitializers.push(initializer) },
})

Remote('deleteEvent')(CalendarService.prototype.deleteEvent, {
  kind: 'method', name: 'deleteEvent', static: false, private: false,
  addInitializer(initializer) { remoteInitializers.push(initializer) },
})

Remote('putEvent')(CalendarService.prototype.putEvent, {
  kind: 'method', name: 'putEvent', static: false, private: false,
  addInitializer(initializer) { remoteInitializers.push(initializer) },
})

Remote('updateEvent')(CalendarService.prototype.updateEvent, {
  kind: 'method', name: 'updateEvent', static: false, private: false,
  addInitializer(initializer) { remoteInitializers.push(initializer) },
})

Remote('applySource')(CalendarService.prototype.applySource, {
  kind: 'method', name: 'applySource', static: false, private: false,
  addInitializer(initializer) { remoteInitializers.push(initializer) },
})

Remote('putNote')(CalendarService.prototype.putNote, {
  kind: 'method', name: 'putNote', static: false, private: false,
  addInitializer(initializer) { remoteInitializers.push(initializer) },
})

Remote('removeNote')(CalendarService.prototype.removeNote, {
  kind: 'method', name: 'removeNote', static: false, private: false,
  addInitializer(initializer) { remoteInitializers.push(initializer) },
})

Remote('notes')(CalendarService.prototype.notes, {
  kind: 'method', name: 'notes', static: false, private: false,
  addInitializer(initializer) { remoteInitializers.push(initializer) },
})

Remote('unlinkedNotes')(CalendarService.prototype.unlinkedNotes, {
  kind: 'method', name: 'unlinkedNotes', static: false, private: false,
  addInitializer(initializer) { remoteInitializers.push(initializer) },
})

Remote({ mode: 'stream' })(CalendarService.prototype.changes, {
  kind: 'method', name: 'changes', static: false, private: false,
  addInitializer(initializer) { remoteInitializers.push(initializer) },
})

Remote('setPersonal')(CalendarService.prototype.setPersonal, {
  kind: 'method', name: 'setPersonal', static: false, private: false,
  addInitializer(initializer) { remoteInitializers.push(initializer) },
})

Remote('personalFor')(CalendarService.prototype.personalFor, {
  kind: 'method', name: 'personalFor', static: false, private: false,
  addInitializer(initializer) { remoteInitializers.push(initializer) },
})

Remote('sourceStatuses')(CalendarService.prototype.sourceStatuses, {
  kind: 'method', name: 'sourceStatuses', static: false, private: false,
  addInitializer(initializer) { remoteInitializers.push(initializer) },
})

for (const name of ['reminders', 'ackReminder']) Remote(name)(CalendarService.prototype[name], {
  kind: 'method', name, static: false, private: false,
  addInitializer(initializer) { remoteInitializers.push(initializer) },
})

export default CalendarService
