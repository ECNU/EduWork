// Coordinates the product's resource teardown with the official task prompt.
// An updater handoff is already committed; it must never prompt a second time.
export class DesktopExit {
  complete = false
  closing = false
  /** The last shutdown attempt failed after the user/request approved it. */
  failure
  pending
  relaunchRequested = false
  installerOwnsQuit = false
  constructor({ confirm, close, relaunch, quit, failed }) {
    Object.assign(this, { confirm, close, relaunch, quit, failed })
  }
  async restart({ strict = false } = {}) {
    if (this.closing || this.complete) return
    if (this.pending) {
      if (!strict) {
        this.relaunchRequested = true
        this.quit()
        return this.pending
      }
      // A strict restart cannot inherit the non-strict decision of a quit that
      // is already waiting for confirmation. It takes effect only if that quit
      // is declined; an approved quit keeps its own baseline outcome.
      await this.pending
      if (this.complete || this.closing) return
      return this.restart({ strict: true })
    }
    this.relaunchRequested = true
    const pending = this.request({ strict })
    this.quit()
    return pending
  }
  handoff() { this.installerOwnsQuit = true; this.relaunchRequested = false; this.quit() }
  request({ strict = false } = {}) {
    if (this.complete) return Promise.resolve()
    if (this.pending) return this.pending
    let phase = 'confirm'
    this.pending = (async () => {
      if (!this.installerOwnsQuit && !await this.confirm() && !this.installerOwnsQuit) {
        this.relaunchRequested = false
        return
      }
      phase = 'close'
      this.closing = true
      await this.close()
      // Let the cancelled native quit event unwind before requesting quit again.
      await new Promise(resolve => setImmediate(resolve))
      if (this.relaunchRequested && !this.installerOwnsQuit) this.relaunch()
      this.failure = undefined
      this.complete = true
      this.quit()
    })().catch(error => {
      this.closing = false
      const relaunch = this.relaunchRequested
      this.relaunchRequested = false
      this.failure = error
      this.failed(error)
      // A confirmation failure means the user never approved this exit. Keep the
      // process running and skip close exactly as the baseline did.
      if (phase === 'confirm') return strict ? error : undefined
      if (strict && !this.installerOwnsQuit) return error
      // Normal quit and installer handoff complete even when a service stop fails.
      if (relaunch && !this.installerOwnsQuit) this.relaunch()
      this.complete = true
      this.quit()
    }).finally(() => { this.pending = undefined })
    return this.pending
  }
}
