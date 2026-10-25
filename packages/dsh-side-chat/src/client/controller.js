export const SIDE_CHAT_PATH = '/api/eduwork/side-chat'
export const SIDE_KIND = 'eduwork-side-chat'
export const addressOf = sessionId => `dsh-resource://sidechat/session/${encodeURIComponent(sessionId)}`

/** Window-local lease. Deliberately never connected to a persistence store. */
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
    this.snapshot = { ...this.snapshot, ...value }
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
  async open(sourceSessionId, atSeq) {
    const existing = this.snapshot.chat
    if (existing) {
      if (existing.sourceSessionId === sourceSessionId && existing.atSeq === atSeq && this.snapshot.phase === 'open') return existing
      throw new Error('onlyOne')
    }
    const pending = { owner: this.owner(), sourceSessionId, atSeq }
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
  async heartbeat() {
    const { chat, phase } = this.snapshot
    if (!chat) return
    if (phase === 'closing') return this.close()
    if (phase !== 'open') return
    try {
      await this.request({ action: 'heartbeat', owner: chat.owner, sessionId: chat.sessionId })
    } catch (error) {
      if (error.status === 410 && this.snapshot.chat === chat && this.snapshot.phase === 'open') {
        this.update({ chat: undefined, phase: 'idle', error: 'expired', references: [] })
      }
    }
  }
}
