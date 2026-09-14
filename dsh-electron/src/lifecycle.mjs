// Shutdown waits for preparation to settle before taking ownership snapshots.
// Every resource must be registered before the following cancellation check.
export class DesktopLifecycle {
  closing = false
  preparations = new Set()
  hosts = new Set()
  bridges = new Set()
  shutdown = undefined
  check() { if (this.closing) throw new Error('Desktop is shutting down') }
  prepare(callback) {
    this.check()
    const task = Promise.resolve().then(callback)
    this.preparations.add(task)
    void task.finally(() => this.preparations.delete(task)).catch(() => {})
    return task
  }
  trackHost(host) { this.check(); this.hosts.add(host) }
  trackBridge(bridge) { this.bridges.add(bridge); this.check() }
  close() {
    if (this.shutdown) return this.shutdown
    this.closing = true
    this.shutdown = (async () => {
      while (this.preparations.size) await Promise.allSettled([...this.preparations])
      await Promise.allSettled([...this.hosts].map(host => host.stop()))
      await Promise.allSettled([...this.bridges].map(bridge => bridge.close()))
    })()
    return this.shutdown
  }
}
