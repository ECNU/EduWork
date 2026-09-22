import { randomUUID } from 'node:crypto'

export const notificationDefaults = Object.freeze({ enabled: true, attention: true, completed: true, failed: true, studio: true, sound: false, preview: false })
const human = item => item.kind === 'question' || item.kind === 'approval'
const safeTitle = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/gu, ' ').slice(0, 120) : ''

/** Observe live work only. Never answer, cancel, or change an agent's policy. */
export class DesktopAttention {
  constructor({ bridge, preferences, validateTarget = async () => true, now = Date.now, schedule = setTimeout, cancel = clearTimeout }) {
    Object.assign(this, { bridge, preferences, validateTarget, now, schedule, cancel })
    this.items = new Map()
    this.titles = new Map()
    this.turns = new Map()
    this.studioSeen = new Map()
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
      for (const row of this.items.values()) if (row.sessionId === sessionId && !row.artifactId) this.remove(row.key)
    }
    if (event.type === 'approval/asked') this.put({ key: `approval:${sessionId}:${data.id}`, kind: 'approval', sessionId, title: this.titles.get(sessionId) })
    if (event.type === 'approval/decided') this.remove(`approval:${sessionId}:${data.id}`)
    if (event.type !== 'turn/end') return
    this.removeSession(sessionId, true)
    // A restore's interrupted marker and seed history must not create toasts.
    if (this.turns.get(sessionId) !== data.turn) return
    this.turns.delete(sessionId)
    const kind = data.reason?.kind
    if (kind === 'completed' || ['error', 'blocked', 'max-tokens'].includes(kind))
      this.put({ key: `turn:${sessionId}:${data.turn}`, kind: kind === 'completed' ? 'completed' : 'failed', sessionId, title: this.titles.get(sessionId) })
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
    const current = new Set()
    for (const row of rows) {
      current.add(row.id)
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
      const result = await this.bridge({ action: 'sync', instance: this.instance, items: [...this.items.values()], preferences: this.preferences() })
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
  close() { this.closed = true; this.cancel(this.timer); this.items.clear(); this.titles.clear(); this.turns.clear(); this.studioSeen.clear() }
}

export function observeDesktopAttention(ctx, attention) {
  const root = session => ctx.get('agents')?.roots().some(agent => agent.id === session.id) === true
  ctx.on('session/event', (session, event) => attention.event(session, event, root(session)))
  ctx.on('session/disposed', session => { attention.removeSession(String(session.id), true); attention.titles.delete(String(session.id)); attention.turns.delete(String(session.id)) })
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
