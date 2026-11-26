/** Exact, read-only capability supplied by trusted Host code, never a renderer. */
export function serviceReadAllowed(profile, target, init, authorization) {
  const secure = target.protocol === 'https:'
  let issuerOrigin
  try { issuerOrigin = new URL(profile.auth?.expectedIssuer ?? profile.oidc?.issuer).origin } catch {}
  // An explicitly configured HTTP test issuer may also serve its own read APIs.
  // Do not extend the development exception to unrelated HTTP service hosts.
  const development = profile.allowInsecureDevelopment === true && target.protocol === 'http:'
    && (['127.0.0.1', '[::1]'].includes(target.hostname) || target.origin === issuerOrigin)
  return authorization.serviceURL === target.href && (secure || development)
    && (init.method ?? 'GET').toUpperCase() === 'GET' && init.body === undefined
}
