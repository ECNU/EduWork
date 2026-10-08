// Purpose is independent of input modalities: a vision LLM is still an LLM.
// Unknown (including future server types) is never registered for conversation.
export const MODEL_TYPES = Object.freeze(['llm', 'embedding', 'rerank', 'image', 'tts', 'unknown'])

export function isLLM(model) {
  return model.type === 'llm'
}
