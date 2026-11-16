/** 日历展示层，使用 FullCalendar 排版并沿用 EduWork 宿主的数据与编辑入口。 */
import React, { useLayoutEffect, useMemo, useRef } from 'react'
import { Calendar, type CalendarOptions, type EventInput } from 'fullcalendar'
import dayGrid from 'fullcalendar/daygrid'
import timeGrid from 'fullcalendar/timegrid'
import interaction from 'fullcalendar/interaction'
import monarch from 'fullcalendar/themes/monarch'
import zhCN from 'fullcalendar/locales/zh-cn'
import skeletonCss from 'fullcalendar/skeleton.css'
import monarchCss from 'fullcalendar/themes/monarch/theme.css'
import viewCss from './calendar-views.css'
import timetableCss from './timetable-prototype.css'
import { addDays, localDate, monthStart, parseDate } from './dates.js'
import { occurrenceNote } from './personal-settings.js'

const h = React.createElement
const nextDay = (date: string) => addDays(date.slice(0, 10), 1)
const short = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`
const minutes = (date: string) => Number(date.slice(11, 13)) * 60 + Number(date.slice(14, 16))
const eventBlockColor = (accent: string) => `color-mix(in srgb, ${accent} 17%, var(--cal-surface))`

interface Span {
  firstDay: string
  lastDay: string
  originalFirstDay?: string
  originalLastDay?: string
  text: string
  tone?: string
}

interface Occurrence {
  uid: string
  source: string
  title: string
  start: string
  end?: string
  location?: string
}

const startOf = (span: Span) => span.originalFirstDay ?? span.firstDay
const endOf = (span: Span) => span.originalLastDay ?? span.lastDay
const spanName = (span: Span) => span.text.replace(/^\d{4}[-–]\d{4}\s+/, '')
const phaseName = (span: Span) => spanName(span).split(' · ').at(-1) ?? span.text
const phases = (spans: Span[]) => spans.filter(span => span.tone === 'highlight' || span.tone === 'quiet')
const spanDates = (span: Span) => `${short(startOf(span))}–${short(endOf(span))}`

/** 挂载与宿主主题变量相连的日历样式。 */
export function CalendarStyles() {
  return h('style', null, [skeletonCss, monarchCss, viewCss, timetableCss].join('\n'))
}

/** 每个校历阶段仅在月份摘要中显示一次完整日期。 */
export function PhaseSummary({ spans, weekLabel }: { spans: Span[]; weekLabel?: string }) {
  const marked = phases(spans)
  if (marked.length === 0 && !weekLabel) return null
  return h('div', { className: 'cal-phase-summary', 'aria-label': '校历阶段' },
    weekLabel && h('span', { className: 'cal-week-label' }, weekLabel),
    ...marked.map(span => h('span', {
      className: 'cal-phase-key',
      'data-tone': span.tone,
      key: `${startOf(span)}:${span.text}`,
    }, h('i', { 'aria-hidden': true }), h('strong', null, phaseName(span)), h('span', null, spanDates(span)))))
}

interface CanvasProps {
  mode: 'month' | 'week'
  focusedDate: string
  occurrences: Occurrence[]
  noteIndex: Map<string, string>
  annotations: { weeks: Array<{ firstDay: string; text: string }>; spans: Span[] }
  tintOf: (key?: string) => { accent: string }
  occurrenceKeyOf: (entry: Occurrence) => string
  onSelect: (entry: Occurrence) => void
  onCreate: (date: string, from: number, to: number) => void
  onCreateDay: (date: string) => void
}

/** 月视图和周视图共享宿主持有的当前日期。 */
export function CalendarCanvas(props: CanvasProps) {
  const { mode, focusedDate, occurrences, annotations, tintOf, occurrenceKeyOf, noteIndex } = props
  const root = useRef<HTMLDivElement | null>(null)
  const instance = useRef<Calendar | null>(null)
  const callbacks = useRef(props)
  callbacks.current = props
  const type = mode === 'month' ? 'dayGridMonth' : 'timeGridWeek'
  const events = useMemo<EventInput[]>(() => [
    ...occurrences.map(entry => {
      const allDay = entry.start.length === 10
      const accent = tintOf(entry.source || entry.uid).accent
      const block = allDay || mode === 'week'
      const note = occurrenceNote(noteIndex, entry)
      return {
        id: occurrenceKeyOf(entry), title: entry.title, start: entry.start,
        end: allDay ? nextDay(entry.end ?? entry.start) : entry.end,
        allDay, display: block ? 'block' as const : 'list-item' as const,
        color: block ? eventBlockColor(accent) : accent,
        extendedProps: { entry, accent, block, note, order: allDay ? 1 : 2 },
      }
    }),
    ...phases(annotations?.spans ?? []).map(span => ({
      id: `phase:${span.firstDay}:${span.text}`, title: `${phaseName(span)} ${spanDates(span)}`,
      start: span.firstDay, end: nextDay(span.lastDay), allDay: true, display: 'block' as const,
      color: span.tone === 'quiet' ? 'var(--cal-rest-soft)' : 'var(--cal-accent-soft)',
      extendedProps: { span, order: 0 },
    })),
  ], [occurrences, annotations, mode, tintOf, occurrenceKeyOf, noteIndex])

  useLayoutEffect(() => {
    if (!root.current) return
    const options: CalendarOptions = {
      plugins: [monarch, dayGrid, timeGrid, interaction],
      locale: zhCN, firstDay: 1, initialView: type, initialDate: focusedDate,
      navLinks: true, navLinkHint: '查看 $0 的安排',
      navLinkDayClick: date => callbacks.current.onCreateDay(localDate(date)),
      headerToolbar: false, height: '100%', expandRows: true, fixedWeekCount: false,
      displayEventEnd: false, dayMaxEvents: true, moreLinkClick: 'popover',
      moreLinkContent: ({ num }) => `+${num} 项`,
      allDayText: '全天', nowIndicator: true,
      defaultTimedEventDuration: '00:45:00',
      slotDuration: '00:30:00', slotLabelInterval: '01:00:00', scrollTime: '08:00:00',
      slotMinHeight: 22,
      slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
      eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
      dayHeaderFormat: { weekday: 'short' },
      views: { timeGridWeek: { dayHeaderFormat: { weekday: 'short', month: 'numeric', day: 'numeric' } } },
      eventOrder: 'order,start,title', eventOrderStrict: true,
      selectable: true, selectMinDistance: 6, selectMirror: true,
      // 拖选预览尚无来源，保存后会写入个人日程。
      eventColor: eventBlockColor(tintOf('manual').accent),
      eventContrastColor: 'var(--cal-ink)',
      dayHeaderClass: 'cal-column-heading',
      dayCellInnerClass: 'cal-cell-content',
      dayCellTopClass: 'cal-cell-top',
      dayCellDidMount: ({ el, date }) => { el.dataset.calendarDay = localDate(date) },
      dateClick: ({ dateStr, allDay }) => {
        const date = dateStr.slice(0, 10)
        if (allDay) callbacks.current.onCreateDay(date)
        else {
          const start = minutes(dateStr)
          callbacks.current.onCreate(date, start, Math.min(start + 60, 24 * 60 - 1))
        }
      },
      select: ({ startStr, endStr, allDay, view }) => {
        view.calendar.unselect()
        if (!allDay && startStr.slice(0, 10) === endStr.slice(0, 10)) {
          callbacks.current.onCreate(startStr.slice(0, 10), minutes(startStr), minutes(endStr))
        }
      },
      eventClick: ({ event }) => {
        const entry = event.extendedProps.entry as Occurrence | undefined
        if (entry) callbacks.current.onSelect(entry)
      },
      eventClass: ({ event, isMirror }) => {
        if (event.extendedProps.span) return 'cal-phase-band'
        if (isMirror && !event.extendedProps.entry) return 'cal-event-block cal-selection-preview'
        return event.extendedProps.block ? 'cal-event cal-event-block' : 'cal-event'
      },
      eventContent: ({ event, timeText, view }) => {
        const { note } = event.extendedProps
        const compact = view.type === 'dayGridMonth' && Boolean(event.extendedProps.entry)
        if (!note && !compact) return true
        const details = document.createElement('span')
        details.className = 'cal-event-details'
        const title = document.createElement('span')
        title.textContent = compact ? event.title : [timeText, event.title].filter(Boolean).join(' ')
        const summary = document.createElement('span')
        summary.className = 'cal-event-note'
        summary.textContent = `笔记：${note}`
        details.append(title)
        if (note) details.append(summary)
        return { domNodes: [details] }
      },
      eventDidMount: ({ event, el, isStart, isMirror }) => {
        const { span, entry, accent, note } = event.extendedProps
        if (span) {
          el.dataset.tone = span.tone
          el.dataset.phaseStart = startOf(span)
          el.dataset.phaseEnd = endOf(span)
          el.title = `${phaseName(span)} ${spanDates(span)}`
          if (!isStart || span.firstDay !== startOf(span)) el.classList.add('cal-phase-continuation')
        } else if (entry) {
          el.style.setProperty('--cal-event-ink', accent)
          const time = entry.start.length === 10 ? '全天' : entry.start.slice(11, 16)
          el.title = [entry.title, time, entry.location, note && `笔记：${note}`].filter(Boolean).join(' · ')
          el.setAttribute('aria-label', [time, el.title].join(' '))
          el.setAttribute('data-occurrence', event.id)
          el.dataset.eventTitle = entry.title
        } else if (isMirror) {
          el.style.setProperty('--cal-event-ink', callbacks.current.tintOf('manual').accent)
        }
      },
    }
    const calendar = new Calendar(root.current, options)
    calendar.render()
    instance.current = calendar
    return () => { calendar.destroy(); instance.current = null }
  }, [])

  useLayoutEffect(() => {
    const calendar = instance.current
    if (!calendar) return
    const weeks = new Map((annotations?.weeks ?? []).map(week => [week.firstDay, week.text]))
    calendar.batchRendering(() => {
      if (calendar.view.type !== type) calendar.changeView(type, focusedDate)
      else if (localDate(calendar.getDate()) !== focusedDate) calendar.gotoDate(focusedDate)
      calendar.setOption('dayCellClass', ({ date }) => localDate(date) === focusedDate ? 'cal-focused-day' : '')
      calendar.setOption('dayCellTopContent', ({ date, isToday, isOther, view }) => {
        const day = localDate(date)
        const top = document.createElement('div')
        top.className = 'cal-day-top'
        const number = document.createElement('span')
        number.className = 'cal-day-number'
        number.textContent = String(date.getDate())
        if (isToday) number.classList.add('cal-today')
        if (isOther) number.classList.add('cal-outside-day')
        top.append(number)
        const label = weeks.get(day)
        if (label && view.type === 'dayGridMonth') {
          const week = document.createElement('span')
          week.className = 'cal-week-number'
          week.title = label
          week.textContent = label.split(' · ')[0]
          top.append(week)
        }
        return { domNodes: [top] }
      })
      calendar.setOption('events', events)
    })
  }, [annotations, events, focusedDate, type])

  return h('section', {
    'aria-label': mode === 'month' ? '月日历' : '周日历',
    className: 'cal-canvas', 'data-calendar-view': mode,
  }, h('div', { ref: root, className: 'cal-engine' }))
}

const utcDay = (date: string) => Date.parse(date) / 86_400_000

/** 用同一时间轴排列校历阶段，区间按钮跳到对应月份。 */
export function AcademicYear({ spans, focusedDate, onOpenMonth }: {
  spans: Span[]; focusedDate: string; onOpenMonth: (date: string) => void
}) {
  if (!spans.length) return h('div', { className: 'cal-year-empty' }, '当前校历未提供学年阶段')
  const from = monthStart(spans[0].firstDay)
  const last = spans.reduce((latest, span) => latest > span.lastDay ? latest : span.lastDay, from)
  const months: string[] = []
  const month = parseDate(from)
  while (localDate(month) <= last) {
    months.push(localDate(month))
    month.setMonth(month.getMonth() + 1)
  }
  const duration = utcDay(localDate(month)) - utcDay(from)
  const offset = (date: string) => (utcDay(date) - utcDay(from)) * 100 / duration
  const monthCells = months.map(date => h('span', {
    key: date, style: { left: `${offset(date)}%` },
  }, `${Number(date.slice(5, 7))}月`))
  return h('section', { className: 'cal-year', 'aria-label': '学年时间轴' },
    h('div', { className: 'cal-year-inner' },
      h('div', { className: 'cal-year-axis' }, h('span', null, '校历阶段'),
        h('div', { className: 'cal-year-months' }, ...monthCells)),
      h('ol', { className: 'cal-year-stages', 'aria-label': '学年阶段' },
        ...spans.map(span => h('li', { key: `${span.firstDay}:${span.text}` },
          h('button', {
            type: 'button', className: 'cal-year-phase', 'data-tone': span.tone ?? 'neutral',
            'aria-current': span.firstDay <= focusedDate && focusedDate <= span.lastDay ? 'date' : undefined,
            onClick: () => onOpenMonth(span.firstDay),
          },
          h('span', { className: 'cal-year-name' }, h('strong', null, spanName(span)),
            h('small', null, spanDates(span))),
          h('span', { className: 'cal-year-track', 'aria-hidden': true },
            ...months.map(date => h('i', { key: date, style: { left: `${offset(date)}%` } })),
            h('span', { className: 'cal-year-bar', style: {
              left: `${offset(span.firstDay)}%`,
              width: `${offset(nextDay(span.lastDay)) - offset(span.firstDay)}%`,
            } }))))))))
}
