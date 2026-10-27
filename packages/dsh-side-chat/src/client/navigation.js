import { addressOf } from './controller.js'

// Older annotation builds do not supply liveSnapshot. Treat a reference with
// no durable message identity as unknown instead of claiming it is in a seed.
export function liveCoverage(reference, liveSnapshot) {
  if (liveSnapshot) return liveSnapshot
  if (reference?.source !== 'eduwork-annotation') return undefined
  try {
    const value = JSON.parse(reference.ref)
    return value?.o?.messageId ? undefined : {}
  } catch { return {} }
}

/** Coordinate independently owned snapshots and the user's latest navigation. */
export class SideChatNavigation {
  constructor({ registry, sidebar, title }) {
    this.registry = registry
    this.sidebar = sidebar
    this.title = title
    this.intents = new Map()
    this.pending = new Map()
  }

  async open({ sourceSessionId, atSeq, reference, topic, liveSnapshot }) {
    const mounted = this.sidebar.mounted.getSnapshot() === sourceSessionId
    const focusedAddress = mounted ? this.sidebar.active()?.contentId : undefined
    const owner = this.registry.select(sourceSessionId, atSeq, focusedAddress, liveCoverage(reference, liveSnapshot))
    const current = this.pending.get(owner) ?? { count: 0, created: !owner.snapshot.chat }
    current.count++
    this.pending.set(owner, current)
    const intent = (this.intents.get(sourceSessionId) ?? 0) + 1
    this.intents.set(sourceSessionId, intent)
    try {
      const chat = await owner.open(sourceSessionId, owner.snapshot.chat?.atSeq ?? atSeq, this.title(topic))
      if (this.sidebar.mounted.getSnapshot() !== sourceSessionId) throw new Error('expired')
      if (reference) owner.queueReference(chat.sessionId, reference)
      const address = addressOf(chat.sessionId)
      const isLatest = this.intents.get(sourceSessionId) === intent
      const existing = this.sidebar.tabsIn(sourceSessionId).some(tab => tab.contentId === address)
      if (isLatest) this.sidebar.openResource(address)
      else if (!existing) {
        // Make the earlier result accessible without leaving it focused.
        const previous = this.sidebar.active()
        this.sidebar.openResource(address)
        if (previous?.id) this.sidebar.focus(previous.id)
      }
      return chat
    } finally {
      current.count--
      if (current.count === 0) {
        this.pending.delete(owner)
        const chat = owner.snapshot.chat
        const hasTab = chat?.sessionId && this.sidebar.tabsIn(sourceSessionId).some(tab => tab.contentId === addressOf(chat.sessionId))
        // The user navigated away before this newly created chat could be
        // placed. Do not close an existing tab or a shared in-flight owner.
        if (current.created && chat && !hasTab && owner.snapshot.phase === 'open') await owner.close()
      }
    }
  }
}
