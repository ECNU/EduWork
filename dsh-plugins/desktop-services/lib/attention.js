import { randomUUID } from 'node:crypto'

export const notificationDefaults = Object.freeze({ enabled: true, attention: true, completed: true, failed: true, studio: true, sound: false, preview: false })
const human = item => item.kind === 'question' || item.kind === 'approval'
const safeTitle = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/gu, ' ').slice(0, 120).toWellFormed() : ''

/** Observe live work only. Never answer, cancel, or change an agent's policy. */
export class DesktopAttention {
  constructor({ bridge, preferences, validateTarget = async () => true, goal = () => undefined, notifications, now = Date.now, schedule = setTimeout, cancel = clearTimeout }) {
    Object.assign(this, { bridge, preferences, validateTarget, goal, notifications, now, schedule, cancel })
    this.items = new Map()
    this.titles = new Map()
    this.turns = new Map()
    this.delegated = new Map()
    this.goalRounds = new Map()
    this.startedAt = now()
    this.instance = randomUUID()
    this.closed = false
    this.dirty = true
  }
  put(item) {
    if (this.closed || this.items.has(item.key)) return
    this.items.set(item.key, { ...item, title: safeTitle(item.title), createdAt: this.now() })
    while (this.items.size > 200) {
      const oldest = [...this.items.values()].find(row => !human(row)) ?? this.items.values().next().value
      this.items.delete(oldest.key)
    }
    this.changed()
  }
  remove(key) { if (this.items.delete(key)) this.changed() }
  removeSession(sessionId, onlyHuman = false) {
    for (const row of this.items.values()) if (row.sessionId === sessionId && (!onlyHuman || human(row))) this.remove(row.key)
  }
  event(session, event, isRoot) {
    const sessionId = String(session.id), data = event.data
    if (event.type === 'session/title') this.titles.set(sessionId, safeTitle(data.title))
    if (!isRoot) return
    if (event.type === 'turn/start') {
      this.turns.set(sessionId, data.turn)
      this.goalRounds.delete(sessionId)
      for (const row of this.items.values()) if (row.sessionId === sessionId) this.remove(row.key)
      this.changed()
    }
    if (event.type === 'approval/asked') this.put({ key: `approval:${sessionId}:${data.id}`, kind: 'approval', sessionId, title: this.titles.get(sessionId) })
    if (event.type === 'approval/decided') this.remove(`approval:${sessionId}:${data.id}`)
    if (event.type !== 'turn/end') return
    this.removeSession(sessionId, true)
    // A restore's interrupted marker and seed history must not create toasts.
    if (this.turns.get(sessionId) !== data.turn) return
    this.turns.delete(sessionId)
    this.changed()
    const kind = data.reason?.kind, goal = this.goal(sessionId)
    // A background subagent wakes this conversation for another turn when it settles.
    if (kind === 'completed' && [...this.delegated.values()].includes(sessionId)) return
    // The goal driver either starts another round or ends the goal; goalChanged() settles this turn.
    if (kind === 'completed' && goal?.phase === 'active' && goal.activation === 'armed') { this.goalRounds.set(sessionId, data.turn); return }
    const failed = ['error', 'blocked', 'max-tokens'].includes(kind) || kind === 'completed' && goal?.phase === 'blocked'
    if (kind === 'completed' || failed) this.finish(sessionId, data.turn, failed)
  }
  finish(sessionId, turn, failed) {
    this.put({ key: `turn:${sessionId}:${turn}`, kind: failed ? 'failed' : 'completed', sessionId, title: this.titles.get(sessionId) })
  }
  /** A goal blocked or completed after the turn it held is reported once; a pause or clear is the user's own stop. */
  goalChanged(sessionId, operation) {
    const turn = this.goalRounds.get(sessionId)
    if (turn === undefined || operation === 'edit') return
    this.goalRounds.delete(sessionId)
    if (operation === 'block' || operation === 'complete') this.finish(sessionId, turn, operation === 'block')
  }
  /** A working subagent belongs to the root conversation that delegated it. */
  subagent(sessionId, type, root) {
    if (type === 'turn/end') this.delegated.delete(sessionId)
    else if (root !== undefined) this.delegated.set(sessionId, root)
  }
  async question(request, next) {
    if (!request.agent || request.signal?.aborted) return next()
    const sessionId = String(request.agent.id), key = `question:${sessionId}:${randomUUID()}`
    this.put({ key, kind: 'question', sessionId, title: this.titles.get(sessionId) })
    const clear = () => this.remove(key)
    request.signal?.addEventListener('abort', clear, { once: true })
    try { return await next() }
    finally { request.signal?.removeEventListener('abort', clear); clear() }
  }
  /** The shared display snapshot includes optional plugin activity. */
  running() { return [...new Set([...this.turns.keys(), ...(this.notifications?.running() ?? [])])].slice(0, 200) }
  changed() {
    const wasDirty = this.dirty
    this.dirty = true
    if (!this.closed && (!this.timer || !wasDirty)) {
      this.cancel(this.timer)
      this.timer = this.schedule(() => { this.timer = null; void this.flush() }, 200)
    }
  }
  flush() {
    // Each caller waits for a snapshot taken after preceding sends finish.
    // Merely joining an older send would miss notices added while it was pending.
    const send = async () => {
      if (this.closed) return false
      this.dirty = false
      try {
        const result = await this.bridge({ action: 'sync', instance: this.instance, items: [...this.items.values(), ...(this.pluginSupported ? this.notifications?.snapshot() ?? [] : [])], running: this.running(), preferences: this.preferences() })
        this.connected = true
        this.pluginSupported = result.pluginNotifications === 1
        for (const key of result.seen ?? []) this.items.delete(key)
        if (result.delivery === 'unavailable') { this.dirty = true; return false }
        return true
      } catch { this.connected = false; this.dirty = true; return false }
      finally {
        // Also repairs a transient bridge failure, without interrupting the agent.
        if (!this.closed && !this.timer) this.timer = this.schedule(() => { this.timer = null; void this.flush() }, this.dirty ? 1000 : 5000)
      }
    }
    const pending = (this.flushTail ?? Promise.resolve()).then(send, send)
    this.flushTail = pending
    return pending
  }
  async view(view) {
    if (view.openedKey && this.issuedPlugin?.key === view.openedKey) {
      this.notifications?.seen(view.openedKey, this.issuedPlugin.revision)
      this.issuedPlugin = null
    } else if (view.openedKey && this.items.has(view.openedKey) && !human(this.items.get(view.openedKey))) this.remove(view.openedKey)
    const response = await this.bridge({ action: 'view', sessionId: view.sessionId })
    if (response.foreground) this.notifications?.observeViews(view.visible)
    const plugin = await this.notifications?.activate(response.openKey)
    if (plugin) this.issuedPlugin = plugin
    let target = this.items.get(response.openKey)
    if (target && !await this.validateTarget(target)) { this.remove(target.key); target = null }
    if (target && !this.items.has(target.key)) target = null
    return { desktop: true, target: plugin ? { key: plugin.key, plugin } : target ? { key: target.key, sessionId: target.sessionId } : null,
      delivery: response.delivery, sources: this.notifications?.catalog() ?? [], pluginProtocol: this.pluginSupported ? 1 : 0 }
  }
  close() { this.closed = true; this.cancel(this.timer); this.items.clear(); this.titles.clear(); this.turns.clear(); this.delegated.clear(); this.goalRounds.clear() }
}

export function observeDesktopAttention(ctx, attention) {
  const root = session => ctx.get('agents')?.roots().some(agent => agent.id === session.id) === true
  // Follow subagent lineage, as DSH does; a fork shares the field without the origin.
  const owner = session => {
    const seen = new Set()
    for (let header = session.header; header?.origin === 'subagent' && !seen.has(header.parentSession);) {
      seen.add(header.parentSession)
      const parent = ctx.get('agents')?.get(header.parentSession)
      if (!parent) return
      if (root(parent)) return String(parent.id)
      header = parent.session.header
    }
  }
  ctx.on('session/event', (session, event) => {
    const isRoot = root(session)
    attention.event(session, event, isRoot)
    if (!isRoot && (event.type === 'turn/start' || event.type === 'turn/end')) attention.subagent(String(session.id), event.type, owner(session))
  })
  ctx.on('session/disposed', session => {
    const id = String(session.id)
    attention.removeSession(id, true); attention.titles.delete(id); attention.delegated.delete(id); attention.goalRounds.delete(id)
    if (attention.turns.delete(id)) attention.changed()
  })
  ctx.on('goal/changed', ({ agent, change }) => attention.goalChanged(String(agent.id), change.operation))
  ctx.on('user-questions/request', (request, next) => attention.question(request, next), { prepend: true })
  attention.changed()
  ctx.effect(() => () => attention.close())
}
