import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { generationPolicy, outputLimitError } from './generation-policy.js'

function diagnostic(error) {
  return String(error?.message ?? error).replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/https?:\/\/\S+/g, '[endpoint]').slice(0, 800)
}

function modelSelection(ctx, sessionId) {
  const agent = sessionId ? ctx.agents?.get(sessionId) : null
  const request = agent?.session?.requestHeader()?.config
  const fallback = ctx.agentDefaultModel?.currentSelection?.()
  const provider = request?.provider ?? fallback?.provider
  const model = request?.model ?? fallback?.model
  return provider && model ? { provider, model } : null
}

async function generateText(ctx, { sessionId, system, prompt, signal, maxTokens, purpose = 'knowledge-studio', idleTimeoutMs = 90_000, preparedGeneration }) {
  const selection = preparedGeneration?.selection ?? modelSelection(ctx, sessionId)
  if (!selection || !ctx.llm?.stream) throw new Error('No DSH model is available for Studio generation')
  if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0) throw new Error('Invalid model stream idle timeout')
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason ?? new Error('Studio generation cancelled'))
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  let timer
  const activity = () => {
    clearTimeout(timer)
    timer = setTimeout(() => controller.abort(Object.assign(new Error('模型服务长时间没有返回内容，本次生成已中断，请稍后重试。'), { code: 'STUDIO_MODEL_IDLE' })), idleTimeoutMs)
  }
  const assembler = new BlockAssembler()
  let generation
  activity()
  try {
    const policy = preparedGeneration?.policy ?? await generationPolicy(ctx, selection, sessionId, controller.signal, maxTokens)
    controller.signal.throwIfAborted()
    const { options } = policy
    generation = policy.generation
    activity()
    let terminalReceived = false
    const messages = [createUserMessage({
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'plugin', plugin: 'dsh-knowledge-studio' },
    })]
    for await (const chunk of ctx.llm.stream({ ...selection, ...options, messages, system, sessionId, purpose, signal: controller.signal })) {
      controller.signal.throwIfAborted()
      activity()
      if (chunk.type === 'finish') terminalReceived = true
      assembler.push(chunk)
    }
    controller.signal.throwIfAborted()
    const finish = assembler.finish
    if (['error', 'aborted'].includes(finish?.kind)) throw Object.assign(new Error(`Studio model failed: ${diagnostic(finish.failure?.message ?? finish.failure ?? finish.kind)}`), { code: finish.kind === 'aborted' ? 'STUDIO_MODEL_ABORTED' : finish.failure?.code })
    const blocks = assembler.blocks()
    if (blocks.some(block => block.type === 'tool-call')) throw new Error('Studio generation must return text only')
    const text = blocks.filter(block => block.type === 'text').map(block => block.text).join('\n').trim()
    if (finish?.kind === 'max-tokens') throw outputLimitError(text, generation)
    if (!terminalReceived) throw Object.assign(new Error('模型连接结束时没有返回完成标记，成果尚未完成。'), { code: 'STUDIO_STREAM_INTERRUPTED' })
    if (!text) throw Object.assign(new Error(blocks.some(block => block.type === 'reasoning')
      ? '模型已结束，但只返回了推理内容，没有生成正文。请重试生成；这不表示资料上下文或输出额度已耗尽。'
      : '模型已结束，但没有返回正文。请重试生成；这不表示资料上下文或输出额度已耗尽。'), { code: 'STUDIO_EMPTY_OUTPUT' })
    return { text, selection, generation: { ...generation, finishKind: finish.kind, ...(assembler.usage ? { usage: assembler.usage } : {}) } }
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error))
    const partialText = assembler.blocks().filter(block => block.type === 'text').map(block => block.text).join('\n').trim()
    if (partialText && !failure.partialText) failure.partialText = partialText
    if (generation && !failure.generation) failure.generation = { ...generation,
      finishKind: signal?.aborted ? 'aborted' : assembler.finish?.kind ?? 'error',
      hasReasoning: assembler.blocks().some(block => block.type === 'reasoning'),
      ...(assembler.usage ? { usage: assembler.usage } : {}),
    }
    throw failure
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

function citationSnapshot(evidence) {
  return {
    evidenceId: evidence.evidenceId,
    chunkId: evidence.chunkId,
    path: evidence.path,
    heading: evidence.heading,
    locator: evidence.locator,
    pageStart: evidence.pageStart,
    pageEnd: evidence.pageEnd,
    lineStart: evidence.lineStart,
    lineEnd: evidence.lineEnd,
    excerpt: evidence.content.slice(0, 500),
    excerptHash: evidence.excerptHash,
    revisionHash: evidence.revisionHash,
    fresh: true,
  }
}

export { citationSnapshot, generateText, modelSelection }
