import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { WebOidcBackend, account, sessionRef } from './oidc.js'
import { DesktopOidcBackend } from './desktop-oidc.js'
import { emptyResources, normalizeResourceModels } from './resources.js'
import { detectGatewayProtocol, gatewayJSON, liteLLMToken, protocolError, readGatewayJSON, registerLiteLLM, revokeLiteLLM, tokenRequest } from './litellm-protocol.js'

const seconds = backend => Math.floor(backend.now() / 1000)
const fingerprint = (profile, descriptor) => createHash('sha256').update(JSON.stringify({ auth: profile.auth, descriptor })).digest('hex')
const query = (url, key, required = false) => {
  const values = url.searchParams.getAll(key)
  if (values.length > 1 || (required && !values[0])) throw protocolError('oidc_callback_invalid', 'Invalid gateway callback parameters')
  return values[0]
}

/** Additive protocol adapter. Profiles with `oidc` execute the existing backend. */
function withGatewayAuth(Base) {
  return class extends Base {
    async discover(profile) {
      if (!profile.auth) return super.discover(profile)
      const cached = this.discovery.get(profile.id)
      if (cached) return cached
      const raw = await gatewayJSON(this.fetch, profile.auth.discoveryUrl, { headers: { accept: 'application/json' } })
      const descriptor = detectGatewayProtocol(raw, profile)
      this.discovery.set(profile.id, descriptor)
      return descriptor
    }

    async createAuthorization(profile, descriptor, redirectURI) {
      if (!profile.auth) return super.createAuthorization(profile, descriptor, redirectURI)
      const epoch = this.accountEpoch(profile)
      const clientId = await registerLiteLLM(this.fetch, descriptor, redirectURI)
      if (epoch !== this.accountEpoch(profile)) throw protocolError('oidc_login_cancelled', 'Sign-in was cancelled')
      this.pruneFlows()
      if (this.flows.size >= 32) throw protocolError('oidc_flow_limit', 'Too many pending sign-ins')
      const state = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url')
      const flow = { profileID: profile.id, verifier, clientId, redirectURI, createdAt: this.now(), epoch }
      const target = new URL(descriptor.authorizationEndpoint)
      for (const [key, value] of Object.entries({ response_type: 'code', client_id: clientId, redirect_uri: redirectURI, state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource: descriptor.resource })) target.searchParams.set(key, value)
      this.flows.set(state, flow)
      return { state, flow, authorizationURL: target.toString() }
    }

    async exchangeAuthorization(requested, flow) {
      const profile = this.profile(flow.profileID)
      if (!profile.auth) return super.exchangeAuthorization(requested, flow)
      if (query(requested, 'error')) throw protocolError('oidc_authorization_rejected', 'Gateway authorization was declined')
      const code = query(requested, 'code', true), descriptor = await this.discover(profile)
      if (query(requested, 'iss') && query(requested, 'iss') !== descriptor.issuer) throw protocolError('oidc_callback_invalid', 'Gateway callback issuer mismatch')
      const raw = await tokenRequest(this.fetch, descriptor, { grant_type: 'authorization_code', client_id: flow.clientId, code, redirect_uri: flow.redirectURI, code_verifier: flow.verifier })
      const session = { ...liteLLMToken(raw, this.now), issuer: descriptor.issuer, protocol: descriptor.protocol, clientId: flow.clientId, binding: fingerprint(profile, descriptor), contextID: randomUUID(), capabilities: [] }
      // Only project a display name; budgets, keys and team records never enter RPC.
      try {
        const info = await gatewayJSON(this.fetch, descriptor.userInfoEndpoint, { headers: { authorization: `Bearer ${session.accessToken}`, accept: 'application/json' } })
        if (info.user_id === session.identity.sub && typeof info.user_info?.user_alias === 'string' && info.user_info.user_alias.trim()) session.identity.name = info.user_info.user_alias.trim().slice(0, 256)
      } catch { /* Identity is supplied by the token endpoint; display data is optional. */ }
      if (flow.epoch !== this.accountEpoch(profile)) {
        await this.revokeGateway(profile, descriptor, session)
        throw protocolError('oidc_login_cancelled', 'Account changed during sign-in')
      }
      return session
    }

    async loadSession(profile) {
      if (!profile.auth) return super.loadSession(profile)
      const epoch = this.accountEpoch(profile)
      const record = await this.ctx.credentials.resolve(sessionRef(profile))
      if (!record?.value) return undefined
      let session
      try { session = JSON.parse(record.value) } catch { return undefined }
      const descriptor = await this.discover(profile)
      if (epoch !== this.accountEpoch(profile)) return undefined
      if (session?.protocol !== descriptor.protocol || session.binding !== fingerprint(profile, descriptor) || typeof session.contextID !== 'string' || !session.contextID || typeof session.accessToken !== 'string' || !session.accessToken || typeof session.refreshToken !== 'string' || !session.refreshToken || typeof session.clientId !== 'string' || !session.clientId || !Number.isFinite(session.expiresAt) || typeof session.identity?.sub !== 'string' || !session.identity.sub || !(session.teamID === null || typeof session.teamID === 'string')) return undefined
      return session
    }

    async saveSession(profile, session, epoch = this.accountEpoch(profile)) {
      if (!profile.auth) return super.saveSession(profile, session, epoch)
      return this.writeCredentials(profile, epoch, async () => {
        await this.ctx.credentials.set(sessionRef(profile), JSON.stringify(session))
        this.resourceFlights.delete(profile.id)
        await this.clearGatewayModels(profile)
      })
    }

    refresh(profile, session) {
      if (!profile.auth) return super.refresh(profile, session)
      const key = `${profile.id}:${session.contextID}`
      if (!this.refreshFlights.has(key)) {
        const flight = this.performRefresh(profile, session).finally(() => { if (this.refreshFlights.get(key) === flight) this.refreshFlights.delete(key) })
        this.refreshFlights.set(key, flight)
      }
      return this.refreshFlights.get(key)
    }

    async gatewayCurrent(profile, session, epoch) {
      const current = await this.loadSession(profile)
      if (epoch !== this.accountEpoch(profile) || current?.contextID !== session.contextID) throw protocolError('oidc_login_cancelled', 'Gateway account changed during the request')
      return current
    }

    async performRefresh(profile, session) {
      if (!profile.auth) return super.performRefresh(profile, session)
      const epoch = this.accountEpoch(profile), descriptor = await this.discover(profile)
      const saved = await this.gatewayCurrent(profile, session, epoch)
      // A request may have captured the old pair before the previous flight settled.
      if (saved.accessToken !== session.accessToken) return saved
      let next
      try {
        const raw = await tokenRequest(this.fetch, descriptor, { grant_type: 'refresh_token', client_id: saved.clientId, refresh_token: saved.refreshToken })
        next = { ...saved, ...liteLLMToken(raw, this.now) }
        if (next.identity.sub !== saved.identity.sub || next.teamID !== saved.teamID) throw protocolError('gateway_identity_changed', 'Gateway authorization identity changed during refresh')
        next.identity = saved.identity
        await this.writeCredentials(profile, epoch, async () => {
          // Serialize persistence of the entire rotated pair. Never overwrite a new login.
          await this.gatewayCurrent(profile, saved, epoch)
          await this.ctx.credentials.set(sessionRef(profile), JSON.stringify(next))
        })
        return next
      } catch (cause) {
        if (next) await this.revokeGateway(profile, descriptor, next)
        if (cause.oauthError === 'invalid_grant' || cause.oauthError === 'invalid_client' || cause.code === 'gateway_identity_changed') {
          await this.writeCredentials(profile, epoch, async () => {
            await this.gatewayCurrent(profile, saved, epoch)
            await this.ctx.credentials.unset(sessionRef(profile))
          })
          await this.clearGatewayModels(profile)
          this.accountChanged(account(profile, undefined, false))
          throw protocolError('oidc_login_required', 'Gateway authorization expired; please sign in again')
        }
        throw cause
      }
    }

    async activeSession(profile) {
      if (!profile.auth) return super.activeSession(profile)
      const epoch = this.accountEpoch(profile)
      const session = await this.loadSession(profile)
      if (!session) return undefined
      if (session.expiresAt > seconds(this) + 90) return session
      try { return await this.refresh(profile, session) }
      catch (cause) {
        // Brief outages must not discard a still-valid access token; expired tokens stop.
        if ((cause.code === 'gateway_unavailable' || cause.status === 429 || cause.status >= 500) && session.expiresAt > seconds(this)) return this.gatewayCurrent(profile, session, epoch)
        throw cause
      }
    }

    async resolveGatewayCredential(profileID) {
      const profile = this.profile(profileID), epoch = this.accountEpoch(profile)
      const session = await this.activeSession(profile)
      if (!session) return undefined
      await this.gatewayCurrent(profile, session, epoch)
      return { value: session.accessToken }
    }

    async status(profileID) {
      const profile = this.profile(profileID)
      if (!profile.auth) return super.status(profileID)
      const epoch = this.accountEpoch(profile), session = await this.loadSession(profile)
      if (!session) return account(profile, undefined, false)
      if (!this.resourceStates.has(profileID)) await this.resources(profileID)
      await this.gatewayCurrent(profile, session, epoch)
      return account(profile, session, session.expiresAt > seconds(this) || Boolean(session.refreshToken), 'access_token')
    }

    async reconcile(profileID, options = {}) {
      const profile = this.profile(profileID)
      if (!profile.auth) return super.reconcile(profileID, options)
      const epoch = this.accountEpoch(profile), session = await this.activeSession(profile)
      if (!session) return account(profile, undefined, false)
      await this.resources(profileID)
      await this.gatewayCurrent(profile, session, epoch)
      return account(profile, session, true, 'access_token')
    }

    async authorizedFetch(profileID, endpoint, init = {}) {
      const profile = this.profile(profileID)
      if (!profile.auth) return super.authorizedFetch(profileID, endpoint, init)
      const epoch = this.accountEpoch(profile), descriptor = await this.discover(profile)
      const target = new URL(endpoint)
      // Host-only model and own-account routes, never key administration or arbitrary origins.
      const modelBase = new URL(`${descriptor.baseURL}/`)
      if (target.username || target.password || target.hash || target.origin !== modelBase.origin || !(target.href === descriptor.userInfoEndpoint || target.pathname.startsWith(modelBase.pathname))) throw protocolError('oidc_authorized_origin_denied', 'Gateway token destination is not an authorized resource')
      let session = await this.activeSession(profile)
      if (!session) throw protocolError('oidc_login_required', 'Gateway sign-in is required')
      const request = current => this.fetch(target.href, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), authorization: `Bearer ${current.accessToken}` }, redirect: 'error', signal: init.signal ?? AbortSignal.timeout(20_000) })
      let response = await request(session)
      // Retry only safe reads. A generation (including SSE) is never replayed here.
      if (response.status === 401 && ['GET', 'HEAD'].includes((init.method ?? 'GET').toUpperCase())) {
        await response.body?.cancel()
        session = await this.refresh(profile, session)
        response = await request(session)
      }
      try { await this.gatewayCurrent(profile, session, epoch) }
      catch (cause) { await response.body?.cancel(); throw cause }
      return response
    }

    async readResources(profileID) {
      const profile = this.profile(profileID)
      if (!profile.auth) return super.readResources(profileID)
      const result = { ...emptyResources(profile), models: [] }, epoch = this.accountEpoch(profile)
      const session = await this.activeSession(profile)
      if (!session) return result
      const descriptor = await this.discover(profile)
      try {
        const raw = await readGatewayJSON(await this.authorizedFetch(profileID, `${descriptor.baseURL}/models`))
        const models = Array.isArray(raw.data) && raw.data.length === 0 ? [] : normalizeResourceModels(raw, this.reviewedProfiles.get(profileID))
        await this.gatewayCurrent(profile, session, epoch)
        const next = Object.freeze({ ...profile, provider: Object.freeze({ ...profile.provider, baseURL: descriptor.baseURL, models }) })
        // updateProvider is synchronous in the Host; no asynchronous account switch gap.
        this.updateProvider(next)
        this.profiles.set(profileID, next)
        result.models = models
      } catch (cause) {
        if (cause.code === 'oidc_login_cancelled' || cause.code === 'oidc_login_required') throw cause
        result.issues.push('models_unavailable')
      }
      await this.gatewayCurrent(profile, session, epoch)
      this.resourceStates.set(profileID, result)
      return result
    }

    async clearGatewayModels(profile) {
      const next = Object.freeze({ ...profile, provider: Object.freeze({ ...profile.provider, models: [] }) })
      this.updateProvider(next)
      this.profiles.set(profile.id, next)
      this.resourceStates.delete(profile.id)
    }

    async revokeGateway(profile, descriptor, session) {
      try { await revokeLiteLLM(this.fetch, descriptor, session) }
      catch { this.ctx.logger.warn('Gateway refresh revocation was not confirmed; local logout still removes access') }
    }

    async logout(profileID) {
      const profile = this.profile(profileID)
      if (!profile.auth) return super.logout(profileID)
      this.accountEpochs.set(profileID, this.accountEpoch(profile) + 1)
      for (const attempt of this.attempts?.values() ?? []) if (attempt.profileID === profileID && attempt.state === 'pending') await this.cancelLogin(attempt.loginID)
      const epoch = this.accountEpoch(profile)
      // Clear locally even when discovery is offline on a fresh process.
      const record = await this.ctx.credentials.resolve(sessionRef(profile))
      let session
      try { session = JSON.parse(record?.value) } catch { /* No valid revocation candidate. */ }
      await this.clearCredentials(profile, epoch)
      for (const key of this.refreshFlights.keys()) if (key.startsWith(`${profileID}:`)) this.refreshFlights.delete(key)
      this.resourceFlights.delete(profileID)
      for (const [state, flow] of this.flows) if (flow.profileID === profileID) this.flows.delete(state)
      await this.clearGatewayModels(profile)
      this.accountChanged(account(profile, undefined, false))
      if (session) {
        try {
          const descriptor = await this.discover(profile)
          if (session.binding === fingerprint(profile, descriptor)) await this.revokeGateway(profile, descriptor, session)
        } catch { this.ctx.logger.warn('Gateway logout completed locally; remote revocation could not be confirmed') }
      }
      return account(profile, undefined, false)
    }
  }
}

export const GatewayWebBackend = withGatewayAuth(WebOidcBackend)
export const GatewayDesktopBackend = withGatewayAuth(DesktopOidcBackend)
