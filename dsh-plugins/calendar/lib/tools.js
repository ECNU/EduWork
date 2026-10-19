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
import { occurrencesOf, PersonalPatchSchema, PersonalViewSchema } from './model.js'
import { z } from 'zod'
import { sourceEvent, applySourceOutcome } from './typert-schemas.js'

// Project the shared model into the Runtime tool-author subset. These unions
// have disjoint strict-object branches. Date/range refinements stay enforced by
// the service, because the tool schema subset cannot express those constraints.
function personalToolSchema(node) {
  if (node.anyOf) return { oneOf: node.anyOf.map(personalToolSchema) }
  const result = { type: node.type }
  for (const key of ['enum', 'const', 'description']) if (node[key] !== undefined) result[key] = node[key]
  if (node.type === 'object') {
    result.additionalProperties = false
    result.properties = Object.fromEntries(Object.entries(node.properties ?? {}).map(([key, value]) => [key, {
      ...personalToolSchema(value), ...(node.required?.includes(key) ? { required: true } : {}),
    }]))
  }
  if (node.items) result.items = personalToolSchema(node.items)
  return result
}

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
    description: event.description,
    source: event.source,
    until: event.recurrence?.until,
    repeats: Boolean(event.recurrence),
  })
}

/** One line describing one occurrence, as both the model and the reader see it. */
function lineOf(entry) {
  const actualDate = dateOf(entry.start)
  const clock = clockOf(entry.start)
  const end = entry.end ? clockOf(entry.end) : ''
  const when = clock === ''
    ? entry.end && dateOf(entry.end) > dateOf(entry.start)
      ? `${actualDate} – ${dateOf(entry.end)} 全天`
      : `${actualDate} 全天`
    : end === ''
      ? `${actualDate} ${clock}`
      : `${actualDate} ${clock}–${end}`
  return [
    when,
    entry.title,
    entry.location ? `· ${entry.location}` : '',
    entry.repeats ? '· 重复日程' : '',
    `ref=${JSON.stringify({ source: entry.source ?? MANUAL_SOURCE, uid: entry.uid, originalStart: entry.originalStart ?? entry.start })}`,
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
  return `${prefix} ${when} ${event.title}${event.location ? ` · ${event.location}` : ''}${event.recurrence ? ' · 重复日程' : ''} ref=${JSON.stringify({ source: event.source ?? MANUAL_SOURCE, uid: event.uid })}`
}

/** Model guesses must not create private records that attach to no event. */
function assertPersonalTarget(calendar, ref) {
  const event = calendar.getEvent(ref)
  if (!event) throw new Error('event_not_found: use the exact source and uid from calendar_list_events')
  if (ref.originalStart !== undefined) {
    const day = dateOf(ref.originalStart)
    const valid = event.recurrence
      ? occurrencesOf({ ...event, overrides: undefined, exceptions: undefined }, { from: day, to: day }).some(item => item.originalStart === ref.originalStart)
      : (event.originalStart ?? event.start) === ref.originalStart
    if (!valid) throw new Error('occurrence_not_found: use originalStart from calendar_list_events, not the moved time')
  }
}

const WEEK_CODES = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su']
const repeatParameter = {type:'string',enum:['none','daily','weekly','custom'],description:'none, daily, weekly on the start weekday, or custom selected weekdays.'}
const weekdaysParameter = {type:'array',items:{type:'string',enum:WEEK_CODES},description:'Required with repeat custom. mo, tu, we, th, fr, sa, su.'}
function recurrenceFor(args) {
  if (args.repeat === 'none') return undefined
  if (args.repeat === 'custom' && !args.weekdays?.length) throw new Error('custom repeat needs at least one weekday')
  return withoutEmpty({freq:'weekly',byDay:args.repeat === 'daily'?WEEK_CODES:args.repeat === 'custom'?args.weekdays:undefined,until:args.until})
}

const occurrenceSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    uid: { type: 'string', required: true, description: 'Identity of the stored record, for a later write.' },
    date: { type: 'string', required: true, description: 'Original occurrence date for calendar_occurrence. Actual display date is in start.' },
    title: { type: 'string', required: true },
    start: { type: 'string', required: true, description: 'Local start, `YYYY-MM-DDTHH:mm` or `YYYY-MM-DD`.' },
    end: { type: 'string' },
    location: { type: 'string' },
    source: { type: 'string' },
    originalStart: { type: 'string', description: 'Stable original start to pass to note tools; use this rather than current start.' },
    description: { type: 'string' },
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
    description: { type: 'string' },
    until: { type: 'string' },
    repeats: { type: 'boolean', required: true },
  },
}

const timeParameter = description => ({
  type: 'string',
  description: `${description} A local wall-clock time written as YYYY-MM-DDTHH:mm, or YYYY-MM-DD for a whole-day value.`,
})

/**
 * Which layer an entry belongs to.
 *
 * An identifier is only unique within the source that issued it, so two entries
 * can share one `uid` — a school class and the reader's own entry, or two
 * timetables that number their courses independently. A tool that names only the
 * identifier is therefore ambiguous, and resolving it by assuming the local layer
 * reaches the wrong entry rather than failing to find the right one. Every write
 * names its layer; reads report the layer of each entry they return.
 */
const sourceParameter = {
  type: 'string',
  description: 'Which layer the entry belongs to, as a read reported it. Omit for an entry the user created locally.',
}

/** The layer an entry created here belongs to, matching the store's default. */
const MANUAL_SOURCE = 'manual'

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
          description: occurrence.description,
          originalStart: occurrence.originalStart,
          source: occurrence.source,
          repeats: Boolean(occurrence.recurrence),
        })),
      }
    },
    presentCall: args => ({ card: 'generic', title: '日历 · 读日程', kind: 'read', rawInput: `${args.from ?? ''} – ${args.to ?? ''}`.trim() }),
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
      repeat: repeatParameter,
      weekdays: weekdaysParameter,
      until: { type: 'string', description: 'Last date of the repetition, `YYYY-MM-DD`. Only with a repeating entry.' },
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
        recurrence: args.repeat && args.repeat !== 'none' ? recurrenceFor(args) : undefined,
      })
      return { event: recordFields(await ctx.calendar.putEvent(record)) }
    },
    presentCall: args => ({ card: 'generic', title: `日历 · 新建 ${args.title}`, kind: 'write', rawInput: `${args.start ?? ''} ${args.title ?? ''}`.trim() }),
  }))

  ctx.tools.register(defineTool({
    name: 'calendar_update_event',
    description: 'Change one stored entry of this machine\'s local calendar, identified by the `uid` a read returned. Only the fields the call carries change; an empty string clears `location` or `description`. A moved start keeps the entry\'s duration unless `end` is given. This changes the whole entry, including every date of a repeating one: use `calendar_occurrence` to change a single date. Description edits on imported events become private remarks; read them with calendar_read_personal.',
    parameters: {
      uid: { type: 'string', required: true, description: 'Identity of the stored entry, as returned by a read.' },
      source: sourceParameter,
      title: { type: 'string' },
      start: timeParameter('New start.'),
      end: timeParameter('New end.'),
      location: { type: 'string', description: 'New place; an empty string removes it.' },
      description: { type: 'string', description: 'New description. Imported events save this as a private remark, readable with calendar_read_personal. An empty string clears the content.' },
      repeat: repeatParameter,
      weekdays: weekdaysParameter,
      until: { type: 'string', description: 'Last date of the repetition, `YYYY-MM-DD`.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { event: { ...recordSchema, required: true } } },
      render: (_args, value) => [{ type: 'text', text: recordLine('已更新：', value.event) }],
    },
    async execute(args) {
      const patch = {}
      for (const field of ['title', 'start', 'end', 'location', 'description']) {
        if (args[field] !== undefined) patch[field] = args[field] === '' ? null : args[field]
      }
      if (args.repeat !== undefined) patch.recurrence = recurrenceFor(args) ?? null
      else if (args.until !== undefined) patch.until = args.until || null
      return { event: recordFields(await ctx.calendar.updateEvent({ uid: args.uid, source: args.source ?? MANUAL_SOURCE, patch })) }
    },
    presentCall: args => ({ card: 'generic', title: '日历 · 改日程', kind: 'write', rawInput: args.uid }),
  }))

  ctx.tools.register(defineTool({
    name: 'calendar_delete_event',
    description: 'Delete one stored entry of this machine\'s local calendar, including every date of a repeating one. Use `calendar_occurrence` with action `cancel` to drop a single date instead. Deleting what is not there reports `removed: false` rather than failing.',
    parameters: {
      uid: { type: 'string', required: true, description: 'Identity of the stored entry, as returned by a read.' },
      source: sourceParameter,
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
      const { removed } = await ctx.calendar.deleteEvent({ uid: args.uid, source: args.source ?? MANUAL_SOURCE })
      return { uid: args.uid, removed }
    },
    presentCall: args => ({ card: 'generic', title: '日历 · 删除日程', kind: 'write', rawInput: args.uid }),
  }))

  ctx.tools.register(defineTool({
    name: 'calendar_occurrence',
    description: 'Change one date a repeating entry produces, leaving the rest of the series alone — the `RECURRENCE-ID` case. `move` changes that date only, `reset` makes it follow the series again, `cancel` drops it, and `restore` brings a cancelled date back. A single, non-repeating entry has no dates to act on: update or delete it instead.',
    parameters: {
      uid: { type: 'string', required: true, description: 'Identity of the repeating entry, as returned by a read.' },
      source: sourceParameter,
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
      const input = { uid: args.uid, date: args.date, patch, source: args.source ?? MANUAL_SOURCE }
      if (args.action === 'move') {
        if (Object.keys(patch).length === 0) throw new Error('move 需要至少给出 start、end、title 或 location 之一')
        return { event: recordFields(await ctx.calendar.applyOverride(input)) }
      }
      if (args.action === 'reset') return { event: recordFields(await ctx.calendar.removeOverride(input)) }
      if (args.action === 'cancel') return { event: recordFields(await ctx.calendar.cancelOccurrence(input)) }
      return { event: recordFields(await ctx.calendar.restoreOccurrence(input)) }
    },
    presentCall: args => ({ card: 'generic', title: `日历 · ${args.action} 单次`, kind: 'write', rawInput: `${args.date ?? ''} ${args.uid ?? ''}`.trim() }),
  }))

  const noteIdentity = {
    source: {...sourceParameter, required:true},
    uid: {type:'string',required:true,description:'Event uid returned by calendar_list_events.'},
    originalStart: {type:'string',description:'Stable originalStart returned by calendar_list_events. Omit for the whole event; supply it for one occurrence, never use the moved start.'},
  }
  const noteFields = {
    source:{type:'string',required:true},uid:{type:'string',required:true},
    originalStart:{type:'string'},text:{type:'string',required:true},reason:{type:'string'},
  }
  ctx.tools.register(defineTool({
    name:'calendar_notes',
    description:'Read the user’s private calendar notes, separately from the event description that is exported in ICS. Filter by source, uid and originalStart. unlinkedOnly reads preserved notes whose original class can no longer be found.',
    parameters:{source:sourceParameter,uid:{type:'string'},originalStart:{type:'string'},unlinkedOnly:{type:'boolean'}},
    output:{schema:{type:'object',additionalProperties:false,properties:{notes:{type:'array',required:true,items:{type:'object',additionalProperties:false,properties:noteFields}}}},
      render:(_args,value)=>[{type:'text',text:value.notes.length?value.notes.map(n=>`${n.source} / ${n.uid} / ${n.originalStart ?? '整条日程'}：${n.text}`).join('\n'):'没有符合条件的笔记。'}]},
    execute(args) {
      const records=args.unlinkedOnly?ctx.calendar.unlinkedNotes().filter(r=>r.scope==='source'):ctx.calendar.notes({scope:'source'})
      return {notes:records.filter(r=>r.note?.text!==undefined).filter(r=>(args.source===undefined||r.source===args.source)&&(args.uid===undefined||r.uid===args.uid)&&(args.originalStart===undefined||r.originalStart===args.originalStart))
        .map(r=>({source:r.source,uid:r.uid,text:r.note?.text ?? '',...(r.originalStart?{originalStart:r.originalStart}:{}),...(r.reason?{reason:r.reason}:{})}))}
    },
    presentCall:()=>({card:'generic',title:'日历 · 读笔记',kind:'read'}),
  }))
  ctx.tools.register(defineTool({
    name:'calendar_put_note',
    description:'Write or replace a private note using source and uid. Omit originalStart for the whole event; supply the stable originalStart from calendar_list_events for one occurrence. The note follows a reschedule and is never written into school fields or ICS. Empty text clears the note. This writes user data and uses the calendar write permission gate.',
    parameters:{...noteIdentity,text:{type:'string',required:true,description:'Private note text. Empty string clears it.'}},
    output:{schema:{type:'object',additionalProperties:false,properties:{saved:{type:'boolean',required:true}}},render:(_args,v)=>[{type:'text',text:v.saved?'已保存笔记。':'已清空笔记。'}]},
    async execute(args) {
      const {text,...ref}=args
      assertPersonalTarget(ctx.calendar, ref)
      if(text==='') {await ctx.calendar.removeNote({...ref,scope:'source'});return {saved:false}}
      await ctx.calendar.putNote({...ref,scope:'source',text});return {saved:true}
    },
    presentCall:args=>({card:'generic',title:'日历 · 写笔记',kind:'write',rawInput:args.text}),
  }))
  ctx.tools.register(defineTool({
    name:'calendar_remove_note',
    description:'Remove only a private note field. Use source and uid; omit originalStart for the whole event, or supply its stable originalStart for one occurrence. Clearing an occurrence restores its inherited note. This does not delete the event or its exported description.',
    parameters:noteIdentity,
    output:{schema:{type:'object',additionalProperties:false,properties:{removed:{type:'boolean',required:true}}},render:(_args,v)=>[{type:'text',text:v.removed?'已删除笔记。':'这次日程没有笔记。'}]},
    async execute(args) { assertPersonalTarget(ctx.calendar, args); return ctx.calendar.removeNote({...args,scope:'source'}) },
    presentCall:()=>({card:'generic',title:'日历 · 清空笔记',kind:'write'}),
  }))

  const patchSchema = personalToolSchema(z.toJSONSchema(PersonalPatchSchema))
  const viewSchema = personalToolSchema(z.toJSONSchema(PersonalViewSchema.omit({ legacyExtensions: true })))
  const settingsOutput = {
    schema: { type: 'object', additionalProperties: false, properties: { settings: { ...viewSchema, required: true }, legacyExtensions: { type: 'string' } } },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value.settings) }],
  }
  ctx.tools.register(defineTool({
    name: 'calendar_read_personal',
    description: 'Read effective private note, remark, display and reminder settings for an event or occurrence. Omit originalStart for series defaults. Settings inherit per field; off disables that field. These values are local and excluded from ICS.',
    parameters: noteIdentity,
    output: settingsOutput,
    execute: args => {
      const { legacyExtensions, ...settings } = ctx.calendar.personalFor({ ...args, scope: 'source' })
      return { settings, ...(legacyExtensions ? { legacyExtensions: JSON.stringify(legacyExtensions) } : {}) }
    },
    presentCall: () => ({ card: 'generic', title: '日历 · 读个人设置', kind: 'read' }),
  }))
  ctx.tools.register(defineTool({
    name: 'calendar_personal_settings',
    description: 'Change private note, remark, hidden and reminder settings. Omit originalStart for the whole event. patch contains only changed fields; clear names fields to restore inheritance. reminder is relative {kind:relative,minutes}, fixed {kind:fixed,at:local datetime}, or {off:true}. This saves and calculates reminders; actual delivery requires a Host scheduler adapter.',
    parameters: { ...noteIdentity, patch: patchSchema, clear: { type: 'array', items: { type: 'string', enum: ['note', 'remark', 'hidden', 'reminder'] } } },
    output: settingsOutput,
    async execute(args) {
      assertPersonalTarget(ctx.calendar, args)
      await ctx.calendar.setPersonal({ ...args, scope: 'source' })
      const { patch, clear, ...ref } = args
      const { legacyExtensions, ...settings } = ctx.calendar.personalFor({ ...ref, scope: 'source' })
      return { settings, ...(legacyExtensions ? { legacyExtensions: JSON.stringify(legacyExtensions) } : {}) }
    },
    presentCall: () => ({ card: 'generic', title: '日历 · 改个人设置', kind: 'write' }),
  }))

  ctx.tools.register(defineTool({
    name: 'calendar_import_source',
    description: 'Import or update a verified batch with stable event uids. Use a stable user-owned source agent:<name>; replaying the same IDs updates rather than duplicates. mode=merge (default) updates supplied entries and deletes nothing; mode=replace removes absent entries ONLY in this source, including clearing with an empty array. Never replace from failed or incomplete data. Managed sync: sources require explicit Host opt-in. Keep movedFrom when dates change. Private notes and settings are preserved. Increasing revision prevents old versions from overwriting new ones.',
    parameters: {
      source: { type: 'string', required: true, description: 'Stable source, e.g. agent:semester-2026. Never use manual or invent a managed source.' },
      events: { type: 'array', required: true, items: personalToolSchema(z.toJSONSchema(sourceEvent)) },
      mode: { type: 'string', enum: ['merge', 'replace'], description: 'merge updates without deleting absent entries (default); replace is an explicitly requested complete replacement.' },
      revision: { type: 'number', description: 'Positive increasing integer for versioned datasets. Reuse only for the identical batch.' },
    },
    output: { schema: personalToolSchema(z.toJSONSchema(applySourceOutcome)),
      render: (_args, value) => [{ type: 'text', text: `写入 ${value.applied} 项，移除 ${value.removed ?? 0} 项，无法关联 ${value.unattributable.length} 项。` }] },
    execute: ({ mode = 'merge', ...batch }) => ctx.calendar.importSource({ ...batch, ...(mode === 'replace' ? { complete: true } : {}) }),
    presentCall: args => ({ card: 'generic', title: '日历 · 批量更新来源', kind: 'write', rawInput: `${args.source} / ${args.events?.length ?? 0} 项${args.mode === 'replace' ? ' / 完整替换' : ' / 合并'}` }),
  }))

}
