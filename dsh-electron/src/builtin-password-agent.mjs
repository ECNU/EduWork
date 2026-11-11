// Main-process adapter. The Host/LLM gets fixed status values only; the vault
// and the isolated login executor never cross the desktop service boundary.
export function createBuiltinPasswordAgent({ vault, login, getDestination, approve, isEnabled = () => false }) {
  let busy = false
  let active
  const grants = new Set()
  const statuses = new Set(['cancelled', 'unsupported-platform', 'debugging-enabled',
    'unsupported-login-page', 'origin-changed', 'login-needs-user', 'unsafe-session-state',
    'login-certificate-error', 'login-connection-failed', 'login-timeout'])
  const handle = async (request, signal) => {
    if (!request || Array.isArray(request) || Object.keys(request).some(key => !['action', 'provider', 'url', 'sessionId'].includes(key))
      || request.provider !== 'builtin' || !['status', 'login'].includes(request.action)) return { status: 'invalid-request' }
    if (!isEnabled()) return { status: 'agent-login-disabled' }
    if (request.action === 'status') return { status: 'available' }
    if (busy) return { status: 'busy' }
    let url
    try {
      url = new URL(request.url)
      if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search
        || !/^[\w-]{1,200}$/.test(request.sessionId)) return { status: 'invalid-request' }
    } catch { return { status: 'invalid-request' } }
    busy = true
    active = new AbortController()
    signal = signal ? AbortSignal.any([signal, active.signal]) : active.signal
    let window
    try {
      signal?.throwIfAborted()
      const matches = vault.findForOrigin(url.origin)
      if (!matches.ok) return { status: 'vault-unavailable' }
      if (!matches.value.exact.length) return { status: 'no-saved-account' }
      // The model cannot choose a hidden account ID or invent permission.
      const entries = matches.value.exact
      const existing = entries.length === 1 && grants.has(`${request.sessionId}:${entries[0].id}:${url.origin}`) ? entries[0] : null
      const selected = existing ?? await approve({ origin: url.origin, entries, signal })
      signal?.throwIfAborted()
      const entry = selected && entries.find(entry => entry.id === selected.id)
      if (!entry) return { status: 'cancelled' }
      const destination = await getDestination(request.sessionId, url.href)
      signal?.throwIfAborted()
      // Re-read the account after approval; deletion must take effect immediately.
      const current = vault.findForOrigin(url.origin)
      if (!current.ok || !current.value.exact.some(value => value.id === entry.id)) return { status: 'no-saved-account' }
      window = await login.open({ loginURL: url.href, origin: url.origin, alias: entry.username }, destination, signal, { automatic: true })
      signal?.throwIfAborted()
      const secret = vault.getPassword(entry.id)
      if (!secret.ok) return { status: 'vault-unavailable' }
      await window.fill({ username: entry.username, password: secret.value })
      signal?.throwIfAborted()
      await window.submit()
      signal?.throwIfAborted()
      await window.transfer()
      signal?.throwIfAborted()
      vault.markUsed(entry.id)
      grants.add(`${request.sessionId}:${entry.id}:${url.origin}`)
      return { status: 'session-ready' }
    } catch (error) {
      return { status: signal?.aborted ? 'cancelled' : statuses.has(error?.message) ? error.message : 'operation-failed' }
    } finally {
      try { await window?.close() } catch { /* No raw provider diagnostics. */ }
      busy = false
      active = undefined
    }
  }
  handle.revoke = () => { grants.clear(); active?.abort() }
  return handle
}
