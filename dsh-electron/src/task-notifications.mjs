const kinds = new Set(['question', 'approval', 'completed', 'failed', 'studio'])
const text = (value, max) => typeof value === 'string' && value.length <= max && !/[\x00-\x1f\x7f]/u.test(value)
const human = item => ['question', 'approval'].includes(item.kind)
const category = item => human(item) ? 'attention' : item.kind
const labels = { question: '需要补充信息', approval: '需要授权确认', completed: '任务已完成', failed: '任务需要处理', studio: 'Studio 成果已完成' }

/** Small authenticated wire contract. No commands, URLs, or notification actions. */
export function validateAttentionRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error('Invalid attention request')
  if (body.action === 'view') {
    if (Object.keys(body).some(key => !['action', 'sessionId', 'artifactId'].includes(key)) || !text(body.sessionId, 256) || body.artifactId !== undefined && !text(body.artifactId, 256)) throw Error('Invalid attention view')
    return body
  }
  if (body.action !== 'sync' || Object.keys(body).some(key => !['action', 'instance', 'items', 'preferences'].includes(key)) || !text(body.instance, 80) || !Array.isArray(body.items) || body.items.length > 200) throw Error('Invalid attention snapshot')
  const keys = new Set()
  for (const item of body.items) {
    if (!item || Object.keys(item).some(key => !['key', 'kind', 'sessionId', 'artifactId', 'title', 'createdAt'].includes(key)) || !text(item.key, 600) || keys.has(item.key) || !kinds.has(item.kind)
      || !text(item.sessionId, 256) || !item.sessionId || !text(item.title, 120) || !Number.isSafeInteger(item.createdAt) || item.createdAt < 0
      || item.artifactId !== undefined && (!text(item.artifactId, 256) || !item.artifactId)) throw Error('Invalid attention item')
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
    this.items = new Map(); this.notified = new Set(); this.sessionId = ''; this.nextPopup = 0
    this.delivery = 'available'
  }
  handle(value) {
    const body = validateAttentionRequest(value)
    if (body.action === 'view') {
      this.sessionId = body.sessionId
      this.artifactId = body.artifactId ?? ''
      const openKey = this.openKey ?? ''; this.openKey = null
      return { openKey, delivery: this.delivery }
    }
    if (this.instance !== body.instance) { this.notified.clear(); this.openKey = null; this.dismiss(); this.instance = body.instance }
    const priorPreferences = this.preferences
    this.items = new Map(body.items.map(item => [item.key, item])); this.preferences = body.preferences
    const seen = []
    for (const item of this.items.values()) if (this.foreground() && this.sessionId === item.sessionId && !human(item) && (!item.artifactId || item.artifactId === this.artifactId)) { seen.push(item.key); this.items.delete(item.key) }
    if (this.popupKey && !this.items.has(this.popupKey) || !body.preferences.enabled || priorPreferences?.preview && !body.preferences.preview) { this.dismiss(); this.popupKey = null }
    for (const key of this.notified) if (!this.items.has(key)) this.notified.delete(key)
    const pending = [...this.items.values()].filter(item => !this.notified.has(item.key))
    // Foreground use stays quiet even while viewing a different conversation.
    // Leave its entry in the tray, but never replay old popups after a focus change.
    if (this.foreground() || !body.preferences.enabled) for (const item of pending) this.notified.add(item.key)
    else if (this.now() >= this.nextPopup) {
      const eligible = pending.filter(item => body.preferences[category(item)])
      for (const item of pending) this.notified.add(item.key)
      if (eligible.length) {
        const item = eligible.find(human) ?? eligible[0]
        const title = eligible.length > 1 ? `${eligible.length} 项工作有新进展` : labels[item.kind]
        const content = body.preferences.preview && item.title ? item.title : '点击返回应用查看。'
        this.nextPopup = this.now() + 5000
        try { this.popupKey = item.key; this.delivery = 'available'; this.publish({ title, content, sound: body.preferences.sound, key: item.key }) }
        catch { this.delivery = 'unavailable' }
      }
    }
    const revision = JSON.stringify([body.preferences, [...this.items.values()]])
    if (revision !== this.revision) { this.revision = revision; this.changed() }
    return { seen }
  }
  activate(key) { if (!this.items.has(key)) return; this.openKey = key; this.show() }
  menu() {
    const rows = [...this.items.values()].sort((a, b) => Number(human(b)) - Number(human(a)) || b.createdAt - a.createdAt)
    return rows.map(item => ({ label: `${labels[item.kind]}${this.preferences?.preview && item.title ? ' · ' + item.title : ''}`, click: () => this.activate(item.key) }))
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
