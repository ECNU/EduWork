// Client half of the calendar panel: the week view, one entry's page, and the
// ICS dialogs.
//
// A calendar shows time, not rows: the week is drawn on an hour axis with one
// column per day, and an entry is a block whose top and height come from its
// clock. Two entries at the same hour split their day's width instead of
// stacking, and everything that is not a clock time lives in the all-day row
// above the axis. The arithmetic of that placement is in `src/layout.js`; this
// file scales it to pixels and paints it.
//
// The panel holds events, never courses. A timetable is one data source that an
// institution plugin may feed in, and it arrives as ordinary entries carrying
// that source's stamp: the panel groups and colours by source for exactly that
// reason, and an entry the reader writes by hand is a `manual` one.
//
// The panel is built from the product's own primitives (buttons, dialogs, menu,
// inputs, icons) rather than hand-rolled controls, so it looks like the rest of
// the shell in both light and dark themes and keeps their keyboard behaviour.
// The two generations of this package that the product ships name their icons
// differently: the earlier one carries the drawn size in the name
// (`IconPlusOutline16`), the later one drops it and offers stroke variants with
// the size as a prop (`IconPlusOutlineRegular`). The components below are the
// same in both; each icon is resolved from whichever set is loaded, so the panel
// draws on either runtime instead of importing a name one of them lacks.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Menu, Modal as PrimitiveModal, Switch, Tag, Toast, Tooltip, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import calendarRemote from '../lib/typert.remote-client.js'
import { PersonalSettings, occurrenceNote } from './personal-settings.js'
import { dayWindow, layoutWeek, minutesOf } from './layout.js'
import { MonthGrid, monthRange, monthStart, shiftMonth } from './month-view.js'

/**
 * Resolve one icon from the loaded primitives package.
 * @param names - the names it may be exported under, older generation first.
 * @param size - the size to draw at when the name does not already fix it.
 */
const icon = (names: string[], size: number) => {
  const artwork = names.map(name => (primitives as any)[name]).find(Boolean)
  return artwork ? (props: any = {}) => React.createElement(artwork, { size, ...props }) : () => null
}

const IconAlarmClock = icon(['IconAlarmClockOutline16', 'IconAlarmClockOutlineRegular'], 16)
const IconArchive = icon(['IconArchiveOutline20', 'IconArchiveOutlineRegular'], 20)
const IconCheck = icon(['IconCheckOutline16', 'IconCheckOutlineRegular'], 16)
const IconChevronDown = icon(['IconChevronDownOutline14', 'IconChevronDownOutlineRegular'], 14)
const IconChevronLeft = icon(['IconChevronLeftOutline14', 'IconChevronLeftOutlineRegular'], 14)
const IconChevronRight = icon(['IconChevronRightOutline14', 'IconChevronRightOutlineRegular'], 14)
const IconClock = icon(['IconClockOutline16', 'IconClockOutlineRegular'], 16)
const IconCopy = icon(['IconCopyOutline16', 'IconCopyOutlineRegular'], 16)
const IconDownload = icon(['IconDownloadOutline16', 'IconDownloadOutlineRegular'], 16)
const IconFolderOpen = icon(['IconFolderOpenOutline16', 'IconFolderOpenOutlineRegular'], 16)
const IconPlus = icon(['IconPlusOutline16', 'IconPlusOutlineRegular'], 16)
const IconRefresh = icon(['IconRefreshOutline16', 'IconRefreshOutlineRegular'], 16)
const IconRefreshSmall = icon(['IconRefreshOutline14', 'IconRefreshOutlineRegular'], 14)
const IconTrash = icon(['IconTrashOutline16', 'IconTrashOutlineRegular'], 16)
const IconWarning = icon(['IconWarningOutline16', 'IconWarningOutlineRegular'], 16)

export const inject = ['slots', 'remote']

const PANEL_ID = 'calendar'
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
/** Recurrence weekday codes, for the summary line of a stored series. */
const WEEKDAY_BY_CODE: Record<string, string> = { mo: '周一', tu: '周二', we: '周三', th: '周四', fr: '周五', sa: '周六', su: '周日' }

/**
 * The `uid` of an entry created here. The caller owns it — the host stores the
 * record it is handed — so it has to be one no import would ever produce.
 */
const newUid = () => (globalThis.crypto?.randomUUID
  ? `manual-${globalThis.crypto.randomUUID()}`
  : `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)

/** Row height of one hour on the axis, in pixels; the axis is drawn from this. */
const HOUR_HEIGHT = 48
const PX_PER_MINUTE = HOUR_HEIGHT / 60
/** Width of the hour gutter, in pixels. */
const GUTTER = 54
/**
 * The axis is a whole day, as in the calendars this view follows. A fixed
 * working day left the lower half of a tall window empty; with the whole day on
 * the axis the grid always reaches the bottom, and the view scrolls to where
 * this week's entries are instead of cropping them to office hours.
 */
const DAY_MINUTES = 24 * 60

const PAGE_BACKGROUND = 'var(--dsw-alias-bg-base, #fff)'
const PRIMARY = 'var(--dsw-alias-label-primary, #222)'
const SECONDARY = 'var(--dsw-alias-label-secondary, #666)'
const TERTIARY = 'var(--dsw-alias-label-tertiary, #888)'
const HAIRLINE = '.5px solid var(--dsw-alias-border-l1, #00000014)'
const CARD_BORDER = '1px solid var(--dsw-alias-border-l2, #0000001f)'
const LAYER = 'var(--dsw-alias-bg-layer-2, #f6f6f6)'
const HOVER = 'var(--dsw-alias-interactive-bg-hover, #0000000a)'

/** The shared Modal leaves its size and scrolling to the consuming surface. */
function Modal({ children, className, contentClassName, ...props }: React.ComponentProps<typeof PrimitiveModal>) {
  return React.createElement(PrimitiveModal, {
    ...props,
    className: ['eduwork-calendar-dialog', className].filter(Boolean).join(' '),
    contentClassName: ['eduwork-calendar-dialog-content', contentClassName].filter(Boolean).join(' '),
  }, React.createElement('style', null, `
    .eduwork-calendar-dialog { width: min(640px, 100%); max-height: 100%; }
    .eduwork-calendar-dialog-content { min-height: 0; overflow-y: auto; }
    .eduwork-calendar-dialog > :not(.eduwork-calendar-dialog-content) { flex-shrink: 0; }
  `), children)
}

/** The hues a source is drawn in, as the product's static palette names; the fallbacks are for themes without them. */
const TINTS: Record<string, string> = { blue: '#4d6bfe', amber: '#d99a2b', green: '#2f9e68', deepseek: '#4d6bfe', red: '#d4553f' }
const TINT_FAMILIES = Object.keys(TINTS)

/** Hover feedback for a row or a block, which inline styles cannot express. */
function useHover() {
  const [hovered, setHovered] = useState(false)
  return [hovered, { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) }] as const
}

const pad2 = (value: number) => String(value).padStart(2, '0')
/** Local `YYYY-MM-DD` of a date. */
const localDate = (value = new Date()) => `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`
/** Local midnight of a `YYYY-MM-DD` string. */
function parseDate(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day)
}
const addDays = (date: string, days: number) => {
  const value = parseDate(date)
  value.setDate(value.getDate() + days)
  return localDate(value)
}
/** Monday of the week a date belongs to. */
const startOfWeek = (date: string = localDate()) => addDays(date, -((parseDate(date).getDay() + 6) % 7))
const dateOf = (value: string) => value.slice(0, 10)
/** Clock part of a local time string, empty for a whole-day value. */
const clockOf = (value?: string) => (value && value.length > 10 ? value.slice(11, 16) : '')
const weekdayOf = (date: string) => WEEKDAYS[(parseDate(date).getDay() + 6) % 7]
const dayNumber = (date: string) => parseDate(date).getDate()
const shortDate = (date: string) => `${parseDate(date).getMonth() + 1}月${parseDate(date).getDate()}日`
const monthOf = (date: string) => `${parseDate(date).getFullYear()}年${parseDate(date).getMonth() + 1}月`
const hourLabel = (minutes: number) => `${pad2(Math.floor(minutes / 60))}:00`
/** Minutes from midnight of an `HH:mm` clock string. */
const clockMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5))
/** The `HH:mm` clock string of minutes from midnight. */
const clockAt = (minutes: number) => `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`
const isToday = (date: string) => date === localDate()

/**
 * The clock a new entry is offered: the next whole hour when it is for today,
 * otherwise the start of a working day. A new entry therefore always carries a
 * time, and nothing is written as a whole-day record by accident.
 */
function suggestedStart(date: string) {
  if (date !== localDate()) return 9 * 60
  const now = new Date()
  return Math.min(22 * 60, Math.ceil((now.getHours() * 60 + now.getMinutes()) / 60) * 60)
}

/** The clock range a block shows, from its own times. */
function clockRange(occurrence: any) {
  const start = clockOf(occurrence?.start)
  const end = clockOf(occurrence?.end)
  if (start === '') return '全天'
  return end === '' ? start : `${start}–${end}`
}

/** A stable hue per data source, so one import keeps its colour across views and restarts. */
function tintOf(key?: string) {
  let hash = 0
  const text = key ?? 'event'
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) % 100003
  const family = TINT_FAMILIES[hash % TINT_FAMILIES.length]
  const accent = `var(--dsw-static-${family}-500, ${TINTS[family]})`
  return { accent, background: `color-mix(in srgb, ${accent} 15%, var(--dsw-alias-bg-layer-1, #fff))` }
}

/** Drop undefined and blank entries, so a patch or an edit carries only what it means. */
function withoutEmpty(input: Record<string, unknown>) {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value.trim() === '') continue
    output[key] = value
  }
  return output
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Keep stable source identifiers out of display names, including account hashes. */
const calendarLabel = (source: string, statuses: any[] = []) => source === 'manual' ? '个人日程'
  : statuses.find(item => item.source === source)?.label || (source?.startsWith('sync:') ? '同步日历' : source)

/** Unwrap one remote result: the gateway answers with `{ ok, value }` or `{ ok, error }`. */
async function unwrap(operation: any) {
  const result = await operation
  if (result?.ok === true) return result.value
  throw new Error(result?.error?.message || result?.error?.code || '日历数据不可用')
}

/** The note of a record: a field of its own, written out as `DESCRIPTION`. */
const noteOf = (event: any) => (typeof event?.description === 'string' ? event.description : '')

/**
 * The identity one occurrence's personal content hangs on.
 *
 * `originalStart` is the instant the series produced, so this key survives the
 * school moving the class: the reading is taken from the occurrence before its
 * time is used for anything, and it is what the host indexes annotations by.
 * @param occurrence - a rendered occurrence.
 * @returns a stable key, or `''` when the host did not report an identity.
 */
const occurrenceKeyOf = (occurrence: any) =>
  occurrence?.originalStart ? `${occurrence.source ?? 'manual'}\u0000${occurrence.uid}\u0000${occurrence.originalStart}` : ''

/**
 * The reference the host needs to find or write one occurrence's personal content.
 *
 * The ownership is named explicitly rather than left to be inferred from which
 * table a record turns up in, so a note can never land on the school side by
 * accident.
 * @param occurrence - a rendered occurrence.
 * @returns `{ scope, source, uid, originalStart }`, without empty fields.
 */
function noteRefOf(occurrence: any) {
  const ref: Record<string, unknown> = {
    scope: 'source',
    source: occurrence?.source ?? 'manual',
    uid: occurrence?.uid,
  }
  if (occurrence?.originalStart) ref.originalStart = occurrence.originalStart
  return ref
}

/** One line describing how often a stored series repeats. */
function seriesSummary(event: any) {
  if (!event.recurrence) return '单次'
  if ((event.recurrence.interval ?? 1) === 1 && event.recurrence.byDay?.length === 7) return `每天${event.recurrence.until ? ` · 至 ${shortDate(dateOf(event.recurrence.until))}` : ''}`
  const days = (event.recurrence.byDay ?? []).map((code: string) => WEEKDAY_BY_CODE[code]).filter(Boolean).join('、')
  const interval = event.recurrence.interval
  const every = interval && interval > 1 ? `每 ${interval} 周` : '每周'
  const limit = event.recurrence.count
    ? ` · 共 ${event.recurrence.count} 次`
    : event.recurrence.until
      ? ` · 至 ${shortDate(dateOf(event.recurrence.until))}`
      : ''
  return `${every}${days ? ` ${days}` : ''}${limit}`
}

/** A labelled form row: the label above its control, as in the shell's own settings. */
function Field({ label, children, hint }: any) {
  return React.createElement('label', { style: { display: 'block', marginBottom: 12 } },
    React.createElement('span', { style: { display: 'block', marginBottom: 6, fontSize: 12, color: SECONDARY } }, label),
    children,
    hint ? React.createElement('span', { style: { display: 'block', marginTop: 4, fontSize: 11, color: TERTIARY } }, hint) : undefined)
}


const Muted = ({ children, style }: any) => React.createElement('span', { style: { fontSize: 12, color: SECONDARY, ...style } }, children)

/**
 * The React key of one drawn occurrence.
 *
 * `occurrenceId` is `uid#date`, which is only unique within a source: a personal
 * entry and an imported class can both be numbered `MATH101-01` and both fall on the
 * same date. React matches children by key, so handing it that value alone gives two
 * different records one identity, and from then on the view stops reconciling — a
 * record it no longer holds keeps its place on screen, and a reader who deletes a
 * class watches it stay there. The source is part of the identity because the uid
 * is not.
 * @param occurrence - a rendered occurrence.
 * @returns a key no two sources can share.
 */
const reactKeyOf = (occurrence: any) =>
  `${occurrence?.source ?? ''}\u0000${occurrence?.occurrenceId ?? ''}`

/** Icon-only button with the product's tooltip, used for every row-level action. */
function IconButton({ label, icon, onClick, danger, disabled }: any) {
  return React.createElement(Tooltip, { label, side: 'bottom' },
    React.createElement(Button, {
      variant: 'ghost', size: 'sm', icon, onClick, disabled,
      'aria-label': label,
      style: danger ? { color: 'var(--dsw-alias-state-error-primary, #d4553f)' } : undefined,
    }))
}

/**
 * One entry on the axis.
 *
 * The block is a button so a keyboard reaches it, and its width is the lane the
 * layout gave it: `100 / lanes` percent, inset by a hairline so neighbours stay
 * apart.
 */
function Block({ entry, axisStart, tint, note, onSelect }: any) {
  const [hovered, hover] = useHover()
  const width = 100 / entry.lanes
  const height = entry.height * PX_PER_MINUTE
  const inner = height - 8
  const label = `${clockRange(entry.occurrence)} ${entry.occurrence.title}${entry.occurrence.location ? ` · ${entry.occurrence.location}` : ''}`
  // A block shows what fits: the clock and the title always, the place when
  // there is room for a third line.
  const line = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
  return React.createElement('button', {
    type: 'button',
    title: label,
    'aria-label': label,
    // Names the occurrence the block stands for, so a test acts on the same
    // identity the note is stored under rather than on a button's position.
    'data-occurrence': occurrenceKeyOf(entry.occurrence),
    onClick: () => onSelect(entry.occurrence),
    ...hover,
    style: {
      position: 'absolute', top: (entry.top - axisStart) * PX_PER_MINUTE, height,
      left: `calc(${entry.lane * width}% + 2px)`, width: `calc(${width}% - 4px)`,
      display: 'block', overflow: 'hidden', textAlign: 'left', cursor: 'pointer',
      padding: '3px 6px', border: 'none', borderLeft: `3px solid ${tint.accent}`, borderRadius: 6,
      background: tint.background, color: PRIMARY, fontFamily: 'inherit',
      boxShadow: hovered ? 'var(--dsw-elevation-panel, 0 6px 18px rgba(0, 0, 0, .16))' : 'none',
      transition: 'box-shadow .12s ease', zIndex: hovered ? 2 : 1,
    },
  },
  React.createElement('div', { style: { ...line, fontSize: 11, lineHeight: '15px', color: SECONDARY, fontVariantNumeric: 'tabular-nums' } }, clockRange(entry.occurrence)),
  React.createElement('div', {
    style: { ...line, marginTop: 1, fontSize: 12, lineHeight: '17px', fontWeight: 600 },
  }, entry.occurrence.title),
  inner >= 34 && entry.occurrence.location
    ? React.createElement('div', { style: { ...line, fontSize: 11, lineHeight: '15px', color: SECONDARY } }, entry.occurrence.location)
    : undefined,
  // The reader's own note, when the block has room for it. A note that is only
  // visible after opening the class is a note the reader has to remember writing.
  inner >= 50 && note
    ? React.createElement('div', { style: { ...line, fontSize: 11, lineHeight: '15px', color: PRIMARY, opacity: .75 } }, `笔记：${note}`)
    : undefined)
}

/**
 * The week: a day header row and the hour axis below it. The axis is one scroll
 * container so the day columns can never drift apart vertically. A record that
 * arrives without a clock is drawn as a block at midnight, not in a row of its
 * own, so the week has a single geometry.
 *
 * Dragging on an empty spot starts an entry spanning what was dragged, and a
 * double click starts a one-hour one there: between them the view is writable
 * rather than only readable.
 */
function WeekGrid({ anchor, occurrences, noteIndex, onSelect, onCreate }: any) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = addDays(anchor, index)
    return { key: date, label: WEEKDAYS[index], day: dayNumber(date), today: isToday(date) }
  }), [anchor])
  // The whole day is drawn; the entries of the week decide what the view opens on.
  const focus = useMemo(() => dayWindow(occurrences).start, [occurrences])
  const scroller = useRef<HTMLDivElement | null>(null)
  const scrolledTo = useRef('')
  useEffect(() => {
    const node = scroller.current
    const key = `${anchor}:${focus}`
    if (!node || scrolledTo.current === key) return
    scrolledTo.current = key
    node.scrollTop = Math.max(0, focus * PX_PER_MINUTE - 8)
  }, [anchor, focus])
  const axis = useMemo(() => ({ start: 0, end: DAY_MINUTES }), [])
  const hours = useMemo(() => {
    const list: number[] = []
    for (let minutes = axis.start; minutes < axis.end; minutes += 60) list.push(minutes)
    return list
  }, [axis])
  const axisHeight = (axis.end - axis.start) * PX_PER_MINUTE
  // A pointer gesture on empty space: `press` is what has been started, `dragging`
  // what is drawn while it runs. The column captures the pointer, so the gesture
  // keeps tracking after the cursor leaves it.
  const [dragging, setDragging] = useState<{ day: string; from: number; to: number } | null>(null)
  const press = useRef<{ day: string; from: number; pointerId: number; moved: boolean } | null>(null)
  /** The fifteen-minute slot under a pointer inside one column. */
  const slotAt = (event: any) => {
    const box = event.currentTarget.getBoundingClientRect()
    const raw = axis.start + (event.clientY - box.top) / PX_PER_MINUTE
    return Math.max(0, Math.min(DAY_MINUTES - 15, Math.round(raw / 15) * 15))
  }
  const timed = useMemo(() => (occurrences ?? []).filter((occurrence: any) => clockOf(occurrence.start) !== ''), [occurrences])
  const byDay = useMemo(() => layoutWeek(timed), [timed])
  /**
   * Whole-day occurrences, listed under every day of this week they cover.
   *
   * A value that arrived without a clock (`DTSTART;VALUE=DATE`, which is what a
   * holiday or an academic calendar is made of) has no slot on the axis, so it is
   * shown in the day header: visible whatever the axis is scrolled to, and not
   * claiming a time it does not have. A record that covers several days is shown
   * on each of them, the way a calendar draws a multi-day bar.
   *
   * What a block says about its date is worked out here, per day, and not where it
   * is drawn: the day it sits under is the one fact the drawing does not add, and
   * two blocks of one multi-day record with the same label would be one thing said
   * twice — indistinguishable to a screen reader and to anyone reading the page.
   */
  const allDayByDay = useMemo(() => {
    const first = anchor
    const last = addDays(anchor, 6)
    const map = new Map<string, any[]>()
    for (const occurrence of occurrences ?? []) {
      if (clockOf(occurrence.start) !== '') continue
      const start = dateOf(occurrence.start)
      const spanned = occurrence.end && clockOf(occurrence.end) === '' && dateOf(occurrence.end) > start
        ? dateOf(occurrence.end)
        : start
      const from = start < first ? first : start
      const to = spanned > last ? last : spanned
      const covers = spanned > start
      // What one of those blocks says: on the first day it covers it speaks for the
      // whole record, and on each later day it names the day it is actually on.
      const spokenOn = (date: string) => (covers
        ? (date > start ? shortDate(date) : `${shortDate(start)}–${shortDate(spanned)}`)
        : shortDate(start))
      for (let date = from; date <= to; date = addDays(date, 1)) {
        const chip = { occurrence, label: `全天 · ${spokenOn(date)} ${occurrence.title}` }
        const list = map.get(date)
        if (list) list.push(chip)
        else map.set(date, [chip])
      }
    }
    return map
  }, [occurrences, anchor])

  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const nowVisible = days.some(day => day.today)

  // The pieces are built apart and assembled at the end: the nesting of one
  // expression per row was unreadable, and a misread parenthesis there is a
  // silent layout bug rather than a syntax error.
  /** The whole-day entries of one day, as the chips its header shows. */
  const allDayChips = (date: string) => {
    const list = allDayByDay.get(date) ?? []
    if (list.length === 0) return undefined
    return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 } },
      ...list.slice(0, 2).map(({ occurrence, label }: any) => {
        const tint = tintOf(occurrence.source ?? occurrence.uid)
        return React.createElement('button', {
          key: reactKeyOf(occurrence),
          type: 'button',
          title: label,
          'aria-label': label,
          onClick: () => onSelect(occurrence),
          style: {
            display: 'block', width: '100%', padding: '1px 4px', border: 'none', borderRadius: 4, cursor: 'pointer',
            textAlign: 'left', fontSize: 10, lineHeight: '15px', fontFamily: 'inherit', color: PRIMARY,
            background: tint.background, borderLeft: `3px solid ${tint.accent}`,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          },
        }, occurrence.title)
      }),
      list.length > 2
        ? React.createElement('div', { style: { fontSize: 10, lineHeight: '14px', color: SECONDARY, textAlign: 'left' } }, `还有 ${list.length - 2} 条全天`)
        : undefined)
  }

  const headerRow = React.createElement('div', {
    style: { display: 'flex', borderBottom: CARD_BORDER, background: PAGE_BACKGROUND, paddingRight: 8 },
  },
  React.createElement('div', { style: { width: GUTTER, flex: '0 0 auto' } }),
  ...days.map(day => React.createElement('div', {
    key: day.key,
    style: { flex: '1 1 0', minWidth: 0, padding: '8px 4px', textAlign: 'center', borderLeft: HAIRLINE },
  },
  React.createElement('div', { style: { fontSize: 11, color: day.today ? PRIMARY : SECONDARY } }, day.label),
  React.createElement('div', {
    style: day.today
      ? {
        width: 26, height: 26, margin: '2px auto 0', borderRadius: 999, lineHeight: '26px',
        fontSize: 13, fontWeight: 650, background: 'var(--dsw-alias-state-business-primary, #4d6bfe)', color: '#fff',
      }
      : { marginTop: 2, fontSize: 13, fontWeight: 600, lineHeight: '26px', color: PRIMARY },
  }, day.day),
  allDayChips(day.key))))

  const hourLabels = hours.map((minutes, index) => React.createElement('div', {
    key: minutes,
    style: {
      // The label sits on its line, half above and half below; the first line is
      // the top edge of the axis, so it moves inside instead of being cut off.
      position: 'absolute', top: index === 0 ? 2 : (minutes - axis.start) * PX_PER_MINUTE - 6, right: 8,
      fontSize: 11, color: TERTIARY, fontVariantNumeric: 'tabular-nums',
    },
  }, hourLabel(minutes)))

  // One column per day: its hour lines, then its blocks, then today's "now" line.
  const columns = days.map(day => React.createElement('div', {
    key: day.key,
    // Empty space in the column is a time on that day. A drag across it asks for
    // an entry spanning what was dragged; a double click asks for a one-hour one,
    // because a single click would fire while the reader is only looking. A press
    // that lands on a block belongs to that block, so the gesture starts only when
    // the column itself is the target — and the decorative lines below take no
    // pointer events, so they never become one.
    onPointerDown: (event: any) => {
      if (!onCreate || event.target !== event.currentTarget) return
      // Touch keeps its own scrolling: a finger dragged down the axis must pan it.
      if (event.pointerType === 'touch' || event.button !== 0) return
      const from = slotAt(event)
      press.current = { day: day.key, from, pointerId: event.pointerId, moved: false }
      event.currentTarget.setPointerCapture(event.pointerId)
      setDragging({ day: day.key, from, to: from })
      event.preventDefault()
    },
    onPointerMove: (event: any) => {
      const active = press.current
      if (!active || active.pointerId !== event.pointerId) return
      const to = slotAt(event)
      if (!active.moved && Math.abs(to - active.from) < 15) return
      active.moved = true
      setDragging({ day: active.day, from: Math.min(active.from, to), to: Math.max(active.from, to) })
    },
    onPointerUp: (event: any) => {
      const active = press.current
      if (!active || active.pointerId !== event.pointerId) return
      press.current = null
      setDragging(null)
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      if (!active.moved) return
      const to = slotAt(event)
      if (Math.abs(to - active.from) < 15) return
      onCreate(day.key, Math.min(active.from, to), Math.max(active.from, to))
    },
    onPointerCancel: (event: any) => {
      if (press.current?.pointerId !== event.pointerId) return
      press.current = null
      setDragging(null)
    },
    onDoubleClick: (event: any) => {
      if (!onCreate || event.target !== event.currentTarget) return
      const from = slotAt(event)
      onCreate(day.key, from, Math.min(from + 60, 24 * 60 - 1))
    },
    style: {
      position: 'relative', flex: '1 1 0', minWidth: 0, borderLeft: HAIRLINE,
      background: day.today ? 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #4d6bfe) 4%, transparent)' : undefined,
    },
  },
  ...hours.map(minutes => React.createElement('div', {
    key: minutes,
    style: {
      position: 'absolute', left: 0, right: 0, top: (minutes - axis.start) * PX_PER_MINUTE,
      height: 1, background: 'var(--dsw-alias-border-l1, #00000010)', pointerEvents: 'none',
    },
  })),
  dragging?.day === day.key
    ? React.createElement('div', {
      key: 'drag-preview',
      'aria-hidden': true,
      style: {
        position: 'absolute', left: 2, right: 2,
        top: dragging.from * PX_PER_MINUTE,
        height: Math.max(22, dragging.to - dragging.from) * PX_PER_MINUTE,
        borderRadius: 6, pointerEvents: 'none', zIndex: 2,
        border: '1px dashed var(--dsw-alias-state-business-primary, #4d6bfe)',
        background: 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #4d6bfe) 14%, transparent)',
      },
    },
    dragging.to > dragging.from
      ? React.createElement('div', {
        style: { padding: '2px 6px', fontSize: 11, color: PRIMARY, fontVariantNumeric: 'tabular-nums' },
      }, `${clockAt(dragging.from)}–${clockAt(dragging.to)}`)
      : undefined)
    : undefined,
  ...(byDay.get(day.key) ?? []).map(entry => React.createElement(Block, {
    key: reactKeyOf(entry.occurrence),
    entry,
    axisStart: axis.start,
    tint: tintOf(entry.occurrence.source ?? entry.occurrence.uid),
    note: occurrenceNote(noteIndex, entry.occurrence),
    onSelect,
  }))))

  const nowLine = nowVisible ? React.createElement('div', {
    'aria-hidden': true,
    style: {
      position: 'absolute', left: 0, right: 0, top: (nowMinutes - axis.start) * PX_PER_MINUTE,
      height: 2, background: 'var(--dsw-alias-state-error-primary, #d4553f)', zIndex: 3, pointerEvents: 'none',
    },
  }) : undefined

  const axisRow = React.createElement('div', {
    // A whole day is taller than most panels; `minHeight` keeps the day columns
    // and their rules running to the bottom edge of a very tall one.
    style: { display: 'flex', height: axisHeight + 12, minHeight: '100%', paddingRight: 8 },
  },
  React.createElement('div', { style: { position: 'relative', width: GUTTER, flex: '0 0 auto' } }, ...hourLabels),
  React.createElement('div', { style: { position: 'relative', flex: '1 1 0', display: 'flex' } }, ...columns, nowLine))

  return React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 },
  },
  headerRow,
  React.createElement('div', {
    ref: scroller,
    style: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden' },
  }, axisRow))
}

/** The details of one occurrence, and every change the panel can make to it. */
function EventDialog({ occurrence, event, note, service, onClose, run, onEdit, sourceName }: any) {
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [form, setForm] = useState({
    start: occurrence?.start ?? '',
    end: occurrence?.end ?? '',
    location: occurrence?.location ?? '',
  })
  // The reader's own note about this one class, kept apart from anything the
  // school provided. It is edited on its own and saved on its own, so writing a
  // note can never rewrite a school record and a school sync cannot touch it.
  const [noteDraft, setNoteDraft] = useState<string>(note ?? '')
  const [writingNote, setWritingNote] = useState(false)
  const [savingNote, setSavingNote] = useState(false)
  const [showPersonal, setShowPersonal] = useState(false)
  useEffect(() => {
    setEditing(false)
    setConfirming(false)
    setNoteDraft(note ?? '')
    setWritingNote(false)
    setForm({ start: occurrence?.start ?? '', end: occurrence?.end ?? '', location: occurrence?.location ?? '' })
  }, [occurrenceKeyOf(occurrence)])
  useEffect(() => { if (!writingNote) setNoteDraft(note ?? '') }, [note, writingNote])
  useEffect(() => { if (!editing) setForm({ start: occurrence?.start ?? '', end: occurrence?.end ?? '', location: occurrence?.location ?? '' }) }, [occurrence?.start, occurrence?.end, occurrence?.location, editing])

  if (!occurrence) return null
  const date = occurrence.occurrenceDate ?? dateOf(occurrence.start)
  const series = Boolean(event?.recurrence)
  // A whole-day entry has no clock to move, so its dialog points at the page that
  // owns the date and the place instead of offering two blank time fields.
  const wholeDay = clockOf(occurrence.start) === ''
  const changed = form.start !== (occurrence.start ?? '') || form.end !== (occurrence.end ?? '') || form.location !== (occurrence.location ?? '')
  const patch = withoutEmpty({
    start: form.start !== occurrence.start ? form.start : undefined,
    end: form.end !== (occurrence.end ?? '') ? form.end : undefined,
    location: form.location !== (occurrence.location ?? '') ? form.location : undefined,
  })

  /**
   * A series keeps one record per rule and marks the exceptions, so a change to
   * a single occurrence of one is an override. A one-off entry has no series to
   * keep in step: an override there would be a `RECURRENCE-ID` on a `VEVENT`
   * without `RRULE`, which RFC 5545 does not allow, so the record itself is what
   * gets edited.
   */
  const save = () => (series
    ? service.applyOverride({ uid: occurrence.uid, date, patch, source: occurrence.source })
    : service.updateEvent({ uid: occurrence.uid, source: occurrence.source, patch: {
      ...(form.start !== occurrence.start ? { start: form.start } : {}),
      ...(form.end !== (occurrence.end ?? '') ? { end: form.end || null } : {}),
      ...(form.location !== (occurrence.location ?? '') ? { location: form.location || null } : {}),
    } }))

  const actions = []
  if (!editing) {
    actions.push(React.createElement(Button, {
      key: 'when', variant: 'outline', size: 'sm',
      onClick: () => (wholeDay && event ? onEdit(event.uid, event.source) : setEditing(true)),
    }, wholeDay ? '改日期或地点' : series ? '改期或改地点' : '改时间或地点'))
  }
  actions.push(React.createElement(Button, {
    key: 'note', variant: 'outline', size: 'sm',
    onClick: () => setWritingNote(!writingNote),
  }, note ? '改笔记' : '写笔记'))
  actions.push(React.createElement(Button, {
    key: 'personal', variant: 'outline', size: 'sm', onClick: () => setShowPersonal(!showPersonal),
  }, showPersonal ? '收起个人设置' : '更多个人设置'))
  // The dialog speaks for one occurrence; the title, the date and the repeat
  // rule belong to the record, and the record has a page of its own.
  if (event) {
    actions.push(React.createElement(Button, {
      key: 'record', variant: 'ghost', size: 'sm', onClick: () => onEdit(event.uid, event.source),
    }, '编辑日程信息'))
  }
  if (occurrence.overridden) {
    actions.push(React.createElement(Button, {
      key: 'undo', variant: 'ghost', size: 'sm', disabled: false,
      onClick: () => run(() => service.removeOverride({ uid: occurrence.uid, date, source: occurrence.source }), '已恢复原定安排').then(ok => ok && onClose()),
    }, '撤销改期'))
  }
  if (series) {
    actions.push(React.createElement(Button, {
      key: 'cancel', variant: 'ghost', size: 'sm',
      onClick: () => run(() => service.cancelOccurrence({ uid: occurrence.uid, date, source: occurrence.source }), `已取消：${shortDate(date)}`).then(ok => ok && onClose()),
    }, '取消这一次'))
  } else {
    actions.push(React.createElement(Button, {
      key: 'delete', variant: 'ghost', size: 'sm',
      style: { color: 'var(--dsw-alias-state-error-primary, #d4553f)' },
      onClick: () => setConfirming(true),
    }, '删除日程'))
  }

  return React.createElement(Modal, {
    open: true,
    onClose,
    title: occurrence.title,
    closeLabel: '关闭',
    description: series ? seriesSummary(event) : undefined,
    footer: React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } },
      ...actions,
      React.createElement('span', { style: { flex: '1 1 auto' } }),
      React.createElement(Button, { variant: 'ghost', size: 'sm', onClick: onClose }, '关闭')),
  },
  React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
      React.createElement('span', { style: { fontSize: 13, color: PRIMARY, fontVariantNumeric: 'tabular-nums' } },
        `${monthOf(dateOf(occurrence.start))}${dayNumber(dateOf(occurrence.start))}日 ${weekdayOf(dateOf(occurrence.start))} ${clockRange(occurrence)}`),
      occurrence.overridden ? React.createElement(Tag, { tone: 'info' }, '已改期') : undefined,
      series ? React.createElement(Tag, { tone: 'outline' }, '重复日程中的一次') : React.createElement(Tag, { tone: 'quiet' }, '单次日程')),
    occurrence.location
      ? React.createElement('div', { style: { fontSize: 13, color: PRIMARY } }, `地点：${occurrence.location}`)
      : undefined,
    occurrence.description
      ? React.createElement('div', null,
        React.createElement(Muted, { style: { display: 'block', marginBottom: 2 } },
          event?.source && event.source !== 'manual' ? `日历备注（${sourceName(event.source)}）` : '日程备注'),
        React.createElement('div', { style: { fontSize: 12, color: SECONDARY, whiteSpace: 'pre-wrap' } }, occurrence.description))
      : undefined,
    // The reader's note about this class. It follows the class when the school
    // moves it, which is why it is shown with the occurrence rather than the
    // record, and why it lives outside the school's own fields.
    note && !writingNote
      ? React.createElement('div', {
        style: { padding: '8px 10px', borderRadius: 8, background: LAYER, whiteSpace: 'pre-wrap', fontSize: 13 },
      },
      React.createElement(Muted, { style: { display: 'block', marginBottom: 3 } }, '我的笔记'),
      note)
      : undefined,
    writingNote
      ? React.createElement('div', {
        style: { marginTop: 4, padding: 12, borderRadius: 10, background: LAYER, display: 'flex', flexDirection: 'column', gap: 10 },
      },
      React.createElement(Field, { label: '我的笔记', hint: '只属于这次日程。改期后保留，独立于日程备注，不随 ICS 导出。' },
        React.createElement('textarea', {
          value: noteDraft, rows: 4, spellCheck: false, autoFocus: true, disabled: savingNote,
          placeholder: '例如：期末要背 P187',
          onChange: (event: any) => setNoteDraft(event.target.value),
          style: {
            width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: 8, resize: 'vertical',
            border: CARD_BORDER, background: 'var(--dsw-alias-bg-layer-1, #fff)', color: PRIMARY, fontSize: 13,
            fontFamily: 'inherit', lineHeight: 1.5,
          },
        })),
      React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
        React.createElement(Button, {
          variant: 'primary', size: 'sm',
          disabled: savingNote || noteDraft === (note ?? ''),
          onClick: async () => {
            if (savingNote) return
            setSavingNote(true)
            try {
              const ok = await run(
                () => (noteDraft.trim() === ''
                  ? service.removeNote(noteRefOf(occurrence))
                  : service.putNote({ ...noteRefOf(occurrence), text: noteDraft })),
                noteDraft.trim() === '' ? '已清空笔记' : '笔记已保存',
              )
              if (ok) setWritingNote(false)
            } finally { setSavingNote(false) }
          },
        }, '保存笔记'),
        React.createElement(Button, { variant: 'ghost', size: 'sm', disabled: savingNote, onClick: () => { setNoteDraft(note ?? ''); setWritingNote(false) } }, '取消'),
        noteDraft !== (note ?? '') ? React.createElement(Muted, null, '笔记只属于这次日程') : undefined))
      : undefined,
    showPersonal ? React.createElement(PersonalSettings, { identity: noteRefOf(occurrence), service, run, Field }) : undefined,
    event?.source ? React.createElement('div', null, React.createElement(Muted, null, `日历：${sourceName(event.source)}`)) : undefined,
    editing
      ? React.createElement('div', {
        style: { marginTop: 4, padding: 12, borderRadius: 10, background: LAYER, display: 'flex', flexDirection: 'column', gap: 10 },
      },
      React.createElement(Field, { label: '开始' },
        React.createElement(Input, {
          type: 'datetime-local', value: form.start,
          onChange: (event: any) => setForm({ ...form, start: event.target.value }),
        })),
      React.createElement(Field, { label: '结束', hint: '留空表示沿用原本的时长' },
        React.createElement(Input, {
          type: 'datetime-local', value: form.end,
          onChange: (event: any) => setForm({ ...form, end: event.target.value }),
        })),
      React.createElement(Field, { label: '地点' },
        React.createElement(Input, {
          value: form.location, placeholder: '留空表示沿用原来的地点',
          onChange: (event: any) => setForm({ ...form, location: event.target.value }),
        })),
      React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        React.createElement(Button, {
          variant: 'primary', size: 'sm', disabled: Object.keys(patch).length === 0 || (!series && !event),
          onClick: () => run(save, series ? '已保存这次调整' : '已保存修改').then(ok => ok && onClose()),
        }, '保存'),
        React.createElement(Button, { variant: 'ghost', size: 'sm', onClick: () => setEditing(false) }, '取消'),
        React.createElement(Muted, null, series ? '只改这一次，系列其他日期不受影响' : '只改这一条日程')))
      : undefined,
    confirming
      ? React.createElement('div', {
        style: { marginTop: 4, padding: 12, borderRadius: 10, background: LAYER, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      },
      React.createElement('span', { style: { fontSize: 13 } }, '确定删除这条日程？'),
      React.createElement(Button, {
        variant: 'primary', size: 'sm',
        style: { background: 'var(--dsw-alias-state-error-primary, #d4553f)' },
        onClick: () => run(() => service.deleteEvent({ uid: occurrence.uid, source: occurrence.source }), '已删除这条日程').then(ok => ok && onClose()),
      }, '删除'),
      React.createElement(Button, { variant: 'ghost', size: 'sm', onClick: () => setConfirming(false) }, '取消'))
      : undefined))
}

/** Read a dropped or chosen file as text, with the few checks a calendar import needs. */
async function readCalendarFile(file: File) {
  const name = file.name.toLowerCase()
  if (!(name.endsWith('.ics') || name.endsWith('.ical') || name.endsWith('.txt') || file.type.includes('calendar') || file.type.startsWith('text/'))) {
    throw new Error('只支持 .ics 日历文件')
  }
  const text = await file.text()
  if (text.trim() === '') throw new Error('文件是空的')
  return text
}

/** File names identify separate calendars; selecting the same name updates that calendar. */
const calendarNameOf = (name: string) => {
  const label = name.replace(/\.(ics|ical|txt)$/i, '').trim() || '导入日历'
  return label === 'manual' ? 'manual 日历' : label
}
const freshCalendarName = (names: string[]) => {
  let name = '导入日历'
  for (let index = 2; names.includes(name); index += 1) name = `导入日历 ${index}`
  return name
}

/** The import dialog: drop a file or paste text, then read what the import did. */
function ImportDialog({ initialText, initialName, calendars = [], service, onClose, run }: any) {
  const [text, setText] = useState(initialText ?? '')
  const [source, setSource] = useState(() => initialName ? calendarNameOf(initialName) : freshCalendarName(calendars))
  const sourceEdited = useRef(false)
  const [replace, setReplace] = useState(false)
  const [name, setName] = useState(initialName ?? '')
  const [dragging, setDragging] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const picker = useRef<HTMLInputElement | null>(null)

  const accept = useCallback(async (file: File) => {
    try {
      const next = await readCalendarFile(file)
      setText(next)
      setName(file.name)
      if (!sourceEdited.current) setSource(calendarNameOf(file.name))
      setProblem(null)
    } catch (error) {
      setProblem(messageOf(error))
    }
  }, [])

  const submit = async () => {
    if (!source.trim() || source.trim() === 'manual') { setProblem('请填写日历名称，个人日程保留名 manual 不可用于导入'); return }
    setBusy(true)
    setProblem(null)
    try {
      const result = await service.importIcs({ text, source: source.trim(), replace })
      setOutcome(result)
    } catch (error) {
      setProblem(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  const count = text.trim() === '' ? 0 : text.split(/\r\n|\r|\n/).filter((line: string) => line.startsWith('BEGIN:VEVENT')).length

  return React.createElement(Modal, {
    open: true,
    onClose,
    title: outcome ? '导入结果' : '导入日历',
    closeLabel: '关闭',
    description: outcome
      ? `日历「${source.trim()}」`
      : '选择文件或粘贴文本。不同日历分开保存，默认保留已有日程。',
    footer: React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
      outcome
        ? React.createElement(React.Fragment, null,
          React.createElement(Button, { variant: 'ghost', size: 'sm', onClick: () => { setOutcome(null); setText(''); setName(''); setSource(freshCalendarName([...calendars, source])); sourceEdited.current = false; setReplace(false) } }, '再导一份'),
          React.createElement('span', { style: { flex: '1 1 auto' } }),
          React.createElement(Button, { variant: 'primary', size: 'sm', onClick: onClose }, '完成'))
        : React.createElement(React.Fragment, null,
          React.createElement(Muted, null, count > 0 ? `识别到 ${count} 条日程` : '等待日历文本'),
          React.createElement('span', { style: { flex: '1 1 auto' } }),
          React.createElement(Button, { variant: 'ghost', size: 'sm', onClick: onClose }, '取消'),
          React.createElement(Button, { variant: 'primary', size: 'sm', disabled: text.trim() === '' || source.trim() === '' || source.trim() === 'manual' || busy, onClick: submit }, busy ? '正在导入…' : '导入'))),
  },
  outcome
    ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
      React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
        React.createElement(Tag, { tone: 'neutral' }, `日程 ${outcome.events} 条`),
        React.createElement(Tag, { tone: 'neutral' }, `移除旧日程 ${outcome.removedEvents} 条`)),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: PRIMARY } },
        React.createElement(IconCheck),
        outcome.events > 0 ? '已写入日历' : '没有写入新的日程'),
      outcome.skipped.length > 0
        ? React.createElement('div', null,
          React.createElement(Muted, { style: { display: 'block', marginBottom: 4 } }, `未导入 ${outcome.skipped.length} 条`),
          React.createElement('ul', { style: { margin: 0, paddingLeft: 18, fontSize: 12, color: SECONDARY } },
            ...outcome.skipped.map((entry: any, index: number) => React.createElement('li', { key: index }, `${entry.uid ? `${entry.uid}：` : ''}${entry.reason}`))))
        : undefined,
      outcome.degraded.length > 0
        ? React.createElement('div', null,
          React.createElement(Muted, { style: { display: 'block', marginBottom: 4 } }, `重复规则降级为单次 ${outcome.degraded.length} 条`),
          React.createElement('ul', { style: { margin: 0, paddingLeft: 18, fontSize: 12, color: SECONDARY } },
            ...outcome.degraded.map((entry: any, index: number) => React.createElement('li', { key: index }, `${entry.rrule ?? entry.uid ?? ''}${entry.reason ? `（${entry.reason}）` : ''}`))))
        : undefined)
    : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
      React.createElement('div', {
        onDragEnter: (event: any) => { event.preventDefault(); setDragging(true) },
        onDragOver: (event: any) => { event.preventDefault(); setDragging(true) },
        onDragLeave: () => setDragging(false),
        onDrop: async (event: any) => {
          event.preventDefault()
          setDragging(false)
          const file = event.dataTransfer?.files?.[0]
          if (file) await accept(file)
        },
        style: {
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
          padding: '20px 16px', borderRadius: 12, textAlign: 'center',
          border: `1px dashed ${dragging ? 'var(--dsw-alias-state-business-primary, #4d6bfe)' : 'var(--dsw-alias-border-l2, #0000002e)'}`,
          background: dragging ? 'color-mix(in srgb, var(--dsw-alias-state-business-primary, #4d6bfe) 6%, transparent)' : LAYER,
        },
      },
      React.createElement(IconFolderOpen),
      React.createElement('strong', { style: { fontSize: 13 } }, name === '' ? '把 .ics 文件拖到这里' : name),
      React.createElement(Muted, null, name === '' ? '也可以点下面的按钮选择文件' : '已读取文件内容，可以直接导入'),
      React.createElement(Button, {
        variant: 'outline', size: 'sm',
        onClick: () => picker.current?.click(),
      }, '选择文件'),
      React.createElement('input', {
        ref: (node: any) => { picker.current = node },
        type: 'file', accept: '.ics,.ical,.txt,text/calendar', style: { display: 'none' },
        onChange: async (event: any) => {
          const file = event.target.files?.[0]
          if (file) await accept(file)
          event.target.value = ''
        },
      })),
      React.createElement('textarea', {
        value: text,
        onChange: (event: any) => setText(event.target.value),
        placeholder: 'BEGIN:VCALENDAR …',
        spellCheck: false,
        style: {
          width: '100%', minHeight: 148, resize: 'vertical', boxSizing: 'border-box', padding: 10,
          borderRadius: 10, border: CARD_BORDER, background: 'var(--dsw-alias-bg-layer-1, #fff)', color: PRIMARY,
          fontFamily: 'var(--ds-font-family-code, ui-monospace, monospace)', fontSize: 12, lineHeight: 1.5,
        },
      }),
      React.createElement('div', { style: { display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' } },
        React.createElement('div', { style: { flex: '1 1 200px' } },
          React.createElement(Field, { label: '日历名称', hint: '同一日历中相同编号会更新。更新旧日历时选择原名，不同日历请用不同名称' },
            React.createElement(Input, { value: source, list: 'calendar-import-names', onChange: (event: any) => { sourceEdited.current = true; setSource(event.target.value) } })),
          React.createElement('datalist', { id: 'calendar-import-names' }, ...calendars.map((name: string) => React.createElement('option', { key: name, value: name })))),
        React.createElement('div', { style: { paddingBottom: 18, display: 'flex', alignItems: 'center', gap: 8 } },
          React.createElement(Switch, { checked: replace, onChange: setReplace, label: '移除该日历中此次未列出的日程' }),
          React.createElement('span', { style: { fontSize: 12, color: SECONDARY } }, '移除该日历中此次未列出的日程'))),
      problem ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--dsw-alias-state-error-primary, #d4553f)' } },
        React.createElement(IconWarning), problem) : undefined))
}

/** The export dialog: the calendar text, ready to copy or to download. */
function ExportDialog({ service, onClose, toast }: any) {
  const [text, setText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    let alive = true
    service.exportIcs({})
      .then((result: any) => { if (alive) setText(result.text) })
      .catch((error: unknown) => { if (alive) setProblem(messageOf(error)) })
    return () => { alive = false }
  }, [service])

  const save = () => {
    const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = '日历.ics'
    link.click()
    URL.revokeObjectURL(url)
  }

  const lines = text === '' ? 0 : text.split('\r\n').length
  return React.createElement(Modal, {
    open: true,
    onClose,
    title: '导出日历',
    closeLabel: '关闭',
    description: '标准 iCalendar 文本，可以复制或下载后导入其他日历应用。',
    footer: React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
      React.createElement(Muted, null, text === '' ? '正在生成…' : `${lines} 行 · ${text.length} 字符`),
      React.createElement('span', { style: { flex: '1 1 auto' } }),
      React.createElement(Button, {
        variant: 'primary', size: 'sm', icon: React.createElement(IconCopy), disabled: text === '',
        onClick: async () => {
          const ok = await writeClipboard(text)
          setCopied(ok)
          toast(ok ? '已复制日历文本' : '复制失败，请手动选择文本')
        },
      }, copied ? '已复制' : '复制'),
      React.createElement(Button, {
        variant: 'outline', size: 'sm', icon: React.createElement(IconDownload), disabled: text === '',
        onClick: save,
      }, '下载 .ics'),
      React.createElement(Button, { variant: 'ghost', size: 'sm', onClick: onClose }, '完成')),
  },
  React.createElement('textarea', {
    readOnly: true, value: text, spellCheck: false,
    onFocus: (event: any) => event.target.select(),
    style: {
      width: '100%', minHeight: 300, maxHeight: '46vh', resize: 'vertical', boxSizing: 'border-box', padding: 10,
      borderRadius: 10, border: CARD_BORDER, background: 'var(--dsw-alias-bg-layer-1, #fff)', color: PRIMARY,
      fontFamily: 'var(--ds-font-family-code, ui-monospace, monospace)', fontSize: 12, lineHeight: 1.5,
      // The text is a file, not prose: show the folded lines as they are written
      // (a continuation starts with a space) instead of soft-wrapping them into
      // something that no longer looks like the export.
      whiteSpace: 'pre', overflowX: 'auto', overflowY: 'auto',
    },
  }),
  problem ? React.createElement('div', { style: { marginTop: 8, fontSize: 12, color: 'var(--dsw-alias-state-error-primary, #d4553f)' } }, problem) : undefined)
}

/** One entry row of the agenda: date, time, place, and the actions that fit a row. */
function EventRow({ occurrence, tint, note, onOpen, onCancel, onDelete }: any) {
  const [hovered, hover] = useHover()
  const date = dateOf(occurrence.start)
  const series = Boolean(occurrence.recurrence)
  return React.createElement('div', {
    ...hover,
    style: {
      display: 'grid', gridTemplateColumns: `${GUTTER}px minmax(0, 1fr) auto`, alignItems: 'center', gap: 10,
      padding: '8px 12px', borderTop: HAIRLINE, background: hovered ? HOVER : 'transparent',
    },
  },
  React.createElement('div', { style: { textAlign: 'center' } },
    React.createElement('div', { style: { fontSize: 11, color: SECONDARY } }, weekdayOf(date)),
    React.createElement('div', { style: { fontSize: 15, fontWeight: 650, color: PRIMARY } }, dayNumber(date))),
  React.createElement('button', {
    type: 'button',
    onClick: () => onOpen(occurrence),
    style: { display: 'block', minWidth: 0, padding: 0, border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', color: PRIMARY },
  },
  React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
    React.createElement('span', { 'aria-hidden': true, style: { width: 8, height: 8, borderRadius: 999, background: tint.accent, flex: '0 0 auto' } }),
    React.createElement('span', { style: { fontSize: 13, fontWeight: 550, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, occurrence.title),
    occurrence.overridden ? React.createElement(Tag, { tone: 'info' }, '已改期') : undefined,
    occurrence.personal?.hidden ? React.createElement(Tag, { tone: 'quiet' }, '已隐藏') : undefined),
  React.createElement('div', { style: { marginTop: 2, fontSize: 12, color: SECONDARY, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
    [clockRange(occurrence), occurrence.location].filter(Boolean).join(' · ')),
  // The reader's note, where the class is: a note nobody can see is a note nobody
  // trusts to have been kept.
  note
    ? React.createElement('div', {
      style: { marginTop: 2, fontSize: 12, color: SECONDARY, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
    }, `笔记：${note}`)
    : undefined),
  React.createElement('div', { style: { display: 'flex', gap: 2, opacity: hovered ? 1 : 0, transition: 'opacity .12s ease' } },
    series
      ? React.createElement(IconButton, {
        label: '取消这一次', icon: React.createElement(IconArchive),
        onClick: () => onCancel(occurrence),
      })
      : React.createElement(IconButton, {
        label: '删除日程', danger: true, icon: React.createElement(IconTrash),
        onClick: () => onDelete(occurrence),
      })))
}

/** Days between two `YYYY-MM-DD` dates, so a whole-day range keeps its span. */
const daysBetween = (from: string, to: string) => Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86_400_000)

const REPEAT_LABELS: Record<string, string> = { none: '不重复', daily: '每天', weekly: '每周', custom: '自选星期' }
const WEEK_CODES = ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su']
const weekdayCodeOf = (date: string) => WEEK_CODES[(parseDate(date).getDay() + 6) % 7]
const repeatModeOf = (event: any) => {
  const rule = event?.recurrence
  if (!rule) return 'none'
  if ((rule.interval ?? 1) === 1 && rule.byDay?.length === 7) return 'daily'
  if ((rule.interval ?? 1) === 1 && (!rule.byDay?.length || (rule.byDay.length === 1 && rule.byDay[0] === weekdayCodeOf(dateOf(event.start))))) return 'weekly'
  return 'custom'
}

/** The editable fields of a stored record, as the form holds them. */
const draftOf = (event: any) => ({
  title: event?.title ?? '',
  date: dateOf(event?.start ?? '') || localDate(),
  start: clockOf(event?.start),
  end: clockOf(event?.end),
  endDayOffset: event?.end && clockOf(event?.start) !== '' ? daysBetween(dateOf(event.start), dateOf(event.end)) : 0,
  location: event?.location ?? '',
  description: noteOf(event),
  repeat: Boolean(event?.recurrence),
  repeatMode: repeatModeOf(event),
  days: event?.recurrence?.byDay ?? [weekdayCodeOf(dateOf(event?.start ?? '') || localDate())],
  interval: event?.recurrence?.interval ?? 1,
  until: event?.recurrence?.until ? dateOf(event.recurrence.until) : '',
})

/**
 * The record a draft describes, on top of the one it was read from.
 *
 * An emptied field disappears instead of lingering as an empty string: the host
 * stores the record it is handed, so the form is the whole truth about it.
 */
function recordOf(draft: any, base: any = {}) {
  const timed = draft.start !== ''
  const shift = base.start ? daysBetween(dateOf(base.start), draft.date) : 0
  return withoutEmpty({
    ...base,
    uid: base.uid ?? newUid(),
    title: draft.title.trim(),
    start: timed ? `${draft.date}T${draft.start}` : draft.date,
    // A whole-day entry keeps the span it had, moved by however far its date moved.
    end: timed
      ? (draft.end === '' ? undefined : `${addDays(draft.date, draft.endDayOffset ?? 0)}T${draft.end}`)
      : (base.end ? addDays(dateOf(base.end), shift) : undefined),
    location: draft.location.trim(),
    description: draft.description.trim(),
    // A single entry owns no series bookkeeping: turning the repeat off drops the
    // dates that were cancelled or moved while it was a series.
    recurrence: draft.repeat ? withoutEmpty({
      freq: 'weekly',
      byDay: draft.repeatMode === 'daily' ? WEEK_CODES : draft.repeatMode === 'custom' ? draft.days : [weekdayCodeOf(draft.date)],
      interval: draft.repeatMode === 'custom' ? Number(draft.interval) : undefined,
      until: draft.until,
      count: draft.until === (base.recurrence?.until ? dateOf(base.recurrence.until) : '') && draft.repeatMode === repeatModeOf(base) ? base.recurrence?.count : undefined,
    }) : undefined,
    exceptions: draft.repeat ? base.exceptions : undefined,
    overrides: draft.repeat ? base.overrides : undefined,
  })
}

/** Send only fields changed in the editor, never a stale full record. */
function patchOf(draft: any, base: any) {
  const initial = draftOf(base)
  const next = recordOf(draft, base)
  const patch: any = {}
  if (draft.title !== initial.title) patch.title = next.title
  if (draft.date !== initial.date || draft.start !== initial.start) patch.start = next.start
  if (draft.end !== initial.end || draft.endDayOffset !== initial.endDayOffset) patch.end = next.end ?? null
  if (draft.location !== initial.location) patch.location = next.location ?? null
  if (draft.description !== initial.description) patch.description = next.description ?? null
  const recurrenceChanged = ['repeat', 'repeatMode', 'days', 'interval', 'until'].some(field => JSON.stringify(draft[field]) !== JSON.stringify(initial[field]))
  if (recurrenceChanged) patch.recurrence = next.recurrence ?? null
  return patch
}

/** Why a draft cannot be saved yet, or `null` when it can. */
function draftProblem(draft: any) {
  if (draft.title.trim() === '') return '标题不能为空'
  if (draft.date === '') return '需要选一个日期'
  if (draft.start === '' && draft.end !== '') return '需要填写开始时间；全天日程请同时清空开始与结束时间'
  if (draft.endDayOffset < 0) return '结束日期不能早于开始日期'
  if (draft.repeatMode === 'custom' && draft.days.length === 0) return '请至少选择一个重复星期'
  if (draft.repeat && draft.until && draft.until < draft.date) return '重复结束日期不能早于开始日期'
  if (draft.start !== '' && draft.end !== '' && (draft.endDayOffset ?? 0) === 0 && draft.end <= draft.start) return '结束时间要晚于开始时间'
  return null
}

/**
 * The fields of one record, shared by the new-entry dialog and the entry page:
 * what the reader owns about an entry, as opposed to one date of a series.
 */
function EventForm({ draft, onChange, autoFocus, sourceOwned = false }: any) {
  const set = (patch: any) => onChange({ ...draft, ...patch })
  return React.createElement(React.Fragment, null,
    React.createElement(Field, { label: '标题' },
      React.createElement(Input, {
        value: draft.title, placeholder: '例如：组会、体检、回家', autoFocus,
        onChange: (event: any) => set({ title: event.target.value }),
      })),
    React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
      React.createElement('div', { style: { flex: '1 1 150px' } },
        React.createElement(Field, { label: '日期' },
          React.createElement(Input, {
            type: 'date', value: draft.date,
            onChange: (event: any) => set({ date: event.target.value }),
          }))),
      React.createElement('div', { style: { flex: '1 1 90px' } },
        React.createElement(Field, { label: '开始' },
          React.createElement(Input, {
            type: 'time', value: draft.start,
            onChange: (event: any) => set({ start: event.target.value }),
          }))),
      React.createElement('div', { style: { flex: '1 1 90px' } },
        React.createElement(Field, { label: '结束', hint: '留空按 45 分钟显示' },
          React.createElement(Input, {
            type: 'time', value: draft.end,
            onChange: (event: any) => set({ end: event.target.value }),
          })))),
    draft.start !== '' && draft.end !== '' && draft.endDayOffset !== 0
      ? React.createElement(Field, { label: '跨天结束日期', hint: '这条日程跨过午夜；修改日期会保留这个天数跨度' },
        React.createElement(Input, {
          type: 'date', value: addDays(draft.date, draft.endDayOffset),
          onChange: (event: any) => set({ endDayOffset: event.target.value ? daysBetween(draft.date, event.target.value) : -1 }),
        }))
      : undefined,
    React.createElement(Field, { label: '地点' },
      React.createElement(Input, {
        value: draft.location, placeholder: '可留空',
        onChange: (event: any) => set({ location: event.target.value }),
      })),
    React.createElement(Field, { label: sourceOwned ? '来源备注（只读）' : '备注', hint: sourceOwned ? '自己的备注请写在下方个人设置中' : '随导出写进日历，不会同步到任何服务' },
      React.createElement('textarea', {
        'aria-label': sourceOwned ? '来源备注（只读）' : '备注', readOnly: sourceOwned, value: draft.description, rows: 3, spellCheck: false,
        onChange: (event: any) => set({ description: event.target.value }),
        style: {
          width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: 8, resize: 'vertical',
          border: CARD_BORDER, background: 'var(--dsw-alias-bg-layer-1, #fff)', color: PRIMARY, fontSize: 13,
          fontFamily: 'inherit', lineHeight: 1.5,
        },
      })),
    React.createElement(Field, { label: '重复' },
      React.createElement('select', {
        'aria-label': '重复', value: draft.repeatMode,
        onChange: (event: any) => {
          const mode = event.target.value
          set({ repeatMode: mode, repeat: mode !== 'none', days: mode === 'custom' && draft.repeatMode !== 'custom' ? [weekdayCodeOf(draft.date)] : draft.days })
        },
        style: { width: '100%', padding: '8px 10px', border: CARD_BORDER, borderRadius: 8, background: PAGE_BACKGROUND, color: PRIMARY, font: 'inherit' },
      }, ...Object.entries(REPEAT_LABELS).map(([value, label]) => React.createElement('option', { key: value, value }, label)))),
    draft.repeatMode === 'custom'
      ? React.createElement('div', { style: { marginBottom: 14 } },
        React.createElement('div', { role: 'group', 'aria-label': '重复星期', style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 } },
          ...WEEK_CODES.map((code, index) => React.createElement('button', {
            key: code, type: 'button', 'aria-pressed': draft.days.includes(code),
            onClick: () => set({ days: WEEK_CODES.filter(day => day === code ? !draft.days.includes(day) : draft.days.includes(day)) }),
            style: { padding: '7px 11px', borderRadius: 8, border: draft.days.includes(code) ? '1px solid var(--dsw-alias-state-business-primary, #4d6bfe)' : CARD_BORDER, color: draft.days.includes(code) ? 'var(--dsw-alias-state-business-primary, #4d6bfe)' : SECONDARY, background: draft.days.includes(code) ? 'var(--dsw-alias-interactive-bg-hover, #edf1ff)' : PAGE_BACKGROUND, cursor: 'pointer' },
          }, WEEKDAYS[index]))),
        React.createElement(Field, { label: '每隔几周', hint: '1 表示每周，2 表示隔周' },
          React.createElement(Input, { type: 'number', min: 1, max: 52, value: draft.interval, onChange: (event: any) => set({ interval: Math.max(1, Math.min(52, Number(event.target.value) || 1)) }) })))
      : undefined,
    draft.repeat
      ? React.createElement(Field, { label: '重复到', hint: '留空表示一直重复' },
        React.createElement(Input, {
          type: 'date', value: draft.until,
          onChange: (event: any) => set({ until: event.target.value }),
        }))
      : undefined)
}

/** The dialog that creates one entry by hand. */
function CreateDialog({ defaultDate, defaultStart, defaultEnd, service, onClose, run, onSaved }: any) {
  const [draft, setDraft] = useState(() => {
    const date = defaultDate ?? localDate()
    const start = defaultStart ?? clockAt(suggestedStart(date))
    return {
      ...draftOf(null),
      date,
      start,
      end: defaultEnd ?? clockAt(Math.min(clockMinutes(start) + 60, 23 * 60 + 59)),
    }
  })
  const [problem, setProblem] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const saving = useRef(false)
  const complaint = draftProblem(draft)

  const submit = async () => {
    if (saving.current) return
    if (complaint) {
      setProblem(complaint)
      return
    }
    saving.current = true
    setSubmitting(true)
    try {
      const created = await run(() => service.putEvent(recordOf(draft)), '已新建日程')
      if (created) onSaved()
    } finally {
      saving.current = false
      setSubmitting(false)
    }
  }

  return React.createElement(Modal, {
    open: true,
    onClose,
    title: '新建日程',
    closeLabel: '关闭',
    description: '写进本机日历，随时可以再改。',
    footer: React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
      React.createElement(Muted, null, REPEAT_LABELS[draft.repeatMode] ?? '单次日程'),
      React.createElement('span', { style: { flex: '1 1 auto' } }),
      React.createElement(Button, { variant: 'ghost', size: 'sm', onClick: onClose }, '取消'),
      React.createElement(Button, {
        variant: 'primary', size: 'sm', disabled: Boolean(complaint) || submitting, onClick: submit,
      }, submitting ? '正在保存…' : '新建')),
  },
  React.createElement('div', null,
    React.createElement(EventForm, { draft, onChange: setDraft, autoFocus: true }),
    problem
      ? React.createElement('div', {
        style: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary, #d4553f)' },
      }, problem)
      : undefined))
}

/**
 * One stored entry: what it is on the left, the dates it produces on the right.
 * Wide panels show both at once; a narrow one stacks them, because the panel
 * width is the reader's, not ours.
 */
type EventEditor = { event: any; draft: any; dirty: string[]; pending?: { draft: any; dirty: string[] } }

function EventPage({ event, agenda, noteIndex, service, run, onOpenOccurrence, onRestore, onCancel, onDelete, busy, sourceName }: any) {
  const [editor, setEditor] = useState<EventEditor>(() => ({ event, draft: draftOf(event), dirty: [] }))
  const [problem, setProblem] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // A snapshot replaces object identities even when another calendar changed.
  // Adopt fresh values before rendering children, retaining only local edits.
  if (editor.event !== event) {
    const incoming = draftOf(event)
    const protectedFields = [...new Set([...editor.dirty, ...(editor.pending?.dirty ?? [])])]
    const dirty = protectedFields.filter(field => editor.pending?.dirty.includes(field)
      || JSON.stringify(editor.draft[field]) !== JSON.stringify(incoming[field]))
    setEditor({ ...editor, event, draft: { ...incoming, ...Object.fromEntries(dirty.map(field => [field, editor.draft[field]])) }, dirty })
  }
  const { draft } = editor
  const changeDraft = (draft: any) => {
    setProblem(null)
    setEditor(current => {
      const baseline = draftOf(current.event)
      // Compare later typing with the values being saved, not the old server
      // values: reverting to an old value is still a new edit during a save.
      if (current.pending) for (const field of current.pending.dirty) baseline[field] = current.pending.draft[field]
      return { ...current, draft, dirty: Object.keys(draft).filter(field => JSON.stringify(draft[field]) !== JSON.stringify(baseline[field])) }
    })
  }
  const uuid = event?.uid
  const source = event?.source
  const occurrences = useMemo(
    () => (agenda ?? []).filter((occurrence: any) => occurrence.uid === uuid && occurrence.source === source),
    [agenda, uuid, source],
  )
  const groups = useMemo(() => {
    const map = new Map<string, any[]>()
    for (const occurrence of occurrences) {
      const key = occurrence.start.slice(0, 7)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(occurrence)
    }
    return [...map.entries()]
  }, [occurrences])

  if (!event) return null
  const tint = tintOf(event.source ?? event.uid)
  const exceptions = (event.exceptions ?? []).map(dateOf)
  const complaint = draftProblem(draft)
  const dirty = editor.dirty.length > 0

  const save = () => {
    if (complaint) {
      setProblem(complaint)
      return
    }
    if (!dirty) return
    const submitted = editor
    void run(async () => {
      setEditor(current => ({ ...current, pending: { draft: submitted.draft, dirty: submitted.dirty } }))
      try {
        await service.updateEvent({ uid: event.uid, source: event.source, patch: patchOf(submitted.draft, submitted.event) })
      } catch (error) {
        setEditor(current => {
          const baseline = draftOf(current.event)
          return { ...current, pending: undefined, dirty: Object.keys(current.draft).filter(field =>
            JSON.stringify(current.draft[field]) !== JSON.stringify(baseline[field])) }
        })
        throw error
      }
      // Acknowledge only the values sent by this save. Later typing stays dirty.
      // run() refreshes afterwards, so clean fields take normalized server values.
      setEditor(current => ({ ...current, pending: undefined, dirty: current.dirty.filter(field =>
        !submitted.dirty.includes(field) || JSON.stringify(current.draft[field]) !== JSON.stringify(submitted.draft[field])) }))
      setConfirmingDelete(false)
    }, '日程信息已保存')
  }

  // The pieces are built apart and assembled at the end: one nested expression
  // per row was unreadable, and a misread parenthesis there is a silent layout
  // bug rather than a syntax error.
  const infoCard = React.createElement('section', {
    style: { padding: 16, borderRadius: 12, border: CARD_BORDER, background: 'var(--dsw-alias-bg-layer-1, #fff)' },
  },
  React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' } },
    React.createElement('span', { 'aria-hidden': true, style: { width: 10, height: 10, borderRadius: 999, background: tint.accent } }),
    React.createElement('strong', { style: { fontSize: 13 } }, '日程信息'),
    React.createElement('span', { style: { flex: '1 1 auto' } }),
    event.recurrence ? React.createElement(Tag, { tone: 'outline' }, seriesSummary(event)) : undefined,
    event.source ? React.createElement(Muted, null, sourceName(event.source)) : undefined),
  React.createElement(EventForm, { draft, onChange: changeDraft, sourceOwned: event.source !== 'manual' }),
  React.createElement(PersonalSettings, { identity: { source: event.source, uid: event.uid }, service, run, Field, allowOccurrence: false }),
  React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
    React.createElement(Button, {
      variant: 'primary', size: 'sm', disabled: !dirty || busy || Boolean(complaint), onClick: save,
    }, '保存更改'),
    dirty ? React.createElement(Muted, null, complaint ?? '有未保存的改动') : undefined,
    React.createElement('span', { style: { flex: '1 1 auto' } }),
    // Deleting takes out every date of the record, so it is asked about here too: the
    // dialog over one occurrence asks before the same act, and a page that did it on
    // one click would make the safer path the more roundabout one.
    confirmingDelete
      ? React.createElement(React.Fragment, null,
        React.createElement('span', { style: { fontSize: 13 } }, '确定删除这条日程？'),
        React.createElement(Button, {
          variant: 'primary', size: 'sm',
          style: { background: 'var(--dsw-alias-state-error-primary, #d4553f)' },
          onClick: () => onDelete(event),
        }, '删除'),
        React.createElement(Button, { variant: 'ghost', size: 'sm', onClick: () => setConfirmingDelete(false) }, '取消'))
      : React.createElement(Button, {
        variant: 'ghost', size: 'sm', icon: React.createElement(IconTrash),
        style: { color: 'var(--dsw-alias-state-error-primary, #d4553f)' },
        onClick: () => setConfirmingDelete(true),
      }, '删除这条日程')))

  const cancelledCard = exceptions.length === 0 ? undefined : React.createElement('section', {
    style: { padding: 16, borderRadius: 12, border: CARD_BORDER, background: 'var(--dsw-alias-bg-layer-1, #fff)' },
  },
  React.createElement('strong', { style: { display: 'block', marginBottom: 10, fontSize: 13 } }, '已取消的日期'),
  React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
    ...exceptions.map((date: string) => React.createElement('span', {
      key: date,
      style: { display: 'inline-flex', alignItems: 'center', gap: 2, padding: '1px 4px 1px 7px', borderRadius: 999, background: LAYER, fontSize: 11 },
    },
    shortDate(date),
    React.createElement(IconButton, {
      label: `恢复 ${shortDate(date)}`, icon: React.createElement(IconRefreshSmall),
      onClick: () => onRestore(event, date),
    })))))

  const monthBlocks = groups.flatMap(([month, items]) => [
    React.createElement('div', {
      key: month,
      style: { padding: '6px 12px', background: LAYER, fontSize: 12, color: SECONDARY, position: 'sticky', top: 0 },
    }, monthOf(`${month}-01`)),
    ...items.map((occurrence: any) => React.createElement(EventRow, {
      key: reactKeyOf(occurrence),
      occurrence,
      tint,
      note: occurrenceNote(noteIndex, occurrence),
      onOpen: onOpenOccurrence,
      onCancel: (item: any) => onCancel(item),
      onDelete: (item: any) => onDelete(item),
    })),
  ])

  const listCard = React.createElement('div', {
    style: { flex: '2 1 420px', minWidth: 280, borderRadius: 12, border: CARD_BORDER, background: 'var(--dsw-alias-bg-layer-1, #fff)', overflow: 'hidden' },
  },
  React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', flexWrap: 'wrap' } },
    React.createElement('strong', { style: { fontSize: 13 } }, '出现的时间'),
    React.createElement(Muted, null, `近一年内 ${occurrences.length} 次`),
    React.createElement('span', { style: { flex: '1 1 auto' } }),
    React.createElement(Muted, null, '点一条查看或调整')),
  occurrences.length === 0
    ? React.createElement('div', { style: { padding: '24px 12px', textAlign: 'center' } },
      React.createElement(Muted, null, '近一年内没有它出现的时间'))
    : React.createElement('div', null, ...monthBlocks))

  return React.createElement('div', { style: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto' } },
    React.createElement('div', {
      style: { display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', padding: '16px 20px 24px' },
    },
    // Left: the entry itself, and the dates that were cancelled in it.
    React.createElement('div', {
      style: { flex: '1 1 300px', maxWidth: 420, minWidth: 260, display: 'flex', flexDirection: 'column', gap: 12 },
    }, infoCard, cancelledCard),
    // Right: the dates this entry covers, grouped by month.
    listCard))
}

/**
 * The panel: the week, the entry list behind a menu, and the dialogs.
 *
 * Exported so the panel's own wiring can be rendered and driven in a test. The
 * behaviour that matters here is which host methods are called and what is drawn
 * from their answers, and that is only testable if the test can mount this rather
 * than a copy of it.
 * @param service - the calendar surface, as the shell's gateway exposes it.
 * @returns the panel component.
 */
export function createCalendarPage(service: any) {
  return function CalendarPanel() {
    const [view, setView] = useState<{ kind: string; id?: string; source?: string }>({ kind: 'week' })
    const [anchor, setAnchor] = useState(() => startOfWeek())
    const [displayMode, setDisplayMode] = useState<'week' | 'month'>('week')
    const [monthAnchor, setMonthAnchor] = useState(() => monthStart(localDate()))
    const [calendarSource, setCalendarSource] = useState('*')
    const [snapshot, setSnapshot] = useState<any>(null)
    const [sourceStatuses, setSourceStatuses] = useState<any[]>([])
    const [reminderInbox, setReminderInbox] = useState<any>({ channel: 'in-app', unread: 0, items: [] })
    const [week, setWeek] = useState<any>(null)
    const [agenda, setAgenda] = useState<any>(null)
    // The reader's own content, read from the host and kept apart from the
    // entries: it belongs to the person, not to any data source.
    const [noteIndex, setNoteIndex] = useState<Map<string, string>>(() => new Map())
    const [loading, setLoading] = useState(true)
    const [problem, setProblem] = useState<string | null>(null)
    const [toast, setToast] = useState<string | null>(null)
    const [menuOpen, setMenuOpen] = useState(false)
    const [dialog, setDialog] = useState<any>(null)
    const [dropping, setDropping] = useState(false)
    const [busy, setBusy] = useState(false)

    const events = snapshot?.events ?? []
    const sourceName = (source: string) => calendarLabel(source, sourceStatuses)
    useEffect(() => {
      if (snapshot && calendarSource !== '*' && !snapshot.events.some((event: any) => event.source === calendarSource)) setCalendarSource('*')
    }, [snapshot, calendarSource])
    /**
     * The ranges the panel reads, held stable for as long as the week they describe.
     *
     * These are inputs to the read effects through `refresh`, so a fresh object on
     * every render would make `refresh` a new function on every render, re-run the
     * effect that calls it, and re-read and redraw without end. The panel then never
     * settles on one answer: a class deleted through it stays drawn, because each
     * pass lays the new answer over the old drawing instead of replacing it.
     */
    const weekRange = useMemo(() => displayMode === 'month' ? monthRange(monthAnchor) : ({ from: anchor, to: addDays(anchor, 6) }), [anchor, displayMode, monthAnchor])
    const currentRange = useRef(weekRange)
    currentRange.current = weekRange
    const latestWeekRead = useRef(0)
    const agendaRange = useMemo(
      () => ({ from: addDays(localDate(), -180), to: addDays(localDate(), 366), includeHidden: true }),
      [],
    )

    const loadSnapshot = useCallback(async () => { setSnapshot(await service.snapshot()) }, [service])
    const loadWeek = useCallback(async () => {
      const read = ++latestWeekRead.current
      const result = await service.occurrences(weekRange)
      if (read === latestWeekRead.current && currentRange.current === weekRange) setWeek(result)
    }, [service, weekRange])
    const loadAgenda = useCallback(async () => { setAgenda((await service.occurrences(agendaRange)).occurrences) }, [service, view.id])
    /**
     * Read every note once and index it by the identity of the class it is about.
     * One read covers the week view, the entry page and the dialog, so there is no
     * path that shows an entry without its note.
     */
    const loadNotes = useCallback(async () => {
      const records = await service.notes({ scope: 'source' })
      const index = new Map<string, string>()
      for (const record of records ?? []) {
        const text = record?.note?.text ?? (record?.note?.off ? '' : undefined)
        if (typeof text !== 'string') continue
        index.set(`${record.source}\u0000${record.uid}\u0000${record.originalStart ?? ''}`, text)
      }
      setNoteIndex(index)
    }, [service])

    const refresh = useCallback(async () => {
      setLoading(true)
      try {
        await loadSnapshot()
        if (service.sourceStatuses) setSourceStatuses(await service.sourceStatuses())
        if (service.reminders) setReminderInbox(await service.reminders())
        await loadNotes()
        if (view.kind === 'week') await loadWeek()
        if (view.kind === 'event') await loadAgenda()
        setProblem(null)
      } catch (error) {
        setProblem(messageOf(error))
      } finally {
        setLoading(false)
      }
    }, [loadSnapshot, loadNotes, loadWeek, loadAgenda, view.kind])

    useEffect(() => { void refresh() }, [refresh])
    const latestRefresh = useRef(refresh)
    latestRefresh.current = refresh
    useEffect(() => {
      if (!service.subscribe) return
      let timer: ReturnType<typeof setTimeout> | undefined
      const dispose = service.subscribe(() => {
        clearTimeout(timer)
        timer = setTimeout(() => { void latestRefresh.current() }, 60)
      })
      return () => { clearTimeout(timer); dispose() }
    }, [service])

    /** Run one write, then re-read: the panel never guesses what the host stored. */
    const run = useCallback(async (action: () => Promise<unknown>, success?: string) => {
      setBusy(true)
      try {
        await action()
        await refresh()
        if (success) setToast(success)
        return true
      } catch (error) {
        setProblem(messageOf(error))
        return false
      } finally {
        setBusy(false)
      }
    }, [refresh])

    /**
     * Open one record. Its identifier alone is ambiguous once two sources number
     * their entries independently, so the source is part of what is opened.
     */
    const openEvent = useCallback((uid: string, source?: string) => {
      setDialog(null)
      setMenuOpen(false)
      setView({ kind: 'event', id: uid, source })
    }, [])

    /** A drag or a double click in the week asks for a new entry over that span. */
    const createAt = useCallback((date: string, from: number, to: number) => {
      setDialog({ kind: 'create', date, start: clockAt(from), end: clockAt(Math.max(to, from + 15)) })
    }, [])

    const current = view.kind === 'event'
      ? events.find((event: any) => event.uid === view.id && event.source === view.source)
      : undefined
    const selectedOccurrence = dialog?.kind === 'event'
      ? [...(week?.occurrences ?? []), ...(agenda ?? [])].find(item => occurrenceKeyOf(item) === occurrenceKeyOf(dialog.occurrence)) ?? dialog.occurrence
      : undefined
    const weekCount = week?.occurrences?.length ?? 0
    /** The week on screen is today's, so an entry started from here means today. */
    const createDate = displayMode === 'month' ? (monthAnchor === monthStart(localDate()) ? localDate() : monthAnchor) : anchor === startOfWeek() ? localDate() : anchor
    const title = view.kind === 'week' ? '我的日历' : (current?.title ?? '日程')
    const subtitle = view.kind === 'week'
      ? displayMode === 'month' ? `${monthOf(monthAnchor)} · 月视图` : `${monthOf(anchor)}${dayNumber(anchor)}日 – ${shortDate(addDays(anchor, 6))} · ${weekCount} 条`
      : [current?.location, sourceName(current?.source), current && noteOf(current) !== '' ? '有备注' : ''].filter(Boolean).join(' · ')

    const menuItems = events.length === 0
      ? [{ type: 'label' as const, id: 'none', text: '还没有日程' }]
      : events.map((event: any) => ({
        id: `${event.source}\u0000${event.uid}`,
        label: `${event.source === 'manual' ? event.title : `${event.title}（${sourceName(event.source)}）`}${event.exceptions?.length ? ` · 已取消 ${event.exceptions.length} 次` : ''}`,
        icon: React.createElement(IconClock),
      }))

    return React.createElement('div', {
      onDragEnter: (event: any) => { if (event.dataTransfer?.types?.includes('Files')) { event.preventDefault(); setDropping(true) } },
      onDragOver: (event: any) => { if (event.dataTransfer?.types?.includes('Files')) event.preventDefault() },
      onDragLeave: (event: any) => { if (event.currentTarget === event.target) setDropping(false) },
      onDrop: async (event: any) => {
        event.preventDefault()
        setDropping(false)
        const file = event.dataTransfer?.files?.[0]
        if (!file) return
        try {
          const text = await readCalendarFile(file)
          setView({ kind: 'week' })
          setDialog({ kind: 'import', text, name: file.name })
        } catch (error) {
          setProblem(messageOf(error))
        }
      },
      style: {
        position: 'relative', height: '100%', display: 'flex', flexDirection: 'column',
        minHeight: 0, background: PAGE_BACKGROUND, color: PRIMARY,
      },
    },
    // Header: what is on screen, then the ways to move and to read or write a calendar file.
    React.createElement('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: '12px 16px', borderBottom: CARD_BORDER, flex: '0 0 auto',
      },
    },
    view.kind === 'event'
      ? React.createElement(Button, {
        variant: 'ghost', size: 'sm', icon: React.createElement(IconChevronLeft),
        onClick: () => setView({ kind: 'week' }),
      }, '返回')
      : undefined,
    React.createElement('div', { style: { minWidth: 0 } },
      React.createElement('div', { style: { fontSize: 16, fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, title),
      React.createElement('div', { style: { fontSize: 12, color: SECONDARY } }, loading ? '正在读取…' : subtitle)),
    React.createElement('span', { style: { flex: '1 1 auto' } }),
    view.kind === 'week'
      ? React.createElement(React.Fragment, null,
        React.createElement('div', { role: 'group', 'aria-label': '日历视图', style: { display: 'flex', gap: 2, padding: 3, borderRadius: 10, background: LAYER, marginRight: 6 } },
          ...(['week', 'month'] as const).map(mode => React.createElement(Button, {
            key: mode, size: 'sm', variant: displayMode === mode ? 'outline' : 'ghost', 'aria-pressed': displayMode === mode,
            onClick: () => {
              if (mode === displayMode) return
              if (mode === 'month') setMonthAnchor(monthStart(anchor === startOfWeek() ? localDate() : anchor))
              else setAnchor(startOfWeek(monthAnchor === monthStart(localDate()) ? localDate() : monthAnchor))
              setDisplayMode(mode)
            },
          }, mode === 'week' ? '周' : '月'))),
        React.createElement(Button, {
          variant: 'outline', size: 'sm',
          onClick: () => { setAnchor(startOfWeek()); setMonthAnchor(monthStart(localDate())) },
        }, '今天'),
        ...[-1, 1].map(direction => {
          const label = `${direction < 0 ? '上一' : '下一'}${displayMode === 'month' ? '月' : '周'}`
          return React.createElement(Tooltip, { key: direction, label, side: 'bottom' },
            React.createElement(Button, {
              variant: 'ghost', size: 'sm', 'aria-label': label,
              icon: React.createElement(direction < 0 ? IconChevronLeft : IconChevronRight),
              onClick: () => displayMode === 'month' ? setMonthAnchor(shiftMonth(monthAnchor, direction)) : setAnchor(addDays(anchor, direction * 7)),
            }))
        }))
      : undefined,
    React.createElement(Button, {
      variant: 'primary', size: 'sm', icon: React.createElement(IconPlus),
      onClick: () => setDialog({ kind: 'create', date: view.kind === 'event' && current ? dateOf(current.start) : createDate }),
    }, '新建日程'),
    React.createElement(Menu, {
      open: menuOpen,
      onClose: () => setMenuOpen(false),
      items: menuItems,
      selectedId: view.kind === 'event' ? `${view.source}\u0000${view.id}` : undefined,
      onSelect: (id: string) => {
        const [source, uid] = String(id).split('\u0000')
        if (events.some((event: any) => event.uid === uid && event.source === source)) openEvent(uid, source)
      },
      align: 'end',
      anchor: React.createElement(Button, {
        variant: 'ghost', size: 'sm',
        icon: React.createElement(IconClock),
        onClick: () => setMenuOpen(!menuOpen),
      }, '日程', React.createElement(IconChevronDown)),
    }),
    React.createElement(Button, {
      variant: 'ghost', size: 'sm', icon: React.createElement(IconFolderOpen),
      onClick: () => setDialog({ kind: 'import' }),
    }, '导入'),
    React.createElement(Button, {
      variant: 'ghost', size: 'sm', icon: React.createElement(IconDownload),
      onClick: () => setDialog({ kind: 'export' }),
    }, '导出'),
    React.createElement(Button, { variant: 'ghost', size: 'sm', 'aria-label': '提醒记录', onClick: () => setDialog({ kind: 'reminders' }) },
      reminderInbox.unread ? `提醒 · ${reminderInbox.unread}` : '提醒'),
    React.createElement(Tooltip, { label: '刷新', side: 'bottom' },
      React.createElement(Button, {
        variant: 'ghost', size: 'sm', 'aria-label': '刷新', disabled: loading,
        icon: React.createElement(IconRefresh),
        onClick: () => void refresh(),
      }))),
    view.kind === 'week' && events.length > 0
      ? React.createElement('div', { role: 'group', 'aria-label': '筛选日历', style: { display: 'flex', gap: 6, padding: '9px 16px', overflowX: 'auto', flex: '0 0 auto', borderBottom: HAIRLINE } },
        ...['*', ...new Set(events.map((event: any) => event.source))].map((source: any) => React.createElement(Button, {
          key: source, size: 'sm', variant: calendarSource === source ? 'outline' : 'ghost', 'aria-pressed': calendarSource === source,
          onClick: () => setCalendarSource(source), style: { whiteSpace: 'nowrap', borderRadius: 20 },
        }, source !== '*' ? React.createElement('span', { 'aria-hidden': true, style: { display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: tintOf(source).accent, marginRight: 6 } }) : undefined,
        source === '*' ? '全部日历' : sourceName(source))),
        calendarSource !== '*' && calendarSource !== 'manual' && !calendarSource.startsWith('sync:')
          ? React.createElement(Button, { size: 'sm', variant: 'ghost', disabled: busy, onClick: () => setDialog({ kind: 'delete-calendar', source: calendarSource }), style: { marginLeft: 'auto', whiteSpace: 'nowrap' } }, '删除所选日历')
          : undefined)
      : undefined,
    problem
      ? React.createElement('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 16px', fontSize: 12, flex: '0 0 auto',
          color: 'var(--dsw-alias-state-error-primary, #d4553f)', background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #d4553f) 8%, transparent)',
        },
      },
      React.createElement(IconWarning), problem)
      : undefined,
    sourceStatuses.length > 0 ? React.createElement('div', { role: 'status', style: { display: 'flex', gap: 12, flexWrap: 'wrap', padding: '6px 16px', fontSize: 12, color: SECONDARY } },
      ...sourceStatuses.map(item => React.createElement('span', { key: item.source }, `${item.label}：${item.state === 'error' ? '同步失败，保留上次数据' : item.state === 'loading' ? '同步中' : item.state === 'ready' ? '已更新' : '等待同步'}`))) : undefined,
    view.kind === 'week'
      ? React.createElement(displayMode === 'month' ? MonthGrid : WeekGrid, {
          anchor: displayMode === 'month' ? monthAnchor : anchor,
          tintOf, occurrenceKeyOf,
          occurrences: (week?.occurrences ?? []).filter((item: any) => calendarSource === '*' || item.source === calendarSource),
          noteIndex,
          onSelect: (occurrence: any) => setDialog({ kind: 'event', occurrence }),
          onCreate: createAt,
        })
      : React.createElement(EventPage, {
        key: JSON.stringify([view.source, view.id]),
        event: current,
        sourceName,
        service, run,
        agenda,
        noteIndex,
        busy,
        onOpenOccurrence: (occurrence: any) => setDialog({ kind: 'event', occurrence }),
        onRestore: (event: any, date: string) => run(() => service.restoreOccurrence({ uid: event.uid, date, source: event.source }), `已恢复 ${shortDate(date)} 的日程`),
        onDelete: (event: any) => run(() => service.deleteEvent({ uid: event.uid, source: event.source }), '已删除这条日程')
          .then((ok: boolean) => { if (ok) setView({ kind: 'week' }) }),
        onCancel: (occurrence: any) => run(
          () => service.cancelOccurrence({ uid: occurrence.uid, date: occurrence.occurrenceDate ?? dateOf(occurrence.start), source: occurrence.source }),
          `已取消 ${shortDate(occurrence.occurrenceDate ?? dateOf(occurrence.start))} 的日程`,
        ),
      }),
    dialog?.kind === 'event'
      ? React.createElement(EventDialog, {
        occurrence: selectedOccurrence,
        sourceName,
        event: events.find((item: any) =>
      item.uid === dialog.occurrence?.uid && item.source === dialog.occurrence?.source),
        note: occurrenceNote(noteIndex, dialog.occurrence),
        service,
        run,
        onEdit: openEvent,
        onClose: () => setDialog(null),
      })
      : undefined,
    dialog?.kind === 'create'
      ? React.createElement(CreateDialog, {
        defaultDate: dialog.date,
        defaultStart: dialog.start,
        defaultEnd: dialog.end,
        service,
        run,
        onSaved: () => setDialog(null),
        onClose: () => setDialog(null),
      })
      : undefined,
    dialog?.kind === 'import'
      ? React.createElement(ImportDialog, {
        initialText: dialog.text,
        initialName: dialog.name,
        calendars: [...new Set(events.map((event: any) => event.source).filter((name: any) => name && name !== 'manual' && !name.startsWith('sync:')))],
        service,
        run,
        onClose: () => { setDialog(null); void refresh() },
      })
      : undefined,
    dialog?.kind === 'reminders'
      ? React.createElement(Modal, {
        open: true, title: '提醒记录', closeLabel: '关闭', onClose: () => setDialog(null),
        footer: React.createElement(Button, { variant: 'ghost', size: 'sm', onClick: () => setDialog(null) }, '关闭'),
      }, React.createElement('p', { role: 'status', style: { fontSize: 12, color: SECONDARY } },
        reminderInbox.channel === 'system' ? '桌面通知已接入。系统勿扰和应用通知设置可能阻止弹窗。'
          : reminderInbox.channel === 'unavailable' ? '系统通知暂不可用，提醒记录仍保留在这里。' : '当前使用应用内提醒。系统弹窗请在新版桌面端使用。'),
      React.createElement('p', { style: { fontSize: 12, color: SECONDARY } }, '需保持 EduWork 运行。重启后补发最近24小时内的到点提醒；记录保留30天，此处显示最近100条。'),
      reminderInbox.items.length === 0 ? React.createElement('p', null, '还没有到点提醒')
        : React.createElement('ul', { style: { padding: 0, listStyle: 'none' } }, ...reminderInbox.items.map((item: any) => React.createElement('li', { key: item.id, style: { borderBottom: HAIRLINE, padding: '12px 0', display: 'flex', alignItems: 'center', gap: 12 } },
          React.createElement('div', { style: { flex: 1 } }, React.createElement('strong', null, item.title),
            React.createElement('div', { style: { fontSize: 12, color: SECONDARY, marginTop: 4 } }, `${item.at.replace('T', ' ')} · ${sourceName(item.ref.source)} · ${item.kind === 'fixed' ? '固定提醒' : '提前提醒'}`)),
          item.read ? React.createElement(Muted, null, '已读') : React.createElement(Button, { variant: 'outline', size: 'sm', disabled: busy,
            onClick: () => run(() => service.ackReminder({ id: item.id }), '已标为已读'),
          }, '标为已读')))))
      : undefined,
    dialog?.kind === 'delete-calendar'
      ? React.createElement(Modal, {
        open: true, title: '删除导入日历', closeLabel: '关闭', onClose: () => { if (!busy) setDialog(null) },
        footer: React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
          React.createElement(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => setDialog(null) }, '取消'),
          React.createElement(Button, { variant: 'primary', size: 'sm', disabled: busy, style: { background: 'var(--dsw-alias-state-error-primary, #d4553f)' },
            onClick: () => run(() => service.deleteCalendar({ source: dialog.source }), '已删除导入日历，私人笔记与备注已保留').then(ok => { if (ok) { setDialog(null); setCalendarSource('*') } }),
          }, busy ? '正在删除…' : '删除日历')),
      }, React.createElement('p', null, `确定删除“${sourceName(dialog.source)}”及其中的全部日程？`),
      React.createElement('p', null, '私人笔记、备注和提醒设置会保留，可通过智能体查看失联笔记。重新导入同一日历后，仍可关联到同编号的日程。'))
      : undefined,
    dialog?.kind === 'export'
      ? React.createElement(ExportDialog, { service, toast: setToast, onClose: () => setDialog(null) })
      : undefined,
    toast
      ? React.createElement(Toast, { text: toast, onDone: () => setToast(null) })
      : undefined,
    dropping
      ? React.createElement('div', {
        'aria-hidden': true,
        style: {
          position: 'fixed', inset: 0, zIndex: 90, display: 'grid', placeItems: 'center', pointerEvents: 'none',
          background: 'color-mix(in srgb, var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, .32)) 82%, transparent)',
          backdropFilter: 'blur(5px)',
        },
      },
      React.createElement('div', {
        style: {
          padding: '22px 28px', textAlign: 'center', borderRadius: 16,
          border: '1px dashed var(--dsw-alias-border-l2, #0000002e)',
          background: 'var(--dsw-alias-bg-module-platform, #fff)', color: PRIMARY,
          boxShadow: '0 18px 50px rgba(0, 0, 0, .16)',
        },
      },
      React.createElement('div', { style: { fontSize: 28 } }, '⇩'),
      React.createElement('strong', { style: { display: 'block', fontSize: 14 } }, '松开即可导入日历'),
      React.createElement(Muted, null, '.ics 文件会读进导入窗口，确认后再写入')))
      : undefined)
  }
}

/** Sidebar glyph: a month grid with one marked day. */
function CalendarIcon(props: any) {
  return React.createElement('svg', {
    width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true,
    stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round',
    ...props,
  },
  React.createElement('rect', { x: 2, y: 3, width: 12, height: 11, rx: 2 }),
  React.createElement('path', { d: 'M2 6.5h12M5.5 2v2.5M10.5 2v2.5' }),
  React.createElement('path', { d: 'M5 9.5h2.5v2.5H5z', fill: 'currentColor', stroke: 'none' }))
}

export async function apply(ctx: any) {
  // The descriptors the package publishes as "./remote" are what makes the
  // host `calendar` service callable from this half.
  const disposeRemote = await ctx.remote.$mount(calendarRemote)
  ctx.inject(['remote.calendar'], (surface: any) => {
    // The gateway checks the argument count of every call, so the one method
    // that takes none is called with none.
    const call = (method: string) => (input?: any) => unwrap(surface.remote.calendar[method](input))
    const service = {
      snapshot: () => unwrap(surface.remote.calendar.snapshot()),
      sourceStatuses: () => unwrap(surface.remote.calendar.sourceStatuses()),
      reminders: () => unwrap(surface.remote.calendar.reminders()),
      ackReminder: call('ackReminder'),
      subscribe(listener: () => void) {
        let active = true
        const controller = new AbortController()
        let stream: any
        let retry: ReturnType<typeof setTimeout> | undefined
        const observe = async () => {
          try {
            stream = surface.remote.calendar.changes(controller.signal)
            for await (const _change of stream) { if (active) listener() }
          } catch { /* Carrier loss ends a generation; reopen after reconnect. */ }
          finally { if (active) retry = setTimeout(() => { void observe() }, 1000) }
        }
        void observe()
        return () => { active = false; clearTimeout(retry); controller.abort(); stream?.dispose?.() }
      },
      occurrences: call('occurrences'),
      importIcs: call('importIcs'),
      exportIcs: call('exportIcs'),
      applyOverride: call('applyOverride'),
      removeOverride: call('removeOverride'),
      cancelOccurrence: call('cancelOccurrence'),
      restoreOccurrence: call('restoreOccurrence'),
      deleteEvent: call('deleteEvent'),
      deleteCalendar: call('deleteCalendar'),
      putEvent: call('putEvent'),
      updateEvent: call('updateEvent'),
      applySource: call('applySource'),
      putNote: call('putNote'),
      removeNote: call('removeNote'),
      notes: call('notes'),
      setPersonal: call('setPersonal'),
      personalFor: call('personalFor'),
      unlinkedNotes: () => unwrap(surface.remote.calendar.unlinkedNotes({})),
    }
    surface.slots.inject('main', () => surface.slots.register(
      { name: 'main', key: PANEL_ID },
      createCalendarPage(service),
    ))
    surface.slots.inject('sidebar.panellist', () => surface.slots.register(
      { name: 'sidebar.panellist', id: PANEL_ID, order: 100, label: '日历' },
      CalendarIcon,
    ))
  })
  return async () => { await disposeRemote() }
}
