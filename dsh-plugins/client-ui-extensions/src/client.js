import React, { useEffect, useState, useSyncExternalStore } from 'react'
import { Button, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { ExtensionsController } from './controller.js'
const h = React.createElement
export const inject = ['slots', 'locale', 'remote', 'remote.pluginManager']
const NS = 'eduwork-extensions'
export const CONFIG_SLOT = 'eduwork.extensions.config'
const copy = {
  zh: { title: 'EduWork 扩展', intro: '按需启用随应用提供的扩展。停用会保留配置。', empty: '当前版本没有可用的可选扩展。', loading: '正在读取插件状态…', working: '正在应用更改…', refresh: '刷新', enabled: '已启用', disabled: '未启用', configure: '配置', close: '收起配置', docs: '使用说明', loadFailed: '暂时无法读取插件状态，请刷新重试。', changeFailed: '未能确认更改已生效，请刷新检查当前状态。', restartRequired: '配置已保存，请重启应用使更改生效。', notApplied: '配置已保存，当前运行状态尚未确认，请刷新检查。', unavailable: '插件存在兼容或加载问题，请在插件管理页查看详情。', waiting: '配置界面尚未就绪；如已提示需要重启，请先重启应用。', protected: '此插件由当前部署管理，无法在这里切换。' },
  en: { title: 'EduWork extensions', intro: 'Enable bundled extensions as needed. Disabling keeps their configuration.', empty: 'This version has no available optional extensions.', loading: 'Reading plugin status…', working: 'Applying changes…', refresh: 'Refresh', enabled: 'Enabled', disabled: 'Disabled', configure: 'Configure', close: 'Close settings', docs: 'Guide', loadFailed: 'Could not read plugin status. Refresh to retry.', changeFailed: 'The change could not be confirmed. Refresh to check the current state.', restartRequired: 'Configuration saved. Restart the app to apply it.', notApplied: 'Configuration saved, but the running state is not confirmed. Refresh to check.', unavailable: 'The plugin has a compatibility or loading problem. See the plugin manager for details.', waiting: 'The settings interface is not ready. Restart the app if requested.', protected: 'This deployment manages the plugin; it cannot be switched here.' },
}
function Extensions({ controller, configRegistry, resolveText, t, renderSlot }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [open, setOpen] = useState(null)
  useSyncExternalStore(configRegistry.subscribe, configRegistry.getSnapshot)
  useEffect(() => { void controller.refresh() }, [controller])
  return h('section', { className: 'eduwork-extensions', 'aria-label': t('title'), 'aria-busy': state.busy || state.loading },
    h('div', { className: 'eduwork-extensions-intro' }, h('p', null, t('intro')), h(Button, { disabled: state.busy || state.loading, onClick: () => controller.refresh() }, t('refresh'))),
    state.error && h('p', { role: 'alert' }, t(state.error)),
    (state.notice || state.busy || state.loading) && h('p', { role: 'status' }, t(state.busy ? 'working' : state.loading ? 'loading' : state.notice)),
    !state.loading && !state.rows.length && !state.error && h('p', null, t('empty')),
    ...state.rows.map(row => h('article', { key: row.name },
      h('div', { className: 'eduwork-extensions-heading' }, h('h3', null, resolveText(row.title)), h('span', null, t(row.enabled ? 'enabled' : 'disabled')),
        h(Switch, { checked: row.enabled, label: resolveText(row.title), disabled: state.busy || state.loading || Boolean(row.readOnlyReason) || (!row.enabled && Boolean(row.error)), onChange: value => controller.setEnabled(row.name, value) })),
      h('p', null, resolveText(row.description)),
      h('div', { className: 'eduwork-extensions-actions' }, h('code', null, `${row.name}${row.version ? ' · ' + row.version : ''}`),
        h('a', { href: row.documentation, target: '_blank', rel: 'noreferrer' }, t('docs')),
        row.enabled && h(Button, { disabled: state.busy || Boolean(state.notice), 'aria-expanded': open === row.name, onClick: () => setOpen(open === row.name ? null : row.name) }, t(open === row.name ? 'close' : 'configure'))),
      row.error && h('p', { role: 'alert' }, t('unavailable')),
      row.readOnlyReason && h('p', null, t('protected')),
      row.enabled && open === row.name && (configRegistry.has(row.name) ? renderSlot(CONFIG_SLOT, {}, { entryKey: row.name }) : h('p', { role: 'status' }, t('waiting'))))),
  )
}
export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, copy))
  const controller = new ExtensionsController(ctx.remote.pluginManager)
  ctx.effect(() => () => controller.dispose())
  ctx.effect(() => {
    const refresh = () => { if (controller.getSnapshot().rows.length || controller.getSnapshot().loading) void controller.refresh() }
    const off = [ctx.remote.$on('plugin-manager/changed', refresh), ctx.on('connection/reset', refresh)]
    return () => off.forEach(fn => fn())
  })
  const configRegistry = {
    subscribe: fn => ctx.slots.subscribe(CONFIG_SLOT, fn),
    getSnapshot: () => ctx.slots.getVersion(CONFIG_SLOT),
    has: name => ctx.slots.entries(CONFIG_SLOT).some(entry => entry.options.key === name),
  }
  ctx.slots.inject('plugins.tab', () => ctx.slots.register({
    name: 'plugins.tab', id: NS, label: () => ctx.locale.bind(NS)('title'), locale: NS,
    children: { [CONFIG_SLOT]: { kind: 'keyed', scope: 'root' } },
    inject: () => ({ controller, configRegistry, resolveText: text => typeof text === 'string' ? text : ctx.locale.resolveText(text) }),
  }, Extensions))
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = '.eduwork-extensions{color:var(--dsw-alias-label-primary);font-size:14px}.eduwork-extensions p{line-height:1.6}.eduwork-extensions article{border:1px solid var(--dsw-alias-border-l4);border-radius:12px;padding:20px;margin:16px 0}.eduwork-extensions h3{font-size:15px;margin:0;flex:1}.eduwork-extensions-intro,.eduwork-extensions-heading,.eduwork-extensions-actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.eduwork-extensions-intro p{flex:1;min-width:200px}.eduwork-extensions-actions code{font-size:12px;overflow-wrap:anywhere;flex:1;min-width:180px}.eduwork-extensions a{color:var(--dsw-alias-brand-primary)}'
    document.head.append(style); return () => style.remove()
  })
}
