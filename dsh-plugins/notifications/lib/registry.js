import { createHash, randomUUID } from 'node:crypto'

export const NOTIFICATION_PROTOCOL = 1
const id = value => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,95}$/.test(value)
const text = (value, max) => typeof value === 'string' && value.length <= max && !/[\x00-\x1f\x7f]/u.test(value)
const levels = new Set(['info', 'success', 'warning', 'error'])
const clone = value => {
  const json = JSON.stringify(value)
  if (!json || json.length > 4096) throw Error('Notification target must be bounded JSON')
  return JSON.parse(json)
}
const fingerprint = value => JSON.stringify(value)

/** Host-only registry; business records stay with their plugins. Source/scope
 * registration isolates identity, not capacity: this candidate still has a
 * shared plugin limit. See docs/PLUGIN_NOTIFICATIONS.md before extending it. */
export class NotificationRegistry {
  version = NOTIFICATION_PROTOCOL
  sources = new Map()
  records = new Map()
  listeners = new Set()
  constructor({ preferences = () => ({}), legacyPreferences = () => ({}), now = Date.now, report = () => {} } = {}) {
    Object.assign(this, { preferences, legacyPreferences, now, report })
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  changed() { for (const listener of this.listeners) { try { listener() } catch (error) { this.report(error) } } }
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
    const declared = new Map()
    for (const event of events) {
      if (!id(event.id) || declared.has(event.id) || !text(event.label, 120) || !event.label ||
        !levels.has(event.level) || typeof event.requiresAction !== 'boolean' ||
        !Array.isArray(event.actions) || !event.actions.length || event.actions.some(value => !id(value)) ||
        event.enabled !== undefined && typeof event.enabled !== 'boolean' ||
        event.legacyPreference !== undefined && !['studio', 'failed'].includes(event.legacyPreference)) throw Error('Invalid notification event')
      declared.set(event.id, { ...event, actions: [...event.actions] })
    }
    const source = { id: sourceId, scope, label, events: declared, generation: randomUUID(), controller: new AbortController(), onAction, onView: definition.onView, running: [] }
    this.sources.set(sourceKey, source)
    const current = () => !this.closed && this.sources.get(sourceKey) === source && !source.controller.signal.aborted
    const requireCurrent = () => { if (!current()) throw Error('Notification source is disposed') }
    const keyFor = value => {
      if (!text(value, 256) || !value) throw Error('Invalid notification id')
      return 'plugin:' + createHash('sha256').update(JSON.stringify([source.id, source.scope, source.generation, value])).digest('hex')
    }
    const remove = notificationId => {
      // Only committed records are removed. Pending publish() calls must be
      // serialized by the caller until same-ID cancellation is implemented.
      requireCurrent()
      const key = keyFor(notificationId), record = this.records.get(key)
      if (record) { record.resolved = true; record.revision++; this.changed() }
    }
    const publish = async (value, { renotify = false } = {}) => {
      requireCurrent()
      if (this.transport) await this.transport.ready()
      requireCurrent()
      const event = declared.get(value?.event), key = keyFor(value?.id)
      if (!event || !text(value.title, 120) || value.preview !== undefined && !text(value.preview, 400) ||
        value.action !== undefined && !event.actions.includes(value.action) || typeof renotify !== 'boolean') throw Error('Invalid notification')
      const data = { id: value.id, event: event.id, title: value.title, preview: value.preview ?? '',
        action: value.action ?? event.actions[0], target: clone(value.target ?? {}) }
      const previous = this.records.get(key), signature = fingerprint(data)
      if (previous?.signature === signature && !renotify) {
        if (this.transport) await this.transport.flush()
        requireCurrent()
        return { status: previous.resolved ? 'resolved' : this.enabled(source, event) ? 'accepted' : 'disabled', key, delivery: this.transport ? 'desktop' : 'none' }
      }
      // TODO(#189): replace this shared quota with source-isolated bounded FIFO.
      // Capacity must compare old/new state and must not use requiresAction as
      // an eviction priority. The shell rejects oversized snapshots as a whole.
      if ((!previous || previous.resolved || previous.viewed && !event.requiresAction) &&
        [...this.records.values()].filter(row => !row.resolved && (!row.viewed || row.source.events.get(row.data.event).requiresAction)).length >= 200) throw Error('Notification capacity reached')
      const record = { key, source, data, signature, revision: (previous?.revision ?? 0) + 1,
        alert: (previous?.alert ?? 0) + (!previous || renotify ? 1 : 0), createdAt: previous?.createdAt ?? this.now(),
        viewed: renotify ? false : previous?.viewed ?? false, resolved: false }
      this.records.set(key, record)
      // Bound deduplication history without evicting active notifications.
      while (this.records.size > 1000) {
        const old = [...this.records.values()].find(row => row.resolved || row.viewed && !row.source.events.get(row.data.event).requiresAction)
        if (!old) break
        this.records.delete(old.key)
      }
      this.changed()
      if (this.transport) await this.transport.flush()
      requireCurrent()
      return { status: this.enabled(source, event) ? 'accepted' : 'disabled', key, delivery: this.transport ? 'desktop' : 'none' }
    }
    const dispose = () => {
      if (!current()) return
      source.controller.abort()
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
    return [...this.records.values()].filter(record => {
      const event = record.source.events.get(record.data.event)
      return !record.resolved && (!record.viewed || event.requiresAction) && this.enabled(record.source, event)
    }).map(record => {
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
    const record = this.records.get(key)
    if (!record || record.resolved) return null
    const source = record.source, revision = record.revision, event = source.events.get(record.data.event)
    if (!this.enabled(source, event) || source.controller.signal.aborted) return null
    let target
    try { target = await source.onAction({ ...record.data, target: clone(record.data.target), scope: source.scope, signal: source.controller.signal }) }
    catch (error) { this.report(error); return null }
    if (source.controller.signal.aborted || this.records.get(key) !== record || record.revision !== revision || record.resolved || !this.enabled(source, event)) return null
    if (target === false) { record.resolved = true; this.changed(); return null }
    return { key, revision, source: source.id, scope: source.scope, action: record.data.action, target: clone(target ?? record.data.target) }
  }
  close() {
    this.closed = true
    for (const source of this.sources.values()) source.controller.abort()
    this.sources.clear(); this.records.clear(); this.changed(); this.listeners.clear()
  }
}
