const HOUR = 60 * 60 * 1000
const CHECKING = update => update?.busy || update?.state === 'checking'

// This predicate is also checked inside the controller's action queue. A timer
// snapshot alone cannot exclude a download or opt-out queued just before it.
export function mayCheckSoftware(update) {
  return update?.userEnabled !== false && update?.enabled === true
    && !update.busy && !update.installOnNextStart && !update.installOnQuit
    && ['idle', 'up_to_date', 'available', 'error'].includes(update.state)
    && !(update.state === 'error' && ['download', 'install'].includes(update.failedOperation))
}

const mayScheduleInstall = update => update?.automaticInstall === true && update.canSchedule !== false && !update.nativeUpdater

export function softwareAutomationAction(update) {
  if (!update?.enabled || update.busy || update.installOnNextStart || update.installOnQuit) return
  if (update.state === 'available' && update.automaticDownload) return 'download-update'
  if (update.state === 'ready' && mayScheduleInstall(update)) return 'schedule-update'
}

/** One process-owned schedule; status reads never query an update feed. */
export function createSoftwareUpdateScheduler({ readStatus, check, online = () => true, quitting = () => false,
  powerMonitor, diagnose = () => {}, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
  interval = 4 * HOUR, pollInterval = 60_000, busyInterval = 1_000, minimumGap = 60_000,
  retryDelays = [60_000, 5 * 60_000, 15 * 60_000], startupCheck = false, advance }) {
  let started = false, closed = false, timer, inFlight, enabled = true, policy
  let nextCheck = now() + interval, lastAttempt = -Infinity, failures = 0, awaiting = false
  let startupPending = startupCheck, periodic = true, automation = false, lastAutomation, advanceDue = false, watchingPackage = false
  let revision = 0
  let wasOnline = online()
  const clear = () => { if (timer !== undefined) clearTimer(timer); timer = undefined }
  const failed = () => {
    awaiting = false
    nextCheck = now() + (retryDelays[failures++] ?? interval)
  }
  const observe = status => {
    const update = status?.update
    enabled = update?.userEnabled !== false && update?.canToggle !== false
    if (!enabled || update?.checkOnStartup === false) startupPending = false
    periodic = update?.periodicChecks !== false
    automation = Boolean(advance && (update?.automaticDownload || mayScheduleInstall(update)))
    watchingPackage = automation && ['downloading', 'verifying'].includes(update?.state)
    if (policy !== undefined && update?.policy !== policy) {
      nextCheck = 0; failures = 0; awaiting = false; lastAutomation = undefined
    }
    policy = update?.policy
    if (awaiting && !CHECKING(update)) {
      awaiting = false
      if (update?.state === 'error') failed()
      else { failures = 0; nextCheck = now() + interval }
    }
    const action = softwareAutomationAction(update)
    advanceDue = automation && action && lastAutomation !== automationKey(action, update)
    return update
  }
  const automationKey = (action, update) => JSON.stringify([action, update.policy, update.latestVersion])
  const schedule = () => {
    clear()
    if (!started || closed || !enabled || (!startupPending && !periodic && !automation)) return
    timer = setTimer(() => { timer = undefined; void wake() }, awaiting || advanceDue || watchingPackage ? busyInterval : pollInterval)
    timer?.unref?.()
  }
  const run = async () => {
    if (closed || quitting()) return
    const ticket = revision, status = await readStatus()
    if (closed || ticket !== revision) return
    const update = observe(status)
    if (closed || !enabled || quitting()) return
    const connected = online(), recovered = connected && !wasOnline
    wasOnline = connected
    const stillCurrent = () => !closed && ticket === revision && !quitting()
    const action = softwareAutomationAction(update)
    if (advanceDue && (connected || action === 'schedule-update')) {
      const key = automationKey(action, update)
      advanceDue = false
      try {
        const result = await advance(action, () => stillCurrent() && (action !== 'download-update' || online()))
        if (stillCurrent()) {
          if (result.started) lastAutomation = key
          observe(result.status)
        }
      } catch (error) {
        if (stillCurrent()) { lastAutomation = key; report('background update preparation', error) }
      }
      return
    }
    if (!connected) { advanceDue = false; return }
    if (recovered && failures) nextCheck = Math.min(nextCheck, now())
    if (awaiting || !mayCheckSoftware(update) || (!startupPending && (!periodic || now() < nextCheck)) || now() - lastAttempt < minimumGap) return
    lastAttempt = now()
    // Both backends return before the network check finishes. Track its terminal
    // status instead of treating an accepted command as a successful check.
    const result = await check(() => stillCurrent() && online())
    if (closed || ticket !== revision) return
    if (result.started) {
      startupPending = false; awaiting = true; nextCheck = now() + interval; lastAutomation = undefined
    }
    observe(result.status)
  }
  const report = (operation, error) => {
    try { diagnose(`${operation} failed (${error?.code ?? error?.name ?? 'unknown'})`) } catch {}
  }
  const wake = () => {
    if (closed || !started) return Promise.resolve()
    if (inFlight) return inFlight
    clear()
    inFlight = run().catch(error => {
      if (!closed) {
        startupPending = false
        failed()
        report('background update check', error)
      }
    }).finally(() => { inFlight = undefined; schedule() })
    return inFlight
  }
  const onResume = () => { void wake() }
  return {
    start() {
      if (started || closed) return
      started = true
      powerMonitor?.on('resume', onResume)
      void wake()
    },
    // Observe explicit checks and preference changes through the same owner.
    // A manual check postpones the next automatic check, but is never throttled.
    record(action, status) {
      if (closed) return
      revision++
      const priorEnabled = enabled, priorPolicy = policy
      const update = observe(status)
      if (action === 'check-updates' || action === 'check-updates-background') {
        startupPending = false; lastAutomation = undefined
        lastAttempt = now(); failures = 0; awaiting = enabled && CHECKING(update)
        nextCheck = now() + interval
        if (enabled && update?.state === 'error' && !awaiting) failed()
      } else if ((!priorEnabled && enabled) || (priorPolicy !== undefined && policy !== priorPolicy)) {
        failures = 0; nextCheck = 0
      }
      if (action.endsWith('automatic-download') || action.endsWith('automatic-install')) lastAutomation = undefined
      const next = softwareAutomationAction(update)
      advanceDue = automation && next && lastAutomation !== automationKey(next, update)
      schedule()
    },
    checkFailed() { if (!closed) { revision++; startupPending = false; lastAttempt = now(); failures = 0; failed(); schedule() } },
    wake,
    close() {
      closed = true; clear()
      if (started) powerMonitor?.removeListener('resume', onResume)
      return inFlight ?? Promise.resolve()
    },
  }
}
