// Experimental draft 0.1. These wire rules are not a published standard.
import { protocolError } from './litellm-protocol.js'

const fail = message => { throw protocolError('gateway_discovery_invalid', message) }
const tokenText = value => typeof value === 'string' && value.length > 0 && value.length <= 65536
const includes = (raw, key, values) => {
  if (!Array.isArray(raw[key]) || values.some(value => !raw[key].includes(value))) fail(`oidc-llm discovery lacks required ${key}`)
}

function endpoint(value, profile, origin) {
  let url
  try { url = new URL(value) } catch { fail('oidc-llm metadata contains an invalid URL') }
  const development = profile.allowInsecureDevelopment && url.protocol === 'http:'
    && (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.origin === profile.insecureDevelopmentOrigin)
  if (typeof value !== 'string' || value.length > 2048 || (url.protocol !== 'https:' && !development)
    || url.username || url.password || url.search || url.hash || origin && url.origin !== origin) fail('oidc-llm URL is outside the configured trust boundary')
  return url
}

export function detectOidcLlm(raw, profile) {
  if (!profile.auth.experimentalOidcLlm) throw protocolError('gateway_protocol_unsupported', 'oidc-llm requires explicit experimental opt-in')
  if (raw.contract_version !== undefined) fail('Ambiguous gateway discovery contracts')
  const extension = raw.oidc_llm
  if (!extension || Array.isArray(extension) || extension.version !== '0.1') throw protocolError('gateway_protocol_unsupported', 'Unsupported oidc-llm draft version')
  const issuer = endpoint(raw.issuer, profile)
  if (profile.auth.expectedIssuer ? raw.issuer !== profile.auth.expectedIssuer : issuer.origin !== new URL(profile.auth.discoveryUrl).origin) fail('oidc-llm issuer does not match the configured trust anchor')
  // An OIDC well-known document has an issuer-location relationship, even with a pin.
  if (new URL(profile.auth.discoveryUrl).pathname.endsWith('/.well-known/openid-configuration')
    && profile.auth.discoveryUrl !== raw.issuer.replace(/\/+$/, '') + '/.well-known/openid-configuration') fail('OIDC discovery location does not match issuer')
  const resource = endpoint(extension.resource, profile)
  const identityMode = profile.auth.identityMode
  includes(extension, 'identity_modes_supported', ['oauth', identityMode])
  includes(extension, 'client_registration_methods_supported', ['static'])
  const scopes = identityMode === 'oidc'
    ? ['openid', 'profile', 'offline_access', 'llm:models:read', 'llm:invoke']
    : ['llm:profile', 'llm:models:read', 'llm:invoke']
  for (const [key, values] of Object.entries({
    response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'], scopes_supported: scopes,
  })) includes(raw, key, values)
  const result = {
    protocol: 'oidc-llm-draft-0.1', issuer: raw.issuer, resource: extension.resource,
    identityMode, clientId: profile.auth.clientId, scopes,
    requireResponseIssuer: raw.authorization_response_iss_parameter_supported === true,
  }
  for (const [key, wire] of Object.entries({ authorizationEndpoint: 'authorization_endpoint', tokenEndpoint: 'token_endpoint', revocationEndpoint: 'revocation_endpoint' })) {
    endpoint(raw[wire], profile)
    result[key] = raw[wire]
  }
  endpoint(raw.userinfo_endpoint, profile, resource.origin)
  endpoint(extension.api_base, profile, resource.origin)
  result.userInfoEndpoint = raw.userinfo_endpoint
  result.baseURL = extension.api_base.replace(/\/+$/, '')
  if (identityMode === 'oidc') {
    includes(raw, 'id_token_signing_alg_values_supported', ['RS256'])
    if (!Array.isArray(raw.subject_types_supported) || !raw.subject_types_supported.some(v => ['public', 'pairwise'].includes(v))) fail('OIDC subject type is missing')
    endpoint(raw.jwks_uri, profile)
    result.jwksURI = raw.jwks_uri
  }
  return Object.freeze(result)
}

export function oidcLlmToken(raw, descriptor, now, previous) {
  if (!tokenText(raw.access_token) || !tokenText(raw.refresh_token) || typeof raw.token_type !== 'string'
    || raw.token_type.toLowerCase() !== 'bearer' || !Number.isSafeInteger(raw.expires_in)
    || raw.expires_in <= 0 || raw.expires_in > 365 * 86400 || typeof raw.scope !== 'string') {
    throw protocolError('gateway_token_invalid', 'oidc-llm token response is incomplete or invalid')
  }
  const scopes = raw.scope.split(' ')
  const allowed = previous?.scopes ?? descriptor.scopes
  if (scopes.some(scope => !scope || !allowed.includes(scope)) || new Set(scopes).size !== scopes.length
    || descriptor.scopes.some(scope => !scopes.includes(scope))) {
    throw protocolError('gateway_scope_changed', 'oidc-llm granted scopes do not match the requested authorization')
  }
  // No unapproved 15-minute ceiling: honor the actual advertised TTL.
  return { accessToken: raw.access_token, refreshToken: raw.refresh_token, expiresAt: Math.floor(now() / 1000) + raw.expires_in, scopes, teamID: null }
}

export function oidcLlmIdentity(raw) {
  if (typeof raw.sub !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(raw.sub)) throw protocolError('oidc_userinfo_invalid', 'UserInfo has no valid subject')
  for (const key of ['name', 'preferred_username', 'picture', 'email']) {
    if (raw[key] !== undefined && typeof raw[key] !== 'string') throw protocolError('oidc_userinfo_invalid', 'UserInfo claim type is invalid')
  }
  if (raw.email_verified !== undefined && typeof raw.email_verified !== 'boolean') throw protocolError('oidc_userinfo_invalid', 'UserInfo claim type is invalid')
  // Existing account UI consumes only the stable subject and display name.
  return { sub: raw.sub, name: raw.name?.trim().slice(0, 256) || raw.preferred_username?.trim().slice(0, 256) || '已登录' }
}
