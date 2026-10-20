const kinds = new Set(['question', 'approval', 'completed', 'failed'])
const text = (value, max) => typeof value === 'string' && value.length <= max && !/[\x00-\x1f\x7f]/u.test(value)
const human = item => ['question', 'approval'].includes(item.kind) || item.kind === 'plugin' && item.requiresAction
const category = item => human(item) ? 'attention' : item.kind
const label = item => item.kind === 'plugin' ? item.label : labels[item.kind]
const priority = item => ['question', 'approval'].includes(item.kind) ? 3 : human(item) ? 2 : item.kind === 'failed' || item.level === 'error' ? 1 : 0
const labels = { question: '需要补充信息', approval: '需要授权确认', completed: '任务已完成', failed: '任务需要处理' }

/** Small authenticated wire contract. No commands, URLs, or notification actions. */
export function validateAttentionRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('Invalid attention request')
  if (body.action === 'view') {
    if (Object.keys(body).some(key => !['action', 'sessionId'].includes(key)) || !text(body.sessionId, 256)) throw Error('Invalid attention view')
    return body
  }
  if (body.action !== 'sync' || Object.keys(body).some(key => !['action', 'instance', 'items', 'running', 'preferences'].includes(key)) || !text(body.instance, 80) || !Array.isArray(body.items) || body.items.length > 400) throw Error('Invalid attention snapshot')
  // Running sessions are only counted; they never become notification actions.
  if (!Array.isArray(body.running) || body.running.length > 200 || new Set(body.running).size !== body.running.length
    || body.running.some(id => !text(id, 256) || !id)) throw Error('Invalid running sessions')
  const keys = new Set()
  for (const item of body.items) {
    if (!item || !text(item.key, 600) || !item.key || keys.has(item.key) || !text(item.title, 120) ||
      !Number.isSafeInteger(item.createdAt) || item.createdAt < 0) throw Error('Invalid attention item')
    if (item.kind === 'plugin') {
      if (Object.keys(item).some(key => !['key','kind','source','event','label','level','requiresAction','title','preview','createdAt','revision','alert'].includes(key)) ||
        !/^plugin:[a-f0-9]{64}$/.test(item.key) || !text(item.source, 96) || !text(item.event, 96) || !text(item.label, 120) ||
        !['info','success','warning','error'].includes(item.level) || typeof item.requiresAction !== 'boolean' || !text(item.preview, 400) ||
        !Number.isSafeInteger(item.revision) || item.revision < 1 || !Number.isSafeInteger(item.alert) || item.alert < 1) throw Error('Invalid plugin notification')
    } else if (Object.keys(item).some(key => !['key','kind','sessionId','title','createdAt'].includes(key)) ||
      !kinds.has(item.kind) || !text(item.sessionId, 256) || !item.sessionId) throw Error('Invalid Agent notification')
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
      const eligible = pending.filter(item => item.kind === 'plugin' ? priority(this.items.get(this.popupKey) ?? {}) <= priority(item) : body.preferences[category(item)])
      for (const item of pending) this.notified.set(item.key, item.alert ?? 1)
      if (eligible.length) {
        const item = eligible.sort((a, b) => priority(b) - priority(a))[0]
        const title = eligible.length > 1 ? `${eligible.length} 项工作有新进展` : label(item)
        const content = body.preferences.preview && item.title ? (item.preview || item.title) : '点击返回应用查看。'
        this.nextPopup = this.now() + 5000
        try { this.popupKey = item.key; this.delivery = 'available'; this.publish({ title, content, sound: body.preferences.sound, key: item.key }) }
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

/** Windows portable uses the existing tray; macOS delegates to Notification. */
export function nativeNotificationAdapter({ platform, Notification, getTray, productName, activate, failed }) {
  let current, balloonKey
  return {
    balloonClick() { if (balloonKey) activate(balloonKey) },
    dismiss() { current?.close(); current = null; if (balloonKey) getTray()?.removeBalloon?.(); balloonKey = null },
    publish({ title, content, sound, key }) {
      if (platform === 'win32') {
        const tray = getTray()
        if (!tray) { failed(); return }
        balloonKey = key
        tray.displayBalloon({ title: `${productName} · ${title}`, content, noSound: !sound, respectQuietTime: true })
      } else if (platform === 'darwin' && Notification.isSupported()) {
        current?.close()
        const notification = new Notification({ title: `${productName} · ${title}`, body: content, silent: !sound })
        current = notification
        notification.on('click', () => activate(key))
        notification.on('failed', () => failed())
        notification.show()
      } else failed()
    },
  }
}
