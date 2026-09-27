import { normalizeModels } from './profile.js'
import { MODEL_TYPES } from './model-types.js'

// A gateway catalog may also contain embedding, ranking and media models.
// Type metadata classifies authorized rows; it never grants model access.
export function normalizeResourceModels(raw, profile) {
  if (!Array.isArray(raw?.data) || raw.data.length > 128) throw new Error('invalid model catalog')
  const reviewed = new Map(profile.provider.models.map(model => [model.id, model]))
  const models = raw.data.map(row => {
    const id = typeof row?.id === 'string' ? row.id.trim() : ''
    const local = reviewed.get(id)
    // The current server declaration wins. Local metadata fills an absent type,
    // but cannot turn an explicit unknown/future server type into a chat model.
    const type = row.type === undefined
      ? local?.type ?? 'unknown'
      : MODEL_TYPES.includes(row.type) ? row.type : 'unknown'
    // A plain /models response does not prove reasoning or vision support.
    return { ...(local ?? { id, name: id, input: ['text'], reasoning: false }), type }
  })
  // Keep the full typed catalog; only the DSH conversation projection uses LLMs.
  return models.length === 0 ? Object.freeze([]) : normalizeModels(models, profile.provider.id)
}

export function emptyResources(profile) {
  return {
    profileID: profile.id,
    modelSource: profile.provider?.modelSource ?? 'none',
    models: profile.provider?.models ?? [],
    issues: [],
  }
}
