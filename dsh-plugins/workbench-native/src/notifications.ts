import React, { useState, useSyncExternalStore } from 'react'
const h = React.createElement
const labels = { enabled: '桌面弹窗', attention: '需求确认与授权', completed: '任务完成', failed: '任务失败或受阻', sound: '通知声音', preview: '显示通知内容预览' }

export function NotificationSettings({ scope, pluginScope, status }) {
  const snapshot = useSyncExternalStore(listener => scope.subscribe(listener), () => scope.getSnapshot(), () => scope.getSnapshot())
  const plugins = useSyncExternalStore(listener => pluginScope.subscribe(listener), () => pluginScope.getSnapshot(), () => pluginScope.getSnapshot())
  const native = useSyncExternalStore(status.subscribe, status.getSnapshot, status.getSnapshot)
  const [saving, setSaving] = useState(''), [error, setError] = useState('')
  if (!native.desktop) return null
  const save = async (key, value) => {
    setSaving(key); setError('')
    try {
      await scope.set(key, value)
      if (scope.getSnapshot().value?.[key] !== value) throw Error('通知设置未保存，请重试。')
    } catch (cause) { setError(cause.message) }
    finally { setSaving('') }
  }
  const savePlugin = async (key, value) => {
    setSaving(key); setError('')
    try {
      const next = { ...(pluginScope.getSnapshot().value?.events ?? {}), [key]: value }
      await pluginScope.set('events', next)
      if (pluginScope.getSnapshot().value?.events?.[key] !== value) throw Error('通知设置未保存，请重试。')
    } catch (cause) { setError(cause.message) }
    finally { setSaving('') }
  }
  return h('section', { 'data-eduwork-notifications': true, style: { padding: '16px 0', borderBottom: '1px solid var(--dsw-alias-border-l2)' } },
    h('div', { style: { fontSize: 14 } }, '桌面通知'),
    h('p', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.6 } }, '应用在后台运行时提醒；点击返回对应会话。关闭弹窗后，托盘仍保留待处理事项。'),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8 } },
      ...Object.entries(labels).map(([key, label]) => h('label', { key, style: { display: 'flex', alignItems: 'center', gap: 8, minHeight: 32, fontSize: 13 } },
        h('input', { type: 'checkbox', checked: snapshot.value?.[key] === true, disabled: Boolean(saving) || snapshot.writable !== true,
          onChange: event => { void save(key, event.target.checked) } }), label))),
    h('p', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.6 } }, '仅在应用仍运行时生效。系统通知权限或勿扰模式可能阻止弹窗；默认不显示内容预览。'),
    ...(native.sources ?? []).map(source => h('fieldset', { key: source.id, style: { border: 0, padding: '8px 0' } },
      h('legend', null, source.label),
      ...[{ id: '*', label: '启用此来源', enabled: source.enabled }, ...source.events].map(event => {
        const key = source.id + '/' + event.id
        return h('label', { key, style: { display: 'inline-flex', alignItems: 'center', gap: 8, marginRight: 16, minHeight: 32 } },
          h('input', { type: 'checkbox', checked: plugins.value?.events?.[key] ?? event.enabled,
            disabled: Boolean(saving) || plugins.writable !== true,
            onChange: e => { void savePlugin(key, e.target.checked) } }), event.label)
      }))),
    native.pluginProtocol === 0 && h('p', { role: 'status' }, '桌面端不支持插件通知，请更新配套版本；Agent 通知仍可使用。'),
    native.delivery === 'unavailable' && h('p', { role: 'status', style: { fontSize: 12 } }, '系统通知暂不可用，可从托盘查看待处理事项。'),
    error && h('p', { role: 'alert', style: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' } }, error))
}

export function installNotificationNavigation(ctx, invoke, environment = window) {
  let disposed = false, busy = false, timer, openedKey
  let snapshot: any = { desktop: false, delivery: 'available', sources: [] }
  const listeners = new Set<() => void>()
  const status = { getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) } }
  // DSH 0.2 keeps the selected session in the UI scope adapter. The session
  // catalog still exists, but no longer exposes a `current` selection.
  const selection = ctx.uiSession?.adapter.current ?? ctx.sessions.list
  const current = () => {
    const value = selection.getSnapshot()
    return value.props?.sessionId ?? value.current ?? ''
  }
  const poll = async () => {
    if (disposed || busy) return
    busy = true
    let opening = false
    try {
      const result = await invoke({ sessionId: current(), visible: ctx.get('notificationActions')?.visible() ?? [], ...(openedKey ? { openedKey } : {}) })
      if (disposed) return
      openedKey = undefined
      const next = { desktop: result.desktop, delivery: result.delivery, sources: result.sources ?? [], pluginProtocol: result.pluginProtocol }
      if (JSON.stringify(snapshot) !== JSON.stringify(next)) { snapshot = next; listeners.forEach(listener => listener()) }
      const target = result.target
      if (target) {
        opening = true
        if (target.plugin) {
          const actions = ctx.get('notificationActions')
          if (!actions) throw Error('Plugin notification navigation unavailable')
          await actions.dispatch(target.plugin)
          if (!disposed) openedKey = target.key
          return
        }
        // Controller navigation selects the real session; no synthetic answer or approval.
        ctx.uiWorkspace.openSession(target.sessionId)
        openedKey = target.key
      }
    } catch (error) {
      // Keep the entry for retry, but do not hide a broken plugin destination.
      if (opening && !disposed) console.warn('Notification navigation failed:', error?.message)
    }
    finally {
      busy = false
      if (!disposed) { environment.clearTimeout(timer); timer = environment.setTimeout(poll, 1000) }
    }
  }
  const focus = () => { void poll() }
  const unsubscribe = selection.subscribe(focus)
  environment.addEventListener('focus', focus)
  void poll()
  return { status, close() { disposed = true; environment.clearTimeout(timer); environment.removeEventListener('focus', focus); unsubscribe(); listeners.clear() } }
}
