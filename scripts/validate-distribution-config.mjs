import { loadUserConfig } from '../dsh-host/user-config.mjs'
import { readFileSync } from 'node:fs'

// Print a redacted summary only. Deployment identifiers never enter receipts.
try {
  const path = process.argv[2]
  const config = loadUserConfig(path)
  if (config.product.logoUrl) throw new Error('This archive overlay supports eduwork.jsonc only; bundle custom logo assets separately.')
  if (!['stable', 'development'].includes(config.updates?.defaultPolicy)) throw new Error('Set updates.defaultPolicy explicitly.')
  if (!config.updates?.manifestURL) throw new Error('Set the distribution updates.manifestURL.')
  if (!config.organizations.length) throw new Error('A configured institution distribution requires at least one organization.')
  for (const org of config.organizations) {
    if (!org.id || !org.oidc?.clientId || /^replace-with-/i.test(org.oidc.clientId)) throw new Error('An organization has a missing or placeholder Client ID.')
    if (new URL(org.oidc.issuer).protocol !== 'https:') throw new Error('An organization issuer must use HTTPS.')
  }
  if (/(?:"(?:clientSecret|client_secret|apiKey|accessToken|refreshToken)"\s*:|\bsk-[A-Za-z0-9_-]{24,})/.test(readFileSync(path, 'utf8'))) throw new Error('Do not distribute user credentials or client secrets.')
  console.log(JSON.stringify({ organizations: config.organizations.length, defaultPolicy: config.updates.defaultPolicy }))
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
