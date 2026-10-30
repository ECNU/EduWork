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
import { boundedResponse } from './response.js'

export const DEFAULT_INTERVAL_HOURS = 24
const MIN_INTERVAL_HOURS = 1
const MAX_INTERVAL_HOURS = 24 * 30
const REQUEST_TIMEOUT_MS = 30_000
const RETRY_DELAY_MS = 60 * 60 * 1000
const MAX_TIMER_MS = 2 ** 31 - 1

export const feedSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  url: z.string().min(1),
  format: z.string().min(1).default('ics'),
  intervalHours: z.number().int().min(MIN_INTERVAL_HOURS).max(MAX_INTERVAL_HOURS).default(DEFAULT_INTERVAL_HOURS),
  enabled: z.boolean().default(true),
  lastSuccessAt: z.string().optional(),
  lastError: z.string().optional(),
  warnings: z.array(z.string()).optional(),
  authorization: z.object({ profileID: z.string().min(1), account: z.string().min(1) }).strict().optional(),
}).strict()

export const subscriptionsDomain = defineDomain({
  name: 'calendar_subscriptions',
  version: 1,
  tables: { feeds: domainTable(feedSchema), removals: domainTable(feedSchema) },
})

function feedId(url) {
  return createHash('sha256').update(url).digest('base64url').slice(0, 22)
}

function httpUrl(url) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('订阅地址必须是 http(s) 链接')
  if (parsed.username || parsed.password || parsed.hash) throw new Error('订阅地址不能包含凭据或片段')
  return parsed.href
}

function delayWithJitter(delayMs) {
  if (delayMs < 10 * 60 * 1000) return delayMs
  return Math.round(delayMs * (0.9 + Math.random() * 0.2))
}

/** Only the keys a caller actually supplied. */
function defined(input) {
  return Object.fromEntries(Object.entries(input ?? {}).filter(([, value]) => value !== undefined))
}

export default class CalendarSubscriptions extends Service {
  static inject = ['calendar', 'storageDomain']

  constructor(ctx, config = {}) {
    super(ctx, 'calendarSubscriptions')
    this.feedConfigs = new Map()
    this.handles = new Map()
    this.timers = new Map()
    this.inflight = new Map()
    this.requests = new Map()
    this.adapters = new Map([['ics', icsAdapter]])
    this.authorizationEpochs = new Map()
    this.pendingRemovals = new Map()
    this.cleanupFlights = new Map()
    this.disposed = false
    this.table = null
    // Only host assembly may approve credential destinations. Agent input can
    // select a profile, never enlarge this list or supply credentials.
    this.authorizedServices = (config.authorizedServices ?? []).map(service => {
      const url = httpUrl(service.url)
      const parsed = new URL(url)
      const development = config.allowInsecureDevelopment === true && parsed.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(parsed.hostname)
      if ((parsed.protocol !== 'https:' && !development) || !service.profileID) throw new Error('authorized services need an exact HTTPS URL and profileID')
      return { url, profileID: service.profileID }
    })
    ctx.on('oidc/accounts-changed', change => {
      this.authorizationEpochs.set(change.profileID, (this.authorizationEpochs.get(change.profileID) ?? 0) + 1)
      for (const feed of this.feedConfigs.values()) {
        if (feed.authorization?.profileID !== change.profileID) continue
        this.cancelRequest(feed.id)
        this.handles.get(feed.id)?.setActive(false)
        const timer = this.timers.get(feed.id)
        if (timer) clearTimeout(timer)
        this.timers.delete(feed.id)
        void this.reauthorize(feed).catch(() => {})
      }
    })
    ctx.effect(() => () => this.shutdown())
    this.ready = this.start()
  }

  async start() {
    const domain = await this.ctx.storageDomain.open(subscriptionsDomain)
    if (this.disposed) return
    this.table = domain.table('feeds')
    this.removalsTable = domain.table('removals')
    for (const [id, feed] of this.removalsTable.entries()) this.pendingRemovals.set(id, feed)
    for (const feed of this.pendingRemovals.values()) {
      await this.table.delete(feed.id)
      if (this.adapters.has(feed.format)) await this.cleanupRemoval(feed)
    }
    for (const [id, record] of [...this.table.entries()]) {
      this.feedConfigs.set(id, feedSchema.parse(record))
    }
    for (const feed of this.feedConfigs.values()) {
      if (feed.authorization) await this.reauthorize(feed)
      else this.attach(feed)
    }
  }

  shutdown() {
    this.disposed = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    for (const controller of this.requests.values()) controller.abort()
    this.requests.clear()
    this.inflight.clear()
    // The sources belong to this plugin's lifetime. Leaving them registered
    // would keep a deactivated plugin's feeds listed in the calendar, clash
    // with a re-registration of the same identity when it comes back, and let
    // a request that was in flight when the plugin stopped still land in the
    // store: a disposed handle makes that write superseded.
    for (const handle of this.handles.values()) handle.dispose()
    this.handles.clear()
  }

  attach(feed) {
    if (this.disposed || !feed.enabled) return
    const adapter = this.adapters.get(feed.format)
    if (!adapter) return
    if (!this.handles.has(feed.id)) {
      const config = {
        provider: 'subscriptions',
        account: feed.authorization?.account ?? 'local',
        feed: feed.id,
      }
      this.handles.set(feed.id, adapter.openSource
        ? adapter.openSource({ identity: config, label: feed.label })
        : this.ctx.calendar.registerSource({ ...config, label: feed.label }))
      // A corrupt/unavailable cache is reported by refresh, never as an
      // unhandled rejection before the scheduled request begins.
      this.handles.get(feed.id).ready?.catch(() => {})
    }
    this.schedule(feed)
  }

  sourceOptions(feed) {
    return { identity: { provider: 'subscriptions', account: feed.authorization?.account ?? 'local', feed: feed.id }, label: feed.label }
  }

  /** Persisted tombstones prevent removed, unavailable formats restoring old caches. */
  cleanupRemoval(feed) {
    if (this.cleanupFlights.has(feed.id)) return this.cleanupFlights.get(feed.id)
    const run = (async () => {
      const adapter = this.adapters.get(feed.format)
      const options = this.sourceOptions(feed)
      const live = this.handles.get(feed.id)
      const handle = live ?? (adapter?.openSource
        ? adapter.openSource({ ...options, active: false })
        : this.ctx.calendar.registerSource({ ...options.identity, label: options.label, active: false }))
      try {
        handle.setActive(false)
        await handle.ready
        await handle.clear()
      } finally { handle.dispose(); this.handles.delete(feed.id) }
      // Without the owning format, only generic events can be cleared now.
      // Keep its cleanup receipt until it returns, before any restore/re-add.
      if (adapter) {
        await this.removalsTable.delete(feed.id)
        this.pendingRemovals.delete(feed.id)
      }
    })()
    this.cleanupFlights.set(feed.id, run)
    void run.finally(() => { this.cleanupFlights.delete(feed.id) }).catch(() => {})
    return run
  }

  /** Next run: a never-fetched or overdue feed goes soon, a fresh one waits. */
  schedule(feed, overrideDelayMs) {
    // The feed may have been removed while its refresh was in flight; there is
    // nothing to schedule for a feed that no longer exists, and reading its id
    // would be the crash of that race.
    if (!feed) return
    const timer = this.timers.get(feed.id)
    if (timer) clearTimeout(timer)
    if (this.disposed || !feed.enabled || !this.handles.has(feed.id)) return
    const intervalMs = feed.intervalHours * 60 * 60 * 1000
    const dueMs = feed.lastSuccessAt ? Date.parse(feed.lastSuccessAt) + intervalMs - Date.now() : 0
    const delay = overrideDelayMs ?? (dueMs <= 0 ? 1_000 : delayWithJitter(dueMs))
    const dueAt = Date.now() + Math.max(0, delay)
    const wait = () => {
      const remaining = dueAt - Date.now()
      if (remaining > 0) {
        this.timers.set(feed.id, setTimeout(wait, Math.min(remaining, MAX_TIMER_MS)))
        return
      }
      this.timers.delete(feed.id)
      this.refresh(feed.id).catch(() => {}).then(() => {
        if (this.disposed) return
        const next = this.feedConfigs.get(feed.id)
        if (!next) return
        const failed = next.lastError !== undefined
        // A failed attempt retries far sooner than the interval, so a feed
        // that was down at startup catches up within the hour.
        this.schedule(next, failed ? Math.min(intervalMs, RETRY_DELAY_MS) : undefined)
      })
    }
    this.timers.set(feed.id, setTimeout(wait, Math.min(Math.max(0, delay), MAX_TIMER_MS)))
  }

  /** Register a feed (or update its configuration) and fetch it once now. */
  async addFeed(input) {
    if (!this.table) await this.ready
    const url = httpUrl(input.url)
    const format = input.format ?? 'ics'
    if (!this.adapters.has(format)) throw new Error('未登记的日历订阅格式：' + format)
    const label = typeof input.label === 'string' && input.label.trim() ? input.label.trim() : new URL(url).hostname
    const intervalHours = input.intervalHours === undefined ? DEFAULT_INTERVAL_HOURS : input.intervalHours
    let authorization
    if (input.profileID) {
      this.assertAuthorizedService(input.profileID, url)
      const identity = await this.identity(input.profileID)
      if (!identity) throw new Error('请先登录此订阅对应的机构账号')
      authorization = { profileID: input.profileID, account: identity.accountID }
    }
    const accountKey = authorization ? [url, authorization.profileID, authorization.account] : [url]
    const id = feedId(format === 'ics' ? (authorization ? JSON.stringify(accountKey) : url) : JSON.stringify([format, ...accountKey]))
    const prior = this.feedConfigs.get(id)
    if (this.pendingRemovals.has(id)) await this.cleanupRemoval(this.pendingRemovals.get(id))
    if (prior && (prior.label !== label || prior.format !== format)) this.cancelRequest(id)
    const feed = feedSchema.parse({ ...(prior ?? { id, enabled: true }), label, url, format, intervalHours, ...(authorization ? { authorization } : {}) })
    this.feedConfigs.set(id, feed)
    await this.table.put(id, feed)
    // A relabelled feed re-registers: the label lives on the source entry.
    if (this.handles.has(id) && prior && (prior.label !== label || prior.format !== format)) {
      this.handles.get(id).dispose()
      this.handles.delete(id)
    }
    if (feed.authorization) await this.reauthorize(feed)
    else this.attach(feed)
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
    const feed = this.feedConfigs.get(id) ?? this.pendingRemovals.get(id)
    if (!feed) throw new Error('unknown calendar subscription: ' + id)
    this.cancelRequest(id)
    const timer = this.timers.get(id)
    if (timer) clearTimeout(timer)
    this.timers.delete(id)
    await this.removalsTable.put(id, feed)
    this.pendingRemovals.set(id, feed)
    this.feedConfigs.delete(id)
    await this.table.delete(id)
    await this.cleanupRemoval(feed)
    return { removed: id, ...(this.pendingRemovals.has(id) ? { cleanupPending: true } : {}) }
  }

  /** Adjust one feed's label, interval or enable state; scheduling follows. */
  async updateFeed(id, patch = {}) {
    if (!this.table) await this.ready
    const feed = this.feedConfigs.get(id)
    if (!feed) throw new Error('unknown calendar subscription: ' + id)
    const changes = feedSchema.pick({ label: true, intervalHours: true, enabled: true }).partial().strict().parse(defined(patch))
    const next = feedSchema.parse({ ...feed, ...changes })
    if (patch.enabled !== undefined || patch.label !== undefined) this.cancelRequest(id)
    this.feedConfigs.set(id, next)
    await this.table.put(id, next)
    if (patch.enabled !== undefined) this.handles.get(id)?.setActive(next.enabled && !next.authorization)
    // A relabelled feed re-registers: the label lives on the source entry.
    if (patch.label !== undefined && patch.label !== feed.label && this.handles.has(id)) {
      this.handles.get(id).dispose()
      this.handles.delete(id)
    }
    if (!next.enabled) {
      const timer = this.timers.get(id)
      if (timer) clearTimeout(timer)
      this.timers.delete(id)
    } else {
      if (next.authorization) await this.reauthorize(next)
      else this.attach(next)
      if (patch.enabled === true) this.schedule(next, 1_000)
    }
    return this.feedConfigs.get(id)
  }

  /** Fetch one feed now and push its snapshot; failures keep the old events. */
  refresh(id) {
    if (!this.table) return this.ready.then(() => this.refresh(id))
    const feed = this.feedConfigs.get(id)
    if (!feed) return Promise.reject(new Error('unknown calendar subscription: ' + id))
    if (!feed.enabled || this.disposed) return Promise.resolve({ skipped: true, reason: '订阅已停用' })
    const handle = this.handles.get(id)
    if (!handle) return Promise.reject(new Error('subscription is not registered: ' + id))
    const running = this.inflight.get(id)
    if (running) return running
    let receipt
    const controller = new AbortController()
    this.requests.set(id, controller)
    const current = () => !controller.signal.aborted && !this.disposed && this.requests.get(id) === controller
    const attempt = (async () => {
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      try {
        await handle.ready
        if (!current()) return { skipped: true, reason: '来源已改变，本次请求已取消' }
        receipt = handle.beginUpdate()
        let requester = fetch
        if (feed.authorization) {
          this.assertAuthorizedService(feed.authorization.profileID, feed.url)
          const identity = await this.identity(feed.authorization.profileID)
          if (!current() || identity?.accountID !== feed.authorization.account) {
            handle.setActive(false)
            return { skipped: true, reason: '账号已退出或切换，本次结果未写入' }
          }
          requester = (url, init) => this.ctx.oidcAccounts.authorizedFetch(feed.authorization.profileID, url, init, { serviceURL: feed.url })
        }
        const response = await requester(feed.url, {
          signal: controller.signal,
          redirect: feed.authorization ? 'error' : 'follow',
          headers: { accept: 'text/calendar, application/json, text/plain;q=0.9, */*;q=0.8' },
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const adapter = this.adapters.get(feed.format)
        if (!adapter) throw new Error('当前未启用此订阅所需的格式插件')
        const snapshot = await adapter.read(await boundedResponse(response))
        if (feed.authorization && (await this.identity(feed.authorization.profileID))?.accountID !== feed.authorization.account) {
          this.cancelRequest(id)
          handle.setActive(false)
        }
        // The feed may have been removed or disabled, or the plugin stopped,
        // while the request was in flight. A late answer must not write: the
        // source handle's registry check is the second lock on this door.
        if (!current() || !this.feedConfigs.get(id)?.enabled) {
          return { skipped: true, reason: '该订阅已删除、停用或插件已停止，本次结果未写入' }
        }
        const report = await receipt.apply({ events: snapshot.events, ...(snapshot.data === undefined ? {} : { data: snapshot.data }), complete: snapshot.skipped.length === 0 })
        if (!current() || report.state === 'superseded') return { skipped: true, reason: '来源已改变，本次结果未写入' }
        if (report.state !== 'ready') throw new Error(report.error ?? '来源快照无法关联，保留上次数据')
        const warnings = snapshot.degraded.map(item => typeof item === 'string' ? item : JSON.stringify(item))
        await this.remember(id, { lastSuccessAt: new Date().toISOString(), lastError: undefined, warnings })
        return { ...report, ...report.report, skipped: snapshot.skipped, degraded: snapshot.degraded }
      } catch (error) {
        if (this.requests.get(id) !== controller || this.disposed) return { skipped: true, reason: '来源已改变，本次请求已取消' }
        receipt?.fail('sync_failed')
        const timedOut = error?.name === 'AbortError' || error?.name === 'TimeoutError'
        const message = timedOut ? '请求超时' : String(error?.message ?? error)
        await this.remember(id, { lastError: message })
        throw new Error(`订阅「${feed.label}」刷新失败：${message}`)
      } finally {
        clearTimeout(timeout)
        if (this.requests.get(id) === controller) {
          this.requests.delete(id)
          this.inflight.delete(id)
        }
      }
    })()
    this.inflight.set(id, attempt)
    return attempt
  }

  cancelRequest(id) {
    this.requests.get(id)?.abort()
    this.requests.delete(id)
    this.inflight.delete(id)
    // Invalidate a response even when a transport ignores AbortSignal.
    this.handles.get(id)?.setActive(this.feedConfigs.get(id)?.enabled === true)
  }

  assertAuthorizedService(profileID, url) {
    if (!this.authorizedServices.some(service => service.profileID === profileID && service.url === url)) throw new Error('该地址尚未由机构配置授权')
  }

  registerFormat(id, adapter) {
    if (!id || this.adapters.has(id) || typeof adapter?.read !== 'function') throw new Error('invalid or duplicate calendar format')
    this.adapters.set(id, adapter)
    for (const feed of this.pendingRemovals.values()) {
      if (feed.format === id) void this.cleanupRemoval(feed).catch(() => {})
    }
    for (const feed of this.feedConfigs.values()) {
      if (feed.format !== id) continue
      if (feed.authorization) void this.reauthorize(feed).catch(() => {})
      else this.attach(feed)
    }
    return { dispose: () => {
      if (this.adapters.get(id) !== adapter) return
      this.adapters.delete(id)
      for (const feed of this.feedConfigs.values()) {
        if (feed.format !== id) continue
        this.cancelRequest(feed.id)
        clearTimeout(this.timers.get(feed.id))
        this.timers.delete(feed.id)
        this.handles.get(feed.id)?.dispose()
        this.handles.delete(feed.id)
      }
    } }
  }

  async identity(profileID) {
    const oidc = this.ctx.get('oidcAccounts')
    if (!oidc?.accountIdentity) throw new Error('当前 OIDC 插件不提供账号身份能力')
    const identity = await oidc.accountIdentity(profileID)
    if (identity && (typeof identity.accountID !== 'string' || !identity.accountID)) throw new Error('OIDC 未提供稳定的账号标识')
    return identity
  }

  async reauthorize(feed) {
    if (this.disposed || !feed.enabled || !this.feedConfigs.has(feed.id)) return
    try {
      const epoch = this.authorizationEpochs.get(feed.authorization.profileID)
      this.assertAuthorizedService(feed.authorization.profileID, feed.url)
      if ((await this.identity(feed.authorization.profileID))?.accountID !== feed.authorization.account) return
      if (epoch !== this.authorizationEpochs.get(feed.authorization.profileID)) return
      if (this.disposed || !this.feedConfigs.get(feed.id)?.enabled) return
      this.attach(feed)
      this.handles.get(feed.id)?.setActive(true)
      this.schedule(feed, 1_000)
    } catch (error) { await this.remember(feed.id, { lastError: String(error.message ?? error) }) }
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
    if (this.disposed) return
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
