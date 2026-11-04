import remote from './remote.js'
import {Settings, settingsZh, settingsEn, settingsCss} from './settings.js'
export const inject = ['slots', 'locale', 'remote']
const NS = 'eduwork-external-agents'
export async function apply(ctx) {
  ctx.locale.register(NS, {zh: settingsZh, en: settingsEn})
  const unmount = await ctx.remote.$mount(remote)
  ctx.effect(() => unmount)
  ctx.inject(['remote.eduworkAgentConnections'], inner => {
    const t = inner.locale.bind(NS)
    const manage = async request => {
      const result = await inner.remote.eduworkAgentConnections.manage(request)
      if (!result.ok) throw new Error('Agent operation failed')
      return result.value
    }
    inner.slots.inject('settings.section', () => inner.slots.register({
      name: 'settings.section', id: NS, order: 12, locale: NS, label: () => t('connections'), inject: () => ({manage, t}),
    }, Settings))
    // Standalone DSH installs use the official bundle page. EduWork's catalog
    // owns a separate root slot so a disabled bundle never owns its own switch.
    for (const name of ['plugins.bundle.config', 'eduwork.extensions.config']) {
      inner.slots.inject(name, () => inner.slots.register({
        name, key: '@eduwork/dsh-external-agents', locale: NS, inject: () => ({manage, t}),
      }, Settings))
    }
  })
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = settingsCss; document.head.append(style)
    return () => style.remove()
  })
}
