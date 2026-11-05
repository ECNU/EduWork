const eventName = 'eduwork:tray-action'
const handlers = new Map()
export function bindDesktopAction(action, callback) {
  handlers.set(action, callback)
  const drain = () => {
    const pending = window.__eduworkTrayActions ?? []
    const keep = []
    for (const value of pending.slice(-8)) {
      const handler = handlers.get(value)
      if (handler) handler()
      else if (!keep.includes(value)) keep.push(value)
    }
    window.__eduworkTrayActions = keep
  }
  window.addEventListener(eventName, drain)
  drain()
  return () => {
    window.removeEventListener(eventName, drain)
    if (handlers.get(action) === callback) handlers.delete(action)
  }
}

export function bindSettingsOpenAction({ slots, ...options }) {
  const store = slots.entries('sidebar.settings').find(entry => entry.store !== undefined)?.store
  if (!store) throw new Error('DSH settings shell store is not registered')
  const settings = store.create()
  let pending = false
  let cancel = () => {}
  const stop = () => {
    pending = false
    cancel()
    cancel = () => {}
  }
  const unsubscribe = settings.subscribe(() => {
    if (settings.getSnapshot().open) stop()
  })
  const dispose = bindDesktopAction('open-settings', () => {
    if (pending || settings.getSnapshot().open) return
    pending = true
    cancel = openSettingsWhenSettled({ ...options, open: () => {
      pending = false
      settings.actions.open()
    } })
  })
  return () => {
    stop()
    unsubscribe()
    dispose()
  }
}

function observeOnboardingEnd(isOnboardingVisible, callback) {
  if (typeof MutationObserver !== 'function') return () => {}
  const observer = new MutationObserver(() => {
    if (isOnboardingVisible()) return
    observer.disconnect()
    callback()
  })
  observer.observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['inert', 'class', 'data-shortcut-modal'],
  })
  return () => observer.disconnect()
}

/** Onboarding owns the first rendered surface; a tray request waits for it instead of overtaking it. */
export function openSettingsWhenSettled({ open, sessions, isOnboardingVisible = () => false,
  frame = callback => setTimeout(callback, 0), watchOnboardingEnd, timeoutMs = 5000,
  setTimer = (callback, ms) => setTimeout(callback, ms), clearTimer = timer => clearTimeout(timer),
  onFallback = () => {} }) {
  let cancelled = false
  let scheduled = false
  let cancelWait = () => {}
  let unsubscribe = () => {}
  let timer
  const stopWaiting = () => {
    unsubscribe()
    unsubscribe = () => {}
    if (timer !== undefined) {
      clearTimer(timer)
      timer = undefined
    }
  }
  const finish = () => {
    if (cancelled) return
    cancelled = true
    cancelWait()
    open()
  }
  const schedule = () => {
    if (cancelled || scheduled) return
    scheduled = true
    stopWaiting()
    frame(() => {
      if (cancelled) return
      if (!isOnboardingVisible()) { finish(); return }
      const watch = watchOnboardingEnd ?? (callback => observeOnboardingEnd(isOnboardingVisible, callback))
      cancelWait = watch(finish) ?? (() => {})
      if (!cancelled && !isOnboardingVisible()) finish()
    })
  }
  const fallback = () => {
    if (cancelled || scheduled) return
    onFallback()
    schedule()
  }
  const dispose = () => {
    cancelled = true
    stopWaiting()
    cancelWait()
  }
  const snapshot = sessions.getSnapshot()
  if (snapshot.phase === 'ready') {
    schedule()
    return dispose
  }
  timer = setTimer(fallback, timeoutMs)
  unsubscribe = sessions.subscribe(() => {
    const current = sessions.getSnapshot()
    if (current.phase === 'ready') schedule()
  })
  return dispose
}
