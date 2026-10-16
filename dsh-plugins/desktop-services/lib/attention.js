import { randomUUID } from 'node:crypto'

export const notificationDefaults = Object.freeze({ enabled: true, attention: true, completed: true, failed: true, studio: true, sound: false, preview: false })
const human = item => item.kind === 'question' || item.kind === 'approval'
const safeTitle = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/gu, ' ').slice(0, 120) : ''

/** Observe live work only. Never answer, cancel, or change an agent's policy. */
export class DesktopAttention {
  constructor({ bridge, preferences, validateTarget = async () => true, goal = () => undefined, now = Date.now, schedule = setTimeout, cancel = clearTimeout }) {
    Object.assign(this, { bridge, preferences, validateTarget, goal, now, schedule, cancel })
    this.items = new Map()
    this.titles = new Map()
    this.turns = new Map()
    this.delegated = new Map()
    this.goalRounds = new Map()
    this.studioSeen = new Map()
    this.studioRunning = new Map()
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
      for (const row of this.items.values()) if (row.sessionId === sessionId && !row.artifactId) this.remove(row.key)
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
  studio(workspaceId, rows) {
    const current = new Set(), running = this.running().join()
    for (const row of rows) {
      current.add(row.id)
      if (row.sessionId && !row.deletedAt && ['queued', 'running'].includes(row.status)) this.studioRunning.set(row.id, { sessionId: row.sessionId, workspaceId })
      else this.studioRunning.delete(row.id)
      const signature = `${row.version}:${row.status}:${row.lifecycle?.state ?? ''}`
      const previous = this.studioSeen.get(row.id)
      this.studioSeen.set(row.id, { signature, workspaceId })
      // Ignore pre-start history, but include new short jobs between polls.
      if (previous?.signature === signature || Date.parse(row.updatedAt) < this.startedAt) continue
      for (const item of this.items.values()) if (item.artifactId === row.id) this.remove(item.key)
      if (!row.sessionId || !['completed', 'failed'].includes(row.status) || row.lifecycle?.state === 'open') continue
      if (row.lifecycle?.reason === 'aborted' || row.lifecycle?.reason === 'interrupted') continue
      this.put({ key: `studio:${row.id}:${row.version}:${row.status}`, kind: row.status === 'completed' ? 'studio' : 'failed',
        sessionId: row.sessionId, artifactId: row.id, title: row.title })
    }
    for (const [id, row] of this.studioSeen) if (row.workspaceId === workspaceId && !current.has(id)) {
      this.studioSeen.delete(id)
      for (const item of this.items.values()) if (item.artifactId === id) this.remove(item.key)
    }
    for (const [id, row] of this.studioRunning) if (row.workspaceId === workspaceId && !current.has(id)) this.studioRunning.delete(id)
    if (this.running().join() !== running) this.changed()
  }
  /** Root sessions with a live turn or a Studio result being generated. */
  running() {
    return [...new Set([...this.turns.keys(), ...[...this.studioRunning.values()].map(row => row.sessionId)])].slice(0, 200)
  }
  changed() {
    const wasDirty = this.dirty
    this.dirty = true
    if (!this.closed && (!this.timer || !wasDirty)) {
      this.cancel(this.timer)
      this.timer = this.schedule(() => { this.timer = null; void this.flush() }, 200)
    }
  }
  async flush() {
    if (this.closed || this.sending) return
    this.sending = true; this.dirty = false
    try {
      const result = await this.bridge({ action: 'sync', instance: this.instance, items: [...this.items.values()], running: this.running(), preferences: this.preferences() })
      for (const key of result.seen ?? []) this.items.delete(key)
    } catch { this.dirty = true }
    finally {
      this.sending = false
      // Also repairs a transient bridge failure, without interrupting the agent.
      if (!this.closed && !this.timer) this.timer = this.schedule(() => { this.timer = null; void this.flush() }, this.dirty ? 1000 : 5000)
    }
  }
  async view(view) {
    if (view.openedKey && this.items.has(view.openedKey) && !human(this.items.get(view.openedKey))) this.remove(view.openedKey)
    const response = await this.bridge({ action: 'view', sessionId: view.sessionId, ...(view.artifactId ? { artifactId: view.artifactId } : {}) })
    let target = this.items.get(response.openKey)
    if (target && !await this.validateTarget(target)) { this.remove(target.key); target = null }
    if (target && !this.items.has(target.key)) target = null
    // The host is authoritative: a toast clicked after a decision is stale.
    return { desktop: true, target: target ? { key: target.key, sessionId: target.sessionId, ...(target.artifactId ? { artifactId: target.artifactId } : {}) } : null,
      delivery: response.delivery }
  }
  close() { this.closed = true; this.cancel(this.timer); this.items.clear(); this.titles.clear(); this.turns.clear(); this.delegated.clear(); this.goalRounds.clear(); this.studioSeen.clear(); this.studioRunning.clear() }
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
  let disposed = false, timer
  const pollStudio = async () => {
    try {
      const service = ctx.get('knowledgeStudio'), registry = ctx.get('workspaceRegistry')
      if (service && registry) for (const workspace of registry.list()) {
        const { artifacts } = await service.listArtifacts(workspace.id)
        if (disposed) return
        attention.studio(String(workspace.id), artifacts)
      }
    } catch { /* A Studio fault is reported by Studio; no repeated notification errors. */ }
    if (!disposed) timer = setTimeout(pollStudio, 3000)
  }
  void pollStudio()
  attention.changed()
  ctx.effect(() => () => { disposed = true; clearTimeout(timer); attention.close() })
}
