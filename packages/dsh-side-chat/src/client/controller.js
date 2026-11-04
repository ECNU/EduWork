export const SIDE_CHAT_PATH = '/api/eduwork/side-chat'
export const SIDE_KIND = 'eduwork-side-chat'
export const addressOf = sessionId => `dsh-resource://sidechat/session/${encodeURIComponent(sessionId)}`

/** A source may own several independent, ordered snapshot controllers. */
export class SideChatRegistry {
  constructor(options) {
    this.options = options
    this.controllers = new Map()
    this.listeners = new Set()
    this.revision = 0
    this.subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
    this.getSnapshot = () => this.revision
  }
  forSource(sourceSessionId) {
    return this.controllers.get(sourceSessionId)?.[0] ?? this.createForSource(sourceSessionId)
  }
  createForSource(sourceSessionId) {
    const list = this.controllers.get(sourceSessionId) ?? []
    if (!this.controllers.has(sourceSessionId)) this.controllers.set(sourceSessionId, list)
    const controller = new SideChatController({ ...this.options, changed: snapshot => {
        if (snapshot.phase === 'idle' && !snapshot.chat) {
          // Closed snapshots no longer participate in routing. Keep a pending
          // opener registered until its late result has been cleaned up.
          controller.liveSnapshot = undefined
          if (controller.pendingOpens === 0 && !snapshot.error) {
            const index = list.indexOf(controller)
            if (index !== -1) list.splice(index, 1)
            if (list.length === 0 && this.controllers.get(sourceSessionId) === list) this.controllers.delete(sourceSessionId)
          }
        }
        this.revision++
        for (const listener of this.listeners) listener()
      } })
    list.push(controller)
    return controller
  }
  // Only snapshots at or beyond the selected event contain its context.
  // Array order is creation order and is never changed by focus.
  select(sourceSessionId, atSeq, focusedAddress, liveSnapshot) {
    const eligible = (this.controllers.get(sourceSessionId) ?? []).filter(controller => {
      const { chat, phase } = controller.snapshot
      if (!chat || (phase !== 'open' && phase !== 'opening') || chat.atSeq < atSeq) return false
      if (!liveSnapshot || chat.atSeq > atSeq) return true
      // A live assistant row is not part of the durable seed at this boundary.
      // Only a snapshot captured from that same row can cover the selection.
      const captured = controller.liveSnapshot
      return !!captured && typeof liveSnapshot.key === 'string' && captured.key === liveSnapshot.key
        && typeof liveSnapshot.prefix === 'string' && liveSnapshot.prefix !== ''
        && captured.text.startsWith(liveSnapshot.prefix)
    })
    const selected = eligible.find(controller => controller.snapshot.chat?.sessionId && addressOf(controller.snapshot.chat.sessionId) === focusedAddress)
      ?? eligible[0]
    if (selected) return selected
    const created = this.createForSource(sourceSessionId)
    if (liveSnapshot && typeof liveSnapshot.key === 'string' && typeof liveSnapshot.text === 'string') {
      created.liveSnapshot = { key: liveSnapshot.key, text: liveSnapshot.text }
    }
    return created
  }
  findSource(sourceSessionId) {
    const list = this.controllers.get(sourceSessionId) ?? []
    return list.findLast(controller => controller.snapshot.error) ?? list.find(controller => controller.snapshot.chat) ?? list.at(-1)
  }
  findSession(sessionId) { return this.all().find(controller => controller.snapshot.chat?.sessionId === sessionId) }
  findAddress(address) { return this.all().find(controller => controller.snapshot.chat?.sessionId && addressOf(controller.snapshot.chat.sessionId) === address) }
  all() { return [...this.controllers.values()].flat() }
  async retryCleanup() { await Promise.allSettled(this.all().map(controller => controller.retryCleanup())) }
}

/** Window-local ownership. Deliberately never connected to a persistence store. */
export class SideChatController {
  constructor({ request, owner, changed = () => {} }) {
    this.request = request
    this.owner = owner
    this.changed = changed
    this.snapshot = { chat: undefined, phase: 'idle', error: undefined, references: [] }
    this.referenceSequence = 0
    this.pendingOpens = 0
    this.listeners = new Set()
    this.subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
    this.getSnapshot = () => this.snapshot
  }
  update(value) {
    this.snapshot = { ...this.snapshot, ...value,
      ...(value.error ? { noticeSequence: (this.snapshot.noticeSequence ?? 0) + 1 } : {}),
    }
    for (const listener of this.listeners) listener()
    this.changed(this.snapshot)
  }
  queueReference(sessionId, reference) {
    if (this.snapshot.phase !== 'open' || this.snapshot.chat?.sessionId !== sessionId) throw new Error('expired')
    const id = ++this.referenceSequence
    this.update({ references: [...this.snapshot.references, { id, sessionId, reference }] })
    return id
  }
  consumeReference(id) {
    this.update({ references: this.snapshot.references.filter(item => item.id !== id) })
  }
  async title(locale, prefix) {
    const chat = this.snapshot.chat
    if (!chat || this.snapshot.phase !== 'open') return undefined
    const result = await this.request({
      action: 'title', owner: chat.owner, sessionId: chat.sessionId, locale,
      ...(prefix ? { prefix } : {}),
    })
    return typeof result?.title === 'string' && result.title !== '' ? result.title : undefined
  }
  async open(sourceSessionId, atSeq, title) {
    const existing = this.snapshot.chat
    if (existing) {
      if (existing.sourceSessionId === sourceSessionId && existing.atSeq === atSeq && this.snapshot.phase === 'open') return existing
      if (existing.sourceSessionId === sourceSessionId && existing.atSeq === atSeq && this.snapshot.phase === 'opening') return this.opening
      throw new Error('onlyOne')
    }
    const pending = { owner: this.owner(), sourceSessionId, atSeq, ...(title ? { title } : {}) }
    this.pendingOpens++
    this.update({ chat: pending, phase: 'opening', error: undefined })
    this.opening = (async () => { try {
      const result = await this.request({ action: 'open', ...pending })
      if (this.snapshot.chat !== pending || this.snapshot.phase === 'closing') {
        await this.request({ action: 'close', owner: pending.owner, sessionId: result.sessionId })
        throw new Error('expired')
      }
      const chat = { ...pending, ...result }
      this.update({ chat, phase: 'open' })
      return chat
    } catch (error) {
      if (this.snapshot.chat === pending) {
        this.update({ phase: 'closing', error: 'failed' })
        await this.close().catch(() => {})
      }
      throw error
    } finally {
      this.pendingOpens--
      if (this.snapshot.phase === 'idle' && !this.snapshot.chat) this.changed(this.snapshot)
    } })()
    return this.opening
  }
  close() {
    const chat = this.snapshot.chat
    if (!chat) return Promise.resolve()
    if (this.cleanup) return this.cleanup
    this.update({ phase: 'closing' })
    this.cleanup = this.request({ action: 'close', owner: chat.owner, sessionId: chat.sessionId })
      .then(() => { if (this.snapshot.chat === chat) this.update({ chat: undefined, phase: 'idle', references: [], error: undefined }) })
      .catch(error => { this.update({ error: 'failed' }); throw error })
      .finally(() => { this.cleanup = undefined })
    return this.cleanup
  }
  async retryCleanup() {
    if (this.snapshot.phase === 'closing') return this.close()
  }
}
