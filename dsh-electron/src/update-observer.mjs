import { desktopUpdatePresentation } from './update-presentation.mjs'

const BUSY_STATES = new Set(['checking', 'downloading', 'applying'])
const READ_ERROR = '更新状态暂时不可用'

/**
 * One raw status source for display observation. Reads are coalesced and only
 * happen on demand or while an official presentation listener is attached.
 * Raw snapshots stay available to the workbench even when the software
 * presentation itself cannot be classified.
 * Transaction decisions must keep using the coordinator directly.
 */
export function createUpdateObserver({ readStatus, idleInterval = 2500, busyInterval = 350, staleAfter = 5000,
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, diagnose = () => {} }) {
  const listeners = new Set()
  let live = true, timer, inFlight, refreshRequest
  let nextTicket = 0, appliedTicket = 0, documentEpoch = 0
  let hasStatus = false, lastStatus, lastStatusAt = 0, readFailed = false, displayUnavailable = false
  let lastDiagnostic = ''

  const report = message => {
    if (message === lastDiagnostic) return
    lastDiagnostic = message
    try { diagnose(message) } catch { /* Diagnostics must never stop observation. */ }
  }
  // Delivery state belongs to each renderer document, not to the observer or
  // the window. A reload unsubscribes the old document before a new status call
  // binds a fresh listener with empty dedupe/visibility state.
  const publish = (presentation, epoch = documentEpoch) => {
    const key = JSON.stringify(presentation)
    for (const entry of listeners) {
      if (entry.epoch > epoch || key === entry.last) continue
      entry.last = key
      entry.visible = presentation.phase !== 'idle'
      try { entry.listener(presentation) } catch { /* One renderer listener cannot stop observation. */ }
    }
  }
  // The official UI has no truthful "unknown failure" kind. Clear a previously
  // visible software indicator instead of inventing a check/download/install cause.
  // A document that has not received a visible state must not get this idle.
  const clearVisible = (epoch = documentEpoch) => {
    const idle = { phase: 'idle' }, key = JSON.stringify(idle)
    for (const entry of listeners) {
      if (entry.epoch > epoch || !entry.visible) continue
      entry.visible = false
      entry.last = key
      try { entry.listener(idle) } catch { /* One renderer listener cannot stop observation. */ }
    }
  }
  const classify = status => {
    const presentation = desktopUpdatePresentation(status)
    if (presentation === null) {
      report(status?.update?.state === 'error'
        ? 'update error has no proven failedOperation; hiding software indicator'
        : 'unrecognized update snapshot; hiding software indicator')
      return null
    }
    return presentation
  }
  const apply = (status, ticket, epoch = documentEpoch) => {
    appliedTicket = ticket
    hasStatus = true
    lastStatus = status
    lastStatusAt = now()
    readFailed = false
    const presentation = classify(status)
    if (presentation === null) {
      displayUnavailable = true
      clearVisible(epoch)
      return lastStatus
    }
    displayUnavailable = false
    publish(presentation, epoch)
    return lastStatus
  }
  const read = (epoch = documentEpoch) => {
    if (inFlight) return inFlight
    const ticket = ++nextTicket
    let tracked
    tracked = Promise.resolve().then(readStatus).then(status => {
      if (!live) return lastStatus
      // An action result or newer read that completed after this one started wins.
      if (ticket < appliedTicket) {
        if (readFailed) throw new Error(READ_ERROR)
        return lastStatus
      }
      return apply(status, ticket, epoch)
    }, error => {
      if (live && ticket >= appliedTicket) {
        appliedTicket = ticket
        readFailed = true
        // A read started before this document subscribed must not clear or
        // deliver to it, but it still stops older documents from showing stale UI.
        clearVisible(epoch)
        report(`update status read failed (${error?.code ?? error?.name ?? 'unknown'})`)
      }
      throw new Error(READ_ERROR)
    }).finally(() => { if (inFlight === tracked) inFlight = undefined })
    inFlight = tracked
    return tracked
  }
  // Fresh calls never start a parallel read. A document shares one refresh with
  // its own epoch; a newer document waits for any older refresh/read, then
  // performs one serial read for itself instead of accepting the older result.
  let refreshEpoch = -1
  const refresh = epoch => {
    if (refreshRequest && refreshEpoch === epoch) return refreshRequest
    const previous = refreshRequest
    let request
    request = (async () => {
      if (previous) await previous.catch(() => {})
      if (inFlight) await inFlight.catch(() => {})
      if (!live) throw new Error(READ_ERROR)
      return read(epoch)
    })()
    refreshRequest = request
    refreshEpoch = epoch
    request.finally(() => { if (refreshRequest === request) refreshRequest = undefined }).catch(() => {})
    return request
  }
  const busy = () => {
    const update = lastStatus?.update, content = lastStatus?.contentUpdate
    return [update?.state, content?.state].some(state => BUSY_STATES.has(state))
  }
  const schedule = () => {
    if (!live || !listeners.size || timer !== undefined) return
    timer = setTimer(poll, busy() ? busyInterval : idleInterval)
  }
  const poll = async () => {
    timer = undefined
    if (!live || !listeners.size) return
    try { await read() } catch { /* Failure handling already cleared stale display. */ }
    schedule()
  }
  const start = () => {
    if (!live || !listeners.size || timer !== undefined) return
    timer = setTimer(poll, 0)
  }
  const stop = () => {
    if (timer === undefined) return
    clearTimer(timer)
    timer = undefined
  }
  return {
    subscribe(listener) {
      if (!live) return () => {}
      const entry = { listener, last: '', visible: false, epoch: ++documentEpoch }
      listeners.add(entry)
      start()
      return () => {
        listeners.delete(entry)
        if (!listeners.size) stop()
      }
    },
    /** Raw snapshot for the existing workbench status response. */
    async status() {
      if (!live) throw new Error(READ_ERROR)
      // A slow or stuck read must not keep serving the same cached snapshot.
      if (listeners.size && hasStatus && !readFailed && now() - lastStatusAt <= staleAfter) return lastStatus
      await read()
      return lastStatus
    },
    /** Current official presentation; rejects when it cannot be represented. */
    async presentation(fresh = false) {
      if (!live) throw new Error(READ_ERROR)
      if (!fresh && listeners.size && hasStatus && !readFailed && !displayUnavailable
        && now() - lastStatusAt <= staleAfter) {
        const presentation = desktopUpdatePresentation(lastStatus)
        if (presentation === null) throw new Error(READ_ERROR)
        return presentation
      }
      if (fresh) await refresh(documentEpoch)
      else await read()
      if (readFailed || displayUnavailable) throw new Error(READ_ERROR)
      const presentation = desktopUpdatePresentation(lastStatus)
      if (presentation === null) throw new Error(READ_ERROR)
      return presentation
    },
    /** Apply an operation result immediately without waiting for the next poll. */
    record(status) {
      if (!live || status === null || typeof status !== 'object') return
      apply(status, ++nextTicket)
    },
    dispose() {
      if (!live) return
      live = false
      stop()
      listeners.clear()
      displayUnavailable = false
      readFailed = false
    },
  }
}

/** Product composition: the only observation read is the existing status action. */
export function createProductUpdateObserver({ getCoordinator, ...options }) {
  return createUpdateObserver({ ...options,
    readStatus: () => {
      const coordinator = getCoordinator()
      return coordinator ? coordinator.action('status') : undefined
    } })
}

/**
 * Bind one renderer document to the shared observer. A main-frame navigation
 * starts a new document, so its delivery state and subscription are fresh.
 */
export function watchUpdateDocument({ window, updates, getWindow, send }) {
  let stop
  const release = () => {
    stop?.()
    stop = undefined
  }
  const bind = () => {
    if (!updates || stop) return
    stop = updates.subscribe(presentation => {
      if (!window || window.isDestroyed?.() || window !== getWindow()) return
      try { send(presentation) } catch { /* window raced destruction */ }
    })
  }
  const onNavigation = (_event, _url, inPlace, isMainFrame) => {
    if (isMainFrame && !inPlace) release()
  }
  const removeNavigation = () => {
    try { window.webContents.removeListener('did-start-navigation', onNavigation) } catch { /* already destroyed */ }
  }
  window.webContents.on('did-start-navigation', onNavigation)
  window.webContents.once('destroyed', release)
  window.once('closed', () => {
    removeNavigation()
    release()
  })
  return {
    window,
    bind,
    release,
    dispose() {
      removeNavigation()
      release()
    },
  }
}
