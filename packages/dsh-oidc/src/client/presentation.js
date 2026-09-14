function cleanText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function accountUserName(status) {
  return cleanText(status?.userName)
}

export function accountOrganization(profile) {
  return cleanText(profile?.brand?.organizationName) || cleanText(profile?.organization)
}

export function accountStatusLine(profile, statusLabel, userName = '') {
  const organization = accountOrganization(profile)
  const label = cleanText(statusLabel)
  return userName && organization ? `${organization} · ${label}` : label
}

export const reasoningEffortOrder = Object.freeze(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

export function formatModelCapacity(value) {
  if (!Number.isFinite(value) || value <= 0) return ''
  if (value >= 1000000 && value % 1000000 === 0) return `${value / 1000000}M`
  if (value >= 1024 && value % 1024 === 0) return `${value / 1024}K`
  return Number(value).toLocaleString()
}

export function modelCapabilitySummary(model = {}, provider = {}) {
  const input = Array.isArray(model.input) && model.input.length > 0 ? model.input : ['text']
  const efforts = model.reasoningEfforts && typeof model.reasoningEfforts === 'object'
    ? Object.keys(model.reasoningEfforts).sort((left, right) => {
      const leftRank = reasoningEffortOrder.indexOf(left)
      const rightRank = reasoningEffortOrder.indexOf(right)
      return (leftRank < 0 ? reasoningEffortOrder.length : leftRank) -
        (rightRank < 0 ? reasoningEffortOrder.length : rightRank) || left.localeCompare(right)
    })
    : []
  return {
    id: cleanText(model.id), name: cleanText(model.name) || cleanText(model.id),
    upstreamModelID: cleanText(model.upstreamModelID),
    contextWindow: formatModelCapacity(model.contextWindow || provider.defaultContextWindow),
    maxTokens: formatModelCapacity(model.maxTokens || provider.defaultMaxTokens),
    input, reasoningSupported: model.reasoning !== false && model.reasoningEfforts !== false,
    reasoningEfforts: model.reasoning === false || model.reasoningEfforts === false ? [] : efforts,
    defaultReasoningEffort: model.reasoning === false || model.reasoningEfforts === false ? '' : cleanText(model.defaultReasoningEffort),
    multimodal: input.some(value => value !== 'text'),
  }
}

export function runtimeModelDraft(model = {}) {
  const existing = cleanText(model.id) !== ''
  return {
    id: cleanText(model.id), name: cleanText(model.name) || cleanText(model.id),
    upstreamModelID: cleanText(model.upstreamModelID),
    contextWindow: model.contextWindow ? String(model.contextWindow) : '',
    maxTokens: model.maxTokens ? String(model.maxTokens) : '',
    input: Array.isArray(model.input) && model.input.length > 0 ? [...model.input] : ['text'],
    compat: model.compat && typeof model.compat === 'object' && !Array.isArray(model.compat) ? { ...model.compat } : {},
    reasoningSupported: existing ? model.reasoning !== false && model.reasoningEfforts !== false : false,
    reasoning: model.reasoningEfforts && typeof model.reasoningEfforts === 'object' ? Object.keys(model.reasoningEfforts) : [],
    defaultReasoningEffort: cleanText(model.defaultReasoningEffort),
  }
}

export function serializeRuntimeModelDraft(draft) {
  const id = cleanText(draft?.id)
  if (!id) throw new Error('Model ID is required')
  const positiveInteger = (value, label) => {
    if (cleanText(String(value ?? '')) === '') return undefined
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`)
    return parsed
  }
  const input = [...new Set((Array.isArray(draft.input) ? draft.input : []).filter(value => ['text', 'image', 'audio', 'video'].includes(value)))]
  if (input.length === 0) input.push('text')
  const efforts = [...new Set(Array.isArray(draft.reasoning) ? draft.reasoning : [])]
    .filter(level => reasoningEffortOrder.includes(level))
    .sort((left, right) => reasoningEffortOrder.indexOf(left) - reasoningEffortOrder.indexOf(right))
  const reasoningSupported = draft.reasoningSupported !== false
  const defaultReasoningEffort = cleanText(draft.defaultReasoningEffort)
  if (defaultReasoningEffort && !efforts.includes(defaultReasoningEffort)) {
    throw new Error('Default reasoning effort must be one of the selected reasoning efforts')
  }
  const compat = draft.compat && typeof draft.compat === 'object' && !Array.isArray(draft.compat) ? { ...draft.compat } : {}
  if (reasoningSupported) compat.supportsReasoningEffort = efforts.length > 0
  else delete compat.supportsReasoningEffort
  const contextWindow = positiveInteger(draft.contextWindow, 'Context window')
  const maxTokens = positiveInteger(draft.maxTokens, 'Maximum output')
  return {
    id, name: cleanText(draft.name) || id,
    ...(cleanText(draft.upstreamModelID) ? { upstreamModelID: cleanText(draft.upstreamModelID) } : {}),
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(maxTokens === undefined ? {} : { maxTokens }), input,
    ...(!reasoningSupported ? { reasoning: false } : {}),
    ...(reasoningSupported && efforts.length > 0 ? { reasoningEfforts: Object.fromEntries(efforts.map(level => [level, level])) } : {}),
    ...(reasoningSupported && defaultReasoningEffort ? { defaultReasoningEffort } : {}),
    ...(Object.keys(compat).length === 0 ? {} : { compat }),
  }
}
