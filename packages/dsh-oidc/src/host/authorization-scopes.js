import { createHash } from 'node:crypto'
import { protocolError } from './litellm-protocol.js'

export function validScopes(scopes) {
  return Array.isArray(scopes) && scopes.length <= 64
    && scopes.every(scope => typeof scope === 'string' && scope.length <= 128 && /^[\x21\x23-\x5b\x5d-\x7e]+$/.test(scope))
    && new Set(scopes).size === scopes.length
}

// Adding an optional capability or advertising a new scope must not invalidate
// the existing login. Keep the previous binding for all pre-existing fields.
export function authorizationFingerprint(profile, descriptor) {
  const { optionalScopes, ...auth } = profile.auth
  const { supportedScopes, ...baseDescriptor } = descriptor
  return createHash('sha256').update(JSON.stringify({ auth, descriptor: baseDescriptor })).digest('hex')
}

export function requestedScopes(profile, descriptor, requested, previous) {
  if (!validScopes(requested) || requested.length === 0) throw protocolError('oidc_scope_request_invalid', 'Select one or more configured optional scopes')
  if (descriptor.protocol !== 'oidc-llm-draft-0.1') throw protocolError('oidc_scope_request_unsupported', 'This connection does not support optional service authorization')
  const optional = profile.auth?.optionalScopes ?? []
  if (requested.some(scope => !optional.includes(scope))) throw protocolError('oidc_scope_request_denied', 'Requested scope is not an optional capability configured by this integration')
  const scopes = [...new Set([...descriptor.scopes, ...(previous?.scopes ?? []), ...requested])]
  if (scopes.some(scope => !descriptor.supportedScopes?.includes(scope))) throw protocolError('oidc_scope_unavailable', 'The authorization server does not support a requested scope')
  return Object.freeze(scopes)
}
