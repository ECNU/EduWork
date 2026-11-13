import React, { useState } from 'react'
import { occurrenceNote } from './personal-settings.js'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'

const pad = (n: number) => String(n).padStart(2, '0')
const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parse = (date: string) => {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day)
}
const shift = (date: string, days: number) => {
  const result = parse(date)
  result.setDate(result.getDate() + days)
  return local(result)
}
export const monthStart = (date: string) => `${date.slice(0, 7)}-01`
export const shiftMonth = (date: string, count: number) => {
  const result = parse(monthStart(date))
  result.setMonth(result.getMonth() + count)
  return local(result)
}
export function monthRange(date: string) {
  const first = monthStart(date)
  const from = shift(first, -((parse(first).getDay() + 6) % 7))
  return { from, to: shift(from, 41) }
}

const BORDER = '1px solid var(--dsw-alias-border-l1, #00000014)'
// The leading column appears only when a data plugin names the weeks, so a
// calendar without annotations keeps its plain seven-column grid.
const COLUMNS_PLAIN: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }
// Wide enough for one segment of a week label ("第 17 周") on its own line; a
// narrower column breaks the words mid-character instead.
const COLUMNS_WITH_WEEK: React.CSSProperties = { display: 'grid', gridTemplateColumns: '56px repeat(7, minmax(0, 1fr))' }
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

function coversDate(occurrence: any, date: string) {
  const start = occurrence.start.slice(0, 10)
  let end = occurrence.end?.slice(0, 10) ?? start
  // A timed interval ending at midnight does not occupy the next day.
  // All-day ends use the host's inclusive date representation.
  if (occurrence.end?.endsWith('T00:00') && end > start) end = shift(end, -1)
  return start <= date && end >= date
}

function MonthEntry({ occurrence, date, note, tint, identity, onSelect }: any) {
  const time = occurrence.start.length > 10
    ? occurrence.start.slice(0, 10) === date ? occurrence.start.slice(11, 16) : '续'
    : '全天'
  return React.createElement('button', {
    type: 'button',
    'data-occurrence': identity,
    'aria-label': `${date} ${time} ${occurrence.title}${note ? ` 笔记：${note}` : ''}`,
    onClick: () => onSelect(occurrence),
    style: {
      display: 'block', width: '100%', boxSizing: 'border-box', textAlign: 'left',
      padding: '5px 6px', marginBottom: 3, border: 0, borderLeft: `3px solid ${tint.accent}`, borderRadius: 5,
      background: tint.background,
      color: 'var(--dsw-alias-label-primary, #222)', font: 'inherit', fontSize: 12,
      cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    },
  }, `${time} ${occurrence.title}${note ? ' · 笔记' : ''}`)
}

/** A week label's tone as text colour; the grid's own weeks stay tertiary. */
const TONE_TEXT: Record<string, string> = {
  highlight: 'var(--dsw-alias-state-business-primary, #4d6bfe)',
  quiet: 'rgba(63,133,98,0.9)',
}
/** What a span's tone looks like washed over a whole day cell. */
const TONE_WASH: Record<string, string> = {
  highlight: 'rgba(77,107,254,0.06)',
  quiet: 'rgba(63,133,98,0.07)',
}

/** Calendar cells share occurrence identities with the week, including multi-day entries. */
export function MonthGrid({ anchor, occurrences, noteIndex, annotations, onSelect, onCreate, tintOf, occurrenceKeyOf }: any) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const range = monthRange(anchor)
  const today = local(new Date())
  const days = Array.from({ length: 42 }, (_, index) => shift(range.from, index))
  const weekLabel = (date: string) => (annotations?.weeks ?? []).find((week: any) => week.firstDay === date)
  const spanOfDay = (date: string) => (annotations?.spans ?? []).find((span: any) => span.firstDay <= date && date <= span.lastDay)
  // The week column exists only when something names the weeks: a calendar
  // without annotations keeps the plain seven-column grid it always had.
  const hasWeekColumn = days.some((date, index) => index % 7 === 0 && weekLabel(date))
  const columns = hasWeekColumn ? COLUMNS_WITH_WEEK : COLUMNS_PLAIN
  /** One row's leading cell: the data plugin's name for that week, if it has one. */
  const weekTag = (date: string) => {
    const week = weekLabel(date)
    // A label reads "第 17 周 · 考试周": each segment gets its own line rather
    // than letting a narrow column break the words mid-character.
    const parts = (week?.text ?? '').split(' · ').filter(Boolean)
    return React.createElement('div', {
      role: 'rowheader',
      title: week?.text,
      style: {
        minWidth: 0, padding: '8px 2px 0 4px', boxSizing: 'border-box', borderRight: BORDER, borderBottom: BORDER,
        fontSize: 10, lineHeight: '14px', textAlign: 'center', color: TONE_TEXT[week?.tone ?? ''],
        overflowWrap: 'anywhere',
      },
    }, ...parts.map((part, index) => React.createElement('div', { key: index, style: { whiteSpace: 'nowrap' } }, part)))
  }

  const cell = (date: string) => {
    const entries = occurrences.filter((item: any) => coversDate(item, date))
    const outside = date.slice(0, 7) !== anchor.slice(0, 7)
    const span = spanOfDay(date)
    return React.createElement('div', {
      key: date, role: 'gridcell', 'aria-label': date, title: span?.text,
      style: {
        minWidth: 0, minHeight: 112, padding: '6px 5px', boxSizing: 'border-box',
        borderRight: BORDER, borderBottom: BORDER,
        background: outside
          ? 'var(--dsw-alias-bg-layer-2, #f7f8fa)'
          : TONE_WASH[span?.tone ?? ''] ?? 'var(--dsw-alias-bg-base, #fff)',
      },
    },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 } },
      React.createElement('span', {
        'aria-current': date === today ? 'date' : undefined,
        style: {
          fontSize: 12, fontWeight: date === today ? 700 : 500, borderRadius: 20, padding: '3px 7px',
          color: date === today ? '#fff' : outside ? 'var(--dsw-alias-label-tertiary, #999)' : 'inherit',
          background: date === today ? 'var(--dsw-alias-state-business-primary, #4d6bfe)' : 'transparent',
        },
      }, Number(date.slice(8))),
      React.createElement(Button, {
        variant: 'ghost', size: 'sm', 'aria-label': `在 ${date} 新建日程`,
        onClick: () => onCreate(date, 9 * 60, 10 * 60),
      }, '+')),
    ...(expanded[date] ? entries : entries.slice(0, 3)).map((occurrence: any) => {
      const identity = occurrenceKeyOf(occurrence)
      return React.createElement(MonthEntry, {
        key: identity, occurrence, date, identity, onSelect,
        note: occurrenceNote(noteIndex, occurrence), tint: tintOf(occurrence.source ?? occurrence.uid),
      })
    }),
    entries.length > 3 ? React.createElement(Button, {
      variant: 'ghost', size: 'sm', 'aria-expanded': Boolean(expanded[date]),
      onClick: () => setExpanded({ ...expanded, [date]: !expanded[date] }),
    }, expanded[date] ? '收起' : `还有 ${entries.length - 3} 条`) : undefined)
  }

  return React.createElement('div', { style: { flex: '1 1 auto', minHeight: 0, overflow: 'auto' } },
    React.createElement('div', { role: 'grid', 'aria-label': '月日历', style: { minWidth: 640 } },
      React.createElement('div', { role: 'row', style: { ...columns, borderBottom: BORDER } },
        ...(hasWeekColumn ? [React.createElement('div', { key: 'week', role: 'columnheader', 'aria-label': '周标注' })] : []),
        ...WEEKDAYS.map(day => React.createElement('div', {
          key: day, role: 'columnheader',
          style: { padding: 10, textAlign: 'center', fontSize: 12, color: 'var(--dsw-alias-label-secondary, #666)' },
        }, day))),
      ...Array.from({ length: 6 }, (_, row) => React.createElement('div', {
        key: row, role: 'row', style: columns,
      }, ...(hasWeekColumn ? [weekTag(days[row * 7])] : []), ...days.slice(row * 7, row * 7 + 7).map(cell)))))
}
