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
import { Button, Input, Menu, Modal, Switch, Tag, Toast, Tooltip, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import calendarRemote from '../lib/typert.remote-client.js'
import { dayWindow, layoutWeek, minutesOf, shiftedEnd } from './layout.js'

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

/** Source an import writes unless the reader says otherwise; the scope that is replaced. */
const DEFAULT_SOURCE = 'ics'

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

/** Unwrap one remote result: the gateway answers with `{ ok, value }` or `{ ok, error }`. */
async function unwrap(operation: any) {
  const result = await operation
  if (result?.ok === true) return result.value
  throw new Error(result?.error?.message || result?.error?.code || '日历数据不可用')
}

/** The note of a record: a field of its own, written out as `DESCRIPTION`. */
const noteOf = (event: any) => (typeof event?.description === 'string' ? event.description : '')

/** One line describing how often a stored series repeats. */
function seriesSummary(event: any) {
  if (!event.recurrence) return '单次'
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
function Block({ entry, axisStart, tint, onSelect }: any) {
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
function WeekGrid({ anchor, occurrences, onSelect, onCreate }: any) {
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
      for (let date = from; date <= to; date = addDays(date, 1)) {
        const list = map.get(date)
        if (list) list.push(occurrence)
        else map.set(date, [occurrence])
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
      ...list.slice(0, 2).map((occurrence: any) => {
        const tint = tintOf(occurrence.source ?? occurrence.uid)
        const span = occurrence.end && dateOf(occurrence.end) > dateOf(occurrence.start)
          ? `${shortDate(dateOf(occurrence.start))}–${shortDate(dateOf(occurrence.end))}`
          : shortDate(dateOf(occurrence.start))
        const label = `全天 · ${span} ${occurrence.title}`
        return React.createElement('button', {
          key: occurrence.occurrenceId,
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
    key: entry.occurrence.occurrenceId,
    entry,
    axisStart: axis.start,
    tint: tintOf(entry.occurrence.source ?? entry.occurrence.uid),
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
function EventDialog({ occurrence, event, service, onClose, run, onEdit }: any) {
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [form, setForm] = useState({
    start: occurrence?.start ?? '',
    end: occurrence?.end ?? '',
    location: occurrence?.location ?? '',
  })
  useEffect(() => {
    setEditing(false)
    setConfirming(false)
    setForm({ start: occurrence?.start ?? '', end: occurrence?.end ?? '', location: occurrence?.location ?? '' })
  }, [occurrence])

  if (!occurrence) return null
  const date = occurrence.occurrenceDate ?? dateOf(occurrence.start)
  const series = Boolean(event?.recurrence)
  // A whole-day entry has no clock to move, so its dialog points at the page that
  // owns the date and the place instead of offering two blank time fields.
  const wholeDay = clockOf(occurrence.start) === ''
  const changed = form.start !== (occurrence.start ?? '') || form.end !== (occurrence.end ?? '') || form.location !== (occurrence.location ?? '')
  // The form opens with the occurrence's own end filled in, so a start that moved
  // on its own would carry the old clock time over and could finish before it
  // begins. Leaving the end as it opened means "same length", not "same clock".
  const keptLength = !wholeDay && form.end === (occurrence.end ?? '')
    ? shiftedEnd(form.start, occurrence.start ?? form.start, occurrence.end ?? '')
    : undefined
  const patch = withoutEmpty({
    start: form.start !== occurrence.start ? form.start : undefined,
    end: keptLength ?? (form.end !== (occurrence.end ?? '') ? form.end : undefined),
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
    ? service.applyOverride({ uid: occurrence.uid, date, patch })
    : service.putEvent(withoutEmpty({
      ...event,
      start: patch.start ?? event?.start,
      end: patch.end ?? event?.end,
      location: patch.location ?? event?.location,
    })))

  const actions = []
  if (!editing) {
    actions.push(React.createElement(Button, {
      key: 'when', variant: 'outline', size: 'sm',
      onClick: () => (wholeDay && event ? onEdit(event.uid) : setEditing(true)),
    }, wholeDay ? '改日期或地点' : series ? '改期或改地点' : '改时间或地点'))
  }
  // The dialog speaks for one occurrence; the title, the date and the repeat
  // rule belong to the record, and the record has a page of its own.
  if (event) {
    actions.push(React.createElement(Button, {
      key: 'record', variant: 'ghost', size: 'sm', onClick: () => onEdit(event.uid),
    }, '编辑日程信息'))
  }
  if (occurrence.overridden) {
    actions.push(React.createElement(Button, {
      key: 'undo', variant: 'ghost', size: 'sm', disabled: false,
      onClick: () => run(() => service.removeOverride({ uid: occurrence.uid, date }), '已恢复原定安排').then(ok => ok && onClose()),
    }, '撤销改期'))
  }
  if (series) {
    actions.push(React.createElement(Button, {
      key: 'cancel', variant: 'ghost', size: 'sm',
      onClick: () => run(() => service.cancelOccurrence({ uid: occurrence.uid, date }), `已取消：${shortDate(date)}`).then(ok => ok && onClose()),
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
        `${monthOf(date)}${dayNumber(date)}日 ${weekdayOf(date)} ${clockRange(occurrence)}`),
      occurrence.overridden ? React.createElement(Tag, { tone: 'info' }, '已改期') : undefined,
      series ? React.createElement(Tag, { tone: 'outline' }, '重复日程中的一次') : React.createElement(Tag, { tone: 'quiet' }, '单次日程')),
    occurrence.location
      ? React.createElement('div', { style: { fontSize: 13, color: PRIMARY } }, `地点：${occurrence.location}`)
      : undefined,
    occurrence.description
      ? React.createElement('div', { style: { fontSize: 12, color: SECONDARY, whiteSpace: 'pre-wrap' } }, occurrence.description)
      : undefined,
    event?.source ? React.createElement('div', null, React.createElement(Muted, null, `来源：${event.source}`)) : undefined,
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
        onClick: () => run(() => service.deleteEvent({ uid: occurrence.uid }), '已删除这条日程').then(ok => ok && onClose()),
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

/** The import dialog: drop a file or paste text, then read what the import did. */
function ImportDialog({ initialText, initialName, service, onClose, run }: any) {
  const [text, setText] = useState(initialText ?? '')
  const [source, setSource] = useState(DEFAULT_SOURCE)
  const [replace, setReplace] = useState(true)
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
      setProblem(null)
    } catch (error) {
      setProblem(messageOf(error))
    }
  }, [])

  const submit = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const result = await service.importIcs({ text, source: source.trim() === '' ? DEFAULT_SOURCE : source.trim(), replace })
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
      ? `来源 ${source.trim() === '' ? DEFAULT_SOURCE : source.trim()}`
      : '粘贴日历文本，或把 .ics 文件拖到这里；同一来源的旧记录会被替换，自己手动改过的记录不受影响。',
    footer: React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
      outcome
        ? React.createElement(React.Fragment, null,
          React.createElement(Button, { variant: 'ghost', size: 'sm', onClick: () => { setOutcome(null); setText(''); setName('') } }, '再导一份'),
          React.createElement('span', { style: { flex: '1 1 auto' } }),
          React.createElement(Button, { variant: 'primary', size: 'sm', onClick: onClose }, '完成'))
        : React.createElement(React.Fragment, null,
          React.createElement(Muted, null, count > 0 ? `识别到 ${count} 条日程` : '等待日历文本'),
          React.createElement('span', { style: { flex: '1 1 auto' } }),
          React.createElement(Button, { variant: 'ghost', size: 'sm', onClick: onClose }, '取消'),
          React.createElement(Button, { variant: 'primary', size: 'sm', disabled: text.trim() === '' || busy, onClick: submit }, busy ? '正在导入…' : '导入'))),
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
          React.createElement(Field, { label: '来源', hint: '同一来源再次导入会替换它自己的旧记录' },
            React.createElement(Input, { value: source, onChange: (event: any) => setSource(event.target.value) }))),
        React.createElement('div', { style: { paddingBottom: 18 } },
          React.createElement(Switch, { checked: replace, onChange: setReplace, label: '替换同来源的旧记录' }))),
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
function EventRow({ occurrence, tint, onOpen, onCancel, onDelete }: any) {
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
    occurrence.overridden ? React.createElement(Tag, { tone: 'info' }, '已改期') : undefined),
  React.createElement('div', { style: { marginTop: 2, fontSize: 12, color: SECONDARY, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
    [clockRange(occurrence), occurrence.location].filter(Boolean).join(' · '))),
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

/** The editable fields of a stored record, as the form holds them. */
const draftOf = (event: any) => ({
  title: event?.title ?? '',
  date: dateOf(event?.start ?? '') || localDate(),
  start: clockOf(event?.start),
  end: clockOf(event?.end),
  location: event?.location ?? '',
  description: noteOf(event),
  repeat: Boolean(event?.recurrence),
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
      ? (draft.end === '' ? undefined : `${draft.date}T${draft.end}`)
      : (base.end ? addDays(dateOf(base.end), shift) : undefined),
    location: draft.location.trim(),
    description: draft.description.trim(),
    // A single entry owns no series bookkeeping: turning the repeat off drops the
    // dates that were cancelled or moved while it was a series.
    recurrence: draft.repeat ? withoutEmpty({ ...(base.recurrence ?? {}), freq: 'weekly', until: draft.until }) : undefined,
    exceptions: draft.repeat ? base.exceptions : undefined,
    overrides: draft.repeat ? base.overrides : undefined,
  })
}

/** Why a draft cannot be saved yet, or `null` when it can. */
function draftProblem(draft: any) {
  if (draft.title.trim() === '') return '标题不能为空'
  if (draft.date === '') return '需要选一个日期'
  if (draft.start !== '' && draft.end !== '' && draft.end <= draft.start) return '结束时间要晚于开始时间'
  return null
}

/**
 * The fields of one record, shared by the new-entry dialog and the entry page:
 * what the reader owns about an entry, as opposed to one date of a series.
 */
function EventForm({ draft, onChange, autoFocus }: any) {
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
    React.createElement(Field, { label: '地点' },
      React.createElement(Input, {
        value: draft.location, placeholder: '可留空',
        onChange: (event: any) => set({ location: event.target.value }),
      })),
    React.createElement(Field, { label: '备注', hint: '随导出写进日历，不会同步到任何服务' },
      React.createElement('textarea', {
        value: draft.description, rows: 3, spellCheck: false,
        onChange: (event: any) => set({ description: event.target.value }),
        style: {
          width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: 8, resize: 'vertical',
          border: CARD_BORDER, background: 'var(--dsw-alias-bg-layer-1, #fff)', color: PRIMARY, fontSize: 13,
          fontFamily: 'inherit', lineHeight: 1.5,
        },
      })),
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 } },
      React.createElement(Switch, {
        checked: draft.repeat, label: '每周重复',
        onChange: (next: boolean) => set({ repeat: next, until: next ? draft.until : '' }),
      }),
      React.createElement('span', { style: { fontSize: 13, color: PRIMARY } }, '每周重复'),
      React.createElement(Muted, null, '按开始日期的星期')),
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
  const complaint = draftProblem(draft)

  const submit = async () => {
    if (complaint) {
      setProblem(complaint)
      return
    }
    const created = await run(() => service.putEvent(recordOf(draft)), '已新建日程')
    if (created) onSaved()
  }

  return React.createElement(Modal, {
    open: true,
    onClose,
    title: '新建日程',
    closeLabel: '关闭',
    description: '写进本机日历，随时可以再改。',
    footer: React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
      React.createElement(Muted, null, draft.repeat ? '每周重复' : '单次日程'),
      React.createElement('span', { style: { flex: '1 1 auto' } }),
      React.createElement(Button, { variant: 'ghost', size: 'sm', onClick: onClose }, '取消'),
      React.createElement(Button, {
        variant: 'primary', size: 'sm', disabled: Boolean(complaint), onClick: submit,
      }, '新建')),
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
function EventPage({ event, agenda, onOpenOccurrence, onSave, onRestore, onCancel, onDelete, busy }: any) {
  const [draft, setDraft] = useState(() => draftOf(event))
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => { setDraft(draftOf(event)); setProblem(null) }, [event])
  const uuid = event?.uid
  const occurrences = useMemo(
    () => (agenda ?? []).filter((occurrence: any) => occurrence.uid === uuid),
    [agenda, uuid],
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
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(event))

  const save = () => {
    if (complaint) {
      setProblem(complaint)
      return
    }
    if (dirty) onSave(recordOf(draft, event))
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
    event.source ? React.createElement(Muted, null, event.source) : undefined),
  React.createElement(EventForm, { draft, onChange: setDraft }),
  React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
    React.createElement(Button, {
      variant: 'primary', size: 'sm', disabled: !dirty || busy || Boolean(complaint), onClick: save,
    }, '保存更改'),
    dirty ? React.createElement(Muted, null, complaint ?? '有未保存的改动') : undefined,
    React.createElement('span', { style: { flex: '1 1 auto' } }),
    React.createElement(Button, {
      variant: 'ghost', size: 'sm', icon: React.createElement(IconTrash),
      style: { color: 'var(--dsw-alias-state-error-primary, #d4553f)' },
      onClick: () => onDelete(event),
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
      key: occurrence.occurrenceId,
      occurrence,
      tint,
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

/** The panel: the week, the entry list behind a menu, and the dialogs. */
function createCalendarPage(service: any) {
  return function CalendarPanel() {
    const [view, setView] = useState<{ kind: string; id?: string }>({ kind: 'week' })
    const [anchor, setAnchor] = useState(() => startOfWeek())
    const [snapshot, setSnapshot] = useState<any>(null)
    const [week, setWeek] = useState<any>(null)
    const [agenda, setAgenda] = useState<any>(null)
    const [loading, setLoading] = useState(true)
    const [problem, setProblem] = useState<string | null>(null)
    const [toast, setToast] = useState<string | null>(null)
    const [menuOpen, setMenuOpen] = useState(false)
    const [dialog, setDialog] = useState<any>(null)
    const [dropping, setDropping] = useState(false)
    const [busy, setBusy] = useState(false)

    const events = snapshot?.events ?? []
    const weekRange = { from: anchor, to: addDays(anchor, 6) }
    const agendaRange = { from: addDays(localDate(), -180), to: addDays(localDate(), 366) }

    const loadSnapshot = useCallback(async () => { setSnapshot(await service.snapshot()) }, [service])
    const loadWeek = useCallback(async () => { setWeek(await service.occurrences(weekRange)) }, [service, anchor])
    const loadAgenda = useCallback(async () => { setAgenda((await service.occurrences(agendaRange)).occurrences) }, [service, view.id])

    const refresh = useCallback(async () => {
      setLoading(true)
      try {
        await loadSnapshot()
        if (view.kind === 'week') await loadWeek()
        if (view.kind === 'event') await loadAgenda()
        setProblem(null)
      } catch (error) {
        setProblem(messageOf(error))
      } finally {
        setLoading(false)
      }
    }, [loadSnapshot, loadWeek, loadAgenda, view.kind])

    useEffect(() => { void refresh() }, [refresh])

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

    const openEvent = useCallback((uid: string) => {
      setDialog(null)
      setMenuOpen(false)
      setView({ kind: 'event', id: uid })
    }, [])

    /** A drag or a double click in the week asks for a new entry over that span. */
    const createAt = useCallback((date: string, from: number, to: number) => {
      setDialog({ kind: 'create', date, start: clockAt(from), end: clockAt(Math.max(to, from + 15)) })
    }, [])

    const current = view.kind === 'event' ? events.find((event: any) => event.uid === view.id) : undefined
    const weekCount = week?.occurrences?.length ?? 0
    /** The week on screen is today's, so an entry started from here means today. */
    const createDate = anchor === startOfWeek() ? localDate() : anchor
    const title = view.kind === 'week' ? '我的日历' : (current?.title ?? '日程')
    const subtitle = view.kind === 'week'
      ? `${monthOf(anchor)}${dayNumber(anchor)}日 – ${shortDate(addDays(anchor, 6))} · ${weekCount} 条`
      : [current?.location, current?.source, current && noteOf(current) !== '' ? '有备注' : ''].filter(Boolean).join(' · ')

    const menuItems = events.length === 0
      ? [{ type: 'label' as const, id: 'none', text: '还没有日程' }]
      : events.map((event: any) => ({ id: event.uid, label: event.title, icon: React.createElement(IconClock) }))

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
        React.createElement(Button, {
          variant: 'outline', size: 'sm', disabled: anchor === startOfWeek(),
          onClick: () => setAnchor(startOfWeek()),
        }, '今天'),
        React.createElement(Tooltip, { label: '上一周', side: 'bottom' },
          React.createElement(Button, {
            variant: 'ghost', size: 'sm', 'aria-label': '上一周', icon: React.createElement(IconChevronLeft),
            onClick: () => setAnchor(addDays(anchor, -7)),
          })),
        React.createElement(Tooltip, { label: '下一周', side: 'bottom' },
          React.createElement(Button, {
            variant: 'ghost', size: 'sm', 'aria-label': '下一周', icon: React.createElement(IconChevronRight),
            onClick: () => setAnchor(addDays(anchor, 7)),
          })))
      : undefined,
    React.createElement(Button, {
      variant: 'primary', size: 'sm', icon: React.createElement(IconPlus),
      onClick: () => setDialog({ kind: 'create', date: view.kind === 'event' && current ? dateOf(current.start) : createDate }),
    }, '新建日程'),
    React.createElement(Menu, {
      open: menuOpen,
      onClose: () => setMenuOpen(false),
      items: menuItems,
      selectedId: view.id,
      onSelect: (id: string) => (events.some((event: any) => event.uid === id) ? openEvent(id) : undefined),
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
    React.createElement(Tooltip, { label: '刷新', side: 'bottom' },
      React.createElement(Button, {
        variant: 'ghost', size: 'sm', 'aria-label': '刷新', disabled: loading,
        icon: React.createElement(IconRefresh),
        onClick: () => void refresh(),
      }))),
    problem
      ? React.createElement('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 16px', fontSize: 12, flex: '0 0 auto',
          color: 'var(--dsw-alias-state-error-primary, #d4553f)', background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #d4553f) 8%, transparent)',
        },
      },
      React.createElement(IconWarning), problem)
      : undefined,
    view.kind === 'week'
      ? (events.length === 0 && weekCount === 0 && !loading
        ? React.createElement('div', { style: { flex: '1 1 auto', display: 'grid', placeItems: 'center', padding: 24 } },
          React.createElement('div', {
            style: { maxWidth: 380, padding: 20, borderRadius: 12, border: CARD_BORDER, background: LAYER, textAlign: 'center' },
          },
          React.createElement(IconAlarmClock),
          React.createElement('div', { style: { margin: '8px 0 4px', fontSize: 14, fontWeight: 600 } }, '日历还是空的'),
          React.createElement(Muted, null, '先新建一条日程，或把从教务系统、其他日历导出的 .ics 文件拖进这个面板。双击时间轴上的空白处也能新建。'),
          React.createElement('div', { style: { marginTop: 12, display: 'flex', gap: 8, justifyContent: 'center' } },
            React.createElement(Button, {
              variant: 'primary', size: 'sm', icon: React.createElement(IconPlus),
              onClick: () => setDialog({ kind: 'create', date: createDate }),
            }, '新建日程'),
            React.createElement(Button, {
              variant: 'outline', size: 'sm', icon: React.createElement(IconFolderOpen),
              onClick: () => setDialog({ kind: 'import' }),
            }, '导入日历'))))
        : React.createElement(WeekGrid, {
          anchor,
          occurrences: week?.occurrences ?? [],
          onSelect: (occurrence: any) => setDialog({ kind: 'event', occurrence }),
          onCreate: createAt,
        }))
      : React.createElement(EventPage, {
        event: current,
        agenda,
        busy,
        onOpenOccurrence: (occurrence: any) => setDialog({ kind: 'event', occurrence }),
        onSave: (event: any) => run(() => service.putEvent(event), '日程信息已保存'),
        onRestore: (event: any, date: string) => run(() => service.restoreOccurrence({ uid: event.uid, date }), `已恢复 ${shortDate(date)} 的日程`),
        onDelete: (event: any) => run(() => service.deleteEvent({ uid: event.uid }), '已删除这条日程')
          .then((ok: boolean) => { if (ok) setView({ kind: 'week' }) }),
        onCancel: (occurrence: any) => run(
          () => service.cancelOccurrence({ uid: occurrence.uid, date: occurrence.occurrenceDate ?? dateOf(occurrence.start) }),
          `已取消 ${shortDate(occurrence.occurrenceDate ?? dateOf(occurrence.start))} 的日程`,
        ),
      }),
    dialog?.kind === 'event'
      ? React.createElement(EventDialog, {
        occurrence: dialog.occurrence,
        event: events.find((item: any) => item.uid === dialog.occurrence?.uid),
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
        service,
        run,
        onClose: () => { setDialog(null); void refresh() },
      })
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
      occurrences: call('occurrences'),
      importIcs: call('importIcs'),
      exportIcs: call('exportIcs'),
      applyOverride: call('applyOverride'),
      removeOverride: call('removeOverride'),
      cancelOccurrence: call('cancelOccurrence'),
      restoreOccurrence: call('restoreOccurrence'),
      deleteEvent: call('deleteEvent'),
      putEvent: call('putEvent'),
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
