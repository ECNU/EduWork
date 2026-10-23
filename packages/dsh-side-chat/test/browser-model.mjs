// Deterministic model fixture for an isolated full Host/browser acceptance.
// This file is excluded from npm packs and never installed into normal builds.
import { appendFile } from 'node:fs/promises'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'

export const name = 'side-chat-browser-model-fixture'
export const inject = ['llm']

export function apply(ctx, config) {
  class Adapter extends LlmAdapter {
    listModels() { return Promise.resolve([{ provider: 'side-fixture', id: 'fixture', name: 'Synthetic side-chat fixture' }]) }
    resolveModel(provider, model) { return Promise.resolve({ provider, id: model, name: model }) }
    async *stream(request) {
      const body = JSON.stringify(request.messages)
      const users = request.messages.filter(message => message.role === 'user')
      const last = JSON.stringify(users.findLast(message => /SIDE_HANG|SIDE_QUESTION|SOURCE_FUTURE|SOURCE_FIRST|MAIN_PARALLEL/.test(JSON.stringify(message))) ?? '')
      const marker = ['SIDE_HANG', 'SIDE_QUESTION', 'SOURCE_FUTURE', 'SOURCE_FIRST', 'MAIN_PARALLEL'].find(value => last.includes(value)) ?? 'auxiliary'
      const trace = {
        kind: 'request', marker, inheritedReference: body.includes('SOURCE_FIRST'),
        inheritedFuture: body.includes('SOURCE_FUTURE'), sideBoundary: body.includes('Only new requests submitted in this side conversation'),
      }
      await appendFile(config.output, JSON.stringify(trace) + '\n')
      yield { type: 'block-start', index: 0, blockType: 'text' }
      if (marker === 'SIDE_HANG') {
        yield { type: 'text-delta', index: 0, text: 'SIDE_STREAM_PARTIAL' }
        try {
          await new Promise((_, reject) => {
            if (request.signal.aborted) reject(request.signal.reason)
            else request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true })
          })
        } finally { await appendFile(config.output, JSON.stringify({ kind: 'aborted', marker }) + '\n') }
        return
      }
      const text = marker === 'SIDE_QUESTION' ? 'SCRIPTED_SIDE_REPLY'
        : marker === 'SOURCE_FIRST' ? 'SOURCE_FIRST_REPLY'
          : marker === 'SOURCE_FUTURE' ? 'SOURCE_FUTURE_REPLY' : 'SCRIPTED_MAIN_REPLY'
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.effect(() => ctx.llm.registerAdapter(['side-fixture'], new Adapter()), 'synthetic side-chat model')
}
