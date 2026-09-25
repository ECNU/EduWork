import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { WebOidcBackend, account, sessionRef } from './oidc.js'
import { DesktopOidcBackend } from './desktop-oidc.js'
import { emptyResources, normalizeResourceModels } from './resources.js'
import { gatewayJSON, liteLLMToken, protocolError, readGatewayJSON, registerLiteLLM, revokeLiteLLM, tokenRequest } from './litellm-protocol.js'
import { detectGatewayProtocol } from './gateway-protocol.js'
import { oidcLlmIdentity, oidcLlmToken } from './oidc-llm-protocol.js'
import { bufferResourceResponse, validateResourceRead } from './model-resource-transport.js'
import { accessTokenNeedsRefresh } from './token-lifetime.js'

const seconds = backend => Math.floor(backend.now() / 1000)
const fingerprint = (profile, descriptor) => createHash('sha256').update(JSON.stringify({ auth: profile.auth, descriptor })).digest('hex')
const query = (url, key, required = false) => {
  const values = url.searchParams.getAll(key)
  if (values.length > 1 || (required && !values[0])) throw protocolError('oidc_callback_invalid', 'Invalid gateway callback parameters')
  return values[0]
}

function scopedResponse(response, lease) {
  if (!response.body) { lease.close(); return response }
  const reader = response.body.getReader()
  const body = new ReadableStream({
    async pull(controller) {
      try {
        lease.assertCurrent()
        const next = await reader.read()
        lease.assertCurrent()
        if (next.done) { lease.close(); controller.close() }
        else controller.enqueue(next.value)
      } catch (cause) {
        lease.close()
        await reader.cancel().catch(() => {})
        controller.error(cause)
      }
    },
    async cancel(reason) { lease.close(); await reader.cancel(reason).catch(() => {}) },
  }, { highWaterMark: 0 })
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
}

/** Token model protocols share the OIDC identity and callback implementation. */
function withGatewayAuth(Base) {
  return class extends Base {
    constructor(...args) {
      super(...args)
      this.gatewayRevisions = new Map()
      this.gatewayCalls = new Map()
      this.ctx.effect(() => () => {
        for (const profile of this.profiles.values()) if (profile.auth) this.invalidateGatewayCalls(profile)
      }, 'dsh-oidc: gateway model requests')
    }

    invalidateGatewayCalls(profile) {
      this.gatewayRevisions.set(profile.id, (this.gatewayRevisions.get(profile.id) ?? 0) + 1)
      for (const controller of this.gatewayCalls.get(profile.id) ?? []) controller.abort()
      this.gatewayCalls.delete(profile.id)
    }

    async createGatewayScope(profileID) {
      const profile = this.profile(profileID), epoch = this.accountEpoch(profile)
      const revision = this.gatewayRevisions.get(profileID) ?? 0
      const session = await this.activeSession(profile)
      if (!session) throw protocolError('oidc_login_required', 'Gateway sign-in is required')
      await this.gatewayCurrent(profile, session, epoch)
      const assertCurrent = () => {
        if (epoch !== this.accountEpoch(profile) || revision !== (this.gatewayRevisions.get(profileID) ?? 0)) {
          throw protocolError('oidc_login_cancelled', 'Gateway authorization changed; start a new model request')
        }
      }
      assertCurrent()
      return {
        open: signal => {
          assertCurrent()
          const controller = new AbortController()
          let calls = this.gatewayCalls.get(profileID)
          if (!calls) this.gatewayCalls.set(profileID, calls = new Set())
          calls.add(controller)
          return {
            signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
            assertCurrent,
            resolveCredential: async providerID => {
              assertCurrent()
              if (providerID !== profile.provider.id) throw protocolError('oidc_authorized_origin_denied', 'Gateway credential does not belong to this provider')
              const current = await this.activeSession(profile)
              assertCurrent()
              if (!current || current.contextID !== session.contextID) throw protocolError('oidc_login_cancelled', 'Gateway account changed during the request')
              return { value: current.accessToken }
            },
            close: () => { controller.abort(); calls.delete(controller); if (!calls.size && this.gatewayCalls.get(profileID) === calls) this.gatewayCalls.delete(profileID) },
          }
        },
      }
    }

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
      const clientId = descriptor.clientId ?? await registerLiteLLM(this.fetch, descriptor, redirectURI)
      if (epoch !== this.accountEpoch(profile)) throw protocolError('oidc_login_cancelled', 'Sign-in was cancelled')
      this.pruneFlows()
      if (this.flows.size >= 32) throw protocolError('oidc_flow_limit', 'Too many pending sign-ins')
      const state = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url')
      const flow = { profileID: profile.id, verifier, clientId, redirectURI, createdAt: this.now(), epoch }
      const target = new URL(descriptor.authorizationEndpoint)
      for (const [key, value] of Object.entries({ response_type: 'code', client_id: clientId, redirect_uri: redirectURI, state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource: descriptor.resource })) target.searchParams.set(key, value)
      if (descriptor.scopes) target.searchParams.set('scope', descriptor.scopes.join(' '))
      if (descriptor.identityMode === 'oidc') {
        flow.nonce = randomBytes(32).toString('base64url')
        target.searchParams.set('nonce', flow.nonce)
        target.searchParams.set('prompt', 'consent')
      }
      this.flows.set(state, flow)
      return { state, flow, authorizationURL: target.toString() }
    }

    async exchangeAuthorization(requested, flow) {
      const profile = this.profile(flow.profileID)
      if (!profile.auth) return super.exchangeAuthorization(requested, flow)
      const descriptor = await this.discover(profile)
      const issuers = requested.searchParams.getAll('iss')
      if (!issuers.length && descriptor.requireResponseIssuer) throw protocolError('gateway_callback_issuer_missing', 'Gateway authorization response omitted its required issuer')
      if (issuers.length > 1 || issuers.length === 1 && issuers[0] !== descriptor.issuer) throw protocolError('gateway_callback_issuer_invalid', 'Gateway authorization response issuer is invalid')
      if (query(requested, 'error')) throw protocolError('oidc_authorization_rejected', 'Gateway authorization was declined')
      const code = query(requested, 'code', true)
      const raw = await tokenRequest(this.fetch, descriptor, { grant_type: 'authorization_code', client_id: flow.clientId, code, redirect_uri: flow.redirectURI, code_verifier: flow.verifier })
      const draft = descriptor.protocol === 'oidc-llm-draft-0.1'
      let token
      try { token = draft ? oidcLlmToken(raw, descriptor, this.now) : liteLLMToken(raw, this.now) }
      catch (cause) {
        if (draft && typeof raw.refresh_token === 'string' && raw.refresh_token.length > 0 && raw.refresh_token.length <= 65536) await this.revokeGateway(profile, descriptor, { clientId: flow.clientId, refreshToken: raw.refresh_token })
        throw cause
      }
      const session = { ...token, issuer: descriptor.issuer, protocol: descriptor.protocol, clientId: flow.clientId, binding: fingerprint(profile, descriptor), contextID: randomUUID(), capabilities: [] }
      if (draft) {
        session.identityMode = descriptor.identityMode
        session.oidcNonce = flow.nonce
        try { await this.gatewayIdentity(profile, descriptor, raw, session) }
        catch (cause) { await this.revokeGateway(profile, descriptor, session); throw cause }
      } else {
        // Only project a display name; budgets, keys and team records never enter RPC.
        try {
          const info = await gatewayJSON(this.fetch, descriptor.userInfoEndpoint, { headers: { authorization: `Bearer ${session.accessToken}`, accept: 'application/json' } })
          if (info.user_id === session.identity.sub && typeof info.user_info?.user_alias === 'string' && info.user_info.user_alias.trim()) session.identity.name = info.user_info.user_alias.trim().slice(0, 256)
        } catch { /* Identity is supplied by the token endpoint; display data is optional. */ }
      }
      if (flow.epoch !== this.accountEpoch(profile)
        || this.attempts && ![...this.attempts.values()].some(attempt => attempt.flow === flow && attempt.state === 'pending')) {
        await this.revokeGateway(profile, descriptor, session)
        throw protocolError('oidc_login_cancelled', 'Account changed during sign-in')
      }
      return session
    }

    async gatewayIdentity(profile, descriptor, raw, session, previous) {
      let claims
      if (descriptor.identityMode === 'oidc' && (!previous || raw.id_token !== undefined)) {
        claims = await this.verifyIDToken({ oidc: { issuer: descriptor.issuer, clientId: session.clientId } }, descriptor,
          raw.id_token, session.oidcNonce, session.accessToken, { refresh: Boolean(previous) })
        const audience = (Array.isArray(claims.aud) ? [...claims.aud] : [claims.aud]).sort()
        if (previous && (claims.sub !== previous.identity.sub || JSON.stringify(audience) !== JSON.stringify(previous.oidcAudience)
          || claims.auth_time !== undefined && claims.auth_time !== previous.authTime)) {
          throw protocolError('gateway_identity_changed', 'OIDC refresh identity changed')
        }
        session.oidcAudience = audience
        if (claims.auth_time !== undefined) session.authTime = claims.auth_time
      }
      const info = await gatewayJSON(this.fetch, descriptor.userInfoEndpoint, { headers: { authorization: `Bearer ${session.accessToken}`, accept: 'application/json' } })
      session.identity = oidcLlmIdentity(info)
      if (claims && claims.sub !== session.identity.sub || previous && previous.identity.sub !== session.identity.sub) throw protocolError('gateway_identity_changed', 'UserInfo subject does not match the authorization')
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
      if (descriptor.protocol === 'oidc-llm-draft-0.1' && (session.clientId !== descriptor.clientId || session.identityMode !== descriptor.identityMode
        || !Array.isArray(session.scopes) || descriptor.scopes.some(scope => !session.scopes.includes(scope))
        || session.scopes.some(scope => !descriptor.scopes.includes(scope))
        || descriptor.identityMode === 'oidc' && typeof session.oidcNonce !== 'string')) return undefined
      return session
    }

    async saveSession(profile, session, epoch = this.accountEpoch(profile)) {
      if (!profile.auth) return super.saveSession(profile, session, epoch)
      return this.writeCredentials(profile, epoch, async () => {
        await this.ctx.credentials.set(sessionRef(profile), JSON.stringify(session))
        this.invalidateGatewayCalls(profile)
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
      let next, received
      try {
        const raw = await tokenRequest(this.fetch, descriptor, { grant_type: 'refresh_token', client_id: saved.clientId, refresh_token: saved.refreshToken })
        received = raw
        if (descriptor.protocol === 'oidc-llm-draft-0.1') {
          next = { ...saved, ...oidcLlmToken(raw, descriptor, this.now, saved) }
          await this.gatewayIdentity(profile, descriptor, raw, next, saved)
        } else next = { ...saved, ...liteLLMToken(raw, this.now) }
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
        else if (descriptor.protocol === 'oidc-llm-draft-0.1' && typeof received?.refresh_token === 'string') await this.revokeGateway(profile, descriptor, { ...saved, refreshToken: received.refresh_token })
        if (cause.oauthError === 'invalid_grant' || cause.oauthError === 'invalid_client' || cause.code === 'gateway_identity_changed'
          || descriptor.protocol === 'oidc-llm-draft-0.1' && received) {
          await this.writeCredentials(profile, epoch, async () => {
            await this.gatewayCurrent(profile, saved, epoch)
            await this.ctx.credentials.unset(sessionRef(profile))
            this.invalidateGatewayCalls(profile)
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
      if (!accessTokenNeedsRefresh(session, this.now)) return session
      try { return await this.refresh(profile, session) }
      catch (cause) {
        // Brief outages must not discard a still-valid access token; expired tokens stop.
        if ((cause.code === 'gateway_unavailable' || cause.status === 429 || cause.status >= 500) && session.expiresAt > seconds(this)) return this.gatewayCurrent(profile, session, epoch)
        throw cause
      }
    }

    async modelAuthorization(profileID, expectedBaseURL) {
      const profile = this.profile(profileID), epoch = this.accountEpoch(profile)
      if (!profile.auth || typeof expectedBaseURL !== 'string') return false
      const descriptor = await this.discover(profile)
      if (expectedBaseURL !== descriptor.baseURL) return false
      const session = await this.activeSession(profile)
      if (!session) return false
      await this.gatewayCurrent(profile, session, epoch)
      return true
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

    async authorizedFetch(profileID, endpoint, init = {}, authorization = {}) {
      const retryUnauthorized = authorization.retryUnauthorized === true
      if (retryUnauthorized && init.body != null && typeof init.body !== 'string') throw new TypeError('Authorization retry requires a buffered text request body')
      const profile = this.profile(profileID)
      if (!profile.auth) return super.authorizedFetch(profileID, endpoint, init)
      const epoch = this.accountEpoch(profile), descriptor = await this.discover(profile)
      const target = new URL(endpoint)
      // Host-only model and own-account routes, never key administration or arbitrary origins.
      const modelBase = new URL(`${descriptor.baseURL}/`)
      if (target.username || target.password || target.hash || target.origin !== modelBase.origin || !(target.href === descriptor.userInfoEndpoint || target.pathname.startsWith(modelBase.pathname))) throw protocolError('oidc_authorized_origin_denied', 'Gateway token destination is not an authorized resource')
      const scope = await this.createGatewayScope(profileID)
      const lease = scope.open(init.signal ?? AbortSignal.timeout(20_000))
      let response
      try {
        let session = await this.activeSession(profile)
        lease.assertCurrent()
        if (!session) throw protocolError('oidc_login_required', 'Gateway sign-in is required')
        const request = current => this.fetch(target.href, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), authorization: `Bearer ${current.accessToken}` }, redirect: 'error', signal: lease.signal })
        response = await request(session)
        // Reads recover automatically. Trusted Host services may explicitly opt
        // in for replayable calls; model generation does not opt in.
        if (response.status === 401 && (retryUnauthorized || ['GET', 'HEAD'].includes((init.method ?? 'GET').toUpperCase()))) {
          await response.body?.cancel()
          session = await this.refresh(profile, session)
          lease.assertCurrent()
          response = await request(session)
        }
        await this.gatewayCurrent(profile, session, epoch)
        lease.assertCurrent()
        return scopedResponse(response, lease)
      } catch (cause) {
        lease.close()
        await response?.body?.cancel().catch(() => {})
        throw cause
      }
    }

    async modelResourceFetch(profileID, relativePath, options = {}) {
      const profile = this.profile(profileID)
      if (!profile.auth) return super.modelResourceFetch(profileID, relativePath, options)
      validateResourceRead(relativePath, options)
      const epoch = this.accountEpoch(profile), revision = this.gatewayRevisions.get(profileID) ?? 0
      const descriptor = await this.discover(profile)
      const response = await this.authorizedFetch(profileID, `${descriptor.baseURL}${relativePath}`, {
        method: 'GET', headers: { accept: 'application/json' },
        signal: AbortSignal.any([AbortSignal.timeout(20_000), ...(options.signal ? [options.signal] : [])]),
      })
      return bufferResourceResponse(response, () => {
        if (epoch !== this.accountEpoch(profile) || revision !== (this.gatewayRevisions.get(profileID) ?? 0)) throw protocolError('oidc_login_cancelled', 'Gateway account changed during resource request')
      })
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
        if (models.some(model => model.type === 'unknown')) result.issues.push('model_types_unresolved')
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
      try {
        if (descriptor.protocol !== 'oidc-llm-draft-0.1') await revokeLiteLLM(this.fetch, descriptor, session)
        else {
          const response = await this.fetch(descriptor.revocationEndpoint, {
            method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: session.refreshToken, token_type_hint: 'refresh_token', client_id: session.clientId }),
            redirect: 'error', signal: AbortSignal.timeout(5_000),
          })
          await response.body?.cancel()
          if (response.status !== 200) throw protocolError('gateway_revocation_failed', 'Remote revocation was not confirmed')
        }
      }
      catch { this.ctx.logger.warn('Gateway refresh revocation was not confirmed; local logout still removes access') }
    }

    async logout(profileID) {
      const profile = this.profile(profileID)
      if (!profile.auth) return super.logout(profileID)
      this.accountEpochs.set(profileID, this.accountEpoch(profile) + 1)
      this.invalidateGatewayCalls(profile)
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
