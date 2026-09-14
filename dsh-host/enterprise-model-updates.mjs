import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const sameInput = (a, b) => Array.isArray(a) && a.length === b.length && a.every((value, i) => value === b[i])
const endpoint = value => typeof value === 'string' ? value.replace(/\/+$/u, '') : value
const modalities = value => Array.isArray(value) && value.length > 0 && new Set(value).size === value.length && value.every(item => ['text', 'image'].includes(item))
const capacity = value => Number.isSafeInteger(value) && value > 0

/** Release-owned catalog corrections only affect the effective enterprise profile.
 * Personal DSH providers, credentials and the administrator's JSONC are not written.
 * Keep institution identities in edition resources, not in the public Host.
 */
export function updateEnterpriseModels(organizations, catalog) {
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.updates)) throw new Error('Invalid enterprise model update catalog')
  for (const update of catalog.updates) {
    const match = update.match
    const inputUpdate = update.fromInput !== undefined || update.toInput !== undefined
    const contextUpdate = update.fromContextWindow !== undefined || update.toContextWindow !== undefined
    if (!match || !['profileID', 'issuer', 'providerID', 'baseURL', 'adapter', 'modelID'].every(key => typeof match[key] === 'string' && match[key])
      || (!inputUpdate && !contextUpdate)
      || (inputUpdate && (!modalities(update.fromInput) || !modalities(update.toInput)))
      || (contextUpdate && (!capacity(update.fromContextWindow) || !capacity(update.toContextWindow)))) throw new Error('Invalid enterprise model capability update')
  }
  return organizations.map(organization => {
    let provider = organization.provider
    // Discovery-owned catalogs must keep following the server. Identity-only
    // organizations and unrelated personal providers never enter this path.
    if (!provider || (provider.modelSource ?? 'profile') !== 'profile' || !Array.isArray(provider.models)) return organization
    for (const update of catalog.updates) {
      const match = update.match
      if (organization.id !== match.profileID || endpoint(organization.oidc?.issuer) !== endpoint(match.issuer)
        || provider.id !== match.providerID || endpoint(provider.baseURL) !== endpoint(match.baseURL)
        || provider.adapter !== match.adapter) continue
      const models = provider.models.map(model => {
        if (model.id !== match.modelID) return model
        let next = model
        if (update.fromInput && sameInput(model.input, update.fromInput)) next = { ...next, input: [...update.toInput] }
        // Compare the effective old capacity, including inherited provider
        // defaults, then pin this model only. Other models keep their defaults.
        if (update.fromContextWindow !== undefined && (model.contextWindow ?? provider.defaultContextWindow) === update.fromContextWindow) {
          next = { ...next, contextWindow: update.toContextWindow }
        }
        return next
      })
      if (models.some((model, i) => model !== provider.models[i])) provider = { ...provider, models }
    }
    return provider === organization.provider ? organization : { ...organization, provider }
  })
}

export async function loadEnterpriseModelUpdates(product, organizations) {
  let body
  try { body = await readFile(join(product, 'resources/desktop/enterprise-model-updates.json'), 'utf8') }
  catch (error) { if (error.code === 'ENOENT') return organizations; throw error }
  return updateEnterpriseModels(organizations, JSON.parse(body))
}
