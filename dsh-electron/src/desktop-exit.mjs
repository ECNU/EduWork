// Coordinates the product's resource teardown with the official task prompt.
// An updater handoff is already committed; it must never prompt a second time.
export class DesktopExit {
  complete = false
  closing = false
  pending
  relaunchRequested = false
  installerOwnsQuit = false
  constructor({ confirm, close, relaunch, quit, failed }) {
    Object.assign(this, { confirm, close, relaunch, quit, failed })
  }
  restart(args = []) { if (this.closing || this.complete) return; this.relaunchRequested = args; this.quit() }
  handoff() { this.installerOwnsQuit = true; this.relaunchRequested = false; this.quit() }
  request() {
    if (this.complete) return Promise.resolve()
    if (this.pending) return this.pending
    this.pending = (async () => {
      if (!this.installerOwnsQuit && !await this.confirm(this.relaunchRequested) && !this.installerOwnsQuit) {
        this.relaunchRequested = false
        return
      }
      this.closing = true
      await this.close(this.relaunchRequested)
      // Let the cancelled native quit event unwind before requesting quit again.
      await new Promise(resolve => setImmediate(resolve))
      if (this.relaunchRequested && !this.installerOwnsQuit) await this.relaunch(this.relaunchRequested)
      this.complete = true
      this.quit()
    })().catch(error => {
      const args = this.relaunchRequested
      this.closing = false; this.relaunchRequested = false; this.failed(error, args)
    }).finally(() => { this.pending = undefined })
    return this.pending
  }
}
