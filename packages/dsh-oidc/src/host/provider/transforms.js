import { Service } from '@deepseek-ai/cordis'

function routeKey(provider, model) {
  return `${provider}\u0000${model ?? '*'}`
}

function normalizedModalities(inputModalities) {
  return [...new Set(inputModalities ?? [])]
}

/**
 * Stable extension seam for plugins that add a capability to an enterprise
 * route without replacing the route owner or mutating the durable transcript.
 */
export class EnterpriseModelTransforms extends Service {
  constructor(ctx) {
    super(ctx, 'enterpriseTransforms')
    this.entries = new Map()
  }

  register({ provider, model, inputModalities = [], when = () => true, transform }) {
    if (typeof provider !== 'string' || provider.length === 0) throw new Error('enterprise transform provider is required')
    if (model !== undefined && (typeof model !== 'string' || model.length === 0)) throw new Error('enterprise transform model must be a non-empty string when provided')
    if (typeof when !== 'function') throw new Error('enterprise transform condition must be a function')
    if (typeof transform !== 'function') throw new Error('enterprise transform must be a function')
    const key = routeKey(provider, model)
    if (this.entries.has(key)) throw new Error(`enterprise transform already registered for ${provider}/${model ?? '*'}`)
    const entry = Object.freeze({ provider, model, inputModalities: normalizedModalities(inputModalities), when, transform })
    this.entries.set(key, entry)
    this.ctx.emit('llm/adapters-updated')
    return () => {
      if (this.entries.get(key) !== entry) return
      this.entries.delete(key)
      this.ctx.emit('llm/adapters-updated')
    }
  }

  matching(provider, model, nativeInputModalities) {
    const native = normalizedModalities(nativeInputModalities)
    return [
      this.entries.get(routeKey(provider, undefined)),
      this.entries.get(routeKey(provider, model)),
    ].filter(entry => entry !== undefined && entry.when({ provider, model, inputModalities: native }))
  }

  capabilities(provider, model, inputModalities) {
    const extra = this.matching(provider, model, inputModalities).flatMap(entry => entry.inputModalities)
    return normalizedModalities([...(inputModalities ?? []), ...extra])
  }

  async apply(options, nativeModelInfo) {
    let transformed = options
    for (const entry of this.matching(options.provider, options.model, nativeModelInfo?.inputModalities)) {
      transformed = await entry.transform(transformed, nativeModelInfo)
    }
    return transformed
  }
}
