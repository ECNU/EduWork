import { serviceProtocolAllowed } from '../transport.js'
const modalities = new Set(['text', 'image'])
export const REASONING_EFFORT_ORDER = Object.freeze(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
const reasoningEfforts = new Set(REASONING_EFFORT_ORDER)
export const ENTERPRISE_SETTINGS_NAMESPACE = 'provider-enterprise'
export const ENTERPRISE_DEFAULT_MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024
export const ENTERPRISE_DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET = 2048 * 2048
export const ENTERPRISE_DEFAULT_REQUEST_IMAGE_MAX_BYTES = 1024 * 1024
export const ENTERPRISE_DEFAULT_RETRY_POLICY = Object.freeze({ mode: 'normal', maxRetries: 2 })

function nonEmpty(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`)
  return value.trim()
}

function endpointURL(value, label, allowInsecureDevelopment = false) {
  const raw = nonEmpty(value, label).replace(/\/+$/, '')
  const parsed = new URL(raw)
  if (typeof allowInsecureDevelopment !== 'boolean') throw new Error(`${label}.allowInsecureDevelopment must be boolean`)
  if (!serviceProtocolAllowed(parsed, allowInsecureDevelopment) || parsed.username || parsed.password || parsed.hash || parsed.search) {
    throw new Error(`${label} must be HTTPS or explicitly allowed development HTTP without credentials, query, or fragment`)
  }
  return raw
}

function positiveInteger(value, fallback, label) {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0) throw new Error(`${label} must be a positive integer`)
  return resolved
}

function normalizeInput(value, label) {
  const input = value ?? ['text']
  if (!Array.isArray(input) || input.length === 0 || input.some(item => !modalities.has(item))) {
    throw new Error(`${label} must contain text and/or image`)
  }
  return [...new Set(input)]
}

function normalizeThinkingMap(value, reasoning) {
  if (value === false || reasoning === false) return { off: null }
  const source = value ?? { off: null, high: 'high', max: 'max' }
  if (typeof source !== 'object' || source === null || Array.isArray(source)) throw new Error('reasoningEfforts must be an object or false')
  const entries = Object.entries(source)
  if (entries.length === 0 || !entries.some(([effort]) => effort !== 'off')) {
    throw new Error('reasoningEfforts must declare at least one thinking level')
  }
  for (const [effort, wire] of entries) {
    if (!reasoningEfforts.has(effort)) throw new Error(`reasoningEfforts level ${effort} is not supported`)
    if (wire === null && effort !== 'off') throw new Error(`reasoningEfforts.${effort} may be null only for off`)
    if (wire !== null && (typeof wire !== 'string' || wire.length === 0)) throw new Error(`reasoningEfforts.${effort} must be a non-empty string`)
  }
  const map = {}
  for (const effort of REASONING_EFFORT_ORDER) {
    const wire = source[effort]
    if (wire === undefined) map[effort] = null
    else if (wire !== null) map[effort] = wire
  }
  return map
}

function declaredReasoningEfforts(value, reasoning) {
  if (reasoning === false || value === false) return []
  const source = value ?? { off: null, high: 'high', max: 'max' }
  return REASONING_EFFORT_ORDER.filter(effort => Object.hasOwn(source, effort))
}

function reasoningPreference(value, label) {
  const preference = value ?? 'high'
  if (!reasoningEfforts.has(preference)) throw new Error(`${label} is not a supported reasoning effort`)
  return preference
}

function nearestReasoningEffort(preference, supported) {
  const preferredRank = REASONING_EFFORT_ORDER.indexOf(preference)
  return [...supported].sort((left, right) => {
    const leftRank = REASONING_EFFORT_ORDER.indexOf(left)
    const rightRank = REASONING_EFFORT_ORDER.indexOf(right)
    return Math.abs(leftRank - preferredRank) - Math.abs(rightRank - preferredRank) || leftRank - rightRank
  })[0]
}

export function resolveEnterpriseProfiles(raw = {}) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('enterprise provider config must be an object')
  const providers = raw.providers ?? {}
  if (typeof providers !== 'object' || providers === null || Array.isArray(providers)) throw new Error('enterprise provider config.providers must be an object')

  return Object.entries(providers).map(([provider, source]) => {
    const route = nonEmpty(provider, 'provider route')
    if (typeof source !== 'object' || source === null || Array.isArray(source)) throw new Error(`${route} config must be an object`)
    const displayName = nonEmpty(source.displayName ?? route, `${route}.displayName`)
    const baseURL = endpointURL(source.baseURL, `${route}.baseURL`, source.allowInsecureDevelopment)
    const credentialRef = nonEmpty(source.apiKeyEnv, `${route}.apiKeyEnv`)
    const contextWindow = positiveInteger(source.defaultContextWindow, 262144, `${route}.defaultContextWindow`)
    const maxTokens = positiveInteger(source.defaultMaxTokens, 32768, `${route}.defaultMaxTokens`)
    const maxRequestImageBytes = positiveInteger(source.maxRequestImageBytes, ENTERPRISE_DEFAULT_MAX_REQUEST_IMAGE_BYTES, `${route}.maxRequestImageBytes`)
    const requestImagePixelBudget = positiveInteger(source.requestImagePixelBudget, ENTERPRISE_DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET, `${route}.requestImagePixelBudget`)
    const requestImageMaxBytes = positiveInteger(source.requestImageMaxBytes, ENTERPRISE_DEFAULT_REQUEST_IMAGE_MAX_BYTES, `${route}.requestImageMaxBytes`)
    const providerReasoning = reasoningPreference(source.reasoning, `${route}.reasoning`)
    if (!Array.isArray(source.models) || source.models.length === 0) throw new Error(`${route}.models must not be empty`)

    const ids = new Set()
    const models = source.models.map((model, index) => {
      if (typeof model !== 'object' || model === null || Array.isArray(model)) throw new Error(`${route}.models[${index}] must be an object`)
      const id = nonEmpty(model.id, `${route}.models[${index}].id`)
      if (ids.has(id)) throw new Error(`${route} declares duplicate model ${id}`)
      ids.add(id)
      const reasoning = model.reasoning !== false && model.reasoningEfforts !== false
      const compat = {
        supportsDeveloperRole: false,
        supportsStore: false,
        supportsReasoningEffort: reasoning,
        supportsUsageInStreaming: true,
        maxTokensField: 'max_tokens',
        supportsStrictMode: false,
        supportsLongCacheRetention: false,
        thinkingFormat: 'deepseek',
        requiresReasoningContentOnAssistantMessages: true,
        ...(source.compat ?? {}),
        ...(model.compat ?? {}),
      }
      const supportsReasoningEffort = reasoning && compat.supportsReasoningEffort !== false
      const efforts = supportsReasoningEffort ? declaredReasoningEfforts(model.reasoningEfforts, reasoning) : []
      if (model.defaultReasoningEffort !== undefined && !reasoningEfforts.has(model.defaultReasoningEffort)) {
        throw new Error(`${route}.${id}.defaultReasoningEffort is not a supported reasoning effort`)
      }
      if (model.defaultReasoningEffort !== undefined && !efforts.includes(model.defaultReasoningEffort)) {
        throw new Error(`${route}.${id}.defaultReasoningEffort must be one of the model's declared reasoningEfforts`)
      }
      const defaultReasoningEffort = supportsReasoningEffort
        ? (model.defaultReasoningEffort ?? nearestReasoningEffort(providerReasoning, efforts))
        : undefined
      // PiAi uses an internal effort to enable thinking even when the gateway
      // accepts no reasoning_effort field. Keep that default separate from UI choices.
      const internalThinkingEffort = reasoning && !supportsReasoningEffort
        ? nearestReasoningEffort(providerReasoning, declaredReasoningEfforts(model.reasoningEfforts, reasoning))
        : undefined
      return {
        id,
        name: nonEmpty(model.name ?? id, `${route}.${id}.name`),
        api: 'openai-completions',
        provider: route,
        baseUrl: baseURL,
        reasoning,
        thinkingLevelMap: normalizeThinkingMap(model.reasoningEfforts, reasoning),
        input: normalizeInput(model.input, `${route}.${id}.input`),
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: positiveInteger(model.contextWindow, contextWindow, `${route}.${id}.contextWindow`),
        maxTokens: positiveInteger(model.maxTokens, maxTokens, `${route}.${id}.maxTokens`),
        compat,
        modelPolicy: {
          reasoning, supportsReasoningEffort, reasoningEfforts: efforts, defaultReasoningEffort,
          requiresReasoningContent: reasoning && compat.requiresReasoningContentOnAssistantMessages === true,
          ...(internalThinkingEffort === undefined ? {} : { internalThinkingEffort }),
        },
      }
    })

    return {
      provider: route,
      displayName,
      baseURL,
      credentialRef,
      reasoning: providerReasoning,
      maxRequestImageBytes,
      requestImagePixelBudget,
      requestImageMaxBytes,
      streamIdleTimeoutMs: positiveInteger(source.streamIdleTimeoutMs, 300000, `${route}.streamIdleTimeoutMs`),
      retryPolicy: source.retryPolicy ?? ENTERPRISE_DEFAULT_RETRY_POLICY,
      configuredMaxTokens: new Map(models.map(model => [model.id, model.maxTokens])),
      modelPolicies: new Map(models.map(model => [model.id, model.modelPolicy])),
      models: models.map(({ modelPolicy: _modelPolicy, ...model }) => model),
    }
  })
}

export function configurableEntries(profiles) {
  return [...profiles.values()].map(profile => ({
    provider: profile.provider,
    displayName: profile.displayName,
    settingsNs: ENTERPRISE_SETTINGS_NAMESPACE,
    settingsPath: ['providers', profile.provider],
    declared: true,
  }))
}

export function settingsBase(rawConfig) {
  return { providers: rawConfig.providers ?? {} }
}
