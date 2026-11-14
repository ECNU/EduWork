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

/** One process-owned schedule; status reads never query an update feed. */
export function createSoftwareUpdateScheduler({ readStatus, check, online = () => true, quitting = () => false,
  powerMonitor, diagnose = () => {}, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
  interval = 4 * HOUR, pollInterval = 60_000, busyInterval = 1_000, minimumGap = 60_000,
  retryDelays = [60_000, 5 * 60_000, 15 * 60_000] }) {
  let started = false, closed = false, timer, inFlight, enabled = true, policy
  let nextCheck = now() + interval, lastAttempt = -Infinity, failures = 0, awaiting = false
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
    if (policy !== undefined && update?.policy !== policy) {
      nextCheck = 0; failures = 0; awaiting = false
    }
    policy = update?.policy
    if (awaiting && !CHECKING(update)) {
      awaiting = false
      if (update?.state === 'error') failed()
      else { failures = 0; nextCheck = now() + interval }
    }
    return update
  }
  const schedule = () => {
    clear()
    if (!started || closed || !enabled) return
    timer = setTimer(() => { timer = undefined; void wake() }, awaiting ? busyInterval : pollInterval)
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
    if (!connected) return
    if (recovered && failures) nextCheck = Math.min(nextCheck, now())
    if (awaiting || !mayCheckSoftware(update) || now() < nextCheck || now() - lastAttempt < minimumGap) return
    lastAttempt = now()
    // Both backends return before the network check finishes. Track its terminal
    // status instead of treating an accepted command as a successful check.
    const result = await check(() => !closed && ticket === revision && online() && !quitting())
    if (closed || ticket !== revision) return
    if (result.started) { awaiting = true; nextCheck = now() + interval }
    observe(result.status)
  }
  const wake = () => {
    if (closed || !started) return Promise.resolve()
    if (inFlight) return inFlight
    clear()
    inFlight = run().catch(error => {
      if (!closed) {
        failed()
        try { diagnose(`background update check failed (${error?.code ?? error?.name ?? 'unknown'})`) } catch {}
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
        lastAttempt = now(); failures = 0; awaiting = enabled && CHECKING(update)
        nextCheck = now() + interval
        if (enabled && update?.state === 'error' && !awaiting) failed()
      } else if ((!priorEnabled && enabled) || (priorPolicy !== undefined && policy !== priorPolicy)) {
        failures = 0; nextCheck = 0
      }
      schedule()
    },
    checkFailed() { if (!closed) { revision++; lastAttempt = now(); failures = 0; failed(); schedule() } },
    wake,
    close() {
      closed = true; clear()
      if (started) powerMonitor?.removeListener('resume', onResume)
      return inFlight ?? Promise.resolve()
    },
  }
}
