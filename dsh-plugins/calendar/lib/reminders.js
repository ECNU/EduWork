// Calendar computes intent. A Host scheduler owns actual delivery and durable
// deduplication; no browser timer is used as a notification mechanism here.
import { annotationKey } from './keys.js'

const pad = value => String(value).padStart(2, '0')
export function localTime(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function reminderPlan(calendar, range) {
  const tasks = new Map()
  // Hidden means a display preference, not an instruction to turn reminders off.
  for (const occurrence of calendar.occurrences({ ...range, includeHidden: true }).occurrences) {
    const rule = occurrence.personal?.reminder
    if (rule?.kind !== 'relative' || occurrence.start.length !== 16) continue
    const ref = { scope: 'source', source: occurrence.source, uid: occurrence.uid, originalStart: occurrence.originalStart }
    const at = new Date(occurrence.start)
    at.setMinutes(at.getMinutes() - rule.minutes)
    const task = { id: `${annotationKey(ref)}:relative`, ref, title: occurrence.title, kind: 'relative', at: localTime(at) }
    tasks.set(task.id, task)
  }
  // A series-level fixed reminder is one task, not one task per generated class.
  // It survives a cancellation or disappearance of its source record.
  for (const scope of ['source', 'personal']) {
    for (const annotation of calendar.personal.list(scope)) {
      if (annotation.reminder?.kind !== 'fixed' || !calendar.isSourceVisible(annotation.source)) continue
      const at = annotation.reminder.at
      if (range?.from && at.slice(0, 10) < range.from.slice(0, 10)) continue
      if (range?.to && at.slice(0, 10) > range.to.slice(0, 10)) continue
      const { source, uid, originalStart } = annotation
      const ref = { scope, source, uid, ...(originalStart ? { originalStart } : {}) }
      const title = calendar.getEvent({ source, uid })?.title ?? '日历提醒'
      const task = { id: `${annotationKey(ref)}:fixed`, ref, title, kind: 'fixed', at }
      tasks.set(task.id, task)
    }
  }
  return { tasks: [...tasks.values()].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)) }
}


/**
 * Host-only scheduling boundary. The adapter replaces only the calendar-owned
 * tasks, durably and idempotently by task.id; existing Session/desktop dispatch
 * stays in that adapter. This module never creates notification timers.
 */
export function bindReminderScheduler(calendar, adapter, range) {
  if (typeof adapter?.replace !== 'function') throw new Error('scheduler adapter needs replace({ owner, tasks })')
  let active = true, fingerprint, state = 'pending', error
  let tail = Promise.resolve()
  const controller = new AbortController()
  const refresh = () => {
    const run = async () => {
      if (!active) return
      try {
        const now = new Date()
        const until = new Date(now)
        until.setFullYear(until.getFullYear() + 1)
        let tasks = calendar.reminderPlan(range ?? { from: localTime(now).slice(0, 10), to: localTime(until).slice(0, 10) }).tasks
        if (!range) tasks = tasks.filter(task => task.at > localTime(now))
        const next = JSON.stringify(tasks)
        if (next !== fingerprint) {
          await adapter.replace({ owner: 'calendar', tasks }, controller.signal)
          fingerprint = next
        }
        state = 'ready'
        error = undefined
      } catch {
        state = 'error'
        error = 'scheduler_failed'
      }
    }
    tail = tail.then(run, run)
    return tail
  }
  const unsubscribe = calendar.onChanged(() => { void refresh() })
  const timer = setInterval(() => { void refresh() }, 60000)
  timer.unref?.()
  void refresh()
  return { refresh, status: () => ({ state, ...(error ? { error } : {}) }),
    dispose() { active = false; clearInterval(timer); unsubscribe(); controller.abort() } }
}
