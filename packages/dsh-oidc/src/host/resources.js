import { normalizeModels } from './profile.js'

// The public resource contract extends the deployed worker wire protocol. OIDC
// access tokens remain on the management plane; these calls use the model key.
export function normalizeResourceModels(raw, profile) {
  if (!Array.isArray(raw?.data) || raw.data.length > 128) throw new Error('invalid model catalog')
  const reviewed = new Map(profile.provider.models.map(model => [model.id, model]))
  const models = raw.data.map(row => {
    const id = typeof row?.id === 'string' ? row.id.trim() : ''
    // A plain /models response does not prove reasoning or vision support.
    return reviewed.get(id) ?? { id, name: id, input: ['text'], reasoning: false }
  })
  return normalizeModels(models, profile.provider.id)
}

export function emptyResources(profile) {
  return {
    profileID: profile.id,
    modelSource: profile.provider?.modelSource ?? 'none',
    models: profile.provider?.models ?? [],
    issues: [],
  }
}
