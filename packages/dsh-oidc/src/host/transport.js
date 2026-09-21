// One transport rule for configured and discovered service URLs.
// Callback binding, issuer identity and protocol-specific origin checks are separate.
export function serviceProtocolAllowed(url, allowInsecureDevelopment = false) {
  return url.protocol === 'https:' || (allowInsecureDevelopment === true && url.protocol === 'http:')
}
