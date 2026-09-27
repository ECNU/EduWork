// One owner, one persistent profile. This module has no DSH or UI dependency.
export class ManagedBrowser {
  constructor({ launch, profile }) {
    this.launch = launch
    this.profile = profile
    this.state = undefined
    this.nextTab = 1
    this.notice = undefined
  }

  async close() {
    const current = this.state
    this.state = undefined
    if (current) await current.context.close()
  }

  remember(page, state) {
    if (!state.tabs.has(page)) {
      state.tabs.set(page, this.nextTab++)
      page.once('close', () => state.tabs.delete(page))
    }
  }

  async page(mode, { requireExisting = false } = {}) {
    let current = this.state
    const lost = current && (current.closed || current.page.isClosed())
    if ((!current || lost) && requireExisting) {
      throw new Error('The managed browser target was closed. Call snapshot/tabs, then select a tab or navigate before acting again. The sidebar browser is separate.')
    }
    if (!current || current.closed || current.mode !== mode) {
      // Only an intentional mode change resumes the URL. Never replay a URL or
      // a click after an external close: the caller must inspect the new target.
      const resumeURL = current && !lost && current.mode !== mode ? current.page.url() : undefined
      await this.close()
      const context = await this.launch(this.profile, mode)
      current = { context, mode, page: context.pages()[0] ?? await context.newPage(), tabs: new Map(), closed: false }
      this.state = current
      for (const page of context.pages()) this.remember(page, current)
      context.on('page', page => this.remember(page, current))
      context.on('close', () => { current.closed = true })
      if (lost) this.notice = 'Managed browser reopened after closure. The old tab is unavailable; inspect the current URL before continuing. This is not the sidebar browser.'
      if (typeof resumeURL === 'string' && /^https?:/i.test(resumeURL)) {
        await current.page.goto(resumeURL, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      }
    } else if (current.page.isClosed()) {
      current.page = current.context.pages().find(page => !page.isClosed()) ?? await current.context.newPage()
      this.remember(current.page, current)
      this.notice = 'The previous managed tab was closed. A different tab is now selected; verify its URL before acting.'
    }
    return current.page
  }

  async tabs() {
    const current = this.state
    return Promise.all(current.context.pages().filter(page => !page.isClosed()).map(async page => {
      this.remember(page, current)
      return { tabId: current.tabs.get(page), url: page.url(), title: await page.title().catch(() => ''), selected: page === current.page }
    }))
  }

  async select(tabId) {
    const current = this.state
    const page = current.context.pages().find(page => !page.isClosed() && current.tabs.get(page) === tabId)
    if (!page) throw new Error('Managed tab not found; call tabs to obtain current tab IDs.')
    current.page = page
    await page.bringToFront()
    return page
  }

  async newTab() {
    const page = await this.state.context.newPage()
    this.remember(page, this.state)
    this.state.page = page
    return page
  }

  identity() {
    const result = { target: 'managed-browser', tabId: this.state.tabs.get(this.state.page), ...(this.notice ? { notice: this.notice } : {}) }
    this.notice = undefined
    return result
  }
}

// Serialize calls per exact live Agent, including close/mode switches. Separate
// sessions never share a page. Dispose closes in-flight pages before draining.
export function managedBrowserOwners(create) {
  const owners = new Map(), disposed = new WeakSet()
  let stopping = false
  return {
    async run(owner, signal, operation) {
      if (stopping || disposed.has(owner)) throw new Error('Managed browser owner has been disposed')
      signal?.throwIfAborted()
      let entry = owners.get(owner)
      if (!entry) { entry = { browser: create(owner), tail: Promise.resolve(), controller: new AbortController() }; owners.set(owner, entry) }
      const combined = signal ? AbortSignal.any([signal, entry.controller.signal]) : entry.controller.signal
      const task = entry.tail.then(async () => {
        if (stopping || disposed.has(owner)) throw new Error('Managed browser owner has been disposed')
        combined.throwIfAborted()
        const result = await operation(entry.browser, combined)
        combined.throwIfAborted()
        return result
      })
      entry.tail = task.catch(() => {})
      return task
    },
    async release(owner) {
      disposed.add(owner)
      const entry = owners.get(owner)
      if (!entry) return
      entry.controller.abort(new Error('Managed browser owner has been disposed'))
      await entry.browser.close()
      await entry.tail
      // An in-flight launch may have completed during shutdown.
      await entry.browser.close()
      owners.delete(owner)
    },
    async dispose() {
      stopping = true
      await Promise.all([...owners.keys()].map(owner => this.release(owner)))
    },
  }
}
