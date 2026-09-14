import { displayAffiliation } from './core.js'

export const emptyProfile = () => ({ displayName: null, organization: null, affiliation: null, connected: false })
const text = value => typeof value === 'string' && value.trim() ? value.trim() : null

// Account metadata is deliberately read afresh even when the activity totals
// are cached: login/logout must not leave another identity in the overview.
export async function readActivityProfile(ctx) {
  const oidc = ctx.get?.('oidcAccounts')
  if (oidc) {
    try {
      const configuration = await oidc.configuration()
      for (const profile of configuration.profiles ?? []) {
        try {
          const status = await oidc.status(profile.id)
          if (!text(status?.userName)) continue
          return {
            displayName: text(status.userName),
            organization: text(status.organization) ?? text(profile.organization) ?? text(profile.displayName),
            affiliation: displayAffiliation(status.affiliation),
            connected: status.credentialReady === true,
          }
        } catch { /* One unavailable account must not hide the remaining ones. */ }
      }
    } catch { /* Local statistics remain available without an account service. */ }
    return emptyProfile()
  }
  const accounts = ctx.get?.('enterpriseAccounts')
  if (!accounts) return emptyProfile()
  try {
    const { activeInstitutionID } = await accounts.configuration()
    if (!activeInstitutionID) return emptyProfile()
    const status = await accounts.status(activeInstitutionID)
    return { displayName: text(status?.userName), organization: text(status?.organization),
      affiliation: displayAffiliation(status?.affiliation), connected: status?.state === 'ready' }
  } catch { return emptyProfile() }
}
