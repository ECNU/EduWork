import React, { useState, useSyncExternalStore } from 'react'
const h = React.createElement
const labels = { enabled: '桌面弹窗', attention: '需求确认与授权', completed: '任务完成', failed: '任务失败或受阻', studio: 'Studio 成果完成', sound: '通知声音', preview: '显示会话与成果标题' }

export function NotificationSettings({ scope, status }) {
  const snapshot = useSyncExternalStore(listener => scope.subscribe(listener), () => scope.getSnapshot(), () => scope.getSnapshot())
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
  return h('section', { 'data-eduwork-notifications': true, style: { padding: '16px 0', borderBottom: '1px solid var(--dsw-alias-border-l2)' } },
    h('div', { style: { fontSize: 14 } }, '桌面通知'),
    h('p', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.6 } }, '应用在后台运行时提醒；点击返回对应会话。关闭弹窗后，托盘仍保留待处理事项。'),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8 } },
      ...Object.entries(labels).map(([key, label]) => h('label', { key, style: { display: 'flex', alignItems: 'center', gap: 8, minHeight: 32, fontSize: 13 } },
        h('input', { type: 'checkbox', checked: snapshot.value?.[key] === true, disabled: Boolean(saving) || snapshot.writable !== true,
          onChange: event => { void save(key, event.target.checked) } }), label))),
    h('p', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.6 } }, '仅在应用仍运行时生效。系统通知权限或勿扰模式可能阻止弹窗；默认不显示内容预览。'),
    native.delivery === 'unavailable' && h('p', { role: 'status', style: { fontSize: 12 } }, '系统通知暂不可用，可从托盘查看待处理事项。'),
    error && h('p', { role: 'alert', style: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' } }, error))
}

export function installNotificationNavigation(ctx, invoke, environment = window) {
  let disposed = false, busy = false, timer, openedKey, navigation = 0, visibleArtifact
  let snapshot = { desktop: false, delivery: 'available' }
  const listeners = new Set<() => void>()
  const status = { getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) } }
  const current = () => ctx.sessions.list.getSnapshot().current ?? ''
  const poll = async () => {
    if (disposed || busy) return
    busy = true
    try {
      const result = await invoke({ sessionId: current(), ...(openedKey ? { openedKey } : {}), ...(visibleArtifact?.sessionId === current() ? { artifactId: visibleArtifact.artifactId } : {}) })
      if (disposed) return
      openedKey = undefined
      if (snapshot.desktop !== result.desktop || snapshot.delivery !== result.delivery) { snapshot = { desktop: result.desktop, delivery: result.delivery }; listeners.forEach(listener => listener()) }
      const target = result.target
      if (target) {
        const ownNavigation = ++navigation
        // Controller navigation selects the real session; no synthetic answer or approval.
        ctx.uiWorkspace.openSession(target.sessionId)
        if (target.artifactId) {
          // The mounted right pane follows selection on the next render. Its
          // public navigation params select the artifact, including an existing tab.
          for (let attempt = 0; attempt < 20; attempt++) {
            await new Promise(resolve => environment.setTimeout(resolve, 50))
            if (disposed || ownNavigation !== navigation || current() !== target.sessionId) return
            try { ctx.get('sidebarRight').openTab('knowledge-studio', { params: { artifactId: target.artifactId } }); break }
            catch (error) { if (attempt === 19) throw error }
          }
        }
        openedKey = target.key
      }
    } catch { /* Keep the tray entry available; reconnect automatically. */ }
    finally {
      busy = false
      if (!disposed) { environment.clearTimeout(timer); timer = environment.setTimeout(poll, 1000) }
    }
  }
  const focus = () => {
    if (visibleArtifact && visibleArtifact.sessionId !== current()) visibleArtifact = undefined
    void poll()
  }
  const studioVisibility = event => {
    const value = event.detail
    if (value?.sessionId !== current() || typeof value.artifactId !== 'string' || !/^artifact_[a-f0-9]{32}$/.test(value.artifactId)) return
    if (value.visible === true) visibleArtifact = { sessionId: value.sessionId, artifactId: value.artifactId }
    else if (value.visible === false && visibleArtifact?.artifactId === value.artifactId) visibleArtifact = undefined
    focus()
  }
  const unsubscribe = ctx.sessions.list.subscribe(focus)
  environment.addEventListener('focus', focus)
  environment.addEventListener('eduwork:studio-visibility', studioVisibility)
  void poll()
  return { status, close() { disposed = true; navigation++; environment.clearTimeout(timer); environment.removeEventListener('focus', focus); environment.removeEventListener('eduwork:studio-visibility', studioVisibility); unsubscribe(); listeners.clear() } }
}
