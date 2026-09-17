// LiteLLM v1.101.0, native CLI auth contract 1. This is OAuth, not OIDC.
// Protocol-specific wire fields stay here; tokens never cross the renderer RPC.
const MAX_BYTES = 1024 * 1024
const MAX_TOKEN = 64 * 1024
export const protocolError = (code, message) => Object.assign(new Error(message), { code })
const nonempty = (value, max = MAX_TOKEN) => typeof value === 'string' && value.length > 0 && value.length <= max

export async function readGatewayJSON(response) {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) {
    await response.body?.cancel()
    throw protocolError('gateway_response_invalid', 'Gateway response exceeds the size limit')
  }
  const reader = response.body?.getReader(), chunks = []
  let size = 0
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > MAX_BYTES) throw new Error('limit')
        chunks.push(value)
      }
    } catch {
      await reader.cancel().catch(() => {})
      throw protocolError('gateway_response_invalid', 'Gateway response could not be read')
    }
  }
  let raw
  try { raw = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw protocolError('gateway_response_invalid', 'Gateway did not return JSON') }
  if (!response.ok) {
    // Never include untrusted error descriptions or echoed credentials in logs/UI.
    const oauthError = ['invalid_grant', 'invalid_client', 'invalid_target', 'invalid_request', 'unsupported_grant_type'].includes(raw?.error) ? raw.error : undefined
    throw Object.assign(protocolError('gateway_request_failed', `Gateway request failed (HTTP ${response.status}${oauthError ? `, ${oauthError}` : ''})`), { status: response.status, oauthError })
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw protocolError('gateway_response_invalid', 'Gateway response must be an object')
  return raw
}

export async function gatewayJSON(fetcher, url, init = {}) {
  let response
  try {
    response = await fetcher(url, { ...init, redirect: 'error', signal: init.signal ?? AbortSignal.timeout(20_000) })
  } catch {
    throw protocolError('gateway_unavailable', 'Gateway request did not complete; check the connection and retry')
  }
  return readGatewayJSON(response)
}

function trustedURL(value, profile, origin) {
  let url
  try { url = new URL(value) } catch { throw protocolError('gateway_discovery_invalid', 'Gateway metadata contains an invalid URL') }
  const local = profile.allowInsecureDevelopment && url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (!nonempty(value, 2048) || (url.protocol !== 'https:' && !local) || url.username || url.password || url.search || url.hash || (origin && url.origin !== origin)) {
    throw protocolError('gateway_discovery_invalid', 'Gateway metadata URL is outside the configured trust boundary')
  }
  return url
}

export function detectGatewayProtocol(raw, profile) {
  if (Object.hasOwn(raw, 'oidc_llm')) {
    throw protocolError('gateway_protocol_unsupported', 'oidc-llm is not enabled yet; retain the existing oidc profile until the new server protocol is available')
  }
  if (raw.contract_version !== 1) throw protocolError('gateway_protocol_unsupported', 'Unsupported gateway discovery contract; ordinary OIDC must use the existing oidc profile')
  const origin = new URL(profile.auth.discoveryUrl).origin
  const issuer = trustedURL(raw.issuer, profile, origin)
  if (profile.auth.expectedIssuer && raw.issuer !== profile.auth.expectedIssuer) throw protocolError('gateway_discovery_invalid', 'Gateway issuer does not match expectedIssuer')
  // Native proxy resource and issuer describe the same gateway, including its prefix.
  trustedURL(raw.resource, profile, origin)
  if (raw.resource !== raw.issuer) throw protocolError('gateway_discovery_invalid', 'LiteLLM resource must exactly match its issuer')
  for (const [key, required] of Object.entries({ response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], revocation_endpoint_auth_methods_supported: ['none'] })) {
    if (!Array.isArray(raw[key]) || required.some(value => !raw[key].includes(value))) throw protocolError('gateway_discovery_invalid', `LiteLLM discovery lacks required ${key}`)
  }
  const result = { protocol: 'litellm-native-v1', issuer: raw.issuer, resource: raw.resource }
  for (const [property, wire] of Object.entries({ authorizationEndpoint: 'authorization_endpoint', tokenEndpoint: 'token_endpoint', registrationEndpoint: 'registration_endpoint', revocationEndpoint: 'revocation_endpoint' })) {
    trustedURL(raw[wire], profile, origin)
    result[property] = raw[wire]
  }
  const base = issuer.href.replace(/\/+$/, '')
  return Object.freeze({ ...result, baseURL: `${base}/v1`, userInfoEndpoint: `${base}/user/info` })
}

export async function registerLiteLLM(fetcher, descriptor, redirectURI) {
  const redirect = new URL(redirectURI)
  if (redirect.protocol !== 'http:' || redirect.hostname !== '127.0.0.1' || redirect.username || redirect.password || redirect.search || redirect.hash) throw protocolError('gateway_callback_invalid', 'LiteLLM requires a loopback callback')
  const raw = await gatewayJSON(fetcher, descriptor.registrationEndpoint, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ client_name: 'EduWork', redirect_uris: [redirectURI], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
  })
  if (!nonempty(raw.client_id) || raw.token_endpoint_auth_method !== 'none' || !Array.isArray(raw.redirect_uris) || raw.redirect_uris.length !== 1 || raw.redirect_uris[0] !== redirectURI) {
    throw protocolError('gateway_registration_invalid', 'LiteLLM did not register the requested public client callback')
  }
  return raw.client_id
}

export function liteLLMToken(raw, now, previous) {
  if (!nonempty(raw.access_token) || !nonempty(raw.refresh_token) || typeof raw.token_type !== 'string' || raw.token_type.toLowerCase() !== 'bearer' || !Number.isSafeInteger(raw.expires_in) || raw.expires_in <= 0 || raw.expires_in > 365 * 86400 || !nonempty(raw.user_id, 1024) || !(raw.team_id === null || nonempty(raw.team_id, 1024))) {
    throw protocolError('gateway_token_invalid', 'LiteLLM token response is incomplete or invalid')
  }
  if (previous && (raw.user_id !== previous.identity.sub || raw.team_id !== previous.teamID)) throw protocolError('gateway_identity_changed', 'Gateway authorization identity changed during refresh; sign in again')
  return { accessToken: raw.access_token, refreshToken: raw.refresh_token, expiresAt: Math.floor(now() / 1000) + raw.expires_in, teamID: raw.team_id, identity: { sub: raw.user_id, name: previous?.identity?.name || raw.user_id } }
}

export function tokenRequest(fetcher, descriptor, values) {
  return gatewayJSON(fetcher, descriptor.tokenEndpoint, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ ...values, resource: descriptor.resource }),
  })
}

export async function revokeLiteLLM(fetcher, descriptor, session) {
  await gatewayJSON(fetcher, descriptor.revocationEndpoint, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: session.refreshToken, client_id: session.clientId }), signal: AbortSignal.timeout(5_000),
  })
}
