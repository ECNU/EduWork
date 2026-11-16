/** 日历原型的当日安排及详情，沿用宿主主题。 */
import React from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { addDays, localDate, parseDate } from './dates.js'

const h = React.createElement
const fullDate = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })

interface Entry {
  uid: string
  source: string
  title: string
  start: string
  end?: string
  location?: string
}

const time = (date: string) => date.slice(11, 16)
const endTime = (entry: Entry) => entry.end ?? entry.start
const isAllDay = (entry: Entry) => entry.start.length === 10

/** 筛选覆盖该日的日程，跨天定时日程以结束时间为开区间。 */
export function agendaFor(date: string, entries: Entry[]) {
  return entries.filter(entry => entry.start < addDays(date, 1)
    && (isAllDay(entry) || !entry.end ? endTime(entry).slice(0, 10) >= date : entry.end > `${date}T00:00`))
    .sort((left, right) => Number(isAllDay(right)) - Number(isAllDay(left)) || left.start.localeCompare(right.start))
}

export function TimetableSidebar({ open, onClose, children }: {
  open: boolean
  onClose: () => void
  children?: React.ReactNode
}) {
  return h(React.Fragment, null,
    open && h('button', { className: 'tt-sheet-mask', type: 'button', tabIndex: -1, 'aria-hidden': true, onClick: onClose }),
    h('aside', { className: 'tt-sidebar', 'data-open': open, 'aria-label': '日程侧栏' },
      h('button', { className: 'tt-sheet-close', type: 'button', onClick: onClose, 'aria-label': '收起日程侧栏' }, '×'),
      children))
}

export function DailyAgenda({ date, entries, onSelect, onCreate, onDate, tintOf }: {
  date: string
  entries: Entry[]
  onSelect: (entry: Entry) => void
  onCreate: () => void
  onDate: (date: string) => void
  tintOf: (key: string) => { accent: string }
}) {
  const now = new Date()
  const today = localDate(now)
  const instant = `${today}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const rows = agendaFor(date, entries)
  const next = date === today ? rows.find(entry => !isAllDay(entry) && entry.start > instant) : undefined
  const tomorrow = date === today && !next ? agendaFor(addDays(date, 1), entries).find(entry => entry.start.slice(0, 10) > today) : undefined
  return h(React.Fragment, null,
    h('header', { className: 'tt-panel-head' },
      h('span', { className: 'tt-panel-kicker' }, today === date ? '今天' : '当日安排'),
      h('h2', null, fullDate.format(parseDate(date)))),
    rows.length ? h('ol', { className: 'tt-agenda' }, ...rows.map(entry => {
      const current = !isAllDay(entry) && entry.start <= instant && instant < endTime(entry) && date === today
      const state = current ? 'active' : entry === next ? 'next' : undefined
      return h('li', { key: `${entry.source}:${entry.uid}:${entry.start}`, 'data-state': state },
        h('div', { className: 'tt-agenda-time' }, isAllDay(entry) ? '全天' : time(entry.start),
          !isAllDay(entry) && entry.end && h('small', null, time(entry.end))),
        h('button', {
          type: 'button', className: 'tt-agenda-entry', onClick: () => onSelect(entry),
          style: { '--tt-entry-accent': tintOf(entry.source).accent } as React.CSSProperties,
        }, h('strong', null, entry.title), entry.location && h('span', null, entry.location),
        state && h('small', null, current ? '进行中' : '下一项')))
    })) : h('p', { className: 'tt-empty' }, '当天没有安排'),
    tomorrow && h('button', { type: 'button', className: 'tt-tomorrow', onClick: () => onDate(addDays(date, 1)) },
      h('span', null, '明天'), h('strong', null, [time(tomorrow.start), tomorrow.title].filter(Boolean).join(' · '))),
    !rows.length && h('footer', { className: 'tt-panel-actions' }, h(Button, { size: 'sm', variant: 'ghost', onClick: onCreate }, '＋ 添加日程')))
}

export function TimetableDetails({ entry, source, remark, sourceDescription, note, recurrence, tint, actions, tools, onBack, children }: {
  entry: Entry
  source: string
  remark?: string
  sourceDescription?: string
  note?: string
  recurrence?: string
  tint: string
  actions: React.ReactNode
  tools: React.ReactNode
  onBack: () => void
  children?: React.ReactNode
}) {
  return h(React.Fragment, null,
    h('div', { className: 'tt-detail-nav' }, h(Button, { variant: 'ghost', size: 'sm', onClick: onBack }, '‹ 当日安排'), tools),
    h('header', { className: 'tt-panel-head tt-detail-head', style: { '--tt-entry-accent': tint } as React.CSSProperties },
      h('span', { className: 'tt-panel-kicker' }, source), h('h2', null, entry.title)),
    h('dl', { className: 'tt-detail-facts' },
      h('div', null, h('dt', null, '时间'), h('dd', null, fullDate.format(parseDate(entry.start.slice(0, 10))),
        h('span', null, isAllDay(entry) ? '全天' : [time(entry.start), time(endTime(entry))].filter((value, index, all) => index === 0 || value !== all[0]).join(' – ')))),
      entry.location && h('div', null, h('dt', null, '地点'), h('dd', null, entry.location)),
      recurrence && h('div', null, h('dt', null, '重复'), h('dd', null, recurrence))),
    [{ label: '来源说明', text: sourceDescription }, { label: '备注', text: remark }, { label: '笔记', text: note }]
      .filter(({ text }) => text).map(({ label, text }) => h('div', { key: label, className: 'tt-detail-text' }, h('span', null, label), h('p', null, text))),
    children,
    h('footer', { className: 'tt-panel-actions' }, actions))
}
