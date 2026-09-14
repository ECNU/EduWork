import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { aggregateActivitySummaries, canonicalTimeZone, summarizeActivitySnapshot } from './core.js'
import { ActivitySummaryStore } from './summary-store.js'
import { emptyProfile, readActivityProfile } from './profile.js'

export const name = 'activity-insights-native'
const remoteInitializers = []

function parseRequest(value) {
  let parsed
  try { parsed = JSON.parse(value || '{}') } catch { throw new Error('activity request must be valid JSON') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('activity request must be an object')
  return {
    timeZone: canonicalTimeZone(typeof parsed.timeZone === 'string' ? parsed.timeZone : undefined),
    refresh: parsed.refresh === true,
  }
}

async function mapConcurrent(values, concurrency, project) {
  const result = new Array(values.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++
      try { result[index] = { status: 'fulfilled', value: await project(values[index]) } }
      catch (reason) { result[index] = { status: 'rejected', reason } }
    }
  })
  await Promise.all(workers)
  return result
}

function idleProgress() {
  return {
    state: 'idle',
    phase: 'listing',
    completed: 0,
    total: 0,
    reusedSessions: 0,
    updatedSessions: 0,
    skippedSessions: 0,
  }
}

async function within(operation, timeoutMs, fallback) {
  let timeout
  try {
    return await Promise.race([
      operation,
      new Promise(resolve => { timeout = setTimeout(() => resolve(fallback), timeoutMs) }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

export class ActivityInsightsService extends TypertRemoteService {
  static inject = ['sessionQuery']

  constructor(ctx, config = {}) {
    super(ctx, 'activityInsights')
    for (const initialize of remoteInitializers) initialize.call(this)
    this.ctx = ctx
    this.query = ctx.sessionQuery
    this.cacheMs = Number.isSafeInteger(config.cacheMs) ? Math.max(10_000, Math.min(600_000, config.cacheMs)) : 60_000
    this.concurrency = Number.isSafeInteger(config.concurrency) ? Math.max(1, Math.min(4, config.concurrency)) : 2
    this.requestTimeoutMs = Number.isSafeInteger(config.requestTimeoutMs) ? Math.max(5_000, Math.min(120_000, config.requestTimeoutMs)) : 30_000
    this.profileTimeoutMs = Number.isSafeInteger(config.profileTimeoutMs) ? Math.max(500, Math.min(10_000, config.profileTimeoutMs)) : 3_000
    this.cache = new Map()
    this.memoryEntries = undefined
    this.memoryTimeZone = undefined
    this.activeScan = undefined
    this.scanProgress = idleProgress()
    this.store = new ActivitySummaryStore({
      dshHome: typeof config.dshHome === 'string' ? config.dshHome : undefined,
      namespace: typeof config.cacheNamespace === 'string' ? config.cacheNamespace : 'default',
      logger: ctx.logger,
    })
  }

  async profile() { return readActivityProfile(this.ctx) }

  setProgress(patch) {
    this.scanProgress = { ...this.scanProgress, ...patch }
  }

  async readLive(record, previous, timeZone, signal) {
    let observation
    try {
      observation = await this.query.observeSession(record.header.id, { signal, projectionMode: 'all' })
      if (previous && previous.cursor === observation.cursor) return { entry: previous, reused: true, stable: false }
      const canAppend = previous && observation.cursor > previous.cursor
      const events = canAppend
        ? observation.events.filter(event => Number.isSafeInteger(event?.seq) && event.seq > previous.cursor)
        : observation.events
      const summary = summarizeActivitySnapshot(
        { header: observation.header, events },
        { timeZone, projections: observation.projections, ...(canAppend ? { previous: previous.summary, tail: true } : {}) },
      )
      return {
        entry: {
          sessionId: String(observation.header.id),
          revision: previous?.revision ?? '',
          cursor: observation.cursor,
          summary,
        },
        reused: false,
        stable: false,
      }
    } finally {
      observation?.[Symbol.dispose]?.()
    }
  }

  async readPersisted(record, revision, previous, timeZone, signal) {
    if (previous?.revision === revision) return { entry: previous, reused: true, stable: true }
    return this.readObserved(record, previous, timeZone, signal, revision)
  }

  async readObserved(record, previous, timeZone, signal, knownRevision = '') {
    let observation
    try {
      observation = await this.query.observeSession(record.header.id, { signal, projectionMode: 'all' })
      const revision = observation.revision === undefined ? knownRevision : String(observation.revision)
      if (previous && revision && previous.revision === revision) return { entry: previous, reused: true, stable: true }
      const canAppend = previous && observation.cursor > previous.cursor
      const events = canAppend
        ? observation.events.filter(event => Number.isSafeInteger(event?.seq) && event.seq > previous.cursor)
        : observation.events
      return {
        entry: {
          sessionId: String(observation.header.id),
          revision,
          cursor: observation.cursor,
          summary: summarizeActivitySnapshot(
            { header: observation.header, events },
            { timeZone, projections: observation.projections, ...(canAppend ? { previous: previous.summary, tail: true } : {}) },
          ),
        },
        reused: false,
        stable: Boolean(revision),
      }
    } finally {
      observation?.[Symbol.dispose]?.()
    }
  }

  async calculate(options) {
    const startedAt = Date.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new Error('activity insights request timed out')), this.requestTimeoutMs)
    const profilePromise = within(this.profile(), this.profileTimeoutMs, emptyProfile())
    this.scanProgress = { ...idleProgress(), state: 'running', phase: 'listing' }
    try {
      const records = await this.query.listSessions(controller.signal)
      const persistence = this.ctx.get?.('sessionPersistence')
      let snapshots = []
      if (persistence?.listSnapshots) {
        snapshots = await persistence.listSnapshots(controller.signal)
      }
      const revisions = new Map(snapshots.map(snapshot => [String(snapshot.header.id), String(snapshot.revision)]))
      const stableEntries = await this.store.load(options.timeZone)
      const priorMemory = this.memoryTimeZone === options.timeZone ? this.memoryEntries : undefined
      const activeIDs = new Set(records.map(record => String(record.header.id)))
      for (const sessionID of stableEntries.keys()) {
        if (!activeIDs.has(sessionID)) stableEntries.delete(sessionID)
      }

      this.setProgress({ phase: 'scanning', total: records.length })
      const reads = await mapConcurrent(records, this.concurrency, async record => {
        const sessionID = String(record.header.id)
        const stablePrevious = stableEntries.get(sessionID)
        const memoryPrevious = priorMemory?.get(sessionID)
        try {
          let result
          if (record.live) {
            result = await this.readLive(record, memoryPrevious ?? stablePrevious, options.timeZone, controller.signal)
          } else {
            const revision = revisions.get(sessionID)
            result = revision
              ? await this.readPersisted(record, revision, stablePrevious, options.timeZone, controller.signal)
              : await this.readObserved(record, stablePrevious, options.timeZone, controller.signal)
          }
          if (result.reused) this.setProgress({ reusedSessions: this.scanProgress.reusedSessions + 1 })
          else this.setProgress({ updatedSessions: this.scanProgress.updatedSessions + 1 })
          return result
        } catch (error) {
          this.setProgress({ skippedSessions: this.scanProgress.skippedSessions + 1 })
          return { entry: memoryPrevious ?? stablePrevious, reused: true, stable: false, error }
        } finally {
          this.setProgress({ completed: this.scanProgress.completed + 1 })
        }
      })

      const memoryEntries = new Map()
      for (const read of reads) {
        const result = read.status === 'fulfilled' ? read.value : undefined
        if (!result?.entry) continue
        memoryEntries.set(result.entry.sessionId, result.entry)
        if (result.stable && result.entry.revision) stableEntries.set(result.entry.sessionId, result.entry)
      }
      this.memoryEntries = memoryEntries
      this.memoryTimeZone = options.timeZone
      this.setProgress({ phase: 'saving' })
      await this.store.save(options.timeZone, stableEntries, {
        total: this.scanProgress.total,
        reusedSessions: this.scanProgress.reusedSessions,
        updatedSessions: this.scanProgress.updatedSessions,
        skippedSessions: this.scanProgress.skippedSessions,
        durationMs: Date.now() - startedAt,
      })
      const value = {
        ...aggregateActivitySummaries([...memoryEntries.values()].map(entry => entry.summary), {
          timeZone: options.timeZone,
          days: 365,
        }),
        profile: await profilePromise,
        skippedSessions: this.scanProgress.skippedSessions,
      }
      this.cache.set(options.timeZone, { at: Date.now(), value })
      this.setProgress({ state: 'ready', phase: 'ready' })
      return value
    } catch (error) {
      this.setProgress({ state: 'error', phase: 'ready' })
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  async snapshot(request) {
    const options = parseRequest(request)
    const cached = this.cache.get(options.timeZone)
    if (!options.refresh && cached && Date.now() - cached.at < this.cacheMs) return { ...cached.value, profile: await within(this.profile(), this.profileTimeoutMs, emptyProfile()) }

    if (this.activeScan) {
      if (this.activeScan.timeZone === options.timeZone) return this.activeScan.promise
      try { await this.activeScan.promise } catch {}
    }
    const promise = this.calculate(options)
    this.activeScan = { timeZone: options.timeZone, promise }
    try {
      return await promise
    } finally {
      if (this.activeScan?.promise === promise) this.activeScan = undefined
    }
  }

  async progress() {
    return { ...this.scanProgress }
  }
}

for (const method of ['snapshot', 'progress']) {
  Remote(method)(ActivityInsightsService.prototype[method], {
    kind: 'method', name: method, static: false, private: false,
    addInitializer(initializer) { remoteInitializers.push(initializer) },
  })
}

export default ActivityInsightsService
