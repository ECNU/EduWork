import { createHash, createPublicKey, randomBytes, randomUUID, timingSafeEqual, verify as verifySignature } from 'node:crypto'
import { emptyResources, normalizeResourceModels } from './resources.js'
import { DEFAULT_CREDENTIAL_REF, legacyCredentialRefs } from './profile.js'
import { bufferResourceResponse, validateResourceRead } from './model-resource-transport.js'

const FLOW_TTL_MS = 10 * 60 * 1000
const MAX_PENDING_FLOWS = 32
const CLOCK_SKEW_SECONDS = 60
const ACCESS_REFRESH_SECONDS = 90
const MAX_RESPONSE_BYTES = 1024 * 1024
export const OIDC_CALLBACK_PATH = '/oauth/callback'

function base64url(bytes) {
  return Buffer.from(bytes).toString('base64url')
}

function decodePart(value, label) {
  try { return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) }
  catch { throw publicError('oidc_id_token_invalid', `${label} is not valid JSON`) }
}

function publicError(code, message, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause })
  error.code = code
  return error
}

async function responseJSON(response, stage) {
  const declared = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw publicError(stage, `${stage}: response exceeds ${MAX_RESPONSE_BYTES} bytes`)
  let bytes
  try { bytes = Buffer.from(await response.arrayBuffer()) }
  catch (cause) { throw publicError(stage, `${stage}: unable to read response`, cause) }
  if (bytes.byteLength > MAX_RESPONSE_BYTES) throw publicError(stage, `${stage}: response exceeds ${MAX_RESPONSE_BYTES} bytes`)
  let value
  try { value = JSON.parse(bytes.toString('utf8')) }
  catch (cause) { throw publicError(stage, `${stage}: response is not JSON`, cause) }
  if (!response.ok) {
    const detail = typeof value?.error === 'string' ? value.error : `HTTP ${response.status}`
    const error = publicError(stage, `${stage}: ${detail}`)
    error.status = response.status
    error.oauthError = value?.error
    throw error
  }
  return value
}

function isLoopback(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

/** OIDC metadata endpoints may use origins distinct from the issuer over HTTPS. */
function discoveredEndpoint(value, profile, label, optional = false) {
  if (optional && (value === undefined || value === '')) return ''
  if (typeof value !== 'string' || value === '') throw publicError('oidc_discovery_invalid', `OIDC discovery is missing ${label}`)
  let endpoint
  try { endpoint = new URL(value) }
  catch (cause) { throw publicError('oidc_discovery_invalid', `OIDC ${label} is not an absolute URL`, cause) }
  const issuerURL = new URL(profile.oidc.issuer)
  const secure = endpoint.protocol === 'https:'
  const localDevelopment = issuerURL.protocol === 'http:' && isLoopback(issuerURL.hostname)
    && endpoint.protocol === 'http:' && isLoopback(endpoint.hostname)
  const explicitlyAllowedDevelopment = profile.allowInsecureDevelopment === true
    && typeof profile.insecureDevelopmentOrigin === 'string'
    && issuerURL.origin === profile.insecureDevelopmentOrigin
    && endpoint.protocol === 'http:'
    && endpoint.origin === profile.insecureDevelopmentOrigin
  if ((!secure && !localDevelopment && !explicitlyAllowedDevelopment) || endpoint.username || endpoint.password || endpoint.hash) {
    throw publicError('oidc_discovery_invalid', `OIDC ${label} must be HTTPS, loopback HTTP, or the profile's exact development HTTP origin`)
  }
  return endpoint.toString()
}

function sessionRef(profile) {
  return `DSH_OIDC_${profile.id.toUpperCase().replace(/-/g, '_')}_SESSION`
}

function resourceBinding(profile) {
  return profile.keyBinding ? {
    managementBaseURL: profile.keyBinding.baseURL, runtimeBaseURL: profile.provider.baseURL,
    providerID: profile.provider.id, credentialRef: profile.keyBinding.credentialRef,
  } : null
}

function credentialHash(value) {
  return typeof value === 'string' && value ? createHash('sha256').update(value).digest('hex') : ''
}

function sameResourceBinding(left, right, ignoreRef = false) {
  return Boolean(left && right && ['managementBaseURL', 'runtimeBaseURL', 'providerID', ...(ignoreRef ? [] : ['credentialRef'])]
    .every(key => left[key] === right[key]))
}

function nowSeconds(now) {
  return Math.floor(now() / 1000)
}

function presentationText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function account(profile, session, credentialReady, credentialState = '') {
  return {
    profileID: profile.id,
    displayName: profile.displayName,
    organization: profile.organization,
    state: session ? (credentialReady || !profile.keyBinding ? 'connected' : 'authenticated') : 'signed_out',
    ...(session?.identity?.name ? { userName: session.identity.name } : {}),
    ...(session?.identity?.affiliation ? { affiliation: session.identity.affiliation } : {}),
    ...(session?.expiresAt ? { accessExpiresAt: new Date(session.expiresAt * 1000).toISOString() } : {}),
    credentialRef: profile.keyBinding?.credentialRef ?? '',
    credentialReady,
    ...(credentialState ? { credentialState } : {}),
    capabilities: Array.isArray(session?.capabilities) ? session.capabilities : [],
  }
}

function runtimeModel(model) {
  return {
    id: String(model?.id ?? ''),
    ...(model?.name ? { name: String(model.name) } : {}),
    ...(model?.upstreamModelID ? { upstreamModelID: String(model.upstreamModelID) } : {}),
    ...(model?.contextWindow ? { contextWindow: model.contextWindow } : {}),
    ...(model?.maxTokens ? { maxTokens: model.maxTokens } : {}),
    ...(Array.isArray(model?.input) ? { input: [...model.input] } : {}),
    ...(typeof model?.reasoning === 'boolean' ? { reasoning: model.reasoning } : {}),
    ...(model?.defaultReasoningEffort ? { defaultReasoningEffort: String(model.defaultReasoningEffort) } : {}),
    ...(model?.reasoningEfforts === false ? { reasoningEfforts: false } : {}),
    ...(model?.reasoningEfforts && typeof model.reasoningEfforts === 'object' ? { reasoningEfforts: { ...model.reasoningEfforts } } : {}),
    ...(model?.compat && typeof model.compat === 'object' ? { compat: { ...model.compat } } : {}),
  }
}

function runtimeProjection(runtime = {}, fallback = {}) {
  return {
    displayName: String(runtime.displayName ?? fallback.displayName ?? ''),
    ...(runtime.modelSource ? { modelSource: String(runtime.modelSource) } : {}),
    ...(runtime.reasoning ? { reasoning: String(runtime.reasoning) } : {}),
    ...(runtime.defaultContextWindow ? { defaultContextWindow: runtime.defaultContextWindow } : {}),
    ...(runtime.defaultMaxTokens ? { defaultMaxTokens: runtime.defaultMaxTokens } : {}),
    ...(runtime.compat && typeof runtime.compat === 'object' ? { compat: { ...runtime.compat } } : {}),
    models: Array.isArray(runtime.models) ? runtime.models.map(runtimeModel) : [],
  }
}

function profileManagement(profiles) {
  const rows = [...profiles.values()].map(profile => ({
    id: profile.id, displayName: profile.displayName, organization: profile.organization,
    baseURL: profile.provider?.baseURL || profile.auth?.discoveryUrl || profile.oidc.issuer, builtIn: true, configured: true, enabled: true,
    providerID: profile.provider?.id ?? '',
    runtime: runtimeProjection({ ...profile.provider, modelSource: profile.provider?.modelSource ?? 'none' }, profile.provider),
  }))
  return {
    schemaVersion: 'dsh-oidc/management/v1alpha1', mode: 'profile',
    activeProfileID: rows[0]?.id ?? '', restartRequired: false,
    capabilities: { manageProfiles: false, manageModels: false, restart: false }, profiles: rows,
  }
}

function unsupportedManagement() {
  throw publicError('oidc_management_unsupported', 'this dsh-oidc backend does not support mutable enterprise configuration')
}

function loopbackBaseURL(config, webServer) {
  if (config.publicBaseURL !== undefined) {
    throw new Error('dsh-oidc Web callback origin is fixed to 127.0.0.1 and does not accept publicBaseURL')
  }
  if (webServer?.host !== '127.0.0.1') {
    throw new Error('dsh-oidc Web backend requires the DSH WebServer host to be exactly 127.0.0.1')
  }
  const port = Number(webServer.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('dsh-oidc Web backend requires a valid DSH WebServer port')
  }
  return `http://127.0.0.1:${port}`
}

function normalizeReturnPath(raw, callbackBaseURL) {
  if (raw === undefined || raw === '') return '/'
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) throw new Error('dsh-oidc returnPath must be a same-origin absolute path')
  const target = new URL(raw, callbackBaseURL)
  if (target.origin !== new URL(callbackBaseURL).origin || target.username || target.password || target.hash) {
    throw new Error('dsh-oidc returnPath must stay on the loopback callback origin')
  }
  return `${target.pathname}${target.search}`
}

function singleQueryParameter(url, name, required = false) {
  const values = url.searchParams.getAll(name)
  if (values.length > 1) throw publicError('oidc_callback_invalid', `OIDC callback repeats ${name}`)
  const value = values[0] ?? ''
  if (required && value === '') throw publicError('oidc_callback_invalid', `OIDC callback has no ${name}`)
  return value
}

function discoveryURL(issuer) {
  return `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`
}

function equalText(left, right) {
  const a = Buffer.from(String(left))
  const b = Buffer.from(String(right))
  return a.byteLength === b.byteLength && timingSafeEqual(a, b)
}

function verifyAccessTokenHash(accessToken, claim) {
  const expected = base64url(createHash('sha256').update(accessToken).digest().subarray(0, 16))
  return equalText(expected, claim)
}

export class WebOidcBackend {
  constructor(ctx, profiles, config = {}, options = {}) {
    this.ctx = ctx
    this.profiles = profiles
    this.config = config
    this.fetch = options.fetch ?? fetch
    this.updateProvider = options.updateProvider ?? (() => {})
    this.accountChanged = options.accountChanged ?? (() => {})
    if (options.authorizedOrigins !== undefined && (!Array.isArray(options.authorizedOrigins) || options.authorizedOrigins.length > 64)) throw new Error('authorizedOrigins must be a bounded origin array')
    this.authorizedOrigins = (options.authorizedOrigins ?? []).map(value => {
      const url = new URL(value)
      if (url.origin !== value || url.protocol !== 'https:') throw new Error('authorizedOrigins must contain exact HTTPS origins')
      return value
    })
    this.resourceStates = new Map()
    this.resourceFlights = new Map()
    this.refreshFlights = new Map()
    this.accountEpochs = new Map()
    this.credentialWrites = new Map()
    this.reviewedProfiles = new Map(profiles)
    this.now = options.now ?? Date.now
    this.flows = new Map()
    this.discovery = new Map()
    if (options.transport === 'desktop') return
    this.callbackBaseURL = loopbackBaseURL(config, ctx.webServer)
    this.returnPath = normalizeReturnPath(config.returnPath, this.callbackBaseURL)
    this.callbackPath = OIDC_CALLBACK_PATH
    this.redirectURI = `${this.callbackBaseURL}${this.callbackPath}`
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: this.callbackPath,
      handler: (request, response) => this.callback(request, response),
    }), 'dsh-oidc: web callback')
  }

  profile(id) {
    const profile = this.profiles.get(id)
    if (!profile) throw publicError('oidc_profile_unknown', `unknown OIDC profile ${id}`)
    return profile
  }

  async discover(profile) {
    const cached = this.discovery.get(profile.id)
    if (cached) return cached
    let response
    try {
      response = await this.fetch(discoveryURL(profile.oidc.issuer), {
        headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000),
      })
    } catch (cause) {
      throw publicError('oidc_discovery_failed', 'unable to read OIDC discovery metadata', cause)
    }
    const raw = await responseJSON(response, 'oidc_discovery_failed')
    if (raw.issuer !== profile.oidc.issuer) throw publicError('oidc_discovery_invalid', 'OIDC issuer does not exactly match the configured profile')
    if (!Array.isArray(raw.code_challenge_methods_supported) || !raw.code_challenge_methods_supported.includes('S256')) {
      throw publicError('oidc_discovery_invalid', 'OIDC provider does not advertise PKCE S256')
    }
    if (Array.isArray(raw.id_token_signing_alg_values_supported) && !raw.id_token_signing_alg_values_supported.includes('RS256')) {
      throw publicError('oidc_discovery_invalid', 'OIDC provider does not advertise RS256 ID Tokens')
    }
    const result = Object.freeze({
      issuer: raw.issuer,
      authorizationEndpoint: discoveredEndpoint(raw.authorization_endpoint, profile, 'authorization_endpoint'),
      tokenEndpoint: discoveredEndpoint(raw.token_endpoint, profile, 'token_endpoint'),
      userInfoEndpoint: discoveredEndpoint(raw.userinfo_endpoint, profile, 'userinfo_endpoint'),
      jwksURI: discoveredEndpoint(raw.jwks_uri, profile, 'jwks_uri'),
      revocationEndpoint: discoveredEndpoint(raw.revocation_endpoint, profile, 'revocation_endpoint', true),
    })
    this.discovery.set(profile.id, result)
    return result
  }

  async begin(profileID) {
    const profile = this.profile(profileID)
    const discovery = await this.discover(profile)
    this.pruneFlows()
    if (this.flows.size >= MAX_PENDING_FLOWS) throw publicError('oidc_flow_limit', 'too many pending OIDC login attempts')
    const { authorizationURL } = await this.createAuthorization(profile, discovery, this.redirectURI)
    return { mode: 'redirect', authorizationURL }
  }

  createAuthorization(profile, discovery, redirectURI) {
    const state = base64url(randomBytes(32))
    const nonce = base64url(randomBytes(32))
    const verifier = base64url(randomBytes(48))
    const challenge = base64url(createHash('sha256').update(verifier).digest())
    const flow = { profileID: profile.id, nonce, verifier, redirectURI, createdAt: this.now(), epoch: this.accountEpoch(profile) }
    this.flows.set(state, flow)
    const target = new URL(discovery.authorizationEndpoint)
    for (const [key, value] of Object.entries({
      response_type: 'code', client_id: profile.oidc.clientId, redirect_uri: redirectURI,
      scope: profile.oidc.scopes.join(' '), state, nonce, code_challenge: challenge,
      code_challenge_method: 'S256',
    })) target.searchParams.set(key, value)
    return { state, flow, authorizationURL: target.toString() }
  }

  pruneFlows() {
    const threshold = this.now() - FLOW_TTL_MS
    for (const [state, flow] of this.flows) if (flow.createdAt < threshold) this.flows.delete(state)
  }

  async callback(request, response) {
    const requested = new URL(request.url ?? this.callbackPath, this.callbackBaseURL)
    let outcome = 'error'
    let profileID = ''
    try {
      if (requested.origin !== new URL(this.callbackBaseURL).origin || requested.pathname !== this.callbackPath) throw publicError('oidc_callback_invalid', 'OIDC callback URL is invalid')
      const state = singleQueryParameter(requested, 'state', true)
      const flow = this.flows.get(state)
      this.flows.delete(state)
      if (!flow || flow.createdAt < this.now() - FLOW_TTL_MS) throw publicError('oidc_callback_invalid', 'OIDC login state is missing or expired')
      profileID = flow.profileID
      const profile = this.profile(flow.profileID)
      const session = await this.exchangeAuthorization(requested, flow)
      await this.saveSession(profile, session, flow.epoch)
      const status = await this.reconcile(profile.id, { allowProvision: false })
      this.accountChanged(status)
      outcome = status.state === 'connected' ? 'connected' : 'credential-required'
    } catch (cause) {
      this.ctx.logger.warn('OIDC callback failed', { code: cause?.code ?? 'oidc_callback_failed' })
      outcome = cause?.code ?? 'oidc_callback_failed'
    }
    const target = new URL(this.returnPath, this.callbackBaseURL)
    target.searchParams.set('dsh_oidc', outcome)
    if (profileID) target.searchParams.set('profile', profileID)
    response.writeHead(302, { location: target.toString(), 'cache-control': 'no-store' })
    response.end()
  }

  async exchangeAuthorization(requested, flow) {
    const profile = this.profile(flow.profileID)
    if (singleQueryParameter(requested, 'error')) throw publicError('oidc_authorization_rejected', 'OIDC authorization was rejected')
    const code = singleQueryParameter(requested, 'code', true)
    const issuer = singleQueryParameter(requested, 'iss')
    if (issuer && !equalText(issuer, profile.oidc.issuer)) throw publicError('oidc_callback_invalid', 'OIDC authorization response issuer is invalid')
    return this.exchangeCode(profile, await this.discover(profile), code, flow.verifier, flow.nonce, flow.redirectURI)
  }

  async exchangeCode(profile, discovery, code, verifier, nonce, redirectURI = this.redirectURI) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code', client_id: profile.oidc.clientId,
      code, redirect_uri: redirectURI, code_verifier: verifier,
    })
    const response = await this.fetch(discovery.tokenEndpoint, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body, signal: AbortSignal.timeout(20_000),
    })
    const token = await responseJSON(response, 'oidc_token_request_failed')
    if (typeof token.access_token !== 'string' || typeof token.id_token !== 'string' || token.token_type?.toLowerCase() !== 'bearer') {
      throw publicError('oidc_token_invalid', 'OIDC token response is incomplete')
    }
    const expiresIn = token.expires_in === undefined ? 3600 : Number(token.expires_in)
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) throw publicError('oidc_token_invalid', 'OIDC token expiry is invalid')
    const claims = await this.verifyIDToken(profile, discovery, token.id_token, nonce, token.access_token)
    const userInfo = await this.userInfo(discovery.userInfoEndpoint, token.access_token)
    if (!equalText(userInfo.sub, claims.sub)) throw publicError('oidc_userinfo_invalid', 'OIDC UserInfo subject does not match ID Token')
    const userName = presentationText(userInfo.name) || presentationText(userInfo.sub)
    const affiliation = presentationText(userInfo.affiliation)
    return {
      issuer: profile.oidc.issuer,
      clientId: profile.oidc.clientId,
      accessToken: token.access_token,
      refreshToken: typeof token.refresh_token === 'string' ? token.refresh_token : '',
      expiresAt: nowSeconds(this.now) + Math.max(60, expiresIn),
      identity: {
        sub: claims.sub,
        name: userName,
        ...(affiliation ? { affiliation } : {}),
      },
      capabilities: [],
    }
  }

  async verifyIDToken(profile, discovery, raw, expectedNonce, accessToken, { refresh = false } = {}) {
    if (typeof raw !== 'string') throw publicError('oidc_id_token_invalid', 'OIDC ID Token is missing')
    const parts = raw.split('.')
    if (parts.length !== 3) throw publicError('oidc_id_token_invalid', 'OIDC ID Token is malformed')
    const header = decodePart(parts[0], 'ID Token header')
    const claims = decodePart(parts[1], 'ID Token claims')
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid === '') throw publicError('oidc_id_token_invalid', 'OIDC ID Token must use RS256 with kid')
    const keysResponse = await this.fetch(discovery.jwksURI, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(20_000) })
    const jwks = await responseJSON(keysResponse, 'oidc_jwks_failed')
    const candidates = Array.isArray(jwks.keys) ? jwks.keys.filter(key => (
      key.kid === header.kid && key.kty === 'RSA' && (key.use === undefined || key.use === 'sig')
      && (key.alg === undefined || key.alg === 'RS256')
    )) : []
    if (candidates.length !== 1) throw publicError('oidc_id_token_invalid', 'OIDC signing key was not uniquely identified')
    let key
    try { key = createPublicKey({ key: candidates[0], format: 'jwk' }) }
    catch (cause) { throw publicError('oidc_id_token_invalid', 'OIDC signing key is invalid', cause) }
    const valid = verifySignature('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'))
    if (!valid) throw publicError('oidc_id_token_invalid', 'OIDC ID Token signature is invalid')
    const now = nowSeconds(this.now)
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    const audienceValid = audience.includes(profile.oidc.clientId)
      && audience.every(value => typeof value === 'string' && value !== '')
      && new Set(audience).size === audience.length
      && (audience.length === 1 || claims.azp === profile.oidc.clientId)
      && (claims.azp === undefined || claims.azp === profile.oidc.clientId)
    const nonceValid = refresh && claims.nonce === undefined || equalText(claims.nonce, expectedNonce)
    if (claims.iss !== profile.oidc.issuer || !audienceValid || typeof claims.sub !== 'string' || claims.sub === '' || !nonceValid) {
      throw publicError('oidc_id_token_invalid', 'OIDC ID Token identity claims are invalid')
    }
    if (!Number.isFinite(claims.exp) || !Number.isFinite(claims.iat)
      || claims.exp < now - CLOCK_SKEW_SECONDS || claims.iat > now + CLOCK_SKEW_SECONDS
      || (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > now + CLOCK_SKEW_SECONDS))) {
      throw publicError('oidc_id_token_invalid', 'OIDC ID Token time claims are invalid')
    }
    if (claims.at_hash !== undefined && (typeof claims.at_hash !== 'string' || !verifyAccessTokenHash(accessToken, claims.at_hash))) {
      throw publicError('oidc_id_token_invalid', 'OIDC ID Token access-token hash is invalid')
    }
    return claims
  }

  async userInfo(endpoint, accessToken) {
    const response = await this.fetch(endpoint, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' }, signal: AbortSignal.timeout(20_000),
    })
    const result = await responseJSON(response, 'oidc_userinfo_failed')
    if (typeof result.sub !== 'string' || result.sub === '') throw publicError('oidc_userinfo_invalid', 'OIDC UserInfo has no subject')
    return result
  }

  async loadSession(profile) {
    const epoch = this.accountEpoch(profile)
    return this.writeCredentials(profile, epoch, async () => {
      const record = await this.ctx.credentials.resolve(sessionRef(profile))
      if (typeof record?.value !== 'string') return undefined
      let session
      try { session = JSON.parse(record.value) } catch { await this.ctx.credentials.unset(sessionRef(profile)); return undefined }
      if (session?.issuer !== profile.oidc.issuer || session?.clientId !== profile.oidc.clientId
        || typeof session?.accessToken !== 'string' || !Number.isFinite(session?.expiresAt)
        || typeof session?.identity?.sub !== 'string') {
        await this.clearOwnedCredential(profile, session)
        await this.ctx.credentials.unset(sessionRef(profile))
        return undefined
      }
      const binding = resourceBinding(profile)
      if (binding) {
        const current = await this.ctx.credentials.resolve(binding.credentialRef)
        if (!sameResourceBinding(session.resourceBinding, binding)) {
          const oldRef = session.resourceBinding?.credentialRef
          const renameOnly = binding.credentialRef === DEFAULT_CREDENTIAL_REF
            && legacyCredentialRefs(profile).includes(oldRef)
            && sameResourceBinding(session.resourceBinding, binding, true)
          const old = renameOnly ? await this.ctx.credentials.resolve(oldRef) : undefined
          if (renameOnly && !current?.value && old?.value
            && ![...this.profiles.values()].some(value => value.id !== profile.id && value.keyBinding?.credentialRef === oldRef)
            && (session.runtimeCredentialHash === undefined || session.runtimeCredentialHash === credentialHash(old.value))) {
            await this.ctx.credentials.set(binding.credentialRef, old.value)
            session.runtimeCredentialHash = credentialHash(old.value)
            await this.ctx.credentials.unset(oldRef)
          } else {
            // A rename never adopts or overwrites an already populated target.
            // Changed endpoints retain identity but require a fresh binding.
            if (!renameOnly) await this.clearOwnedCredential(profile, session)
            session.runtimeCredentialHash = ''
          }
          session.resourceBinding = binding
        } else if (session.runtimeCredentialHash === undefined) {
          // Only unambiguous pre-fingerprint sessions may adopt their old key.
          // New logins always save an explicit empty hash until binding succeeds.
          session.runtimeCredentialHash = this.uniqueCredentialRef(profile) ? credentialHash(current?.value) : ''
        }
      }
      const encoded = JSON.stringify(session)
      if (encoded !== record.value) await this.ctx.credentials.set(sessionRef(profile), encoded)
      return session
    })
  }

  uniqueCredentialRef(profile) {
    return [...this.profiles.values()].filter(value => value.keyBinding?.credentialRef === profile.keyBinding?.credentialRef).length === 1
  }

  async boundCredential(profile, session) {
    if (!session?.runtimeCredentialHash || !sameResourceBinding(session.resourceBinding, resourceBinding(profile))) return undefined
    const credential = await this.ctx.credentials.resolve(profile.keyBinding.credentialRef)
    return credentialHash(credential?.value) === session.runtimeCredentialHash ? credential : undefined
  }

  async resolveBoundCredential(profileID, expected) {
    const profile = this.profiles.get(profileID)
    if (!profile?.keyBinding || !expected || expected.credentialRef !== profile.keyBinding.credentialRef
      || expected.runtimeBaseURL !== profile.provider.baseURL) return undefined
    const epoch = this.accountEpoch(profile)
    const credential = await this.boundCredential(profile, await this.loadSession(profile))
    return epoch === this.accountEpoch(profile) ? credential : undefined
  }

  async clearOwnedCredential(profile, session) {
    if (!profile.keyBinding || session?.resourceBinding?.credentialRef !== profile.keyBinding.credentialRef) return
    const credential = await this.ctx.credentials.resolve(profile.keyBinding.credentialRef)
    const proven = session.runtimeCredentialHash ? credentialHash(credential?.value) === session.runtimeCredentialHash
      : session.runtimeCredentialHash === undefined && this.uniqueCredentialRef(profile)
    if (proven) await this.ctx.credentials.unset(profile.keyBinding.credentialRef)
  }

  setRuntimeCredential(profile, session, value, epoch = this.accountEpoch(profile)) {
    return this.writeCredentials(profile, epoch, async () => {
      const record = await this.ctx.credentials.resolve(sessionRef(profile))
      const saved = record?.value ? JSON.parse(record.value) : undefined
      if (!saved || saved.issuer !== session.issuer || saved.clientId !== session.clientId
        || saved.identity?.sub !== session.identity?.sub || !sameResourceBinding(saved.resourceBinding, resourceBinding(profile))) {
        throw publicError('oidc_login_cancelled', '账户状态已改变，请重新登录。')
      }
      if (value) await this.ctx.credentials.set(profile.keyBinding.credentialRef, value)
      else await this.clearOwnedCredential(profile, saved)
      saved.runtimeCredentialHash = credentialHash(value)
      await this.ctx.credentials.set(sessionRef(profile), JSON.stringify(saved))
    })
  }

  accountEpoch(profile) { return this.accountEpochs.get(profile.id) ?? 0 }

  writeCredentials(profile, epoch, operation) {
    // Serialize vault writes so logout clears even a write already in progress.
    // Network requests do not hold this queue; late replies cannot restore keys.
    const queue = profile.keyBinding?.credentialRef ?? sessionRef(profile)
    const write = (this.credentialWrites.get(queue) ?? Promise.resolve()).catch(() => {}).then(() => {
      if (epoch !== this.accountEpoch(profile)) throw publicError('oidc_login_cancelled', '账户状态已改变，请重新登录。')
      return operation()
    })
    this.credentialWrites.set(queue, write)
    void write.finally(() => { if (this.credentialWrites.get(queue) === write) this.credentialWrites.delete(queue) }).catch(() => {})
    return write
  }

  clearCredentials(profile, epoch) {
    return this.writeCredentials(profile, epoch, async () => {
      const record = await this.ctx.credentials.resolve(sessionRef(profile))
      let saved
      try { saved = JSON.parse(record?.value) } catch { /* Malformed records cannot prove key ownership. */ }
      await this.clearOwnedCredential(profile, saved)
      await this.ctx.credentials.unset(sessionRef(profile))
    })
  }

  saveSession(profile, session, epoch = this.accountEpoch(profile)) {
    return this.writeCredentials(profile, epoch, () => this.ctx.credentials.set(sessionRef(profile), JSON.stringify({ ...session,
      runtimeCredentialHash: session.runtimeCredentialHash ?? '', resourceBinding: resourceBinding(profile) })))
  }

  refresh(profile, session) {
    if (!this.refreshFlights.has(profile.id)) {
      const flight = this.performRefresh(profile, session).finally(() => { if (this.refreshFlights.get(profile.id) === flight) this.refreshFlights.delete(profile.id) })
      this.refreshFlights.set(profile.id, flight)
    }
    return this.refreshFlights.get(profile.id)
  }

  async performRefresh(profile, session) {
    const epoch = this.accountEpoch(profile)
    const saved = await this.loadSession(profile)
    if (!saved) throw publicError('oidc_login_required', 'OIDC session is no longer available')
    if (saved && saved.accessToken !== session.accessToken && saved.expiresAt > nowSeconds(this.now) + ACCESS_REFRESH_SECONDS) return saved
    if (!session.refreshToken) throw publicError('oidc_login_required', 'OIDC session cannot be refreshed')
    const discovery = await this.discover(profile)
    const response = await this.fetch(discovery.tokenEndpoint, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: profile.oidc.clientId, refresh_token: session.refreshToken }),
      signal: AbortSignal.timeout(20_000),
    })
    let token
    try { token = await responseJSON(response, 'oidc_refresh_failed') }
    catch (cause) {
      if (cause.oauthError === 'invalid_grant') {
        await this.clearCredentials(profile, epoch)
        this.accountChanged(account(profile, undefined, false))
        throw publicError('oidc_login_required', 'OIDC refresh token is no longer valid', cause)
      }
      throw cause
    }
    if (typeof token.access_token !== 'string' || token.token_type?.toLowerCase() !== 'bearer') {
      throw publicError('oidc_refresh_failed', 'OIDC refresh response has no Bearer access token')
    }
    const expiresIn = token.expires_in === undefined ? 3600 : Number(token.expires_in)
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) throw publicError('oidc_refresh_failed', 'OIDC refresh expiry is invalid')
    const next = {
      ...session,
      accessToken: token.access_token,
      refreshToken: typeof token.refresh_token === 'string' ? token.refresh_token : session.refreshToken,
      expiresAt: nowSeconds(this.now) + Math.max(60, expiresIn),
    }
    await this.saveSession(profile, next, epoch)
    return next
  }

  async activeSession(profile) {
    const epoch = this.accountEpoch(profile)
    let session = await this.loadSession(profile)
    if (!session) return undefined
    if (session.expiresAt <= nowSeconds(this.now) + ACCESS_REFRESH_SECONDS) {
      if (!session.refreshToken) {
        await this.clearCredentials(profile, epoch)
        this.accountChanged(account(profile, undefined, false))
        return undefined
      }
      session = await this.refresh(profile, session)
    }
    return session
  }

  async status(profileID) {
    const profile = this.profile(profileID)
    const epoch = this.accountEpoch(profile)
    const session = await this.loadSession(profile)
    const credential = profile.keyBinding ? await this.boundCredential(profile, session) : undefined
    if (session && credential?.value && profile.provider?.modelSource === 'discovery' && !this.resourceStates.has(profileID)) {
      await this.resources(profileID)
    }
    if (epoch !== this.accountEpoch(profile)) return account(profile, undefined, false)
    return account(profile, session, typeof credential?.value === 'string' && credential.value !== '')
  }

  async authorized(profile, session, endpoint, init = {}) {
    const request = current => this.fetch(endpoint, {
      ...init,
      headers: { ...Object.fromEntries(new Headers(init.headers).entries()), authorization: `Bearer ${current.accessToken}`, accept: 'application/json' },
      redirect: 'error',
      signal: init.signal ?? AbortSignal.timeout(20_000),
    })
    let current = session
    let response = await request(current)
    if (response.status === 401 && current.refreshToken) {
      current = await this.refresh(profile, current)
      response = await request(current)
    }
    return { response, session: current }
  }

  async authorizedFetch(profileID, endpoint, init = {}) {
    const profile = this.profile(profileID)
    const target = new URL(endpoint)
    const allowed = new Set([
      new URL(profile.oidc.issuer).origin,
      ...(profile.keyBinding ? [new URL(profile.keyBinding.baseURL).origin] : []),
      ...this.authorizedOrigins,
    ])
    if (!allowed.has(target.origin) || target.username || target.password || target.hash) {
      throw publicError('oidc_authorized_origin_denied', 'authorized request must use a configured organization origin')
    }
    const session = await this.activeSession(profile)
    if (!session) throw publicError('oidc_login_required', 'organization sign-in is required')
    return (await this.authorized(profile, session, target.toString(), init)).response
  }

  /** Host-only read transport for optional account extensions. No business paths. */
  async modelResourceFetch(profileID, relativePath, options = {}) {
    const profile = this.profile(profileID), epoch = this.accountEpoch(profile)
    if (!profile.provider || !profile.keyBinding) throw publicError('oidc_resource_not_configured', 'Organization model resources are not configured')
    validateResourceRead(relativePath, options)
    const session = await this.activeSession(profile)
    const credential = await this.boundCredential(profile, session)
    if (!session || !credential?.value || epoch !== this.accountEpoch(profile)) throw publicError('oidc_login_required', 'Organization model sign-in is required')
    const response = await this.fetch(`${profile.provider.baseURL}${relativePath}`, {
      method: 'GET', headers: { authorization: `Bearer ${credential.value}`, accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(20_000), ...(options.signal ? [options.signal] : [])]),
    })
    // Complete the bounded body while the request signal is active. An extension
    // never receives a response belonging to a signed-out or replaced account.
    return bufferResourceResponse(response, async () => {
      const currentCredential = await this.ctx.credentials.resolve(profile.keyBinding.credentialRef)
      if (epoch !== this.accountEpoch(profile) || currentCredential?.value !== credential.value) throw publicError('oidc_login_cancelled', 'Organization account changed during resource request')
    })
  }

  async reconcile(profileID, options = {}) {
    const profile = this.profile(profileID)
    const epoch = this.accountEpoch(profile)
    let session = await this.activeSession(profile)
    if (!session) return account(profile, undefined, false)
    if (!profile.keyBinding) return account(profile, session, false, 'not_required')
    const bootstrapCall = await this.authorized(profile, session, `${profile.keyBinding.baseURL}/bootstrap`)
    session = bootstrapCall.session
    const bootstrap = await responseJSON(bootstrapCall.response, 'oidc_binding_bootstrap_failed')
    if (bootstrap.protocol_version !== undefined && !['worker.user-center.v1', 'worker-user-center/v1', 'eduwork-resources/v1'].includes(bootstrap.protocol_version)) {
      throw publicError('oidc_binding_invalid', '身份登录已完成，但模型资源服务的协议版本不受支持。请联系服务管理员检查接口版本。')
    }
    if (bootstrap.provider?.id !== profile.keyBinding.providerId) {
      throw publicError('oidc_binding_invalid', '身份登录已完成，但模型资源服务与配置中的 Provider ID 不一致。请检查企业配置文件。')
    }
    session = {
      ...session,
      capabilities: Array.isArray(bootstrap.capabilities) ? bootstrap.capabilities.filter(value => typeof value === 'string').slice(0, 256) : [],
    }
    await this.saveSession(profile, session, epoch)
    const runtime = bootstrap.runtime_credential ?? {}
    const state = String(runtime.status ?? '').toLowerCase()
    let operation = 'resolve'
    if (state === 'missing') {
      if (options.allowProvision !== true) {
        await this.setRuntimeCredential(profile, session, '', epoch)
        return account(profile, session, false, 'missing')
      }
      if (runtime.provisioning?.allowed === false) throw publicError('oidc_binding_denied', 'the organization does not allow credential provisioning')
      operation = 'provision'
    } else if (state === 'expired' || state === 'expiring') {
      operation = runtime.api_key_id ? 'renew' : 'resolve'
    } else if (state !== 'active') {
      await this.setRuntimeCredential(profile, session, '', epoch)
      return account(profile, session, false, state || 'unavailable')
    }
    const payload = { provider_id: profile.keyBinding.providerId }
    if (runtime.api_key_id) payload.api_key_id = runtime.api_key_id
    const bindingCall = await this.authorized(profile, session, `${profile.keyBinding.baseURL}/runtime-credential/${operation}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(operation === 'provision' || operation === 'renew' ? { 'idempotency-key': randomUUID() } : {}) },
      body: JSON.stringify(payload),
    })
    session = bindingCall.session
    const credential = await responseJSON(bindingCall.response, 'oidc_binding_failed')
    if (credential.provider_id !== profile.keyBinding.providerId) throw publicError('oidc_binding_invalid', 'runtime credential provider is invalid')
    if (typeof credential.api_key !== 'string' || credential.api_key === '' || credential.api_key.length > 16 * 1024) throw publicError('oidc_binding_invalid', 'runtime credential response has an invalid API key')
    await this.setRuntimeCredential(profile, session, credential.api_key, epoch)
    await this.resources(profileID)
    if (epoch !== this.accountEpoch(profile)) throw publicError('oidc_login_cancelled', '账户状态已改变，请重新登录。')
    const current = await this.resolveBoundCredential(profile.id, {
      credentialRef: profile.keyBinding.credentialRef, runtimeBaseURL: profile.provider.baseURL,
    })
    return account(profile, session, Boolean(current?.value), current ? credential.status ?? 'active' : 'replaced')
  }

  resources(profileID) {
    if (!this.resourceFlights.has(profileID)) {
      const flight = this.readResources(profileID).finally(() => { if (this.resourceFlights.get(profileID) === flight) this.resourceFlights.delete(profileID) })
      this.resourceFlights.set(profileID, flight)
    }
    return this.resourceFlights.get(profileID)
  }

  async readResources(profileID) {
    const profile = this.profile(profileID)
    const epoch = this.accountEpoch(profile)
    const result = emptyResources(profile)
    if (!profile.keyBinding) return result
    const session = await this.loadSession(profile)
    const credential = await this.boundCredential(profile, session)
    if (!credential?.value || epoch !== this.accountEpoch(profile)) return result
    const request = async path => responseJSON(await this.fetch(`${profile.provider.baseURL}/${path}`, {
      headers: { authorization: `Bearer ${credential.value}`, accept: 'application/json' },
      signal: AbortSignal.timeout(20_000), redirect: 'error',
    }), `oidc_resource_${path}_failed`)
    const operations = []
    if (profile.provider.modelSource === 'discovery') operations.push((async () => {
      try {
        const models = normalizeResourceModels(await request('models'), this.reviewedProfiles.get(profileID))
        if (epoch !== this.accountEpoch(profile) || (await this.ctx.credentials.resolve(profile.keyBinding.credentialRef))?.value !== credential.value) return
        const next = Object.freeze({ ...profile, provider: Object.freeze({ ...profile.provider, models }) })
        await this.updateProvider(next)
        this.profiles.set(profileID, next)
        result.models = models
      } catch { result.issues.push('models_unavailable') }
    })())
    await Promise.all(operations)
    if (epoch !== this.accountEpoch(profile)) return emptyResources(profile)
    this.resourceStates.set(profileID, result)
    return result
  }

  management() { return Promise.resolve(profileManagement(this.profiles)) }
  activate() { return unsupportedManagement() }
  configure() { return unsupportedManagement() }
  addCustom() { return unsupportedManagement() }
  updateCustom() { return unsupportedManagement() }
  removeProfile() { return unsupportedManagement() }
  configureModels() { return unsupportedManagement() }
  restart() { return unsupportedManagement() }

  async logout(profileID) {
    const profile = this.profile(profileID)
    const epoch = this.accountEpoch(profile) + 1
    this.accountEpochs.set(profileID, epoch)
    this.refreshFlights.delete(profileID)
    this.resourceFlights.delete(profileID)
    const session = await this.loadSession(profile)
    await this.clearCredentials(profile, epoch)
    this.resourceStates.delete(profileID)
    for (const [state, flow] of this.flows) if (flow.profileID === profileID) this.flows.delete(state)
    if (session) {
      try {
        const discovery = await this.discover(profile)
        if (discovery.revocationEndpoint) {
          const token = session.refreshToken || session.accessToken
          await this.fetch(discovery.revocationEndpoint, {
            method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token, client_id: profile.oidc.clientId }), signal: AbortSignal.timeout(10_000),
          })
        }
      } catch (cause) { this.ctx.logger.warn(cause instanceof Error ? cause : new Error(String(cause))) }
    }
    return account(profile, undefined, false)
  }
}

export class NativeOidcBackend {
  constructor(ctx, profiles) {
    this.ctx = ctx
    this.profiles = profiles
  }

  profile(id) {
    const profile = this.profiles.get(id)
    if (!profile) throw publicError('oidc_profile_unknown', `unknown OIDC profile ${id}`)
    return profile
  }

  service() {
    const service = this.ctx.get('enterpriseAccounts')
    if (!service) throw publicError('oidc_native_adapter_unavailable', 'native OIDC adapter is unavailable')
    return service
  }

  normalize(profile, status) {
    if (status.runtimeCredentialRef !== undefined && status.runtimeCredentialRef !== (profile.keyBinding?.credentialRef ?? '')) {
      throw publicError(
        'oidc_native_credential_ref_mismatch',
        `native OIDC adapter credential reference does not match Enterprise Profile ${profile.id}`,
      )
    }
    return {
      profileID: profile.id,
      displayName: status.displayName ?? profile.displayName,
      organization: status.organization ?? profile.organization,
      state: status.state ?? (status.credentialReady ? 'connected' : 'signed_out'),
      ...(status.userName ? { userName: status.userName } : {}),
      ...(status.affiliation ? { affiliation: status.affiliation } : {}),
      ...(status.accessExpiresAt ? { accessExpiresAt: status.accessExpiresAt } : {}),
      credentialRef: profile.keyBinding?.credentialRef ?? '',
      credentialReady: status.credentialReady === true,
      ...(status.credentialState ? { credentialState: status.credentialState } : {}),
      capabilities: Array.isArray(status.capabilities) ? status.capabilities : [],
    }
  }

  normalizeManagement(configuration) {
    const active = String(configuration?.activeInstitutionID ?? '')
    const institutions = Array.isArray(configuration?.institutions) ? configuration.institutions : []
    return {
      schemaVersion: 'dsh-oidc/management/v1alpha1', mode: 'native', activeProfileID: active,
      restartRequired: configuration?.restartRequired === true,
      capabilities: {
        manageProfiles: ['activate', 'configure', 'addCustom', 'updateCustom', 'removeInstitution'].every(method => typeof this.service()[method] === 'function'),
        manageModels: typeof this.service().configureCustomModels === 'function',
        restart: typeof this.service().restart === 'function',
      },
      profiles: institutions.map(institution => ({
        id: String(institution.id), displayName: String(institution.displayName), organization: String(institution.organization),
        baseURL: String(institution.baseURL), builtIn: institution.builtIn === true, configured: institution.configured === true,
        enabled: String(institution.id) === active, providerID: String(institution.providerID),
        runtime: runtimeProjection(institution.runtime, { displayName: institution.displayName }),
      })),
    }
  }

  async management() { return this.normalizeManagement(await this.service().configuration()) }
  async resources(profileID) {
    return emptyResources(this.profile(profileID))
  }
  async activate(profileID) { return this.normalizeManagement(await this.service().activate(profileID)) }
  async configure(profileID) { return this.normalizeManagement(await this.service().configure(profileID)) }
  async addCustom(baseURL) { return this.normalizeManagement(await this.service().addCustom(baseURL)) }
  async updateCustom(profileID, baseURL) { return this.normalizeManagement(await this.service().updateCustom(profileID, baseURL)) }
  async removeProfile(profileID) { return this.normalizeManagement(await this.service().removeInstitution(profileID)) }
  async configureModels(profileID, modelMode, models) {
    return this.normalizeManagement(await this.service().configureCustomModels(profileID, modelMode, models))
  }
  restart() { return this.service().restart() }

  async status(profileID) {
    const profile = this.profile(profileID)
    return this.normalize(profile, await this.service().status(profile.nativeInstitutionID))
  }

  async begin(profileID) {
    const profile = this.profile(profileID)
    const status = await this.service().login(profile.nativeInstitutionID, { allowProvision: false })
    return { mode: 'completed', status: this.normalize(profile, status) }
  }

  async reconcile(profileID, options = {}) {
    const profile = this.profile(profileID)
    const status = await this.service().reconcile(profile.nativeInstitutionID, { allowProvision: options.allowProvision === true })
    return this.normalize(profile, status)
  }

  async logout(profileID) {
    const profile = this.profile(profileID)
    return this.normalize(profile, await this.service().logout(profile.nativeInstitutionID))
  }
}

export { account, publicError, sessionRef }
