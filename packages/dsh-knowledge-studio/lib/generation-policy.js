// Studio uses the same exact model route and user choices as the conversation.
// An adapter default is not a universal context limit or a plugin-owned cap.
export async function generationPolicy(ctx, selection, sessionId, signal, explicitMaxTokens) {
  const request = sessionId ? ctx.agents?.get(sessionId)?.session?.requestHeader()?.config : undefined
  const selected = request && (!request.provider || request.provider === selection.provider) && (!request.model || request.model === selection.model) ? request : undefined
  const info = await ctx.llm.resolveModelInfo?.(selection.provider, selection.model, signal)
  signal?.throwIfAborted()
  const options = {}
  const requestedCap = explicitMaxTokens ?? selected?.maxTokens
  if (requestedCap !== undefined) {
    if (!Number.isSafeInteger(requestedCap) || requestedCap <= 0) throw new Error('模型输出预算必须是正整数')
    options.maxTokens = requestedCap
  }
  const effort = selected?.reasoningEffort
  // Routes such as a model with thinking but no effort controls must receive
  // no stale effort left by an older session or a different model.
  if (effort && info?.reasoning?.efforts?.some(item => item.id === effort)) options.reasoningEffort = effort
  return {
    options,
    generation: {
      ...selection,
      maxTokens: options.maxTokens ?? info?.defaultMaxTokens ?? null,
      reasoningEffort: options.reasoningEffort ?? info?.reasoning?.defaultEffort ?? null,
      budgetSource: options.maxTokens !== undefined ? 'explicit' : 'model-default',
    },
  }
}

export function outputLimitError(partialText, generation) {
  const budget = generation.maxTokens ? `（本次模型配置为 ${generation.maxTokens} tokens）` : ''
  const progress = partialText ? '已保留可见草稿，可查看后重试生成。' : '本次尚未形成可见正文，可重试生成。'
  const error = new Error(`模型达到本次输出长度上限${budget}，成果尚未完成。${progress}这不是资料上下文容量限制。`)
  error.code = 'STUDIO_OUTPUT_LIMIT'
  error.partialText = partialText
  error.generation = { ...generation, finishKind: 'max-tokens' }
  return error
}
