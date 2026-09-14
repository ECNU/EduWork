import { LlmError } from '@deepseek-ai/dsh-llm'

/** pi-ai preserves the response's raw reasoning alias in replay metadata.
 * Routes requiring reasoning_content must replay that same text under the
 * canonical field, otherwise pi-ai adds an empty alias and strict gateways
 * reject the pair. Change only the outgoing copy; durable history is untouched.
 */
export function canonicalReasoningReplay(request, policy) {
  if (!policy.requiresReasoningContent) return request
  let changed = false
  const messages = request.messages.map(message => {
    const source = message.source, replay = source?.replayState
    if (message.role !== 'assistant' || source?.kind !== 'model' || source.provider !== request.provider || source.model !== request.model
      || replay?.response?.kind !== 'pi-ai' || replay.response.version !== 2 || replay.response.api !== 'openai-completions'
      || !Array.isArray(replay.blocks)) return message
    let replaced = false
    const blocks = replay.blocks.map(block => {
      if (block.type !== 'reasoning' || !['reasoning', 'reasoning_text'].includes(block.thinkingSignature)) return block
      replaced = true
      return { ...block, thinkingSignature: 'reasoning_content' }
    })
    if (!replaced) return message
    changed = true
    return { ...message, source: { ...source, replayState: { ...replay, blocks } } }
  })
  return changed ? { ...request, messages } : request
}

/** Delegate one enterprise route while applying capabilities contributed by replaceable feature plugins. */
export class TransformingEnterpriseAdapter {
  constructor(inner, transforms, modelPolicy = () => ({})) {
    this.inner = inner
    this.transforms = transforms
    this.modelPolicy = modelPolicy
  }

  providerInfo(provider) { return this.inner.providerInfo(provider) }
  providerRetryPolicy(provider) { return this.inner.providerRetryPolicy(provider) }
  imageRequestPricing(provider, model) { return this.inner.imageRequestPricing(provider, model) }

  async listModels(provider) {
    const models = await this.inner.listModels(provider)
    return models.map(model => ({
      ...model,
      inputModalities: this.transforms.capabilities(provider, model.id, model.inputModalities),
    }))
  }

  async resolveModel(provider, model, signal) {
    const policy = this.modelPolicy(provider, model)
    return this.decorateModel(provider, model, await this.inner.resolveModel(provider, model, signal), policy)
  }

  decorateModel(provider, model, resolved, policy = this.modelPolicy(provider, model)) {
    const decorated = {
      ...resolved,
      inputModalities: this.transforms.capabilities(provider, model, resolved.inputModalities),
    }
    if (policy.reasoning !== false && policy.supportsReasoningEffort !== false && Array.isArray(policy.reasoningEfforts)) {
      return {
        ...decorated,
        reasoning: {
          efforts: policy.reasoningEfforts.map(id => ({ id, name: `${id.charAt(0).toUpperCase()}${id.slice(1)}` })),
          defaultEffort: policy.defaultReasoningEffort,
        },
      }
    }
    const { reasoning: _unsupportedReasoningEfforts, ...thinkingOnly } = decorated
    return thinkingOnly
  }

  async prepareCall(provider, model, signal) {
    const policy = this.modelPolicy(provider, model)
    const prepared = typeof this.inner.prepareCall === 'function'
      ? await this.inner.prepareCall(provider, model, signal)
      : { model: await this.inner.resolveModel(provider, model, signal), stream: options => this.inner.stream(options) }
    return {
      model: this.decorateModel(provider, model, prepared.model, policy),
      stream: options => this.streamPrepared(options, prepared, policy),
    }
  }

  async * streamPrepared(options, prepared, policy = this.modelPolicy(options.provider, options.model)) {
    const nativeModelInfo = prepared.model
    let request = options
    if (policy.reasoning === false) {
      request = { ...options, reasoningEffort: 'off' }
    } else if (policy.supportsReasoningEffort === false) {
      const { reasoningEffort: _unsupportedReasoningEffort, ...withoutEffort } = options
      // This enables the model's configured thinking mode inside PiAi;
      // compat.supportsReasoningEffort=false suppresses the HTTP effort field.
      request = policy.internalThinkingEffort === undefined
        ? withoutEffort
        : { ...withoutEffort, reasoningEffort: policy.internalThinkingEffort }
    } else if (Array.isArray(policy.reasoningEfforts)) {
      const effort = options.reasoningEffort ?? policy.defaultReasoningEffort
      if (!policy.reasoningEfforts.includes(effort)) {
        throw new LlmError(`enterprise model "${options.provider}/${options.model}" does not support reasoning effort "${String(effort)}"`, 'UNSUPPORTED_REASONING_EFFORT')
      }
      request = { ...options, reasoningEffort: effort }
    }
    yield* prepared.stream(canonicalReasoningReplay(await this.transforms.apply(request, nativeModelInfo), policy))
  }

  async * stream(options) {
    const policy = this.modelPolicy(options.provider, options.model)
    const prepared = typeof this.inner.prepareCall === 'function'
      ? await this.inner.prepareCall(options.provider, options.model, options.signal)
      : { model: await this.inner.resolveModel(options.provider, options.model, options.signal), stream: request => this.inner.stream(request) }
    yield* this.streamPrepared(options, prepared, policy)
  }
}
