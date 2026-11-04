import { extensions } from '../lib/catalog.js'

// UI projection, not another plugin manager. The native Host owns persistence,
// compatibility checks, authorization, HMR and restart decisions.
export class ExtensionsController {
  constructor(manager, catalog = extensions) {
    this.manager = manager; this.catalog = catalog
    this.listeners = new Set(); this.sequence = 0; this.disposed = false
    this.state = { rows: [], loading: false, busy: false, error: '', notice: '' }
  }
  getSnapshot = () => this.state
  subscribe = fn => { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  patch(update) {
    if (this.disposed) return
    this.state = { ...this.state, ...update }
    for (const fn of this.listeners) fn()
  }
  async refresh() {
    const sequence = ++this.sequence
    this.patch({ loading: true })
    try {
      const [result, plugins] = await Promise.all([
        this.manager.listBundles(),
        this.manager.listPlugins ? this.manager.listPlugins() : { ok: true, value: [] },
      ])
      if (!result.ok || !plugins.ok) throw Error('list failed')
      if (sequence !== this.sequence || this.disposed) return
      const rows = this.catalog.flatMap(entry => {
        const bundle = result.value.find(row => row.name === entry.name)
        // Do not offer an unpublished, absent or edition-excluded package.
        if (!bundle || bundle.availability === 'missing') return []
        if (entry.entryId) {
          // Keep product-owned IDs: replacing Studio/OIDC/pet with their stock
          // bundle would duplicate services and abandon existing settings.
          const row = plugins.value.find(row => row.patchId === entry.entryId && row.moduleName === entry.name)
          return row ? [{ ...bundle, ...entry, enabled: row.enabled, targetId: row.entryId, readOnlyReason: row.readOnlyReason, error: row.error ?? bundle.error }] : []
        }
        return [{ ...bundle, ...entry }]
      })
      this.patch({ rows, loading: false, error: '' })
    } catch {
      if (sequence === this.sequence) this.patch({ loading: false, error: 'loadFailed' })
    }
  }
  async setEnabled(name, enabled) {
    const row = this.state.rows.find(row => row.name === name)
    if (this.disposed || this.state.busy || !row || row.readOnlyReason || (enabled && row.error)) return
    this.patch({ busy: true, error: '', notice: '' })
    let error = '', notice = ''
    try {
      const result = row.entryId
        ? await this.manager.setPluginEnabled(row.targetId, enabled)
        : await this.manager.setBundleEnabled(name, enabled)
      if (!result.ok || result.value.application === 'failed' || result.value.application === 'cancelled') error = 'changeFailed'
      else if (result.value.application === 'restart-required') notice = 'restartRequired'
      else if (result.value.application !== 'applied') notice = 'notApplied'
    } catch { error = 'changeFailed' }
    // Never infer success from the switch click or erase a persisted choice
    // after a transport reset. Read the native selection back in either case.
    await this.refresh()
    this.patch({ busy: false, notice, error: error || this.state.error })
  }
  dispose() { this.disposed = true; ++this.sequence; this.listeners.clear() }
}
