const wait = (ms, signal) => new Promise(resolve => {
  const stop = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); resolve() }
  const timer = setTimeout(stop, ms)
  signal?.addEventListener('abort', stop, { once: true })
  if (signal?.aborted) stop()
})

/**
 * Browser navigation is kept for Web; desktop never navigates its renderer to the IdP.
 * @param {any} service
 * @param {string} profileID
 * @param {{signal?: AbortSignal, onPending?: (pending: boolean) => void, redirect?: (url: string) => void, interval?: number}} options
 */
export async function signIn(service, profileID, { signal, onPending = (pending = false) => {}, redirect = url => window.location.assign(url), interval = 1000 } = {}) {
  const result = await service.begin(profileID)
  if (result.mode === 'redirect') { if (!signal?.aborted) redirect(result.authorizationURL); return service.status(profileID) }
  if (result.mode === 'completed') return result.status
  if (result.mode !== 'external') throw new Error('Unsupported organization sign-in response')
  const expires = Math.min(Date.parse(result.expiresAt), Date.now() + 600_000)
  let completed = false
  onPending(true)
  try {
    while (!signal?.aborted && Number.isFinite(expires) && Date.now() < expires) {
      const next = await service.loginStatus(result.loginID)
      if (next.state === 'completed') { completed = true; return next.status }
      if (next.state === 'cancelled') return service.status(profileID)
      if (next.state === 'failed') {
        const message = ['gateway_callback_issuer_missing', 'gateway_callback_issuer_invalid'].includes(next.errorCode)
          ? 'The authentication response does not match the sign-in configuration. Contact your administrator before trying again.'
          : 'Organization sign-in did not complete. Please try again.'
        throw Object.assign(new Error(message), { code: next.errorCode })
      }
      if (next.state === 'expired') break
      await wait(interval, signal)
    }
    if (signal?.aborted) { await service.cancelLogin(result.loginID); completed = true; return service.status(profileID) }
    throw Object.assign(new Error('Organization sign-in expired. Please try again.'), { code: 'oidc_login_expired' })
  } finally {
    if (!completed) await service.cancelLogin(result.loginID).catch(() => {})
    onPending(false)
  }
}
