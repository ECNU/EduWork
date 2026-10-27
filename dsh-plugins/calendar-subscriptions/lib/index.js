// The fetching half of calendar subscriptions.
//
// The calendar service keeps events, personal content and the panel; this
// plugin owns what a remote feed needs on top of it: per-feed configuration,
// HTTP fetching on a schedule, retries and the last outcome. Snapshots enter
// the calendar only through the registered-source seam (`registerSource`), so
// a subscription never bypasses the store's snapshot semantics — a feed that
// cannot be read keeps the events of its last good fetch, and a clean read
// replaces the previous snapshot without piling up duplicates.
//
// ICS is the first format, behind the adapter seam in `ics-adapter.js`. School
// timetables and academic calendars arrive later as their own adapters or
// sibling data plugins; none of them needs this plugin's internals.
import { Service } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { icsAdapter } from './ics-adapter.js'

export const DEFAULT_INTERVAL_HOURS = 24
const MIN_INTERVAL_HOURS = 1
const MAX_INTERVAL_HOURS = 24 * 30
const REQUEST_TIMEOUT_MS = 30_000
const RETRY_DELAY_MS = 60 * 60 * 1000
const ADAPTERS = { ics: icsAdapter }

export const feedSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  url: z.string().min(1),
  format: z.literal('ics').default('ics'),
  intervalHours: z.number().int().min(MIN_INTERVAL_HOURS).max(MAX_INTERVAL_HOURS).default(DEFAULT_INTERVAL_HOURS),
  enabled: z.boolean().default(true),
  lastSuccessAt: z.string().optional(),
  lastError: z.string().optional(),
}).strict()

export const subscriptionsDomain = defineDomain({
  name: 'calendar_subscriptions',
  version: 1,
  tables: { feeds: domainTable(feedSchema) },
})

function feedId(url) {
  return createHash('sha256').update(url).digest('base64url').slice(0, 22)
}

function httpUrl(url) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('订阅地址必须是 http(s) 链接')
  return parsed.href
}

function delayWithJitter(delayMs) {
  if (delayMs < 10 * 60 * 1000) return delayMs
  return Math.round(delayMs * (0.9 + Math.random() * 0.2))
}

export default class CalendarSubscriptions extends Service {
  static inject = ['calendar', 'storageDomain']

  constructor(ctx) {
    super(ctx, 'calendarSubscriptions')
    this.feedConfigs = new Map()
    this.handles = new Map()
    this.timers = new Map()
    this.inflight = new Map()
    this.disposed = false
    this.table = null
    ctx.effect(() => () => this.shutdown())
    this.ready = this.start()
  }

  async start() {
    const domain = await this.ctx.storageDomain.open(subscriptionsDomain)
    if (this.disposed) return
    this.table = domain.table('feeds')
    for (const [id, record] of [...this.table.entries()]) {
      this.feedConfigs.set(id, feedSchema.parse(record))
    }
    for (const feed of this.feedConfigs.values()) this.attach(feed)
  }

  shutdown() {
    this.disposed = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.inflight.clear()
  }

  attach(feed) {
    if (this.disposed || !feed.enabled) return
    if (!this.handles.has(feed.id)) {
      this.handles.set(feed.id, this.ctx.calendar.registerSource({
        provider: 'subscriptions',
        account: 'local',
        feed: feed.id,
        label: feed.label,
      }))
    }
    this.schedule(feed)
  }

  /** Next run: a never-fetched or overdue feed goes soon, a fresh one waits. */
  schedule(feed, overrideDelayMs) {
    const timer = this.timers.get(feed.id)
    if (timer) clearTimeout(timer)
    if (this.disposed || !feed.enabled) return
    const intervalMs = feed.intervalHours * 60 * 60 * 1000
    const dueMs = feed.lastSuccessAt ? Date.parse(feed.lastSuccessAt) + intervalMs - Date.now() : 0
    const delay = overrideDelayMs ?? (dueMs <= 0 ? 1_000 : delayWithJitter(dueMs))
    this.timers.set(feed.id, setTimeout(() => {
      this.timers.delete(feed.id)
      this.refresh(feed.id).catch(() => {}).then(() => {
        const next = this.feedConfigs.get(feed.id)
        const failed = next?.lastError !== undefined
        // A failed attempt retries far sooner than the interval, so a feed
        // that was down at startup catches up within the hour.
        this.schedule(next, failed ? Math.min(intervalMs, RETRY_DELAY_MS) : undefined)
      })
    }, delay))
  }

  /** Register a feed (or update its configuration) and fetch it once now. */
  async addFeed(input) {
    if (!this.table) await this.ready
    const url = httpUrl(input.url)
    const label = typeof input.label === 'string' && input.label.trim() ? input.label.trim() : new URL(url).hostname
    const intervalHours = input.intervalHours === undefined ? DEFAULT_INTERVAL_HOURS : input.intervalHours
    const id = feedId(url)
    const prior = this.feedConfigs.get(id)
    const feed = feedSchema.parse({ ...(prior ?? { id, enabled: true }), label, url, intervalHours })
    this.feedConfigs.set(id, feed)
    await this.table.put(id, feed)
    // A relabelled feed re-registers: the label lives on the source entry.
    if (this.handles.has(id) && prior && prior.label !== label) {
      this.handles.get(id).dispose()
      this.handles.delete(id)
    }
    this.attach({ ...feed, enabled: feed.enabled })
    if (!feed.enabled) return { feed, refresh: { skipped: true, reason: '该订阅已停用' } }
    try {
      const report = await this.refresh(id)
      return { feed: this.feedConfigs.get(id), refresh: report }
    } catch (error) {
      return { feed: this.feedConfigs.get(id), refresh: { error: String(error?.message ?? error) } }
    }
  }

  /** Stop fetching a feed and clear its events; personal content is kept. */
  async removeFeed(id) {
    if (!this.table) await this.ready
    const feed = this.feedConfigs.get(id)
    if (!feed) throw new Error('unknown calendar subscription: ' + id)
    const timer = this.timers.get(id)
    if (timer) clearTimeout(timer)
    this.timers.delete(id)
    const handle = this.handles.get(id)
    if (handle) {
      // The store keeps a deregistered source's records, and a disabled source
      // rejects writes: restore, clear with one final empty snapshot, then
      // deregister. Personal notes survive the snapshot.
      handle.setActive(true)
      await handle.apply({ events: [], complete: true })
      handle.dispose()
      this.handles.delete(id)
    }
    this.feedConfigs.delete(id)
    await this.table.delete(id)
    return { removed: id }
  }

  async setEnabled(id, enabled) {
    if (!this.table) await this.ready
    const feed = this.feedConfigs.get(id)
    if (!feed) throw new Error('unknown calendar subscription: ' + id)
    const next = feedSchema.parse({ ...feed, enabled })
    this.feedConfigs.set(id, next)
    await this.table.put(id, next)
    this.handles.get(id)?.setActive(enabled)
    if (enabled) this.schedule(next, 1_000)
    else {
      const timer = this.timers.get(id)
      if (timer) clearTimeout(timer)
      this.timers.delete(id)
    }
    return this.feedConfigs.get(id)
  }

  /** Fetch one feed now and push its snapshot; failures keep the old events. */
  refresh(id) {
    if (!this.table) return this.ready.then(() => this.refresh(id))
    const feed = this.feedConfigs.get(id)
    if (!feed) return Promise.reject(new Error('unknown calendar subscription: ' + id))
    const handle = this.handles.get(id)
    if (!handle) return Promise.reject(new Error('subscription is not registered: ' + id))
    const running = this.inflight.get(id)
    if (running) return running
    const attempt = (async () => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      try {
        const response = await fetch(feed.url, {
          signal: controller.signal,
          redirect: 'follow',
          headers: { accept: 'text/calendar, text/plain;q=0.9, */*;q=0.8' },
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const snapshot = await ADAPTERS[feed.format].read(response)
        const report = await handle.apply({ events: snapshot.events, complete: snapshot.skipped.length === 0 })
        await this.remember(id, { lastSuccessAt: new Date().toISOString(), lastError: undefined })
        return { ...report, skipped: snapshot.skipped, degraded: snapshot.degraded }
      } catch (error) {
        const timedOut = error?.name === 'AbortError' || error?.name === 'TimeoutError'
        const message = timedOut ? '请求超时' : String(error?.message ?? error)
        await this.remember(id, { lastError: message })
        throw new Error(`订阅「${feed.label}」刷新失败：${message}`)
      } finally {
        clearTimeout(timeout)
        this.inflight.delete(id)
      }
    })()
    this.inflight.set(id, attempt)
    return attempt
  }

  async refreshAll() {
    if (!this.table) await this.ready
    const ids = [...this.feedConfigs.values()].filter(feed => feed.enabled).map(feed => feed.id)
    const results = await Promise.allSettled(ids.map(id => this.refresh(id)))
    return Object.fromEntries(ids.map((id, index) => [id, results[index].status === 'fulfilled'
      ? results[index].value
      : { error: String(results[index].reason?.message ?? results[index].reason) }]))
  }

  async remember(id, patch) {
    const feed = this.feedConfigs.get(id)
    if (!feed || !this.table) return
    const next = feedSchema.parse({ ...feed, ...patch })
    this.feedConfigs.set(id, next)
    await this.table.put(id, next)
  }

  /** Config plus live source status, as the panel and the agent read it. */
  feeds() {
    return [...this.feedConfigs.values()].map(feed => {
      const status = this.handles.get(feed.id)?.status()
      return { ...feed, state: status?.state, source: status?.source }
    })
  }
}
