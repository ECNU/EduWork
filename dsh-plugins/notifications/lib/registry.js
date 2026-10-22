import { createHash, randomUUID } from 'node:crypto'

export const NOTIFICATION_PROTOCOL = 1
export const SOURCE_LIMIT = 16
export const SOURCE_QUEUE_LIMIT = 200
export const SOURCE_HISTORY_LIMIT = 1000
const id = value => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,95}$/.test(value)
const text = (value, max) => typeof value === 'string' && value.length <= max && !/[\x00-\x1f\x7f]/u.test(value)
const levels = new Set(['info', 'success', 'warning', 'error'])
const clone = value => {
  const json = JSON.stringify(value)
  if (!json || json.length > 4096) throw Error('Notification target must be bounded JSON')
  return JSON.parse(json)
}
const fingerprint = value => JSON.stringify(value)

/** Host-only registry. Each source owns its FIFO and deduplication history;
 * accounts share that source's capacity. Eviction never changes business state. */
export class NotificationRegistry {
  version = NOTIFICATION_PROTOCOL
  sources = new Map()
  records = new Map()
  listeners = new Set()
  sequence = 0
  constructor({ preferences = () => ({}), legacyPreferences = () => ({}), now = Date.now, report = () => {} } = {}) {
    Object.assign(this, { preferences, legacyPreferences, now, report })
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  changed() { this.reconcile(); for (const listener of this.listeners) { try { listener() } catch (error) { this.report(error) } } }
  reconcile() {
    const groups = new Map()
    for (const record of this.records.values()) {
      const event = record.source.events.get(record.data.event)
      // Switching a source off consumes its display backlog, not its business
      // records. Re-enabling must not replay the disabled period's history.
      if (!this.enabled(record.source, event)) record.suppressed = true
      const active = !record.resolved && !record.evicted && !record.suppressed && (!record.viewed || event.requiresAction)
      if (active && !record.queued) record.order = ++this.sequence
      record.queued = active
      const group = groups.get(record.source.id) ?? []
      group.push(record); groups.set(record.source.id, group)
    }
    for (const records of groups.values()) {
      const active = records.filter(row => row.queued).sort((a, b) => a.order - b.order)
      for (const record of active.slice(0, Math.max(0, active.length - SOURCE_QUEUE_LIMIT))) {
        record.evicted = true; record.queued = false
      }
      let excess = records.length - SOURCE_HISTORY_LIMIT
      for (const record of records) if (excess > 0 && !record.queued) { this.records.delete(record.key); excess-- }
    }
  }
  enabled(source, event) {
    const preferences = this.preferences()
    return preferences[`${source.id}/*`] !== false &&
      (preferences[`${source.id}/${event.id}`] ?? this.legacyPreferences()[event.legacyPreference] ?? event.enabled ?? true)
  }
  catalog() {
    const unique = new Map()
    for (const source of this.sources.values()) if (!unique.has(source.id)) unique.set(source.id, {
      id: source.id, label: source.label, enabled: this.preferences()[`${source.id}/*`] !== false,
      events: [...source.events.values()].map(event => ({ id: event.id, label: event.label, enabled: this.enabled(source, event) })),
    })
    return [...unique.values()]
  }
  register(definition) {
    const { source: sourceId, scope = 'default', label, events, onAction } = definition ?? {}
    if (this.closed || definition?.version !== this.version) throw Error('Unsupported notification protocol')
    if (!id(sourceId) || !text(scope, 256) || !scope || !text(label, 120) || !label || !Array.isArray(events) ||
      !events.length || events.length > 32 || typeof onAction !== 'function') throw Error('Invalid notification source')
    const sourceKey = JSON.stringify([sourceId, scope])
    if (this.sources.has(sourceKey)) throw Error('Notification source already registered for this scope')
    const sourceIds = new Set([...this.sources.values()].map(source => source.id))
    if (!sourceIds.has(sourceId) && sourceIds.size >= SOURCE_LIMIT) throw Error('Notification source limit reached')
    const declared = new Map()
    for (const event of events) {
      if (!id(event.id) || declared.has(event.id) || !text(event.label, 120) || !event.label ||
        !levels.has(event.level) || typeof event.requiresAction !== 'boolean' ||
        !Array.isArray(event.actions) || !event.actions.length || event.actions.some(value => !id(value)) ||
        event.enabled !== undefined && typeof event.enabled !== 'boolean' ||
        event.legacyPreference !== undefined && !['studio', 'failed'].includes(event.legacyPreference)) throw Error('Invalid notification event')
      declared.set(event.id, { ...event, label: event.label.toWellFormed(), actions: [...event.actions] })
    }
    const source = { id: sourceId, scope, label: label.toWellFormed(), events: declared, generation: randomUUID(), controller: new AbortController(), onAction, onView: definition.onView, running: [] }
    this.sources.set(sourceKey, source)
    const current = () => !this.closed && this.sources.get(sourceKey) === source && !source.controller.signal.aborted
    const requireCurrent = () => { if (!current()) throw Error('Notification source is disposed') }
    const keyFor = value => {
      if (!text(value, 256) || !value) throw Error('Invalid notification id')
      return 'plugin:' + createHash('sha256').update(JSON.stringify([source.id, source.scope, source.generation, value])).digest('hex')
    }
    const pending = new Map()
    const remove = notificationId => {
      requireCurrent()
      const key = keyFor(notificationId), record = this.records.get(key)
      const operation = pending.get(key)
      if (operation) { operation.cancelled = true; pending.delete(key) }
      if (record) { record.resolved = true; record.revision++; this.changed() }
    }
    const publish = async (value, { renotify = false } = {}) => {
      requireCurrent()
      const event = declared.get(value?.event), key = keyFor(value?.id)
      if (!event || !text(value.title, 120) || value.preview !== undefined && !text(value.preview, 400) ||
        value.action !== undefined && !event.actions.includes(value.action) || typeof renotify !== 'boolean') throw Error('Invalid notification')
      // Producers may truncate at a UTF-16 code unit boundary. Normalize display
      // text so JSON escapes cannot multiply a full snapshot beyond its cap.
      const data = { id: value.id, event: event.id, title: value.title.toWellFormed(), preview: (value.preview ?? '').toWellFormed(),
        action: value.action ?? event.actions[0], target: clone(value.target ?? {}) }
      // Capture intent before the first await. A later same-ID invocation wins;
      // withdraw/resolve invalidates an outstanding publish without waiting for
      // the bridge. A stale operation never overwrites a newer target.
      const operation = { cancelled: false }
      pending.set(key, operation)
      try {
        if (this.transport) await this.transport.ready()
        requireCurrent()
        if (operation.cancelled || pending.get(key) !== operation) return { status: 'resolved', key, delivery: 'none' }
        this.reconcile()
        const previous = this.records.get(key), signature = fingerprint(data)
        const result = () => {
          const currentRecord = this.records.get(key)
          return { status: operation.cancelled || pending.get(key) !== operation || currentRecord?.resolved ? 'resolved' : !currentRecord || currentRecord.evicted ? 'discarded'
            : currentRecord.suppressed || !this.enabled(source, event) ? 'disabled' : 'accepted', key,
            delivery: this.transport ? 'desktop' : 'none' }
        }
        if (previous?.signature === signature && !renotify) {
          if (this.transport) await this.transport.flush()
          requireCurrent()
          return result()
        }
        const record = { key, source, data, signature, revision: (previous?.revision ?? 0) + 1,
          alert: (previous?.alert ?? 0) + (!previous || renotify ? 1 : 0), createdAt: previous?.createdAt ?? this.now(),
          viewed: renotify ? false : previous?.viewed ?? false, resolved: false,
          suppressed: !this.enabled(source, event), evicted: !renotify && previous?.evicted || false,
          queued: previous?.queued ?? false, order: previous?.order }
        this.records.set(key, record)
        this.changed()
        if (this.transport) await this.transport.flush()
        requireCurrent()
        return result()
      } finally { if (pending.get(key) === operation) pending.delete(key) }
    }
    const dispose = () => {
      if (!current()) return
      source.controller.abort()
      pending.clear()
      this.sources.delete(sourceKey)
      for (const [key, record] of this.records) if (record.source === source) this.records.delete(key)
      this.changed()
    }
    this.changed()
    return Object.freeze({ version: this.version, scope, signal: source.controller.signal, publish,
      activity: ids => {
        requireCurrent()
        if (!Array.isArray(ids) || ids.length > 200 || ids.some(value => !text(value, 256))) throw Error('Invalid notification activity')
        source.running = [...new Set(ids)].map(value => keyFor(value))
        this.changed()
      },
      update: async (value, options) => { requireCurrent(); if (!this.records.has(keyFor(value?.id))) throw Error('Unknown notification'); return publish(value, options) },
      withdraw: remove, resolve: remove, dispose })
  }
  running() { return [...this.sources.values()].flatMap(source => source.running).slice(0, 200) }
  snapshot() {
    this.reconcile()
    return [...this.records.values()].filter(record => record.queued).sort((a, b) => a.order - b.order).map(record => {
      const event = record.source.events.get(record.data.event)
      return { key: record.key, kind: 'plugin', source: record.source.id, event: event.id,
        label: event.label, level: event.level, requiresAction: event.requiresAction,
        title: record.data.title, preview: record.data.preview, createdAt: record.createdAt,
        revision: record.revision, alert: record.alert }
    })
  }
  seen(key, revision) {
    const record = this.records.get(key)
    if (!record || record.revision !== revision || record.resolved) return
    record.viewed = true
    this.changed()
  }
  observeViews(views = []) {
    for (const record of this.records.values()) {
      if (record.resolved || record.viewed || typeof record.source.onView !== 'function') continue
      const view = views.find(value => value.source === record.source.id && value.scope === record.source.scope)
      try {
        if (view && record.source.onView(clone(record.data.target), clone(view.target)) === true) this.seen(record.key, record.revision)
      } catch (error) { this.report(error) }
    }
  }
  async activate(key) {
    this.reconcile()
    const record = this.records.get(key)
    if (!record?.queued) return null
    const source = record.source, revision = record.revision, event = source.events.get(record.data.event)
    if (!this.enabled(source, event) || source.controller.signal.aborted) return null
    let target
    try { target = await source.onAction({ ...record.data, target: clone(record.data.target), scope: source.scope, signal: source.controller.signal }) }
    catch (error) { this.report(error); return null }
    this.reconcile()
    if (source.controller.signal.aborted || this.records.get(key) !== record || record.revision !== revision || !record.queued || !this.enabled(source, event)) return null
    if (target === false) { record.resolved = true; this.changed(); return null }
    return { key, revision, source: source.id, scope: source.scope, action: record.data.action, target: clone(target ?? record.data.target) }
  }
  close() {
    this.closed = true
    for (const source of this.sources.values()) source.controller.abort()
    this.sources.clear(); this.records.clear(); this.changed(); this.listeners.clear()
  }
}
