import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { WebOidcBackend, OIDC_CALLBACK_PATH, sessionRef } from './oidc.js'
import { callbackLanguage, callbackPage } from './callback-page.js'

const MAX_FLOWS = 32
const MAX_HISTORY = 128
const error = (code, message) => Object.assign(new Error(message), { code })
const safeCodes = new Set(['oidc_callback_invalid', 'oidc_authorization_rejected', 'oidc_token_invalid', 'oidc_id_token_invalid', 'oidc_userinfo_invalid'])

function reply(response, status, profile, outcome, language) {
  const page = callbackPage(profile, outcome, language)
  response.writeHead(status, page.headers)
  response.end(page.html)
}

/** Same identity/resource implementation as Web; only the callback transport differs. */
export class DesktopOidcBackend extends WebOidcBackend {
  constructor(ctx, profiles, config = {}, options = {}) {
    super(ctx, profiles, config, { ...options, transport: 'desktop' })
    if (Object.keys(config).some(key => !['callbackPort', 'flowTimeoutMs'].includes(key))) throw new Error('unsupported desktop OIDC callback setting')
    this.port = config.callbackPort ?? 0
    this.ttl = config.flowTimeoutMs ?? 600_000
    if (!Number.isInteger(this.port) || this.port < 0 || this.port > 65535) throw new Error('desktop callbackPort must be an integer from 0 to 65535')
    if (!Number.isInteger(this.ttl) || this.ttl < 1000 || this.ttl > 600_000) throw new Error('desktop flowTimeoutMs must be between 1000 and 600000')
    this.openExternal = options.openExternal
    this.attempts = new Map()
    this.starting = new Set()
    this.disposed = false
    ctx.effect(() => () => this.dispose(), 'dsh-oidc: temporary desktop callbacks')
  }

  async begin(profileID) {
    const profile = this.profile(profileID)
    if (this.disposed) throw error('oidc_host_unavailable', 'OIDC host has stopped')
    if (typeof this.openExternal !== 'function') throw error('oidc_browser_unavailable', 'The desktop browser service is unavailable')
    if (this.starting.has(profileID)) throw error('oidc_login_pending', 'Organization sign-in is already starting')
    this.starting.add(profileID)
    let attempt
    try {
      for (const previous of this.attempts.values()) if (previous.profileID === profileID && previous.state === 'pending') await this.cancelLogin(previous.loginID)
      const discovery = await this.discover(profile)
      if (this.disposed) throw error('oidc_host_unavailable', 'OIDC host has stopped')
      if ([...this.attempts.values()].filter(value => value.state === 'pending').length >= MAX_FLOWS) throw error('oidc_flow_limit', 'Too many pending organization sign-ins')
      const loginID = randomBytes(24).toString('base64url')
      attempt = { loginID, profileID, state: 'pending', expiresAt: new Date(this.now() + this.ttl).toISOString(), consumed: false }
      const server = createServer((request, response) => { void this.callbackFor(attempt, request, response) })
      server.requestTimeout = 10_000
      server.headersTimeout = 10_000
      server.maxHeadersCount = 32
      attempt.server = server
      this.attempts.set(loginID, attempt)
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen({ host: '127.0.0.1', port: this.port, exclusive: true }, resolve)
      }).catch(() => { throw error('oidc_callback_unavailable', 'The local sign-in callback could not start; check whether its configured port is in use') })
      server.unref()
      if (this.disposed || attempt.state !== 'pending') {
        await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
        throw error('oidc_host_unavailable', 'OIDC host has stopped')
      }
      attempt.origin = `http://127.0.0.1:${server.address().port}`
      const authorization = await this.createAuthorization(profile, discovery, `${attempt.origin}${OIDC_CALLBACK_PATH}`)
      if (this.disposed || attempt.state !== 'pending') throw error('oidc_login_cancelled', 'Sign-in was cancelled')
      Object.assign(attempt, { oauthState: authorization.state, flow: authorization.flow })
      attempt.timer = setTimeout(() => { void this.cancelLogin(loginID, 'expired').catch(() => {}) }, this.ttl)
      attempt.timer.unref()
      // This Host-only method receives a URL derived from reviewed discovery, never an RPC URL.
      try { await this.openExternal(authorization.authorizationURL) }
      catch { throw error('oidc_browser_unavailable', 'The sign-in browser could not be opened') }
      return { mode: 'external', loginID, expiresAt: attempt.expiresAt }
    } catch (cause) {
      if (attempt) await this.cancelLogin(attempt.loginID, 'failed')
      throw cause
    } finally {
      this.starting.delete(profileID)
      this.pruneAttempts()
    }
  }

  pruneAttempts() {
    for (const [id, attempt] of this.attempts) {
      if (attempt.state !== 'pending' && (this.attempts.size > MAX_HISTORY || Date.parse(attempt.expiresAt) + this.ttl < this.now())) this.attempts.delete(id)
    }
  }

  async closeCallback(attempt, force = false) {
    clearTimeout(attempt.timer)
    this.flows.delete(attempt.oauthState)
    if (!attempt.server) return
    const server = attempt.server
    attempt.server = undefined
    const closed = new Promise(resolve => server.close(resolve))
    if (force) server.closeAllConnections()
    else server.closeIdleConnections()
    await closed
  }

  loginStatus(loginID) {
    const attempt = this.attempts.get(loginID)
    if (!attempt) throw error('oidc_login_unknown', 'This sign-in attempt is no longer available')
    return { loginID, profileID: attempt.profileID, state: attempt.state, expiresAt: attempt.expiresAt,
      ...(attempt.status ? { status: attempt.status } : {}), ...(attempt.errorCode ? { errorCode: attempt.errorCode } : {}) }
  }

  async cancelLogin(loginID, state = 'cancelled') {
    const attempt = this.attempts.get(loginID)
    if (!attempt) throw error('oidc_login_unknown', 'This sign-in attempt is no longer available')
    if (attempt.state === 'pending') {
      attempt.state = state
      await this.closeCallback(attempt, true)
    }
    await attempt.processing
    return this.loginStatus(loginID)
  }

  async callbackFor(attempt, request, response) {
    const profile = this.profile(attempt.profileID), language = callbackLanguage(request.headers['accept-language'])
    let requested
    try {
      requested = new URL(request.url, attempt.origin)
      if (request.method !== 'GET' || request.headers.host !== new URL(attempt.origin).host
        || (request.headers.origin && request.headers.origin !== attempt.origin)
        || requested.origin !== attempt.origin || requested.username || requested.password || requested.hash || requested.pathname !== OIDC_CALLBACK_PATH
        || requested.searchParams.getAll('state').length !== 1 || requested.searchParams.get('state') !== attempt.oauthState
        || attempt.state !== 'pending' || attempt.consumed) {
        reply(response, 400, profile, 'failed', language); return
      }
      if (Date.parse(attempt.expiresAt) <= this.now()) {
        reply(response, 410, profile, 'expired', language); await this.cancelLogin(attempt.loginID, 'expired'); return
      }
    } catch { reply(response, 400, profile, 'failed', language); return }
    attempt.consumed = true
    this.flows.delete(attempt.oauthState)
    attempt.processing = this.finishAuthorization(attempt, requested).catch(() => {
      attempt.state = 'failed'
      attempt.errorCode = 'oidc_credentials_unavailable'
      this.ctx.logger.warn('Desktop OIDC host credentials are unavailable')
    })
    await attempt.processing
    if (!response.destroyed) reply(response, attempt.state === 'completed' ? 200 : 400, profile,
      attempt.state === 'completed' ? (attempt.status?.state === 'authenticated' ? 'credential-required' : 'completed') : 'failed', language)
    await this.closeCallback(attempt)
  }

  async finishAuthorization(attempt, requested) {
    const profile = this.profile(attempt.profileID)
    const previous = new Map()
    let wrote = false
    try {
      const session = await this.exchangeAuthorization(requested, attempt.flow)
      if (attempt.state !== 'pending') return
      const refs = [sessionRef(profile), ...(profile.keyBinding ? [profile.keyBinding.credentialRef] : [])]
      for (const ref of refs) previous.set(ref, await this.ctx.credentials.resolve(ref))
      if (attempt.state !== 'pending') return
      wrote = true
      await this.saveSession(profile, session, attempt.flow.epoch)
      if (attempt.state !== 'pending') return
      // A resource outage must not turn a successful identity login into a failed login.
      let status
      try { status = await this.reconcile(profile.id, { allowProvision: false }) }
      catch { status = await this.status(profile.id) }
      if (attempt.state !== 'pending') return
      attempt.status = status
      attempt.state = 'completed'
      this.accountChanged(status)
    } catch (cause) {
      if (attempt.state === 'pending') {
        attempt.state = 'failed'
        attempt.errorCode = safeCodes.has(cause?.code) ? cause.code : 'oidc_login_failed'
      }
      this.ctx.logger.warn('Desktop OIDC sign-in did not complete', { code: attempt.errorCode ?? 'oidc_login_cancelled' })
    } finally {
      // Cancellation/disposal while the host vault writes must not resurrect a login.
      if (wrote && attempt.state !== 'completed') {
        await this.writeCredentials(profile, attempt.flow.epoch, async () => {
          const currentRecord = await this.ctx.credentials.resolve(sessionRef(profile))
          let currentSession
          try { currentSession = JSON.parse(currentRecord?.value) } catch { /* No proven runtime-key ownership. */ }
          const ownsCurrentKey = await this.boundCredential(profile, currentSession)
          for (const [ref, record] of previous) {
            // A different profile may have rebound the shared key during login.
            if (ref !== sessionRef(profile) && !ownsCurrentKey) continue
            if (record?.value !== undefined) await this.ctx.credentials.set(ref, record.value)
            else await this.ctx.credentials.unset(ref)
          }
        })
        this.resourceStates.delete(profile.id)
      }
      // Retain only the safe public result once the authorization is consumed.
      attempt.flow = undefined
      attempt.oauthState = undefined
    }
  }

  async logout(profileID) {
    for (const attempt of this.attempts.values()) if (attempt.profileID === profileID && attempt.state === 'pending') await this.cancelLogin(attempt.loginID)
    return super.logout(profileID)
  }

  async dispose() {
    this.disposed = true
    await Promise.all([...this.attempts.values()].filter(value => value.state === 'pending').map(value => this.cancelLogin(value.loginID)))
    await Promise.all([...this.attempts.values()].map(value => value.processing))
  }
}
