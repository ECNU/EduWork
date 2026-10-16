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
import { SCHEMA_VERSION, seriesInstants } from './model.js'
import { PersonalStore } from './personal.js'
import { CalendarStore } from './store.js'

export const name = 'dsh-calendar'

const remoteInitializers = []

/** The calendar service (`ctx.calendar`). Reads are synchronous; writes resolve after the record is durable. */
export class CalendarService extends TypertRemoteService {
  static inject = ['storageDomain']

  /**
   * @param ctx - Plugin context.
   */
  constructor(ctx) {
    super(ctx, 'calendar')
    for (const initialize of remoteInitializers) initialize.call(this)
    this.store = new CalendarStore(ctx)
    this.personal = new PersonalStore(ctx)
    ctx.effect(() => async () => {
      await this.personal.close()
      await this.store.close()
    }, 'dsh-calendar: close the calendar domains')
  }

  /** Open the domains before the service is handed to anyone. */
  async [Service.init]() {
    await this.store.open()
    await this.personal.open()
  }

  /** @returns the public snapshot: `{ schemaVersion, events }`. */
  snapshot() {
    return this.store.snapshot()
  }

  /**
   * @param range - Optional `{ from, to }` inclusive local-time bounds.
   * @returns events overlapping the range, as stored.
   */
  listEvents(range) {
    return this.store.listEvents(range)
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
      occurrences: this.store.listOccurrences(range),
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
    const parsed = parseIcs(input.text, { source })
    const written = await this.store.importSnapshot(parsed, {
      source,
      replace: input.replace !== false,
      complete: parsed.skipped.length === 0,
    })
    return { ...written, skipped: parsed.skipped, degraded: parsed.degraded }
  }

  /**
   * Export the records as calendar text.
   * @param options - `{ name? }`, the calendar name written as `X-WR-CALNAME`.
   * @returns `{ text }`.
   */
  exportIcs(options = {}) {
    const snapshot = this.store.snapshot()
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
   * Insert or replace one event: how the panel creates a personal entry and how
   * editing one of its own fields lands. The caller owns the `uid`, so a record
   * can be written, corrected and replayed without asking the store for an
   * identity first.
   * @param event - Event fields.
   * @returns the stored event.
   */
  putEvent(event) {
    return this.store.putEvent(event)
  }

  /**
   * Remove one event.
   * @param input - `{ uid, source? }`; `source` defaults to the user's own records.
   * @returns `{ removed }`.
   */
  async deleteEvent(input) {
    return { removed: await this.store.deleteEvent(input.uid, input.source) }
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
   * Merge a snapshot in, keyed by `uid`.
   * @param snapshot - `{ events }`.
   * @param options - `source` and `replace`, as in `importIcs`.
   * @returns counts of the records written and removed.
   */
  importSnapshot(snapshot, options) {
    return this.store.importSnapshot(snapshot, options)
  }

  /**
   * Observe durable changes.
   * @param listener - Called with each change of this domain.
   * @returns the disposer that stops observing.
   */
  onChanged(listener) {
    return this.store.onChanged(listener)
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
  applySource(input) {
    return this.store.applySource(input)
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
    return { removed: await this.personal.remove(input) }
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
        if (!record.originalStart) continue
        const event = events.find(row => row.uid === record.uid && (row.source ?? 'manual') === record.source)
        if (!event) {
          report.push({ ...record, reason: 'source_record_gone' })
          continue
        }
        // Asked against the series' own instants, not against a windowed
        // rendering: a class moved by an override still owns the instant it was
        // originally scheduled for, so its note is linked, not orphaned.
        if (!seriesInstants(event).includes(record.originalStart)) {
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

export default CalendarService
