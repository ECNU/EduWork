import { normalizeModels } from './profile.js'

// A gateway catalog may also contain embedding, ranking and media models.
// A configured chat selection narrows discovery; it never grants model access.
export function normalizeResourceModels(raw, profile) {
  if (!Array.isArray(raw?.data) || raw.data.length > 128) throw new Error('invalid model catalog')
  const reviewed = new Map(profile.provider.models.map(model => [model.id, model]))
  const models = raw.data.map(row => {
    const id = typeof row?.id === 'string' ? row.id.trim() : ''
    // A plain /models response does not prove reasoning or vision support.
    return reviewed.get(id) ?? { id, name: id, input: ['text'], reasoning: false }
  })
  const normalized = models.length === 0 ? Object.freeze([]) : normalizeModels(models, profile.provider.id)
  if (profile.provider.chatModelIds === undefined) return normalized
  const chatIDs = new Set(profile.provider.chatModelIds)
  return Object.freeze(normalized.filter(model => chatIDs.has(model.id)))
}

export function emptyResources(profile) {
  return {
    profileID: profile.id,
    modelSource: profile.provider?.modelSource ?? 'none',
    models: profile.provider?.models ?? [],
    issues: [],
  }
}
