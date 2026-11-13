import { Service } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { validateDataset, describeDate, annotationsForDataset, eventsForDataset } from './model.js'
import { timetableSchema, timetableEvents } from './timetable.js'
import { openSubscription, bindSubscriptions } from './subscriptions.js'

const snapshotSchema = z.object({ institution: z.string().min(1), account: z.string().min(1), dataset: timetableSchema }).strict()
const domain = defineDomain({ name: 'academic_calendar', version: 1, tables: {
  timetables: domainTable(snapshotSchema),
  versions: domainTable(z.object({ revision: z.number().int().positive(), digest: z.string() }).strict()),
  feeds: domainTable(z.object({ kind: z.enum(['calendar', 'timetable']), data: z.unknown() }).strict()),
} })

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}

/** Education semantics, selected calendars and course grouping; no host internals. */
export default class AcademicCalendar extends Service {
  static inject = ['calendar', 'storageDomain']
  constructor(ctx) {
    super(ctx, 'academicCalendar')
    this.datasets = new Map()
    this.timetables = new Map()
    this.handles = new Map()
    this.chains = new Map()
    this.subscriptionCourses = new Map()
    this.closed = false
    ctx.effect(() => ctx.calendar.onChanged(() => this.syncSelection()))
    this.ready = this.start()
    bindSubscriptions(ctx)
    ctx.effect(() => async () => {
      this.closed = true
      await this.ready.catch(() => {})
      await Promise.allSettled(this.chains.values())
      for (const handle of this.handles.values()) handle.dispose()
      await this.storage?.close()
    })
  }
  async start() {
    this.storage = await this.ctx.storageDomain.open(domain)
    this.table = this.storage.table('timetables')
    for (const [id, record] of this.table.entries()) {
      if (this.closed) return
      await this.applyTimetable(id, record)
    }
  }
  async registerDataset({ id, label, dataset, source: sourceIdentity }) {
    validateDataset(dataset)
    dataset = structuredClone(dataset)
    await this.ready
    if (!id || !label || this.datasets.has(id) || this.closed) throw new Error('invalid or duplicate academic calendar')
    const annotation = this.ctx.calendar.registerAnnotations({ id, label, selectionGroup: 'academic-calendar', annotationsFor: range => annotationsForDataset(dataset, range) })
    let source
    try { source = this.ctx.calendar.registerSource({ provider: 'academic-calendar', account: 'public', feed: id, ...sourceIdentity, label }) }
    catch (error) { annotation.dispose(); throw error }
    const handle = { dispose: () => { annotation.dispose(); source.dispose(); this.datasets.delete(id); this.handles.delete(id); this.syncSelection() } }
    try {
      const version = this.checkRevision(source.source, dataset)
      const outcome = await source.apply({ complete: true, events: eventsForDataset(dataset), ...(dataset.revision ? { revision: dataset.revision } : {}) })
      if (outcome.state !== 'ready') throw new Error('academic calendar snapshot rejected')
      if (version) await this.storage.table('versions').put(source.source, version)
      if (this.closed) { handle.dispose(); throw new Error('academic calendar stopped') }
      this.datasets.set(id, { id, label, dataset, source, active: true })
      this.handles.set(id, handle)
      this.syncSelection()
      return handle
    } catch (error) { handle.dispose(); throw error }
  }
  syncSelection() {
    if (this.closed) return
    const selected = this.ctx.calendar.annotationChoices().find(choice => choice.group === 'academic-calendar' && choice.selected)?.id
    for (const record of this.datasets.values()) {
      const active = record.id === selected
      if (active === record.active) continue
      record.active = active
      record.source.setVisible(active)
    }
  }
  query({ id, from, to = from }) {
    const selected = id ?? this.ctx.calendar.annotationChoices().find(choice => choice.group === 'academic-calendar' && choice.selected)?.id
    const calendar = this.datasets.get(selected)
    if (!calendar) throw new Error('请先选择或指定校历')
    // Validate both dates, including leap days, before enumerating the range.
    describeDate(calendar.dataset, from)
    describeDate(calendar.dataset, to)
    const count = (Date.parse(to) - Date.parse(from)) / 86400000 + 1
    if (!Number.isInteger(count) || count < 1 || count > 366) throw new Error('校历查询范围须为 1–366 天')
    return { id: selected, label: calendar.label, days: Array.from({ length: count }, (_, index) => describeDate(calendar.dataset, new Date(Date.parse(from) + index * 86400000).toISOString().slice(0, 10))) }
  }
  async importTimetable(input) {
    const record = snapshotSchema.parse(input)
    await this.ready
    const id = JSON.stringify([record.institution, record.account, record.dataset.term])
    const pending = (this.chains.get(id) ?? Promise.resolve()).catch(() => {}).then(async () => {
      if (this.closed) throw new Error('academic calendar stopped')
      const result = await this.applyTimetable(id, record)
      await this.table.put(id, record)
      return result
    })
    this.chains.set(id, pending)
    try { return await pending } finally { if (this.chains.get(id) === pending) this.chains.delete(id) }
  }
  async applyTimetable(id, record) {
    const handleKey = `timetable:${id}`
    let handle = this.handles.get(handleKey)
    if (!handle) {
      handle = this.ctx.calendar.registerSource({ provider: `timetable:${record.institution}`, account: record.account, feed: record.dataset.term, label: `课表（${record.dataset.term}）`, replaceInstances: true })
      this.handles.set(handleKey, handle)
    }
    const result = await handle.apply({ complete: true, events: timetableEvents(record.dataset, record.institution) })
    if (result.state !== 'ready') throw new Error('课表更新失败，保留原数据')
    this.timetables.set(id, record)
    return { source: handle.source, courses: record.dataset.courses.length, meetings: record.dataset.courses.reduce((sum, course) => sum + course.meetings.length, 0) }
  }
  courses({ institution, account, term } = {}) {
    return [...this.timetables.values(), ...this.subscriptionCourses.values()].filter(record => (!institution || institution === record.institution) && (!account || account === record.account) && (!term || term === record.dataset.term))
  }
  checkRevision(source, dataset) {
    const previous = this.storage.table('versions').get(source)
    const revision = dataset.revision
    if (previous && (revision === undefined || revision < previous.revision)) throw new Error('stale_revision')
    const digest = createHash('sha256').update(JSON.stringify(canonical(dataset))).digest('hex')
    if (previous && previous.revision === revision && previous.digest !== digest) throw new Error('revision_conflict')
    return revision === undefined ? undefined : { revision, digest }
  }
  /** Host-only format sink. The subscription owns fetching and account lifetime. */
  openSubscription(options) { return openSubscription(this, options) }
}
