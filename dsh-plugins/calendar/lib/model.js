// Event records for the public calendar module.
//
// This file is the single source of the public data shape: the durable record
// schema, the normalization applied before anything is stored, and the snapshot
// handed to consumers. It stays free of IO so it can be unit tested on its own.
//
// A calendar holds events, not courses: one record is one event (a single one,
// or the anchor of a series), and every grouping a data source wants — a school
// timetable, a mail thread, an activity — arrives as events of that source. The
// public shape therefore carries no course entity to keep in sync.
//
// Field names follow the ICS vocabulary so no single data source owns them:
// `uid`/`title`/`start`/`end`/`location`/`description` mirror `UID`/`SUMMARY`/
// `DTSTART`/`DTEND`/`LOCATION`/`DESCRIPTION`, and anything unrecognized is kept
// verbatim in `extensions` (`X-*` on the way out). Times are local strings, not
// instants: the first version does no timezone conversion.
import { z } from 'zod'

/**
 * Version of the public snapshot shape. Bump only for incompatible changes.
 * 2: the snapshot and the occurrence payload no longer carry a course list, and
 * an event no longer carries `courseId`.
 */
export const SCHEMA_VERSION = 2

/** Local time string: `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm` where a clock applies. */
export const LocalTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/, 'expected YYYY-MM-DD or YYYY-MM-DDTHH:mm')

/** Weekday codes accepted in `recurrence.byDay`, as in RRULE. */
export const WEEKDAYS = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su']

/**
 * Supported recurrence subset. Deliberately narrower than RRULE: rules outside
 * it (monthly, yearly, BYMONTHDAY, BYSETPOS) are not represented here — the
 * importer keeps their original RRULE text in `extensions` and degrades the
 * event to a single occurrence instead of dropping it silently.
 */
export const RecurrenceSchema = z
  .object({
    freq: z.literal('weekly'),
    interval: z.number().int().positive().optional(),
    count: z.number().int().positive().optional(),
    until: LocalTimeSchema.optional(),
    byDay: z.array(z.enum(WEEKDAYS)).optional(),
  })
  .strict()

/**
 * One single-occurrence change to a series — the `RECURRENCE-ID` case of ICS:
 * one date of the series is moved, renamed or relocated. `date` is the date the
 * series itself produced, so the change survives later edits to the series
 * time; every other field is optional and inherited from the series, which
 * keeps "moved to Friday, room changed" down to two fields.
 *
 * A cancellation is not an override: it is listed in `exceptions` (`EXDATE`),
 * and an extra date that belongs to no series is a plain event of its own.
 */
export const OverrideSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'),
    title: z.string().min(1).optional(),
    start: LocalTimeSchema.optional(),
    end: LocalTimeSchema.optional(),
    location: z.string().optional(),
    description: z.string().optional(),
  })
  .strict()
  .refine(value => Object.keys(value).length > 1, 'an override must change at least one field')

const OverridesSchema = z
  .array(OverrideSchema)
  .refine(list => new Set(list.map(entry => entry.date)).size === list.length, 'each date may be overridden once')

/**
 * Fields every event-shaped value carries — the stored record and the
 * occurrence handed to a view. Shared so the two cannot drift apart.
 */
export const EventFields = {
  uid: z.string().min(1),
  title: z.string().min(1),
  start: LocalTimeSchema,
  end: LocalTimeSchema.optional(),
  location: z.string().optional(),
  description: z.string().optional(),
  recurrence: RecurrenceSchema.optional(),
  source: z.string().optional(),
  extensions: z.record(z.string(), z.unknown()).optional(),
}

/** Durable shape of one event: the shared fields plus series bookkeeping. */
export const EventSchema = z
  .object({
    ...EventFields,
    exceptions: z.array(LocalTimeSchema).optional(),
    overrides: OverridesSchema.optional(),
  })
  .strict()

/**
 * Fields this contract retired. A store written before the change still holds
 * them, so the medium is read with {@link StoredEventSchema} and rewritten into
 * the current shape once (see `store.js`); the public contract above never
 * accepts them, and neither does anything a caller can send.
 */
export const RETIRED_EVENT_FIELDS = ['courseId']

/**
 * What a medium may hold: the record contract plus the fields it retired. Being
 * able to read one is what lets a store written before the change open at all
 * instead of taking the whole calendar down with it.
 */
export const StoredEventSchema = EventSchema.extend(
  Object.fromEntries(RETIRED_EVENT_FIELDS.map(field => [field, z.unknown().optional()])),
)

/**
 * Drop the retired fields from one stored record.
 * @param event - Record read from the medium.
 * @returns the current shape, or `undefined` when there is nothing to drop.
 */
export function dropRetiredFields(event) {
  const present = RETIRED_EVENT_FIELDS.filter(field => field in event)
  if (present.length === 0) return undefined
  const clean = { ...event }
  for (const field of present) delete clean[field]
  return clean
}

/**
 * Validate one event and fill its defaults.
 * @param input - Event fields as supplied by a caller, an import or an adapter.
 * @returns the durable record.
 */
export function normalizeEvent(input) {
  const candidate = { ...input, source: input?.source ?? 'manual', extensions: input?.extensions ?? {} }
  for (const key of ['end', 'location', 'description', 'recurrence', 'exceptions', 'overrides']) {
    if (candidate[key] === undefined || candidate[key] === null) delete candidate[key]
  }
  return EventSchema.parse(candidate)
}

/** Events in display order: by start, then by title for a stable tie-break. */
export function compareEvents(left, right) {
  return left.start.localeCompare(right.start) || left.title.localeCompare(right.title) || left.uid.localeCompare(right.uid)
}

/**
 * Build the public snapshot: what the client half renders and what export and
 * injection read. Ordering is part of the shape so two runs over the same
 * records produce the same document.
 * @param events - Event records.
 * @returns the versioned snapshot.
 */
export function buildSnapshot(events) {
  return {
    schemaVersion: SCHEMA_VERSION,
    events: [...events].sort(compareEvents),
  }
}

/** Last instant an event occupies, used for range overlap. */
function effectiveEnd(event) {
  const end = event.end ?? event.start
  return end.length === 10 ? `${end}T23:59` : end
}

/**
 * Whether an event overlaps a range. Bounds are inclusive and compared as local
 * strings; an omitted bound is open on that side. A date-only upper bound means
 * the whole of that day, which is what a week view asks for.
 * @param event - Stored event or occurrence.
 * @param range - `{ from, to }` bounds, either optional.
 * @returns true when the event overlaps.
 */
export function overlaps(event, range = {}) {
  const { from } = range
  const to = range.to && range.to.length === 10 ? `${range.to}T23:59` : range.to
  if (from && effectiveEnd(event) < from) return false
  if (to && event.start > to) return false
  return true
}

const DAY_NAMES = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa']
/** Monday-based offset of each RRULE weekday code. */
const WEEKDAY_OFFSET = { mo: 0, tu: 1, we: 2, th: 3, fr: 4, sa: 5, su: 6 }

const pad = value => String(value).padStart(2, '0')
/** Local midnight of a `YYYY-MM-DD` string. */
function parseDate(date) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day)
}
/** Local `YYYY-MM-DD` of a `Date`. */
function formatDate(value) {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}
/** The date `days` away, as a local `YYYY-MM-DD`. */
function shiftDate(date, days) {
  const value = parseDate(date)
  value.setDate(value.getDate() + days)
  return formatDate(value)
}
/** Monday of the week a date belongs to. */
function weekStart(date) {
  return shiftDate(date, -((parseDate(date).getDay() + 6) % 7))
}
/** Whole days from one local date to another. */
function daysBetween(from, to) {
  return Math.round((parseDate(to) - parseDate(from)) / 86400000)
}
/** `YYYY-MM-DD` part of a local time string. */
function dateOf(value) {
  return value.slice(0, 10)
}
/** `THH:mm` part of a local time string, empty for a whole-day value. */
function timeOf(value) {
  return value.length > 10 ? value.slice(10) : ''
}

/**
 * Dates one recurring event produces, from its own start up to `limit`.
 * Iteration begins at the series anchor because RRULE counts `count` from
 * `DTSTART`, and it stops at `limit`: callers that know an override may move an
 * occurrence out of their window pass a wider limit instead of scanning forever.
 */
function recurrenceDates(recurrence, start, limit) {
  const anchor = dateOf(start)
  const seriesTime = timeOf(start)
  const days = (recurrence.byDay?.length ? [...recurrence.byDay] : [DAY_NAMES[parseDate(anchor).getDay()]])
    .sort((left, right) => WEEKDAY_OFFSET[left] - WEEKDAY_OFFSET[right])
  const step = (recurrence.interval ?? 1) * 7
  const dates = []
  for (let week = weekStart(anchor); week <= limit; week = shiftDate(week, step)) {
    for (const day of days) {
      const date = shiftDate(week, WEEKDAY_OFFSET[day])
      if (date < anchor) continue
      if (recurrence.until) {
        const until = recurrence.until.length > 10 ? recurrence.until : `${recurrence.until}T23:59`
        if (`${date}${seriesTime}` > until) return dates
      }
      if (recurrence.count && dates.length >= recurrence.count) return dates
      dates.push(date)
    }
  }
  return dates
}

/**
 * One occurrence of an event. `occurrenceDate` is the date the series produced
 * and `occurrenceId` is the stable key built from it — the same key the view,
 * a later reminder and any feature that hangs off one date of a series uses.
 */
function occurrenceOf(event, date, override) {
  const { overrides: _overrides, exceptions: _exceptions, ...series } = event
  const start = override?.start ?? `${date}${timeOf(event.start)}`
  // The stored end keeps the number of days it sits past the start: a whole-day
  // record covering three days, or a session that runs past midnight, must not
  // have that end pulled back onto its own start date — it would claim to finish
  // before it began, and a multi-day record would silently lose its span. The
  // offset is applied to the occurrence's own start, so each week of a repeating
  // whole-day series carries the same span.
  const inheritedEnd = event.end
    ? `${shiftDate(dateOf(start), daysBetween(dateOf(event.start), dateOf(event.end)))}${timeOf(event.end)}`
    : undefined
  const occurrence = {
    ...series,
    start,
    occurrenceId: `${event.uid}#${date}`,
    occurrenceDate: date,
  }
  const end = override?.end ?? inheritedEnd
  if (end) occurrence.end = end
  else delete occurrence.end
  if (override?.title !== undefined) occurrence.title = override.title
  if (override?.location !== undefined) occurrence.location = override.location
  if (override?.description !== undefined) occurrence.description = override.description
  if (override) occurrence.overridden = true
  return occurrence
}

/**
 * Occurrences one event produces in a window. A single event yields at most one;
 * `exceptions` cancel dates and `overrides` change them. Overrides may move an
 * occurrence by weeks, so an event that carries any is scanned up to a year past
 * the window before the window filter runs.
 * @param event - Stored event.
 * @param range - `{ from, to }` bounds, either optional.
 * @returns the occurrences overlapping the range, in list order.
 */
export function occurrencesOf(event, range = {}) {
  const from = range.from ?? '0000-01-01'
  const to = range.to ?? '9999-12-31'
  const anchor = dateOf(event.start)
  const exceptions = new Set((event.exceptions ?? []).map(dateOf))
  const overrides = new Map((event.overrides ?? []).map(entry => [entry.date, entry]))
  if (!event.recurrence) {
    if (exceptions.has(anchor)) return []
    const single = occurrenceOf(event, anchor, overrides.get(anchor))
    return overlaps(single, range) ? [single] : []
  }
  const dates = recurrenceDates(event.recurrence, event.start, overrides.size ? shiftDate(to, 366) : to)
  const list = []
  for (const date of dates) {
    if (exceptions.has(date)) continue
    if (date > to && !overrides.has(date)) continue
    list.push(occurrenceOf(event, date, overrides.get(date)))
  }
  return list.filter(occurrence => overlaps(occurrence, range))
}

/** Occurrences in display order: by start, then by the occurrence key. */
export function compareOccurrences(left, right) {
  return left.start.localeCompare(right.start) || left.title.localeCompare(right.title) || left.occurrenceId.localeCompare(right.occurrenceId)
}

/**
 * Occurrences of many events in one window, in display order.
 * @param events - Stored events.
 * @param range - `{ from, to }` bounds, either optional.
 * @returns the sorted occurrences.
 */
export function occurrencesIn(events, range = {}) {
  return events.flatMap(event => occurrencesOf(event, range)).sort(compareOccurrences)
}
