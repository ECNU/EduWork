import { z } from 'zod'
import { validateDataset, annotationsForDataset, eventsForDataset } from './model.js'
import { timetableSchema, timetableEvents } from './timetable.js'

const timetableFeed = z.object({ institution: z.string().trim().min(1), dataset: timetableSchema }).strict()

/** Parse before submitting anything; account identity always comes from the Host. */
export function parseFeed(kind, input) {
  if (kind === 'calendar') { validateDataset(input); return structuredClone(input) }
  if (kind === 'timetable') return timetableFeed.parse(input)
  throw new Error('unknown education feed kind')
}

/** A source-compatible writer whose extra data belongs entirely to education. */
export function openSubscription(education, { kind, identity, label, active = true }) {
  if (!['calendar', 'timetable'].includes(kind)) throw new Error('unknown education feed kind')
  const calendar = education.ctx.calendar
  const source = calendar.registerSource({ ...identity, label, active, replaceInstances: kind === 'timetable' })
  const id = `subscription:${source.source}`
  let data, annotation, enabled = active, closed = false, epoch = 0
  const current = generation => !closed && !education.closed && enabled && generation === epoch
  const hide = () => {
    education.datasets.delete(id)
    education.subscriptionCourses.delete(id)
    annotation?.dispose()
    annotation = undefined
    if (kind === 'calendar') source.setVisible(false)
  }
  const show = () => {
    if (!data || closed || !enabled || education.closed) return
    if (kind === 'timetable') {
      education.subscriptionCourses.set(id, { institution: data.institution, account: identity.account, dataset: data.dataset })
      return
    }
    const existing = education.datasets.get(id)
    if (existing) { existing.dataset = data; annotation.invalidate(); return }
    const record = { id, label, dataset: data, source, active: false }
    education.datasets.set(id, record)
    annotation = calendar.registerAnnotations({ id, label, selectionGroup: 'academic-calendar', annotationsFor: range => annotationsForDataset(record.dataset, range) })
    education.syncSelection()
  }
  if (kind === 'calendar') source.setVisible(false)
  const ready = education.ready.then(() => {
    const cached = education.storage.table('feeds').get(source.source)
    if (cached?.kind === kind && !closed) { data = parseFeed(kind, cached.data); show() }
  })
  const handle = {
    source: source.source, ready,
    status: () => source.status(),
    setActive(active) {
      ++epoch
      enabled = active
      if (!active) hide()
      source.setActive(active)
      if (active) show()
    },
    beginUpdate() {
      const generation = epoch
      const receipt = source.beginUpdate()
      return {
        fail: code => receipt.fail(code),
        async apply(snapshot) {
          await ready
          const run = async () => {
            if (!current(generation)) return { state: 'superseded', source: source.source }
            if (snapshot.complete !== true) throw new Error('incomplete_snapshot')
            const next = parseFeed(kind, snapshot.data)
            const version = kind === 'calendar' ? education.checkRevision(source.source, next) : undefined
            const events = kind === 'calendar' ? eventsForDataset(next) : timetableEvents(next.dataset, next.institution)
            const outcome = await receipt.apply({ complete: true, events, ...(next.revision ? { revision: next.revision } : {}) })
            if (outcome.state !== 'ready' || !current(generation)) return { ...outcome, state: 'superseded' }
            if (version) await education.storage.table('versions').put(source.source, version)
            await education.storage.table('feeds').put(source.source, { kind, data: next })
            if (current(generation)) { data = next; show() }
            return current(generation) ? outcome : { state: 'superseded', source: source.source }
          }
          const pending = (education.chains.get(id) ?? Promise.resolve()).catch(() => {}).then(run)
          education.chains.set(id, pending)
          try { return await pending } finally { if (education.chains.get(id) === pending) education.chains.delete(id) }
        },
      }
    },
    apply(snapshot) { return handle.beginUpdate().apply(snapshot) },
    async clear() {
      ++epoch
      await ready
      await education.chains.get(id)?.catch(() => {})
      await source.clear()
      await education.storage.table('feeds').delete(source.source)
      data = undefined
      hide()
    },
    dispose() {
      if (closed) return
      closed = true
      ++epoch
      hide()
      source.dispose()
      education.handles.delete(id)
    },
  }
  education.handles.set(id, handle)
  return handle
}

/** Optional dependency: core education works even without the subscription plugin. */
export function bindSubscriptions(ctx) {
  ctx.inject(['calendarSubscriptions'], inner => {
    for (const [format, kind] of [['academic-calendar', 'calendar'], ['academic-timetable', 'timetable']]) {
      inner.effect(() => inner.calendarSubscriptions.registerFormat(format, {
        openSource: ({ identity, label, active }) => inner.academicCalendar.openSubscription({ kind, identity, label, active }),
        async read(response) { return { data: parseFeed(kind, await response.json()), skipped: [], degraded: [] } },
      }).dispose)
    }
  })
}
