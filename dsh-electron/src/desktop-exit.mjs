// Coordinates the product's resource teardown with the official task prompt.
// An updater handoff is already committed; it must never prompt a second time.
export class DesktopExit {
  complete = false
  pending
  relaunchRequested = false
  installerOwnsQuit = false
  constructor({ confirm, close, relaunch, quit, failed }) {
    Object.assign(this, { confirm, close, relaunch, quit, failed })
  }
  restart() { this.relaunchRequested = true; this.quit() }
  handoff() { this.installerOwnsQuit = true; this.relaunchRequested = false; this.quit() }
  request() {
    if (this.complete) return Promise.resolve()
    if (this.pending) return this.pending
    this.pending = (async () => {
      if (!this.installerOwnsQuit && !await this.confirm() && !this.installerOwnsQuit) {
        this.relaunchRequested = false
        return
      }
      await this.close()
      if (this.relaunchRequested && !this.installerOwnsQuit) this.relaunch()
      this.complete = true
      this.quit()
    })().catch(error => { this.relaunchRequested = false; this.failed(error) }).finally(() => { this.pending = undefined })
    return this.pending
  }
}
