// Host delivery for calendar reminders. No Agent, Session or browser timer is
// involved. The calendar remains the source of pending intent; receipts survive
// restart and the optional desktop service owns OS notification policy.
import { createHash } from 'node:crypto'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { ReminderReceiptSchema } from './model.js'
import { localTime } from './reminders.js'

export const reminderDomain = defineDomain({
  name: 'calendar_reminders', version: 1, layout: 'per-record',
  tables: { receipts: domainTable(ReminderReceiptSchema) },
})

/** One Host instance owns delivery. Sharing a data directory across processes is unsupported. */
export class ReminderDelivery {
  constructor(calendar, ctx) {
    Object.assign(this, { calendar, ctx, active: true, tail: Promise.resolve(), channel: 'in-app' })
  }
  async open() {
    this.domain = await this.ctx.storageDomain.open(reminderDomain)
    this.receipts = this.domain.table('receipts')
    this.unsubscribe = this.calendar.onChanged(change => {
      if (change?.domain !== 'calendar_reminders') this.arm(0)
    })
    await this.refresh()
  }
  arm(delay) {
    clearTimeout(this.timer)
    if (!this.active) return
    this.timer = setTimeout(() => { void this.refresh().catch(() => {}) }, Math.min(Math.max(delay, 0), 2147483647))
    this.timer.unref?.()
  }
  enqueue(work) {
    const next = this.tail.then(work, work)
    this.tail = next.catch(() => {})
    return next
  }
  refresh() {
    return this.enqueue(async () => {
      if (!this.active) return
      const now = Date.now(), from = new Date(now - 86400000), until = new Date(now)
      until.setFullYear(until.getFullYear() + 1)
      let delay = 60000, changed = false
      try {
        const tasks = this.calendar.reminderPlan({ from: localTime(from).slice(0, 10), to: localTime(until).slice(0, 10) }).tasks
        const current = new Set(tasks.map(task => createHash('sha256').update(task.id + '\0' + task.at).digest('hex')))
        for (const task of tasks) {
          const due = new Date(task.at).getTime()
          if (due > now) { delay = Math.min(delay, due - now); continue }
          // Catch up at most 24 hours after restart; ancient reminders must not
          // flood the user's desktop when an old calendar is first opened.
          if (due < now - 86400000) continue
          const id = createHash('sha256').update(task.id + '\0' + task.at).digest('hex')
          if (!this.receipts.get(id)) {
            await this.receipts.put(id, { id, title: task.title, ref: task.ref, at: task.at, kind: task.kind,
              deliveredAt: new Date(now).toISOString(), read: false, nativeSent: false })
            changed = true
          }
        }
        const desktop = this.ctx.get('desktopServices')
        this.channel = desktop?.calendarReminder ? 'system' : 'in-app'
        for (const [id, receipt] of this.receipts.entries()) {
          if (Date.parse(receipt.deliveredAt) < now - 30 * 86400000) {
            await desktop?.dismissCalendarReminder?.(id)
            await this.receipts.delete(id); changed = true; continue
          }
          if (receipt.read || receipt.nativeSent || !desktop?.calendarReminder || !current.has(id)
            || !this.calendar.isSourceVisible(receipt.ref.source) || new Date(receipt.at).getTime() < now - 86400000) continue
          try {
            await desktop.calendarReminder(receipt)
            await this.receipts.put(id, { ...receipt, nativeSent: true })
            changed = true
          } catch { this.channel = 'unavailable'; delay = Math.min(delay, 1000) }
        }
      } catch {
        this.channel = 'unavailable'; delay = 1000
      } finally {
        if (changed) this.calendar.invalidate({ domain: 'calendar_reminders' })
        this.arm(delay)
      }
    })
  }
  inbox() {
    const items = [...this.receipts.entries()].map(([, { nativeSent, ...receipt }]) => receipt)
      .sort((a, b) => b.deliveredAt.localeCompare(a.deliveredAt) || a.id.localeCompare(b.id))
    return { channel: this.channel, unread: items.filter(item => !item.read).length, items: items.slice(0, 100) }
  }
  ack(id) {
    return this.enqueue(async () => {
      const receipt = this.receipts.get(id)
      if (!receipt) return { updated: false }
      await this.receipts.put(id, { ...receipt, read: true })
      await this.ctx.get('desktopServices')?.dismissCalendarReminder?.(id)
      this.calendar.invalidate({ domain: 'calendar_reminders' })
      return { updated: true }
    })
  }
  async close() {
    this.active = false; clearTimeout(this.timer); this.unsubscribe?.()
    await this.tail
    await this.domain?.close()
  }
}
