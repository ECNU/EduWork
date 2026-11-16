/** 日历原型的当日安排及详情，沿用宿主主题。 */
import React, { useEffect, useRef, useState } from 'react'
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
  extensions?: Record<string, unknown>
}

export type TimetableTextField = 'remark' | 'note'
export type TimetableTextScope = 'once' | 'series'
interface TextDraft { text: string; canInherit: boolean }
interface PersonalText {
  remark: string
  note: string
  recurring: boolean
  read: (field: TimetableTextField, scope: TimetableTextScope) => Promise<TextDraft>
  save: (field: TimetableTextField, scope: TimetableTextScope, text: string | null) => Promise<void>
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

export function DailyAgenda({ date, entries, onSelect, onCreate, onDate, accentOf }: {
  date: string
  entries: Entry[]
  onSelect: (entry: Entry) => void
  onCreate: () => void
  onDate: (date: string) => void
  accentOf: (entry: Entry) => string
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
          style: { '--tt-entry-accent': accentOf(entry) } as React.CSSProperties,
        }, h('strong', null, entry.title), entry.location && h('span', null, entry.location),
        state && h('small', null, current ? '进行中' : '下一项')))
    })) : h('p', { className: 'tt-empty' }, '当天没有安排'),
    tomorrow && h('button', { type: 'button', className: 'tt-tomorrow', onClick: () => onDate(addDays(date, 1)) },
      h('span', null, '明天'), h('strong', null, [time(tomorrow.start), tomorrow.title].filter(Boolean).join(' · '))),
    !rows.length && h('footer', { className: 'tt-panel-actions' }, h(Button, { size: 'sm', variant: 'ghost', onClick: onCreate }, '＋ 添加日程')))
}

const textCopy = {
  remark: { label: '备注', add: '添加备注', hint: '导出日历时可选择包含备注' },
  note: { label: '笔记', add: '写笔记', hint: '仅保存在本机' },
}

function TextEditor({ field, content, onDone }: {
  field: TimetableTextField; content: PersonalText; onDone: () => void
}) {
  const [scope, setScope] = useState<TimetableTextScope>(content.recurring ? 'once' : 'series')
  const [draft, setDraft] = useState<TextDraft>()
  const [text, setText] = useState('')
  const [problem, setProblem] = useState('')
  const [saving, setSaving] = useState(false)
  const pending = useRef(false)
  const read = useRef(content.read)
  read.current = content.read
  const { label, hint } = textCopy[field]
  useEffect(() => {
    let active = true
    read.current(field, scope).then(next => {
      if (!active) return
      setDraft(next)
      setText(next.text)
    }).catch(error => { if (active) setProblem(String(error.message ?? error)) })
    return () => { active = false }
  }, [field, scope])

  const save = async (value: string | null) => {
    if (pending.current) return
    pending.current = true
    setSaving(true)
    setProblem('')
    try {
      await content.save(field, scope, value)
      onDone()
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      pending.current = false
      setSaving(false)
    }
  }

  return h('form', { className: 'tt-text-editor', 'aria-label': `编辑${label}`,
    onSubmit: (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (draft && text !== draft.text) void save(text)
    } },
    content.recurring && h('label', { className: 'tt-text-scope' }, '应用于',
      h('select', { value: scope, disabled: saving, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => {
        setDraft(undefined)
        setProblem('')
        setScope(event.target.value === 'once' ? 'once' : 'series')
      } }, h('option', { value: 'once' }, '仅本次'), h('option', { value: 'series' }, '整条日程'))),
    draft && h('textarea', { 'aria-label': label, value: text, autoFocus: true, rows: 3, disabled: saving,
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value) }),
    !draft && !problem && h('small', { role: 'status' }, '正在读取…'),
    problem && h('p', { role: 'alert', className: 'cal-destructive' }, problem),
    h('div', { className: 'tt-text-editor-footer' },
      h('small', null, hint),
      h('div', null,
        draft?.canInherit && h(Button, { type: 'button', variant: 'ghost', size: 'sm', disabled: saving, onClick: () => void save(null) }, '沿用整条日程'),
        h(Button, { type: 'button', variant: 'ghost', size: 'sm', disabled: saving, onClick: onDone }, '取消'),
        h(Button, { type: 'submit', variant: 'primary', size: 'sm', disabled: saving || !draft || text === draft.text }, '保存'))))
}

function TimetableText({ content }: { content: PersonalText }) {
  const [editing, setEditing] = useState<TimetableTextField>()
  return h('section', { className: 'tt-text-fields', 'aria-label': '备注和笔记' },
    ...(['remark', 'note'] as const).map(field => {
      const { label, add } = textCopy[field]
      return h('div', { className: 'tt-detail-text', key: field },
        h('div', { className: 'tt-text-heading' }, h('strong', null, label),
          !editing && h(Button, { size: 'sm', variant: 'ghost', 'aria-label': content[field] ? `编辑${label}` : add,
            onClick: () => setEditing(field) }, content[field] ? '编辑' : add)),
        editing === field ? h(TextEditor, { field, content, onDone: () => setEditing(undefined) })
          : content[field] && h('p', null, content[field]))
    }))
}

export function TimetableDetails({ entry, source, sourceDescription, personalText, recurrence, tint, actions, tools, onBack, children }: {
  entry: Entry
  source: string
  sourceDescription?: string
  personalText?: PersonalText
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
    personalText && h(TimetableText, { content: personalText }),
    sourceDescription && h('div', { className: 'tt-detail-text' }, h('span', null, '来源说明'), h('p', null, sourceDescription)),
    children,
    h('footer', { className: 'tt-panel-actions' }, actions))
}
