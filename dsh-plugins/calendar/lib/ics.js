// The smallest ICS (RFC 5545) subset the calendar module needs: enough to
// import a calendar someone exported or saved from another tool, and enough to
// write one back out. No third-party parser, no timezone database, no network.
//
// Supported: `VCALENDAR`, `VEVENT`, `UID`, `SUMMARY`, `DTSTART`, `DTEND`,
// `LOCATION`, `DESCRIPTION`, `RRULE` (the weekly subset the model understands),
// `EXDATE`, `RECURRENCE-ID`, `STATUS:CANCELLED`, line folding, text escaping and
// unknown properties (kept in `extensions` and written back out).
// Not supported: `VTIMEZONE`, `VALARM`, CalDAV, subscriptions, monthly/yearly
// rules, `RDATE` combinations.
//
// Four choices worth knowing when reading this file:
//
// - An unsupported rule is never dropped: the event degrades to a single
//   occurrence and the original `RRULE` text stays in `extensions.RRULE`, so a
//   later version can pick it up and nothing is lost silently.
// - Properties of an earlier shape of this plugin that named a course
//   (`X-EDUWORK-COURSES`, `X-EDUWORK-COURSE-*`, `X-EDUWORK-NOTE`) are recognized
//   and dropped instead of being kept as unknown extensions. They describe an
//   entity this module no longer has, so a round trip should not carry it on.
// - All-day events: ICS `DTEND` is exclusive, our records treat `end` as the last
//   day covered, so the two directions shift by one day. Timed events are
//   literal.
// - Timezones: no conversion except for an explicit `Z` stamp, whose instant is
//   unambiguous. A `TZID` parameter is kept in `extensions` and written back, but
//   the wall clock is what this version stores.
import { WEEKDAYS } from './model.js'

/** Property names an earlier shape of this plugin wrote for a course; read and discarded. */
const RETIRED_PROPERTIES = new Set([
  'X-EDUWORK-COURSES',
  'X-EDUWORK-COURSE-ID',
  'X-EDUWORK-COURSE-NAME',
  'X-EDUWORK-COURSE-TEACHER',
  'X-EDUWORK-COURSE-DEFAULT-LOCATION',
  'X-EDUWORK-NOTE',
])

const TIMEZONE_KEY = 'X-EDUWORK-TZID'

/** Octets one content line may occupy, the folding limit of RFC 5545 §3.1. */
const LINE_LIMIT = 75

const WEEKDAY_TO_CODE = { MO: 'mo', TU: 'tu', WE: 'we', TH: 'th', FR: 'fr', SA: 'sa', SU: 'su' }
const CODE_TO_WEEKDAY = Object.fromEntries(WEEKDAYS.map(code => [code, code.toUpperCase()]))

/** Property values holding free text: escaped on the way out, unescaped on the way in. */
const TEXT_PROPERTIES = new Set(['UID', 'SUMMARY', 'LOCATION', 'DESCRIPTION'])

const isTextProperty = name => TEXT_PROPERTIES.has(name) || name.startsWith('X-')

/** Properties a `VEVENT` is read for; anything else is preserved in `extensions`. */
const CONSUMED_PROPERTIES = new Set([
  'UID', 'SUMMARY', 'DTSTART', 'DTEND', 'LOCATION', 'DESCRIPTION',
  'RRULE', 'EXDATE', 'RECURRENCE-ID', 'STATUS',
])

const encoder = new TextEncoder()
const pad = value => String(value).padStart(2, '0')

/** Octets a string occupies in UTF-8, which is what the folding limit counts. */
const octets = value => encoder.encode(value).length

/** `YYYY-MM-DD` plus whole days. */
function shiftDay(date, days) {
  const [year, month, day] = String(date).split('-').map(Number)
  const moved = new Date(year, month - 1, day)
  moved.setDate(moved.getDate() + days)
  return `${moved.getFullYear()}-${pad(moved.getMonth() + 1)}-${pad(moved.getDate())}`
}

/** The time part of a start, `T08:00`, or an empty string for a whole-day event. */
const timePartOf = value => (String(value ?? '').includes('T') ? String(value).slice(10) : '')

/** The moment an occurrence of a series begins: the series' own time on that date. */
const occurrenceStart = (event, date) => `${date}${timePartOf(event.start)}`

/**
 * Unescape one TEXT value: `\\`, `\;`, `\,` and `\n`/`\N`.
 * @param value - Raw property value.
 * @returns the readable text.
 */
export function unescapeText(value) {
  return String(value).replace(/\\([\\;,nN])/g, (_, escaped) => (escaped === 'n' || escaped === 'N' ? '\n' : escaped))
}

/**
 * Escape one TEXT value, so commas, semicolons, backslashes and newlines survive
 * the trip through a single content line.
 * @param value - Readable text.
 * @returns the property value.
 */
export function escapeText(value) {
  return String(value)
    .replace(/([\\;,])/g, '\\$1')
    .replace(/\r\n|\r|\n/g, '\\n')
}

/**
 * Split a calendar into unfolded logical lines. Folding is invisible here: a
 * line break followed by a space or tab continues the previous line, and both
 * CRLF and bare LF files are accepted.
 * @param text - Calendar text.
 * @returns logical lines without their line breaks.
 */
export function unfoldLines(text) {
  const normalized = String(text).replace(/^\uFEFF/, '').replace(/\r\n|\r/g, '\n')
  const lines = []
  for (const physical of normalized.split('\n')) {
    if (lines.length && (physical.startsWith(' ') || physical.startsWith('\t'))) lines[lines.length - 1] += physical.slice(1)
    else lines.push(physical)
  }
  return lines
}

/**
 * Fold one content line at 75 octets, measuring bytes so a multi-byte character
 * is never cut in half.
 * @param line - One content line, without a line break.
 * @returns the physical lines, without line breaks.
 */
export function foldLine(line) {
  const chunks = []
  let current = ''
  let size = 0
  for (const character of line) {
    const width = octets(character)
    if (size + width > LINE_LIMIT) {
      chunks.push(current)
      current = ' '
      size = 1
    }
    current += character
    size += width
  }
  chunks.push(current)
  return chunks
}

/**
 * Split one content line into `NAME`, parameters and value. The colon that ends
 * the name section is the first one outside a quoted parameter value.
 * @param line - One unfolded content line.
 * @returns `{ name, params, value }`, or undefined when the line is not a property.
 */
export function parseContentLine(line) {
  const trimmed = String(line).trim()
  if (!trimmed) return undefined
  let quoted = false
  let colon = -1
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index]
    if (character === '"') quoted = !quoted
    else if (character === ':' && !quoted) { colon = index; break }
  }
  if (colon < 0) return undefined
  const head = trimmed.slice(0, colon)
  const value = trimmed.slice(colon + 1)
  const [rawName, ...rawParams] = head.split(';')
  const params = {}
  for (const raw of rawParams) {
    const equals = raw.indexOf('=')
    if (equals < 0) continue
    params[raw.slice(0, equals).toUpperCase()] = raw.slice(equals + 1).replace(/^"|"$/g, '')
  }
  return { name: rawName.trim().toUpperCase(), params, value }
}

/**
 * Read the component tree of a calendar: every component keeps its own
 * properties and children, so a `VALARM` inside a `VEVENT` can never be mistaken
 * for a `VEVENT` property.
 * @param text - Calendar text.
 * @returns top-level components.
 */
export function parseComponents(text) {
  const components = []
  const stack = []
  for (const line of unfoldLines(text)) {
    const parsed = parseContentLine(line)
    if (!parsed) continue
    if (parsed.name === 'BEGIN') {
      stack.push({ name: parsed.value.trim().toUpperCase(), properties: [], children: [] })
      continue
    }
    if (parsed.name === 'END') {
      const component = stack.pop()
      if (!component) continue
      if (stack.length) stack[stack.length - 1].children.push(component)
      else components.push(component)
      continue
    }
    const current = stack[stack.length - 1]
    if (current) current.properties.push(parsed)
  }
  return components
}

/** Every property of a component with the given name, in file order. */
const propertiesNamed = (component, name) => component.properties.filter(property => property.name === name)

/** The first value of a component property, unescaped when it holds text. */
function singleValue(component, name) {
  const [property] = propertiesNamed(component, name)
  if (!property) return undefined
  const value = property.value.trim()
  if (!value) return undefined
  return isTextProperty(name) ? unescapeText(value) : value
}

/**
 * Read one date or date-time property value.
 * @param value - Property value, for example `20260316T080000Z`.
 * @param params - Property parameters, used for `VALUE=DATE`.
 * @returns a local `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm` string, or undefined.
 */
export function parseDateValue(value, params = {}) {
  const text = String(value ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(text)) return text
  const dateOnly = text.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (dateOnly) return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`
  const dateTime = text.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z?)$/)
  if (!dateTime) return undefined
  const [, year, month, day, hour, minute, , zone] = dateTime
  if (params.VALUE === 'DATE') return `${year}-${month}-${day}`
  // A UTC stamp is the one conversion this version performs, because the instant
  // it names is unambiguous. Everything else is wall-clock local time.
  if (zone === 'Z') {
    const utc = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)))
    return `${utc.getFullYear()}-${pad(utc.getMonth() + 1)}-${pad(utc.getDate())}T${pad(utc.getHours())}:${pad(utc.getMinutes())}`
  }
  return `${year}-${month}-${day}T${hour}:${minute}`
}

/**
 * Format a local time string as an ICS property value, following the form of
 * `reference`: an all-day reference yields `YYYYMMDD`, a clock reference yields
 * `YYYYMMDDTHHMMSS`.
 * @param value - `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`.
 * @param reference - The value whose form decides the output form.
 * @returns the property value.
 */
export function stamp(value, reference) {
  const date = String(value).slice(0, 10).replace(/-/g, '')
  if (!String(reference ?? '').includes('T')) return date
  const clock = String(value).includes('T') ? String(value).slice(11, 16).replace(':', '') : '0000'
  return `${date}T${clock}00`
}

/** A positive integer from an RRULE part, or undefined when it is not one. */
function positiveInteger(value) {
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * Read an `RRULE` value into the supported recurrence subset.
 * @param raw - Property value, for example `FREQ=WEEKLY;COUNT=16;BYDAY=MO,WE`.
 * @returns `{ recurrence }` when it fits the subset, `{ unsupported }` with a reason otherwise.
 */
export function parseRrule(raw) {
  const parts = String(raw ?? '').split(';').map(part => part.trim()).filter(Boolean)
  const fields = {}
  for (const part of parts) {
    const equals = part.indexOf('=')
    if (equals < 0) return { unsupported: `unreadable rule part ${part}` }
    fields[part.slice(0, equals).toUpperCase()] = part.slice(equals + 1)
  }
  const allowed = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'WKST'])
  // The frequency is checked first: "MONTHLY is unsupported" says more than the
  // first part that happens to be unfamiliar.
  if (String(fields.FREQ ?? '').toUpperCase() !== 'WEEKLY') return { unsupported: `unsupported frequency ${fields.FREQ ?? 'none'}` }
  for (const key of Object.keys(fields)) if (!allowed.has(key)) return { unsupported: `unsupported rule part ${key}` }
  if (fields.WKST && fields.WKST.toUpperCase() !== 'MO') return { unsupported: `unsupported week start ${fields.WKST}` }
  const recurrence = { freq: 'weekly' }
  if (fields.INTERVAL !== undefined) {
    const interval = positiveInteger(fields.INTERVAL)
    if (!interval) return { unsupported: `unreadable interval ${fields.INTERVAL}` }
    recurrence.interval = interval
  }
  if (fields.COUNT !== undefined) {
    const count = positiveInteger(fields.COUNT)
    if (!count) return { unsupported: `unreadable count ${fields.COUNT}` }
    recurrence.count = count
  }
  if (fields.UNTIL !== undefined) {
    const until = parseDateValue(fields.UNTIL)
    if (!until) return { unsupported: `unreadable until ${fields.UNTIL}` }
    recurrence.until = until
  }
  if (fields.BYDAY !== undefined) {
    const codes = fields.BYDAY.split(',').map(code => code.trim().toUpperCase()).filter(Boolean)
    const byDay = codes.map(code => WEEKDAY_TO_CODE[code])
    if (!byDay.length || byDay.some(code => !code)) return { unsupported: `unreadable byday ${fields.BYDAY}` }
    recurrence.byDay = byDay
  }
  return { recurrence }
}

/**
 * The `RRULE` property value for one recurrence. A date-only `until` is written
 * as the end of that day, which is what it means to the expansion.
 * @param recurrence - Supported recurrence, or undefined.
 * @returns the property value, or undefined.
 */
export function formatRrule(recurrence) {
  if (!recurrence) return undefined
  const parts = ['FREQ=WEEKLY']
  if (recurrence.interval) parts.push(`INTERVAL=${recurrence.interval}`)
  if (recurrence.count) parts.push(`COUNT=${recurrence.count}`)
  if (recurrence.until) {
    const until = String(recurrence.until)
    parts.push(`UNTIL=${until.includes('T') ? stamp(until, until) : `${until.replace(/-/g, '')}T235959`}`)
  }
  if (recurrence.byDay?.length) parts.push(`BYDAY=${recurrence.byDay.map(code => CODE_TO_WEEKDAY[code] ?? String(code).toUpperCase()).join(',')}`)
  return parts.join(';')
}

/**
 * The change one `RECURRENCE-ID` `VEVENT` asks for, expressed as an override:
 * only the fields that differ from the series are kept. A field the overriding
 * `VEVENT` did not carry at all is inherited, never pinned to a default.
 * @param master - The series record.
 * @param date - The date the series produced.
 * @param record - The fields the overriding `VEVENT` carried.
 * @param carried - Which of those fields the `VEVENT` actually named.
 * @returns an override entry, possibly carrying only `date`.
 */
function overridePatch(master, date, record, carried) {
  const patch = { date }
  const inheritedStart = occurrenceStart(master, date)
  if (carried.start && record.start !== inheritedStart) patch.start = record.start
  const effectiveStart = patch.start ?? inheritedStart
  if (carried.end && record.end) {
    const inheritedEnd = master.end ? `${String(effectiveStart).slice(0, 10)}${timePartOf(master.end)}` : undefined
    if (record.end !== inheritedEnd) patch.end = record.end
  }
  if (carried.title && record.title !== master.title) patch.title = record.title
  if (carried.location && record.location !== master.location) patch.location = record.location
  if (carried.description && record.description !== master.description) patch.description = record.description
  return patch
}

/**
 * Read one `VEVENT` into the fields this module maps, or report why it cannot.
 * @param component - The `VEVENT` component.
 * @param source - Source stamp for the record.
 * @returns `{ record, date, cancelled }` or `{ skipped }`.
 */
function readVevent(component, source) {
  const startProperty = propertiesNamed(component, 'DTSTART')[0]
  const start = startProperty ? parseDateValue(startProperty.value, startProperty.params) : undefined
  const recurrenceProperty = propertiesNamed(component, 'RECURRENCE-ID')[0]
  const recurrenceDate = recurrenceProperty ? parseDateValue(recurrenceProperty.value, recurrenceProperty.params) : undefined
  const uid = singleValue(component, 'UID')
  const cancelled = String(singleValue(component, 'STATUS') ?? '').toUpperCase() === 'CANCELLED'
  if (!start) {
    // A cancellation often carries only `RECURRENCE-ID` and `STATUS`, and the
    // series it belongs to is the one this file also lists.
    if (recurrenceDate && cancelled) return { uid, date: String(recurrenceDate).slice(0, 10), cancelled: true }
    return { skipped: { uid, reason: 'a VEVENT without a readable DTSTART cannot be placed' } }
  }
  const endProperty = propertiesNamed(component, 'DTEND')[0]
  const rawEnd = endProperty ? parseDateValue(endProperty.value, endProperty.params) : undefined
  const allDay = !String(start).includes('T')
  // ICS ends an all-day event on the next day, exclusively; our records hold the
  // last day it covers. Timed ends are literal.
  const end = rawEnd === undefined ? undefined : (!allDay ? rawEnd : (rawEnd > start ? shiftDay(rawEnd, -1) : undefined))
  const extensions = {}
  for (const property of component.properties) {
    if (CONSUMED_PROPERTIES.has(property.name) || RETIRED_PROPERTIES.has(property.name)) continue
    extensions[property.name] = isTextProperty(property.name) ? unescapeText(property.value) : property.value
  }
  if (startProperty.params.TZID) extensions[TIMEZONE_KEY] = startProperty.params.TZID
  const record = {
    uid: uid || `${String(start).slice(0, 10)}-${(singleValue(component, 'SUMMARY') ?? 'event').slice(0, 24)}`,
    title: singleValue(component, 'SUMMARY') || '未命名事件',
    start,
    source,
    extensions,
  }
  if (end) record.end = end
  const location = singleValue(component, 'LOCATION')
  const description = singleValue(component, 'DESCRIPTION')
  if (location !== undefined) record.location = location
  if (description !== undefined) record.description = description
  const rule = propertiesNamed(component, 'RRULE')[0]
  const degraded = []
  if (rule && !recurrenceDate) {
    const parsed = parseRrule(rule.value)
    if (parsed.recurrence) record.recurrence = parsed.recurrence
    else {
      // Degrade instead of dropping: the original text stays readable and the
      // event still shows up on its own start date.
      extensions.RRULE = rule.value
      degraded.push({ uid: record.uid, reason: parsed.unsupported, rrule: rule.value })
    }
  }
  const exceptions = []
  for (const property of propertiesNamed(component, 'EXDATE')) {
    for (const part of property.value.split(',')) {
      const date = parseDateValue(part, property.params)
      if (date) exceptions.push(String(date).slice(0, 10))
    }
  }
  if (exceptions.length) record.exceptions = [...new Set(exceptions)].sort()
  const summary = singleValue(component, 'SUMMARY')
  return {
    record,
    uid: record.uid,
    date: recurrenceDate ? String(recurrenceDate).slice(0, 10) : undefined,
    cancelled,
    degraded,
    carried: {
      title: summary !== undefined,
      start: true,
      end: rawEnd !== undefined,
      location: location !== undefined,
      description: description !== undefined,
    },
  }
}

/**
 * Import one calendar.
 *
 * @param text - Calendar text.
 * @param options - `source` stamps imported events (default `ics`), so a later
 *   import can replace exactly this source's records.
 * @returns `{ events, skipped, degraded }`: records in the shape
 *   `importSnapshot` accepts, plus what was left out and what was degraded.
 */
export function parseIcs(text, options = {}) {
  const source = typeof options.source === 'string' && options.source ? options.source : 'ics'
  const components = parseComponents(text)
  const calendar = components.find(component => component.name === 'VCALENDAR')
  const vevents = (calendar ? calendar.children : components).filter(component => component.name === 'VEVENT')

  const events = []
  const byUid = new Map()
  const pending = []
  const skipped = []
  const degraded = []

  for (const component of vevents) {
    const read = readVevent(component, source)
    if (read.skipped) { skipped.push(read.skipped); continue }
    degraded.push(...(read.degraded ?? []))
    if (read.cancelled && !read.record) { pending.push({ uid: read.uid, date: read.date, cancelled: true }); continue }
    if (read.date) { pending.push({ uid: read.uid, date: read.date, cancelled: read.cancelled, record: read.record, carried: read.carried }); continue }
    if (read.cancelled) {
      // A cancelled series is left out, and said so rather than vanishing.
      skipped.push({ uid: read.record.uid, reason: 'the event is cancelled' })
      continue
    }
    events.push(read.record)
    byUid.set(read.record.uid, read.record)
  }

  for (const entry of pending) {
    const master = entry.uid ? byUid.get(entry.uid) : undefined
    if (!master) {
      // An override whose series is not in this file is still a lesson: keep it
      // as an event of its own instead of dropping the time it carries.
      if (entry.record) { events.push(entry.record); byUid.set(entry.record.uid, entry.record) }
      else skipped.push({ uid: entry.uid, reason: `a cancellation for an unknown series (${entry.date})` })
      continue
    }
    if (entry.cancelled) {
      master.exceptions = [...new Set([...(master.exceptions ?? []), entry.date])].sort()
      continue
    }
    const patch = overridePatch(master, entry.date, entry.record, entry.carried ?? {})
    if (Object.keys(patch).length === 1) continue
    const existing = master.overrides ?? []
    master.overrides = [...existing.filter(item => item.date !== patch.date), patch].sort((left, right) => left.date.localeCompare(right.date))
  }

  return { events, skipped, degraded }
}

/**
 * Export records as one calendar.
 *
 * @param snapshot - `{ events }`, the shape `snapshot()` returns.
 * @param options - `name` sets `X-WR-CALNAME`.
 * @returns calendar text with CRLF line endings and folded long lines.
 */
export function buildIcs(snapshot = {}, options = {}) {
  const events = [...(snapshot.events ?? [])]
    .sort((left, right) => left.start.localeCompare(right.start) || left.uid.localeCompare(right.uid))

  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//EduWork//Calendar//CN', 'CALSCALE:GREGORIAN']
  if (options.name) lines.push(`X-WR-CALNAME:${escapeText(options.name)}`)

  for (const event of events) {
    const allDay = !String(event.start).includes('T')
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${escapeText(event.uid)}`)
    lines.push(`SUMMARY:${escapeText(event.title)}`)
    lines.push(`DTSTART${allDay ? ';VALUE=DATE' : ''}:${stamp(event.start, event.start)}`)
    if (event.end) lines.push(`DTEND${allDay ? ';VALUE=DATE' : ''}:${stamp(allDay ? shiftDay(event.end, 1) : event.end, event.start)}`)
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`)
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`)
    const rule = formatRrule(event.recurrence) ?? event.extensions?.RRULE
    if (rule) lines.push(`RRULE:${rule}`)
    if (event.exceptions?.length) lines.push(`EXDATE:${event.exceptions.map(date => stamp(occurrenceStart(event, date), event.start)).join(',')}`)
    for (const [key, value] of Object.entries(event.extensions ?? {})) {
      if (key === 'RRULE' || RETIRED_PROPERTIES.has(key)) continue
      const text = typeof value === 'string' ? value : JSON.stringify(value)
      lines.push(`${key}:${isTextProperty(key) ? escapeText(text) : text}`)
    }
    lines.push('END:VEVENT')

    for (const override of event.overrides ?? []) {
      const movedStart = override.start ?? occurrenceStart(event, override.date)
      lines.push('BEGIN:VEVENT')
      lines.push(`UID:${escapeText(event.uid)}`)
      lines.push(`RECURRENCE-ID${allDay ? ';VALUE=DATE' : ''}:${stamp(occurrenceStart(event, override.date), event.start)}`)
      if (override.title) lines.push(`SUMMARY:${escapeText(override.title)}`)
      lines.push(`DTSTART${allDay ? ';VALUE=DATE' : ''}:${stamp(movedStart, event.start)}`)
      if (override.end) lines.push(`DTEND${allDay ? ';VALUE=DATE' : ''}:${stamp(allDay ? shiftDay(override.end, 1) : override.end, event.start)}`)
      if (override.location !== undefined) lines.push(`LOCATION:${escapeText(override.location)}`)
      if (override.description !== undefined) lines.push(`DESCRIPTION:${escapeText(override.description)}`)
      lines.push('END:VEVENT')
    }
  }

  lines.push('END:VCALENDAR')
  return lines.flatMap(line => foldLine(line)).join('\r\n') + '\r\n'
}
