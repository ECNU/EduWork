import { createHash } from 'node:crypto'

/** Stable across re-login. Public feeds use an explicit shared account such as "public". */
export function sourceIdentity({ provider, account, feed }) {
  for (const value of [provider, account, feed]) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('source needs stable provider, account and feed identifiers')
  }
  return `sync:${createHash('sha256').update(JSON.stringify([provider, account, feed])).digest('base64url')}`
}

/** Registration and pushed writes only. Data plugins own fetching, timers and retries. */
export class SourceRegistry {
  constructor(apply, changed = () => {}) {
    this.apply = apply
    this.changed = changed
    this.entries = new Map()
    this.closed = false
  }

  register(config) {
    if (this.closed) throw new Error('calendar sources are closed')
    if (['fetch', 'subscribe', 'pollIntervalMs', 'timeoutMs'].some(key => key in config)) throw new Error('source fetching belongs to the data plugin')
    const source = sourceIdentity(config)
    if (this.entries.has(source)) throw new Error('source is already registered')
    if (config.label !== undefined && typeof config.label !== 'string') throw new Error('source label must be text')
    if (config.allowAgentUpdates !== undefined && typeof config.allowAgentUpdates !== 'boolean') throw new Error('invalid agent source permission')
    const entry = { source, label: config.label ?? config.feed, active: true, registered: true,
      allowAgentUpdates: config.allowAgentUpdates === true, generation: 0, state: 'idle' }
    this.entries.set(source, entry)
    const handle = Object.freeze({ source,
      apply: async batch => this.begin(entry, batch?.complete === true).apply(batch),
      beginUpdate: () => this.begin(entry),
      setActive: active => {
        if (typeof active !== 'boolean' || !entry.registered) throw new Error('invalid source activation')
        entry.active = active
        ++entry.generation
        entry.state = 'idle'
        this.changed()
      },
      dispose: () => this.remove(entry),
      status: () => this.status(entry),
    })
    this.changed()
    return handle
  }

  status({ source, label, state, updatedAt, error }) {
    return { source, label, state, ...(updatedAt ? { updatedAt } : {}), ...(error ? { error } : {}) }
  }
  statuses() { return [...this.entries.values()].filter(entry => entry.active).map(entry => this.status(entry)) }
  isRegistered(source) { return this.entries.get(source)?.active === true }

  /** Call before external work starts; a later request invalidates this receipt. */
  begin(entry, supersede = true) {
    if (!entry.registered || !entry.active) throw new Error('source_inactive')
    const generation = supersede ? ++entry.generation : entry.generation
    const isCurrent = () => entry.registered && entry.active && entry.generation === generation
    entry.state = 'loading'
    entry.error = undefined
    this.changed()
    let settled = false
    let submitted = false
    const fail = code => {
      if (!isCurrent() || settled) return { state: 'superseded', source: entry.source }
      settled = true
      entry.state = 'error'
      entry.error = ['incomplete_snapshot', 'unattributable', 'sync_timeout'].includes(code) ? code : 'sync_failed'
      this.changed()
      return this.status(entry)
    }
    return Object.freeze({
      fail,
      apply: async batch => {
        if (!isCurrent() || settled || submitted) return { state: 'superseded', source: entry.source }
        submitted = true
        try {
          if (batch?.source !== undefined && batch.source !== entry.source) throw new Error('source_mismatch')
          if (batch?.complete === false || !Array.isArray(batch?.events)) throw new Error('incomplete_snapshot')
          const report = await this.apply({ ...batch, source: entry.source }, { isCurrent })
          if (!isCurrent()) return { state: 'superseded', source: entry.source }
          if (report.unattributable.length) { fail('unattributable'); return { ...this.status(entry), report } }
          settled = true
          entry.state = 'ready'
          entry.updatedAt = new Date().toISOString()
          this.changed()
          return { ...this.status(entry), report }
        } catch (error) {
          if (!isCurrent()) return { state: 'superseded', source: entry.source }
          fail(error.message)
          throw error
        }
      },
    })
  }

  agentApply(source, batch) {
    const entry = this.entries.get(source)
    if (!entry?.allowAgentUpdates) throw new Error('source_agent_write_denied')
    return this.begin(entry, batch?.complete === true).apply(batch)
  }
  remove(entry) {
    if (!entry.registered) return
    entry.registered = false
    entry.active = false
    ++entry.generation
    this.entries.delete(entry.source)
    this.changed()
  }
  close() {
    this.closed = true
    for (const entry of this.entries.values()) this.remove(entry)
  }
}
