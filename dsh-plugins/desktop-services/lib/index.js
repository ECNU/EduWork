import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { DesktopAttention, notificationDefaults, observeDesktopAttention } from './attention.js'

// Host-only seam. No Remote decorator: the renderer cannot choose an arbitrary
// external URL or obtain the native bridge credential through this service.
export default class DesktopServices extends Service {
  static Config = typeof z.boolean().volatile === 'function'
    ? z.object(Object.fromEntries(Object.entries(notificationDefaults).map(([key, value]) => [key, z.boolean().default(value).volatile()])))
    : undefined
  static inject = ['desktopBoundary', 'settings', 'sessions']
  constructor(ctx, config = {}) {
    super(ctx, 'desktopServices')
    const scope = typeof ctx.settings.register === 'function'
      ? ctx.settings.register('eduwork-notifications', z.object(Object.fromEntries(Object.entries(notificationDefaults).map(([key, value]) => [key, z.boolean().default(value)]))),
        { base: { ...notificationDefaults, ...config.notifications }, applies: 'live' })
      : null
    if (!scope) ctx.effect(() => ctx.settings.configure({ auto: false }))
    const preferences = () => scope ? scope.get() : Object.fromEntries(Object.keys(notificationDefaults).map(key => [key, config[key].get()]))
    this.attention = new DesktopAttention({ bridge: body => this.notificationBridge(body), preferences, validateTarget: async target => {
      if (!target.artifactId) return true
      const studio = ctx.get('knowledgeStudio')
      if (!studio) return false
      const { artifact } = await studio.readArtifact(target.artifactId)
      return !artifact.deletedAt && artifact.sessionId === target.sessionId
    }, goal: sessionId => {
      const agent = ctx.get('agents')?.get(sessionId)
      return agent && ctx.get('goals')?.get(agent)
    } })
    observeDesktopAttention(ctx, this.attention)
    if (scope) ctx.effect(() => scope.watch(() => this.attention.changed()))
    else ctx.on('loader/volatile-update', () => this.attention.changed())
  }
  async notificationBridge(body) {
    const { nativeBridge } = await this.ctx.desktopBoundary.ready
    const response = await fetch(nativeBridge.baseURL + '/v1/extensions/attention', {
      method: 'POST', headers: { authorization: 'Bearer ' + nativeBridge.token, 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw Error('Desktop notifications unavailable')
    return response.json()
  }
  /** Host-only calendar delivery; the shell owns opt-out, sound and private previews. */
  async calendarReminder(receipt) {
    if (this.attention.calendarSupported === undefined && !await this.attention.flush()) {
      throw new Error('桌面通知暂时不可用，请稍后重试')
    }
    if (!this.attention.calendarSupported) throw new Error('当前桌面端尚不支持日历通知，请更新桌面应用')
    this.attention.put({ key: 'calendar:' + receipt.id, kind: 'calendar', sessionId: '', reminderId: receipt.id, title: receipt.title })
    if (!await this.attention.flush()) throw new Error('Desktop calendar notifications unavailable')
  }
  /** Remove a calendar notice without exposing the notification queue to callers. */
  async dismissCalendarReminder(id) {
    this.attention.remove('calendar:' + id)
    return this.attention.flush()
  }
  // The desktop pet window belongs to the shell; its plugin reaches it only
  // through this authenticated seam and never sees the bridge credential.
  async pet(body) {
    const { nativeBridge } = await this.ctx.desktopBoundary.ready
    const response = await fetch(nativeBridge.baseURL + '/v1/extensions/pet', {
      method: 'POST', headers: { authorization: 'Bearer ' + nativeBridge.token, 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    })
    if (response.status === 501) return { supported: false }
    if (!response.ok) throw new Error('Desktop pet request failed')
    return response.json()
  }
  async workbench(action) {
    if (!['status', 'check-updates', 'diagnostics', 'download-update', 'schedule-update', 'install-update','use-stable-updates','use-development-updates','download-content-update','restart-content-update','enable-automatic-download','disable-automatic-download','enable-software-updates','disable-software-updates'].includes(action)) throw new Error('Unsupported desktop action')
    const { nativeBridge } = await this.ctx.desktopBoundary.ready
    const response = await fetch(nativeBridge.baseURL + '/v1/extensions/workbench', {
      method: 'POST', headers: { authorization: 'Bearer ' + nativeBridge.token, 'content-type': 'application/json' },
      body: JSON.stringify({ action }), signal: AbortSignal.timeout(30000),
    })
    if (!response.ok) throw new Error('桌面服务暂时不可用，请重试。')
    return response.json()
  }
  async openConfiguration(target) {
    if (!['config', 'examples'].includes(target)) throw new Error('Unsupported configuration target')
    const { nativeBridge } = await this.ctx.desktopBoundary.ready
    const response = await fetch(nativeBridge.baseURL + '/v1/extensions/open-configuration', {
      method: 'POST', headers: { authorization: 'Bearer ' + nativeBridge.token, 'content-type': 'application/json' },
      // The system's application chooser may remain open while the user decides.
      // Its duration is not a file-opening failure.
      body: JSON.stringify({ target }),
    })
    if (!response.ok) throw new Error('无法打开配置文件或示例，请检查文件是否存在。')
  }
  async openExternal(value) {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsupported external browser URL')
    const { nativeBridge } = await this.ctx.desktopBoundary.ready
    const response = await fetch(nativeBridge.baseURL + '/v1/desktop/open-external', {
      method: 'POST', headers: { authorization: 'Bearer ' + nativeBridge.token, 'content-type': 'application/json' },
      body: JSON.stringify({ url: url.href }), signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error('The system browser could not be opened')
  }
}
