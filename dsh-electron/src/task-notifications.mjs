const kinds = new Set(['question', 'approval', 'completed', 'failed'])
const text = (value, max) => typeof value === 'string' && value.length <= max && value.isWellFormed() && !/[\x00-\x1f\x7f]/u.test(value)
const human = item => ['question', 'approval'].includes(item.kind) || item.kind === 'plugin' && item.requiresAction
const category = item => human(item) ? 'attention' : item.kind
const label = item => item.kind === 'plugin' ? item.label : labels[item.kind]
const priority = item => ['question', 'approval'].includes(item.kind) ? 3 : human(item) ? 2 : item.kind === 'failed' || item.level === 'error' ? 1 : 0
const labels = { question: '需要补充信息', approval: '需要授权确认', completed: '任务已完成', failed: '任务需要处理' }
// Keep these wire limits aligned with NotificationRegistry. Each plugin source
// has its own allowance; none can consume the Agent's 200 slots.
export const ATTENTION_SOURCE_LIMIT = 16
export const ATTENTION_QUEUE_LIMIT = 200
export const ATTENTION_MAX_BYTES = 12 * 1024 * 1024

/** Small authenticated wire contract. No commands, URLs, or notification actions. */
export function validateAttentionRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('Invalid attention request')
  if (body.action === 'view') {
    if (Object.keys(body).some(key => !['action', 'sessionId'].includes(key)) || !text(body.sessionId, 256)) throw Error('Invalid attention view')
    return body
  }
  if (body.action !== 'sync' || Object.keys(body).some(key => !['action', 'instance', 'items', 'running', 'preferences'].includes(key)) || !text(body.instance, 80) || !Array.isArray(body.items) || body.items.length > (ATTENTION_SOURCE_LIMIT + 1) * ATTENTION_QUEUE_LIMIT) throw Error('Invalid attention snapshot')
  // Running sessions are only counted; they never become notification actions.
  if (!Array.isArray(body.running) || body.running.length > 200 || new Set(body.running).size !== body.running.length
    || body.running.some(id => !text(id, 256) || !id)) throw Error('Invalid running sessions')
  const keys = new Set()
  const sourceCounts = new Map()
  let agentCount = 0
  for (const item of body.items) {
    if (!item || !text(item.key, 600) || !item.key || keys.has(item.key) || !text(item.title, 120) ||
      !Number.isSafeInteger(item.createdAt) || item.createdAt < 0) throw Error('Invalid attention item')
    if (item.kind === 'plugin') {
      if (Object.keys(item).some(key => !['key','kind','source','event','label','level','requiresAction','title','preview','createdAt','revision','alert'].includes(key)) ||
        !/^plugin:[a-f0-9]{64}$/.test(item.key) || !text(item.source, 96) || !text(item.event, 96) || !text(item.label, 120) ||
        !['info','success','warning','error'].includes(item.level) || typeof item.requiresAction !== 'boolean' || !text(item.preview, 400) ||
        !Number.isSafeInteger(item.revision) || item.revision < 1 || !Number.isSafeInteger(item.alert) || item.alert < 1) throw Error('Invalid plugin notification')
      const count = (sourceCounts.get(item.source) ?? 0) + 1
      sourceCounts.set(item.source, count)
      if (count > ATTENTION_QUEUE_LIMIT || sourceCounts.size > ATTENTION_SOURCE_LIMIT) throw Error('Invalid source queue size')
    } else if (Object.keys(item).some(key => !['key','kind','sessionId','title','createdAt'].includes(key)) ||
      !kinds.has(item.kind) || !text(item.sessionId, 256) || !item.sessionId) throw Error('Invalid Agent notification')
    else if (++agentCount > ATTENTION_QUEUE_LIMIT) throw Error('Invalid Agent queue size')
    keys.add(item.key)
  }
  const preferences = body.preferences
  if (!preferences || Object.keys(preferences).sort().join() !== ['enabled','attention','completed','failed','studio','sound','preview'].sort().join() || Object.values(preferences).some(value => typeof value !== 'boolean')) throw Error('Invalid notification preferences')
  return body
}

/** OS-independent policy; native notification objects live only in the adapter. */
export class TaskNotifications {
  constructor({ foreground, show, publish, dismiss, changed, now = Date.now }) {
    Object.assign(this, { foreground, show, publish, dismiss, changed, now })
    this.items = new Map(); this.notified = new Map(); this.sessionId = ''; this.nextPopup = 0
    this.delivery = 'available'; this.running = []; this.acknowledged = 0
  }
  handle(value) {
    const body = validateAttentionRequest(value)
    if (body.action === 'view') {
      this.sessionId = body.sessionId
      const openKey = this.openKey ?? ''; this.openKey = null
      return { openKey, delivery: this.delivery, foreground: this.foreground() }
    }
    if (this.instance !== body.instance) { this.notified.clear(); this.openKey = null; this.dismiss(); this.instance = body.instance }
    const priorPreferences = this.preferences, prior = this.items
    this.items = new Map(body.items.map(item => [item.key, item])); this.preferences = body.preferences; this.running = body.running
    const seen = []
    for (const item of this.items.values()) if (item.kind !== 'plugin' && this.foreground() && this.sessionId === item.sessionId && !human(item)) {
      seen.push(item.key); this.items.delete(item.key)
      // Work finished in the conversation on screen: a brief cue, no pending mark.
      if (item.kind !== 'failed' && !prior.has(item.key)) this.acknowledged++
    }
    if (this.popupKey && !this.items.has(this.popupKey) || !body.preferences.enabled || priorPreferences?.preview && !body.preferences.preview) { this.dismiss(); this.popupKey = null }
    for (const key of this.notified.keys()) if (!this.items.has(key)) this.notified.delete(key)
    const pending = [...this.items.values()].filter(item => this.notified.get(item.key) !== (item.alert ?? 1))
    // Foreground use stays quiet even while viewing a different conversation.
    // Leave its entry in the tray, but never replay old popups after a focus change.
    if (this.foreground() || !body.preferences.enabled) for (const item of pending) this.notified.set(item.key, item.alert ?? 1)
    else if (this.now() >= this.nextPopup) {
      // Keep the core Agent's existing coalescing policy. Plugin sources use
      // round-robin dispatch with FIFO inside each source, without interpreting
      // their business severity. Waiting sources are not marked as displayed.
      const agents = pending.filter(item => item.kind !== 'plugin')
      const eligibleAgents = agents.filter(item => body.preferences[category(item)])
      for (const item of agents) if (!body.preferences[category(item)]) this.notified.set(item.key, item.alert ?? 1)
      const queues = new Map()
      for (const item of pending) if (item.kind === 'plugin') {
        const queue = queues.get(item.source) ?? []; queue.push(item); queues.set(item.source, queue)
      }
      const sources = [...queues.keys()]
      const source = sources[(sources.indexOf(this.lastPluginSource) + 1) % (sources.length || 1)]
      const active = this.items.get(this.popupKey)
      const waitingForAgent = active && active.kind !== 'plugin' && human(active)
      const item = eligibleAgents.sort((a, b) => priority(b) - priority(a))[0]
        ?? (!waitingForAgent && source ? queues.get(source)[0] : undefined)
      if (item) {
        const title = item.kind !== 'plugin' && eligibleAgents.length > 1 ? `${eligibleAgents.length} 项工作有新进展` : label(item)
        const content = body.preferences.preview && item.title ? (item.preview || item.title) : '点击返回应用查看。'
        this.nextPopup = this.now() + 5000
        try {
          const accepted = this.publish({ title, content, sound: body.preferences.sound, key: item.key })
          if (accepted !== false) {
            this.popupKey = item.key; this.delivery = 'available'
            if (item.kind === 'plugin') { this.lastPluginSource = item.source; this.notified.set(item.key, item.alert) }
            else for (const row of agents) this.notified.set(row.key, row.alert ?? 1)
          }
        }
        catch { this.delivery = 'unavailable' }
      }
    }
    const revision = JSON.stringify([body.preferences, [...this.items.values()], this.running, this.acknowledged])
    if (revision !== this.revision) { this.revision = revision; this.changed() }
    return { seen, delivery: this.delivery, pluginNotifications: 1 }
  }
  activate(key) { if (!this.items.has(key)) return; this.openKey = key; this.show() }
  menu() {
    const rows = [...this.items.values()].sort((a, b) => priority(b) - priority(a) || b.createdAt - a.createdAt)
    return rows.map(item => ({ label: `${label(item)}${this.preferences?.preview && item.title ? ' · ' + item.title : ''}`, click: () => this.activate(item.key) }))
  }
  close() { this.dismiss(); this.items.clear(); this.notified.clear() }
}

/** Presentation only: never interpret plugin targets or complete business work.
 * Windows deliberately keeps tray balloons for the portable distribution.
 * Toast identity/activation registration is deferred to installation issue #176.
 * Windows has one live balloon target. Electron does not forward every native
 * hide event (including quiet-time suppression), so waiting is bounded. After
 * an unacknowledged expiry, balloon clicks only reopen the app: the native event
 * has no ID and must never select an unrelated item. Tray/pet actions keep IDs.
 * This is display serialization, not business completion. */
export function nativeNotificationAdapter({ platform, Notification, getTray, productName, activate, show = () => {}, failed, now = Date.now }) {
  let current, balloon, ambiguous = false
  const expire = () => {
    if (balloon && now() - balloon.startedAt >= 60000) {
      ambiguous = true; balloon = null
    }
  }
  return {
    balloonClick() {
      expire()
      if (ambiguous) { show(); return }
      const previous = balloon; balloon = null
      if (previous && !previous.revoked) activate(previous.key)
    },
    balloonClosed() { balloon = null },
    dismiss() {
      current?.close(); current = null
      // Keep the native slot until Windows acknowledges removal. A late click
      // on the removed bubble must never target the next queued notification.
      if (balloon && !balloon.revoked) { balloon.revoked = true; getTray()?.removeBalloon?.() }
    },
    publish({ title, content, sound, key }) {
      if (platform === 'win32') {
        const tray = getTray()
        if (!tray) { failed(); return false }
        expire()
        if (balloon) return false
        balloon = { key, revoked: false, startedAt: now() }
        try { tray.displayBalloon({ title: `${productName} · ${title}`, content, noSound: !sound, respectQuietTime: true }) }
        catch (error) { balloon = null; throw error }
      } else if (platform === 'darwin' && Notification.isSupported()) {
        current?.close()
        const notification = new Notification({ title: `${productName} · ${title}`, body: content, silent: !sound })
        current = notification
        notification.on('click', () => activate(key))
        notification.on('failed', () => failed())
        notification.show()
      } else { failed(); return false }
    },
  }
}
