// Agent tools over the calendar service.
//
// The weekly panel is no longer the only writer. These tools let a session read a
// range of the calendar and change it, and they call the same `calendar` service
// the client half reaches over the remote gateway — in process, so there is one
// source of truth and one set of validation rules. Who may write is decided in
// `lib/tool-permission.js`, not here.
//
// Two rules shape the surface. Every window is bounded, because a weekly series
// with no end expands up to whatever bound it is given, and a caller that leaves
// both bounds out would ask for four thousand years of dates. And every write
// takes the fields it changes rather than a whole record, because a record that
// has to be supplied in full is a record a model can quietly lose fields from.
import { randomUUID } from 'node:crypto'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { decideCalendarPermission } from './tool-permission.js'

export const name = 'dsh-calendar-tools'
export const inject = ['tools', 'calendar', 'permissionPresets']

/** Slack used when a caller leaves a bound out, as the panel's own agenda does. */
const PAST_DAYS = 180
const FUTURE_DAYS = 366
/** Widest window one call may ask for; a series is expanded inside it. */
const MAX_WINDOW_DAYS = 3660

const pad2 = value => String(value).padStart(2, '0')
/** Local `YYYY-MM-DD` of a date. */
const localDate = (value = new Date()) => `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`

/** Local date moved by whole days. The host half keeps its own copy in `model.js`. */
function shiftDate(date, days) {
  const [year, month, day] = date.split('-').map(Number)
  return localDate(new Date(year, month - 1, day + days))
}

const daysBetween = (from, to) =>
  Math.round((Date.parse(`${to}T00:00`) - Date.parse(`${from}T00:00`)) / 86_400_000)

const dateOf = value => value.slice(0, 10)
/** Clock part of a local time value, empty for a whole-day one. */
const clockOf = value => (value.length > 10 ? value.slice(11, 16) : '')
const clockMinutes = clock => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5))
const clockAt = minutes => `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`

/** Drop the fields a call left out, so a patch carries only what it changes. */
function withoutEmpty(input) {
  const output = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === '') continue
    output[key] = value
  }
  return output
}

/**
 * The window one call reads.
 *
 * Both bounds are inclusive local dates, and one is derived when only the other
 * was given, so `from` alone still means a bounded question.
 * @param args - Tool arguments.
 * @returns `{ from, to }`.
 */
function resolveRange(args) {
  const today = localDate()
  const from = args.from ?? shiftDate(today, -PAST_DAYS)
  const to = args.to ?? shiftDate(args.from ? from : today, FUTURE_DAYS)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new Error('from and to are local dates written as YYYY-MM-DD')
  }
  if (to < from) throw new Error(`to (${to}) is earlier than from (${from})`)
  if (daysBetween(from, to) > MAX_WINDOW_DAYS) {
    throw new Error(`that window is wider than ${MAX_WINDOW_DAYS} days; ask for a narrower one`)
  }
  return { from, to }
}

/** The fields of one stored record that a caller reads back. */
function recordFields(event) {
  return withoutEmpty({
    uid: event.uid,
    title: event.title,
    start: event.start,
    end: event.end,
    location: event.location,
    source: event.source,
    until: event.recurrence?.until,
    repeats: Boolean(event.recurrence),
  })
}

/** One line describing one occurrence, as both the model and the reader see it. */
function lineOf(entry) {
  const clock = clockOf(entry.start)
  const end = entry.end ? clockOf(entry.end) : ''
  const when = clock === ''
    ? entry.end && dateOf(entry.end) > dateOf(entry.start)
      ? `${entry.date} – ${dateOf(entry.end)} 全天`
      : `${entry.date} 全天`
    : end === ''
      ? `${entry.date} ${clock}`
      : `${entry.date} ${clock}–${end}`
  return [
    when,
    entry.title,
    entry.location ? `· ${entry.location}` : '',
    entry.repeats ? '· 每周重复' : '',
    `[uid ${entry.uid}]`,
  ].filter(Boolean).join(' ')
}

/** The text one write answers with, built from the record it stored. */
function recordLine(prefix, event) {
  const clock = clockOf(event.start)
  const end = event.end ? clockOf(event.end) : ''
  const when = clock === ''
    ? (event.end ? `${dateOf(event.start)} – ${dateOf(event.end)} 全天` : `${dateOf(event.start)} 全天`)
    : end === ''
      ? `${dateOf(event.start)} ${clock}`
      : `${dateOf(event.start)} ${clock}–${end}`
  return `${prefix} ${when} ${event.title}${event.location ? ` · ${event.location}` : ''}${event.recurrence ? ' · 每周重复' : ''} [uid ${event.uid}]`
}

/**
 * The end an entry keeps when its start moved without a new end.
 *
 * The duration is what a reader means by "move it to five", so it is carried
 * over: the same number of minutes for a timed entry, the same span in days for a
 * whole-day one. An entry that carried no end, or whose old end cannot be read as
 * a clock, keeps none.
 * @param existing - The stored record.
 * @param start - The new start.
 * @returns The new end, or `undefined`.
 */
function movedEnd(existing, start) {
  if (!existing.end) return undefined
  if (clockOf(start) === '' || clockOf(existing.start) === '') {
    if (clockOf(start) !== '' || clockOf(existing.start) === '') return undefined
    if (clockOf(existing.end) !== '') return undefined
    return shiftDate(dateOf(existing.end), daysBetween(dateOf(existing.start), dateOf(start)))
  }
  if (clockOf(existing.end) === '') return undefined
  const duration = clockMinutes(clockOf(existing.end)) - clockMinutes(clockOf(existing.start))
  if (duration <= 0) return undefined
  return `${dateOf(start)}T${clockAt(Math.min(23 * 60 + 59, clockMinutes(clockOf(start)) + duration))}`
}

/**
 * The record one update describes, on top of the record it changes.
 *
 * Only what the call carries moves: a field left out keeps its stored value and an
 * empty string clears one. Turning the repeat off drops the dates that were
 * cancelled or moved while it was a series, exactly as the panel does, because a
 * single entry owns no series bookkeeping.
 * @param existing - The stored record.
 * @param args - Tool arguments.
 * @returns The record to store.
 */
function updatedRecord(existing, args) {
  const record = { ...existing }
  const moves = args.start !== undefined
  if (moves) record.start = args.start
  if (args.end !== undefined) record.end = args.end === '' ? undefined : args.end
  else if (moves) record.end = movedEnd(existing, args.start)
  if (args.title !== undefined) record.title = args.title
  if (args.location !== undefined) record.location = args.location === '' ? undefined : args.location
  if (args.description !== undefined) record.description = args.description === '' ? undefined : args.description
  if (args.repeat === 'none') {
    record.recurrence = undefined
    record.exceptions = undefined
    record.overrides = undefined
  } else if (args.repeat === 'weekly' || (args.until !== undefined && existing.recurrence)) {
    record.recurrence = withoutEmpty({ ...(existing.recurrence ?? {}), freq: 'weekly', until: args.until })
  }
  return record
}

const occurrenceSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    uid: { type: 'string', required: true, description: 'Identity of the stored record, for a later write.' },
    date: { type: 'string', required: true, description: 'The date this occurrence falls on.' },
    title: { type: 'string', required: true },
    start: { type: 'string', required: true, description: 'Local start, `YYYY-MM-DDTHH:mm` or `YYYY-MM-DD`.' },
    end: { type: 'string' },
    location: { type: 'string' },
    source: { type: 'string' },
    repeats: { type: 'boolean', required: true },
  },
}

const recordSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    uid: { type: 'string', required: true },
    title: { type: 'string', required: true },
    start: { type: 'string', required: true },
    end: { type: 'string' },
    location: { type: 'string' },
    source: { type: 'string' },
    until: { type: 'string' },
    repeats: { type: 'boolean', required: true },
  },
}

const timeParameter = description => ({
  type: 'string',
  description: `${description} A local wall-clock time written as YYYY-MM-DDTHH:mm, or YYYY-MM-DD for a whole-day value.`,
})

/**
 * Register the calendar tools.
 * @param ctx - Plugin context.
 */
export function apply(ctx) {
  ctx.on('tools/pre-execute', (exec, next) => decideCalendarPermission(ctx, exec, next))

  ctx.tools.register(defineTool({
    name: 'calendar_list_events',
    description: 'Read this machine\'s local calendar over a range of dates, as the weekly panel shows it: one entry per date a repeating entry produces, with cancelled dates left out and moved dates applied. Times are local wall-clock times and carry no time zone. An entry only appears here if it overlaps the window, so widen the window rather than assuming a series has ended.',
    parameters: {
      from: { type: 'string', description: 'First local date to include, `YYYY-MM-DD`. Defaults to 180 days before today.' },
      to: { type: 'string', description: 'Last local date to include, `YYYY-MM-DD`. Defaults to a year after `from`.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          from: { type: 'string', required: true },
          to: { type: 'string', required: true },
          count: { type: 'integer', required: true },
          events: { type: 'array', required: true, items: occurrenceSchema },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.count === 0
          ? `${value.from} – ${value.to}：这段日期没有日程。`
          : `${value.from} – ${value.to}，共 ${value.count} 条：\n${value.events.map(lineOf).join('\n')}`,
      }],
    },
    execute(args) {
      const { from, to } = resolveRange(args)
      const occurrences = ctx.calendar.occurrences({ from, to }).occurrences
      return {
        from,
        to,
        count: occurrences.length,
        events: occurrences.map(occurrence => withoutEmpty({
          uid: occurrence.uid,
          date: occurrence.occurrenceDate,
          title: occurrence.title,
          start: occurrence.start,
          end: occurrence.end,
          location: occurrence.location,
          source: occurrence.source,
          repeats: Boolean(occurrence.recurrence),
        })),
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Calendar · 读日程', kind: 'read', rawInput: `${args.from ?? ''} – ${args.to ?? ''}`.trim() }),
  }))

  ctx.tools.register(defineTool({
    name: 'calendar_create_event',
    description: 'Create one entry in this machine\'s local calendar. Times are local wall-clock times without a time zone. `repeat: "weekly"` repeats on the weekday of `start`, and `until` is the last date it happens. The entry is written immediately, so ask the user before creating something they did not ask for.',
    parameters: {
      title: { type: 'string', required: true, description: 'What the entry is called, for example 组会.' },
      start: { ...timeParameter('When it begins.'), required: true },
      end: timeParameter('When it ends. Defaults to the start time with no end, which the panel shows as a short block.'),
      location: { type: 'string', description: 'Where it happens.' },
      description: { type: 'string', description: 'A note kept with the entry.' },
      repeat: { type: 'string', enum: ['none', 'weekly'], description: 'Set to weekly to repeat every week.' },
      until: { type: 'string', description: 'Last date of the repetition, `YYYY-MM-DD`. Only with `repeat: "weekly"`.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { event: { ...recordSchema, required: true } } },
      render: (_args, value) => [{ type: 'text', text: recordLine('已新建：', value.event) }],
    },
    async execute(args) {
      const record = withoutEmpty({
        uid: randomUUID(),
        title: args.title,
        start: args.start,
        end: args.end,
        location: args.location,
        description: args.description,
        recurrence: args.repeat === 'weekly' ? withoutEmpty({ freq: 'weekly', until: args.until }) : undefined,
      })
      return { event: recordFields(await ctx.calendar.putEvent(record)) }
    },
    presentCall: args => ({ card: 'generic', title: `Calendar · 新建 ${args.title}`, kind: 'write', rawInput: `${args.start ?? ''} ${args.title ?? ''}`.trim() }),
  }))

  ctx.tools.register(defineTool({
    name: 'calendar_update_event',
    description: 'Change one stored entry of this machine\'s local calendar, identified by the `uid` a read returned. Only the fields the call carries change; an empty string clears `location` or `description`. A moved start keeps the entry\'s duration unless `end` is given. This changes the whole entry, including every date of a repeating one: use `calendar_occurrence` to change a single date.',
    parameters: {
      uid: { type: 'string', required: true, description: 'Identity of the stored entry, as returned by a read.' },
      title: { type: 'string' },
      start: timeParameter('New start.'),
      end: timeParameter('New end.'),
      location: { type: 'string', description: 'New place; an empty string removes it.' },
      description: { type: 'string', description: 'New note; an empty string removes it.' },
      repeat: { type: 'string', enum: ['none', 'weekly'], description: 'Set to weekly to repeat every week, none to make it a single entry.' },
      until: { type: 'string', description: 'Last date of the repetition, `YYYY-MM-DD`.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { event: { ...recordSchema, required: true } } },
      render: (_args, value) => [{ type: 'text', text: recordLine('已更新：', value.event) }],
    },
    async execute(args) {
      const existing = ctx.calendar.getEvent(args.uid)
      if (!existing) throw new Error(`没有 uid 为 ${args.uid} 的日程`)
      return { event: recordFields(await ctx.calendar.putEvent(updatedRecord(existing, args))) }
    },
    presentCall: args => ({ card: 'generic', title: 'Calendar · 改日程', kind: 'write', rawInput: args.uid }),
  }))

  ctx.tools.register(defineTool({
    name: 'calendar_delete_event',
    description: 'Delete one stored entry of this machine\'s local calendar, including every date of a repeating one. Use `calendar_occurrence` with action `cancel` to drop a single date instead. Deleting what is not there reports `removed: false` rather than failing.',
    parameters: {
      uid: { type: 'string', required: true, description: 'Identity of the stored entry, as returned by a read.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { uid: { type: 'string', required: true }, removed: { type: 'boolean', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: value.removed ? `已删除 ${value.uid}` : `没有 uid 为 ${value.uid} 的日程，未做改动` }],
    },
    async execute(args) {
      const { removed } = await ctx.calendar.deleteEvent({ uid: args.uid })
      return { uid: args.uid, removed }
    },
    presentCall: args => ({ card: 'generic', title: 'Calendar · 删除日程', kind: 'write', rawInput: args.uid }),
  }))

  ctx.tools.register(defineTool({
    name: 'calendar_occurrence',
    description: 'Change one date a repeating entry produces, leaving the rest of the series alone — the `RECURRENCE-ID` case. `move` changes that date only, `reset` makes it follow the series again, `cancel` drops it, and `restore` brings a cancelled date back. A single, non-repeating entry has no dates to act on: update or delete it instead.',
    parameters: {
      uid: { type: 'string', required: true, description: 'Identity of the repeating entry, as returned by a read.' },
      date: { type: 'string', required: true, description: 'The date the series produces, `YYYY-MM-DD`.' },
      action: { type: 'string', required: true, enum: ['move', 'reset', 'cancel', 'restore'] },
      start: timeParameter('New start for this date, for action `move`.'),
      end: timeParameter('New end for this date, for action `move`.'),
      title: { type: 'string', description: 'New title for this date, for action `move`.' },
      location: { type: 'string', description: 'New place for this date, for action `move`.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { event: { ...recordSchema, required: true } } },
      render: (args, value) => [{
        type: 'text',
        text: recordLine(`已${args.action === 'move' ? '改期' : args.action === 'reset' ? '恢复为每周' : args.action === 'cancel' ? '取消这一次' : '恢复这一次'}：`, value.event),
      }],
    },
    async execute(args) {
      const patch = withoutEmpty({ start: args.start, end: args.end, title: args.title, location: args.location })
      const input = { uid: args.uid, date: args.date, patch }
      if (args.action === 'move') {
        if (Object.keys(patch).length === 0) throw new Error('move 需要至少给出 start、end、title 或 location 之一')
        return { event: recordFields(await ctx.calendar.applyOverride(input)) }
      }
      if (args.action === 'reset') return { event: recordFields(await ctx.calendar.removeOverride(input)) }
      if (args.action === 'cancel') return { event: recordFields(await ctx.calendar.cancelOccurrence(input)) }
      return { event: recordFields(await ctx.calendar.restoreOccurrence(input)) }
    },
    presentCall: args => ({ card: 'generic', title: `Calendar · ${args.action} 单次`, kind: 'write', rawInput: `${args.date ?? ''} ${args.uid ?? ''}`.trim() }),
  }))
}
