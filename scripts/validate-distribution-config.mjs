import { loadUserConfig } from '../dsh-host/user-config.mjs'
import { readFileSync } from 'node:fs'

// Print a redacted summary only. Deployment identifiers never enter receipts.
try {
  const path = process.argv[2]
  const config = loadUserConfig(path)
  if (config.product.logoUrl) throw new Error('This archive overlay supports eduwork.jsonc only; bundle custom logo assets separately.')
  // loadUserConfig validates explicit GitHub/static/disabled sources. Omitted
  // update settings inherit the source and channel in the original CI package.
  if (!config.organizations.length) throw new Error('A configured institution distribution requires at least one organization.')
  for (const org of config.organizations) {
    if (org.auth) {
      if (!org.id || org.oidc || org.keyBinding || org.provider?.baseURL || (!org.auth.experimentalOidcLlm && org.auth.clientId)) throw new Error('Gateway auth cannot mix OIDC identity profiles, Key Binding or a configured model API URL.')
      if (org.auth.experimentalOidcLlm && (!org.auth.clientId || /^replace-with-/i.test(org.auth.clientId) || !['oidc', 'oauth'].includes(org.auth.identityMode))) throw new Error('Experimental oidc-llm requires a registered public client ID and explicit identity mode.')
      for (const value of [org.auth.discoveryUrl, ...(org.auth.expectedIssuer ? [org.auth.expectedIssuer] : [])]) {
        const url = new URL(value)
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('A distributed gateway discovery/issuer must use HTTPS without credentials, query or fragment.')
      }
      continue
    }
    if (org.keyBinding || org.provider) throw new Error('Legacy model-key profiles have been removed; configure token gateway discovery.')
    if (!org.id || !org.oidc?.clientId || /^replace-with-/i.test(org.oidc.clientId)) throw new Error('An organization has a missing or placeholder Client ID.')
    if (new URL(org.oidc.issuer).protocol !== 'https:') throw new Error('An organization issuer must use HTTPS.')
  }
  if (/(?:"(?:clientSecret|client_secret|apiKey|accessToken|refreshToken)"\s*:|\bsk-[A-Za-z0-9_-]{24,})/.test(readFileSync(path, 'utf8'))) throw new Error('Do not distribute user credentials or client secrets.')
  console.log(JSON.stringify({ organizations: config.organizations.length, defaultPolicy: config.updates.defaultPolicy ?? null }))
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
