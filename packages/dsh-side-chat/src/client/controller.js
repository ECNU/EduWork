export const SIDE_CHAT_PATH = '/api/eduwork/side-chat'
export const SIDE_KIND = 'eduwork-side-chat'
export const addressOf = sessionId => `dsh-resource://sidechat/session/${encodeURIComponent(sessionId)}`

/** Each source in a window owns an independent controller and cleanup task. */
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
    if (!this.controllers.has(sourceSessionId)) {
      this.controllers.set(sourceSessionId, new SideChatController({ ...this.options, changed: () => {
        this.revision++
        for (const listener of this.listeners) listener()
      } }))
    }
    return this.controllers.get(sourceSessionId)
  }
  findSource(sourceSessionId) { return this.controllers.get(sourceSessionId) }
  findSession(sessionId) { return this.all().find(controller => controller.snapshot.chat?.sessionId === sessionId) }
  findAddress(address) { return this.all().find(controller => controller.snapshot.chat?.sessionId && addressOf(controller.snapshot.chat.sessionId) === address) }
  all() { return [...this.controllers.values()] }
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
      throw new Error('onlyOne')
    }
    const pending = { owner: this.owner(), sourceSessionId, atSeq, ...(title ? { title } : {}) }
    this.update({ chat: pending, phase: 'opening', error: undefined })
    try {
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
    }
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
