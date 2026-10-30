/** Exact, read-only capability supplied by trusted Host code, never a renderer. */
export function serviceReadAllowed(profile, target, init, authorization) {
  const secure = target.protocol === 'https:'
  const development = profile.allowInsecureDevelopment === true && target.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(target.hostname)
  return authorization.serviceURL === target.href && (secure || development)
    && (init.method ?? 'GET').toUpperCase() === 'GET' && init.body === undefined
}
