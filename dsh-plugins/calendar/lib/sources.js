// Institution plugins own authentication and conversion. This coordinator accepts
// complete, validated calendar batches and owns ordering and lifecycle only.
import { createHash } from 'node:crypto'

/** Stable across re-login and display-name changes. Never pass access tokens here. */
export function sourceIdentity({ provider, account, feed }) {
  for (const value of [provider, account, feed]) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('source needs stable provider, account and feed identifiers')
  }
  return `sync:${createHash('sha256').update(JSON.stringify([provider, account, feed])).digest('base64url')}`
}

export class SourceCoordinator {
  constructor(apply, changed = () => {}) {
    this.changed = changed
    this.apply = apply
    this.entries = new Map()
    this.closed = false
  }

  /** Host-only: fetch receives { signal, reason }; credentials stay in its closure. */
  register(config) {
    if (this.closed) throw new Error('calendar sources are closed')
    const source = sourceIdentity(config)
    if (this.entries.has(source)) throw new Error('source is already registered')
    if (typeof config.fetch !== 'function') throw new Error('source needs a fetch adapter')
    const interval = config.pollIntervalMs ?? 300000
    if (!Number.isSafeInteger(interval) || interval < 1000 || interval > 2147483647) throw new Error('poll interval must be at least 1000 ms')
    const timeoutMs = config.timeoutMs ?? 30000
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 2147483647) throw new Error('invalid source timeout')
    if (config.label !== undefined && typeof config.label !== 'string') throw new Error('source label must be text')
    const entry = { source, timeoutMs, label: config.label ?? config.feed, generation: 0, active: true, fetch: config.fetch,
      state: 'idle', controller: undefined }
    this.entries.set(source, entry)
    const handle = { source, sync: (reason = 'manual') => this.sync(entry, reason),
      dispose: () => this.remove(entry), status: () => this.status(entry) }
    try {
      entry.unsubscribe = config.subscribe?.(reason => {
        if (!['login', 'reconnect'].includes(reason)) throw new Error('unsupported source trigger')
        return handle.sync(reason)
      })
      entry.timer = setInterval(() => { void handle.sync('periodic') }, interval)
      entry.timer.unref?.()
    } catch (error) {
      this.remove(entry)
      throw error
    }
    // Failure is a status, not an unhandled startup rejection.
    void handle.sync('startup')
    return handle
  }

  status(entry) {
    const { source, label, state, updatedAt, error } = entry
    return { source, label, state, ...(updatedAt ? { updatedAt } : {}), ...(error ? { error } : {}) }
  }

  isRegistered(source) { return this.entries.has(source) }

  statuses() { return [...this.entries.values()].map(entry => this.status(entry)) }

  async sync(entry, reason) {
    if (!entry.active) return { state: 'stopped', source: entry.source }
    const generation = ++entry.generation
    entry.controller?.abort()
    const controller = new AbortController()
    entry.controller = controller
    entry.state = 'loading'
    entry.error = undefined
    this.changed()
    const isCurrent = () => entry.active && generation === entry.generation
    let abort
    const cancelled = new Promise((_, reject) => {
      abort = () => reject(new Error('sync_timeout'))
      controller.signal.addEventListener('abort', abort, { once: true })
    })
    const timeout = setTimeout(() => controller.abort(), entry.timeoutMs)
    timeout.unref?.()
    try {
      const batch = await Promise.race([entry.fetch({ signal: controller.signal, reason }), cancelled])
      if (!isCurrent()) return { state: 'superseded', source: entry.source }
      if (batch?.complete !== true || !Array.isArray(batch.events)) throw new Error('incomplete_snapshot')
      const report = await this.apply({ source: entry.source, events: batch.events, complete: true }, { isCurrent })
      if (!isCurrent()) return { state: 'superseded', source: entry.source }
      if (report.unattributable.length) throw new Error('unattributable')
      entry.state = 'ready'
      entry.updatedAt = new Date().toISOString()
      this.changed()
      return { ...this.status(entry), report }
    } catch (error) {
      if (!isCurrent()) return { state: 'superseded', source: entry.source }
      entry.state = 'error'
      // Adapter exceptions may contain URLs or credentials. Only public codes leave here.
      entry.error = error?.message === 'sync_timeout' ? 'sync_timeout' : error?.message === 'incomplete_snapshot' ? 'incomplete_snapshot'
        : error?.message === 'unattributable' ? 'unattributable' : 'sync_failed'
      this.changed()
      return this.status(entry)
    } finally {
      clearTimeout(timeout)
      controller.signal.removeEventListener('abort', abort)
    }
  }

  syncAll(reason = 'manual') {
    return Promise.all([...this.entries.values()].map(entry => this.sync(entry, reason)))
  }

  remove(entry) {
    if (!entry.active) return
    entry.active = false
    ++entry.generation
    entry.controller?.abort()
    clearInterval(entry.timer)
    try { entry.unsubscribe?.() } catch { /* Cleanup must continue for every registered source. */ }
    this.entries.delete(entry.source)
    this.changed()
  }

  close() {
    this.closed = true
    for (const entry of this.entries.values()) this.remove(entry)
  }
}
