// Wire schemas of the calendar remote face.
//
// The snapshot that crosses to the client half is exactly the shape the domain
// stores, so the record schemas are reused rather than restated: a change to a
// stored record cannot silently disagree with the wire contract. Occurrences are
// the stored fields minus series bookkeeping, plus the keys a view renders by.
// Every remote method takes one object argument and returns one value; the
// descriptors that point at those schemas are in `lib/typert-descriptors.js`.
import { z } from 'zod'
import { AnnotationSchema, ReminderReceiptSchema, PersonalViewSchema, PersonalPatchSchema, PersonalFields, EventFields, EventSchema, EventPatchSchema, LocalTimeSchema, RecurrenceSchema, ScopeSchema } from './model.js'

const snapshot = z.object({
  schemaVersion: z.number().int().positive(),
  events: z.array(EventSchema),
  /**
   * Records found on disk that cannot be placed in a layer, so no read can name
   * them. Empty in a healthy store; a non-empty list means a human has to decide
   * where those records belong.
   */
  needsReview: z.array(z.object({
    key: z.string(),
    uid: z.unknown().optional(),
    reason: z.string().min(1),
  })).default([]),
}).strict()

const occurrence = z.object({
  ...EventFields,
  occurrenceId: z.string().min(1),
  occurrenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'),
  /**
   * The instant the series produced, which is the occurrence's identity rather
   * than its current time: a class the school moved still reports the instant it
   * was originally scheduled for, so personal content keyed by it stays attached.
   */
  originalStart: LocalTimeSchema,
  overridden: z.boolean().optional(),
  personal: PersonalViewSchema.optional(),
}).strict()

const occurrences = z.object({
  schemaVersion: z.number().int().positive(),
  occurrences: z.array(occurrence),
}).strict()

/** Bounds of a range query; either side may be omitted. */
export const rangeSchema = z.object({
  includeHidden: z.boolean().optional(),
  from: LocalTimeSchema.optional(),
  to: LocalTimeSchema.optional(),
}).strict()

/** A day of a series, as the occurrence itself names it. */
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')

/** Calendar text to import, and how it should land. */
const importInput = z.object({
  text: z.string().min(1),
  source: z.string().min(1).optional(),
  replace: z.boolean().optional(),
}).strict()

/** What an import wrote, what it removed, and what it could not use. */
const importOutcome = z.object({
  events: z.number().int().nonnegative(),
  removedEvents: z.number().int().nonnegative(),
  skipped: z.array(z.object({ uid: z.string().optional(), reason: z.string() }).strict()),
  degraded: z.array(z.object({
    uid: z.string().optional(),
    reason: z.string().optional(),
    rrule: z.string().optional(),
  }).strict()),
}).strict()

/** What to call the exported calendar. */
const exportInput = z.object({
  name: z.string().min(1).optional(),
}).strict()

const exportOutcome = z.object({ text: z.string() }).strict()

/**
 * Which record of which source to act on.
 *
 * `source` is optional and defaults to the user's own records, but a caller that
 * knows which layer it is editing should say so: an identifier is only unique
 * within its source, so naming the source is what keeps an edit from reaching a
 * different class that happens to share the identifier.
 */
const sourceRef = { source: z.string().min(1).optional() }

/** One date of one series. */
const occurrenceInput = z.object({ uid: z.string().min(1), date: dateSchema, ...sourceRef }).strict()

/** The changeable fields of one occurrence; `date` is the series' own date. */
const overrideInput = z.object({
  uid: z.string().min(1),
  date: dateSchema,
  ...sourceRef,
  patch: z.object({
    title: z.string().min(1).optional(),
    start: LocalTimeSchema.optional(),
    end: LocalTimeSchema.optional(),
    location: z.string().optional(),
    description: z.string().optional(),
  }).strict(),
}).strict()

const uidInput = z.object({ uid: z.string().min(1), ...sourceRef }).strict()

const removalOutcome = z.object({ removed: z.boolean() }).strict()

/**
 * One event of a school snapshot.
 *
 * `movedFrom` is what makes a reschedule attributable: it names the instant the
 * changed class was originally scheduled for. Without it a changed anchor cannot
 * be matched to one occurrence, and the service reports that instead of guessing.
 */
export const sourceEvent = z.object({
  uid: z.string().min(1),
  title: z.string().min(1),
  start: LocalTimeSchema,
  end: LocalTimeSchema.optional(),
  location: z.string().optional(),
  description: z.string().optional(),
  recurrence: RecurrenceSchema.optional(),
  movedFrom: LocalTimeSchema.optional(),
  cancelledDates: z.array(LocalTimeSchema).optional(),
}).strict()

export const applySourceInput = z.object({
  source: z.string().min(1),
  events: z.array(sourceEvent),
  complete: z.boolean().optional(),
  revision: z.number().int().positive().optional(),
}).strict()

export const applySourceOutcome = z.object({
  applied: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative().optional(),
  moved: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  unattributable: z.array(z.object({
    uid: z.string(),
    reason: z.string(),
  }).strict()),
}).strict()

/** A note the user wrote, attached to one occurrence or to a whole series. */
const noteInput = z.object({
  scope: ScopeSchema.optional(),
  source: z.string().min(1),
  uid: z.string().min(1),
  originalStart: LocalTimeSchema.optional(),
  text: z.string(),
}).strict()

const noteRefInput = z.object({
  scope: ScopeSchema.optional(),
  source: z.string().min(1),
  uid: z.string().min(1),
  originalStart: LocalTimeSchema.optional(),
}).strict()

/**
 * A note the user wrote, attached to one occurrence or to a whole series.
 *
 * The stored shape is the shared model rather than a restatement of it: the
 * personal store validates records against `AnnotationSchema` and this face
 * reports them, so a second copy here could accept a record the store would
 * reject — which is exactly what "add a reminder" would have made drift.
 */
const annotation = AnnotationSchema

const notesInput = z.object({
  scope: ScopeSchema.optional(),
  source: z.string().min(1).optional(),
  uid: z.string().min(1).optional(),
  originalStart: LocalTimeSchema.optional(),
}).strict()

const unlinkedNote = annotation.extend({ reason: z.string().min(1) })

/** Wrap a zod schema in the descriptor shape the gateway reads. */
const result = (typeSymbol, schema) => Object.freeze({
  mode: 'strict',
  create() { return this.schema },
  typeSymbol,
  schema,
})

/** One JSON argument of one remote method, named the way the method reads it. */
const jsonParameter = (method, name, schema) => Object.freeze({
  name,
  wire: name,
  source: 'json',
  codec: Object.freeze({
    mode: 'strict',
    create() { return this.schema },
    typeSymbol: `@eduwork/dsh-calendar#calendar/${method}:${name}`,
    schema,
  }),
})

export const rangeParameter = jsonParameter('occurrences', 'range', rangeSchema)
export const remindersResult = result('@eduwork/dsh-calendar#ReminderInbox', z.object({ channel: z.enum(['in-app', 'system', 'unavailable']), unread: z.number().int().nonnegative(), items: z.array(ReminderReceiptSchema.omit({ nativeSent: true })) }).strict())
export const ackReminderParameter = jsonParameter('ackReminder', 'input', z.object({ id: z.string().regex(/^[a-f0-9]{64}$/) }).strict())
export const ackReminderResult = result('@eduwork/dsh-calendar#ReminderAcknowledgement', z.object({ updated: z.boolean() }).strict())
export const importParameter = jsonParameter('importIcs', 'input', importInput)
export const exportParameter = jsonParameter('exportIcs', 'options', exportInput)
export const overrideParameter = jsonParameter('applyOverride', 'input', overrideInput)
export const removeOverrideParameter = jsonParameter('removeOverride', 'input', occurrenceInput)
export const cancelParameter = jsonParameter('cancelOccurrence', 'input', occurrenceInput)
export const restoreParameter = jsonParameter('restoreOccurrence', 'input', occurrenceInput)
export const deleteEventParameter = jsonParameter('deleteEvent', 'input', uidInput)
export const deleteCalendarParameter = jsonParameter('deleteCalendar', 'input', z.object({ source: z.string().trim().min(1) }).strict())
export const deleteCalendarResult = result('@eduwork/dsh-calendar#CalendarDeletion', z.object({ removedEvents: z.number().int().nonnegative() }).strict())
export const eventParameter = jsonParameter('putEvent', 'event', EventSchema)
export const applySourceParameter = jsonParameter('applySource', 'input', applySourceInput)
export const putNoteParameter = jsonParameter('putNote', 'input', noteInput)
export const removeNoteParameter = jsonParameter('removeNote', 'input', noteRefInput)
export const notesParameter = jsonParameter('notes', 'input', notesInput)
export const unlinkedNotesParameter = jsonParameter('unlinkedNotes', 'input', z.object({}).strict())

export const snapshotResult = result('@eduwork/dsh-calendar#CalendarSnapshot', snapshot)
export const occurrencesResult = result('@eduwork/dsh-calendar#CalendarOccurrences', occurrences)
export const importResult = result('@eduwork/dsh-calendar#CalendarImport', importOutcome)
export const exportResult = result('@eduwork/dsh-calendar#CalendarExport', exportOutcome)
export const eventResult = result('@eduwork/dsh-calendar#CalendarEvent', EventSchema)
export const removalResult = result('@eduwork/dsh-calendar#CalendarRemoval', removalOutcome)
export const applySourceResult = result('@eduwork/dsh-calendar#CalendarApplySource', applySourceOutcome)
export const noteResult = result('@eduwork/dsh-calendar#CalendarAnnotation', annotation)
export const notesResult = result('@eduwork/dsh-calendar#CalendarAnnotations', z.array(annotation))
export const unlinkedNotesResult = result('@eduwork/dsh-calendar#CalendarUnlinkedAnnotations', z.array(unlinkedNote))

export const changeResult = result('@eduwork/dsh-calendar#CalendarChange', z.object({ revision: z.number().int().nonnegative() }).strict())

export const personalParameter = jsonParameter('setPersonal', 'input', noteRefInput.extend({
  patch: PersonalPatchSchema.optional(),
  clear: z.array(z.enum(Object.keys(PersonalFields))).optional(),
}).strict())
export const personalResult = result('@eduwork/dsh-calendar#CalendarPersonalWrite', z.object({ annotation: AnnotationSchema.nullable() }).strict())

export const personalReadParameter = jsonParameter('personalFor', 'input', noteRefInput)
export const personalReadResult = result('@eduwork/dsh-calendar#CalendarPersonalView', PersonalViewSchema)

export const sourceStatusesResult = result('@eduwork/dsh-calendar#CalendarSourceStatuses', z.array(z.object({
  source: z.string(), label: z.string(), state: z.enum(['idle', 'loading', 'ready', 'error']),
  updatedAt: z.string().optional(), error: z.enum(['incomplete_snapshot', 'unattributable', 'sync_failed', 'sync_timeout']).optional(),
}).strict()))

export const updateEventParameter = jsonParameter('updateEvent', 'input', z.object({ uid: z.string().min(1), ...sourceRef, patch: EventPatchSchema }).strict())
