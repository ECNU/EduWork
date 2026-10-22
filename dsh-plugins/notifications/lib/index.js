import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { NotificationRegistry } from './registry.js'

const schema = () => z.dict(z.boolean()).default({})
export default class Notifications extends Service {
  static inject = ['settings']
  static Config = typeof z.boolean().volatile === 'function' ? z.object({ events: schema().volatile() }) : undefined
  constructor(ctx, config = {}) {
    super(ctx, 'notifications')
    this.version = 1
    const scope = typeof ctx.settings.register === 'function'
      ? ctx.settings.register('eduwork-plugin-notifications', z.object({ events: schema() }), { base: { events: config.events ?? {} }, applies: 'live' })
      : null
    if (!scope) ctx.effect(() => ctx.settings.configure({ auto: false }))
    this.registry = new NotificationRegistry({ preferences: () => scope ? scope.get().events : config.events.get(),
      report: error => ctx.logger?.warn(`Plugin notification callback failed: ${error.message}`) })
    ctx.on('loader/volatile-update', () => this.registry.changed())
    if (scope) ctx.effect(() => scope.watch(() => this.registry.changed()))
    ctx.effect(() => () => this.registry.close())
  }
  /** Registration is Host-only. Cordis scope disposal revokes pending work. */
  register(ctx, definition) {
    const handle = this.registry.register(definition)
    ctx.effect(() => () => handle.dispose())
    return handle
  }
}
