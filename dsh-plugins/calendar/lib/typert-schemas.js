// Wire schemas of the calendar remote face.
//
// The snapshot that crosses to the client half is exactly the shape the domain
// stores, so the record schemas are reused rather than restated: a change to a
// stored record cannot silently disagree with the wire contract. Occurrences are
// the stored fields minus series bookkeeping, plus the keys a view renders by.
// Every remote method takes one object argument and returns one value; the
// descriptors that point at those schemas are in `lib/typert-descriptors.js`.
import { z } from 'zod'
import { EventFields, EventSchema, LocalTimeSchema } from './model.js'

const snapshot = z.object({
  schemaVersion: z.number().int().positive(),
  events: z.array(EventSchema),
}).strict()

const occurrence = z.object({
  ...EventFields,
  occurrenceId: z.string().min(1),
  occurrenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'),
  overridden: z.boolean().optional(),
}).strict()

const occurrences = z.object({
  schemaVersion: z.number().int().positive(),
  occurrences: z.array(occurrence),
}).strict()

/** Bounds of a range query; either side may be omitted. */
export const rangeSchema = z.object({
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

/** One date of one series. */
const occurrenceInput = z.object({ uid: z.string().min(1), date: dateSchema }).strict()

/** The changeable fields of one occurrence; `date` is the series' own date. */
const overrideInput = z.object({
  uid: z.string().min(1),
  date: dateSchema,
  patch: z.object({
    title: z.string().min(1).optional(),
    start: LocalTimeSchema.optional(),
    end: LocalTimeSchema.optional(),
    location: z.string().optional(),
    description: z.string().optional(),
  }).strict(),
}).strict()

const uidInput = z.object({ uid: z.string().min(1) }).strict()

const removalOutcome = z.object({ removed: z.boolean() }).strict()

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
export const importParameter = jsonParameter('importIcs', 'input', importInput)
export const exportParameter = jsonParameter('exportIcs', 'options', exportInput)
export const overrideParameter = jsonParameter('applyOverride', 'input', overrideInput)
export const removeOverrideParameter = jsonParameter('removeOverride', 'input', occurrenceInput)
export const cancelParameter = jsonParameter('cancelOccurrence', 'input', occurrenceInput)
export const restoreParameter = jsonParameter('restoreOccurrence', 'input', occurrenceInput)
export const deleteEventParameter = jsonParameter('deleteEvent', 'input', uidInput)
export const eventParameter = jsonParameter('putEvent', 'event', EventSchema)

export const snapshotResult = result('@eduwork/dsh-calendar#CalendarSnapshot', snapshot)
export const occurrencesResult = result('@eduwork/dsh-calendar#CalendarOccurrences', occurrences)
export const importResult = result('@eduwork/dsh-calendar#CalendarImport', importOutcome)
export const exportResult = result('@eduwork/dsh-calendar#CalendarExport', exportOutcome)
export const eventResult = result('@eduwork/dsh-calendar#CalendarEvent', EventSchema)
export const removalResult = result('@eduwork/dsh-calendar#CalendarRemoval', removalOutcome)
