import { afterEach, beforeEach, expect, test } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { extractPdfLink } from '../../src/tool/pdf-link.js'

let ctx: Context
let stream: (options: any) => AsyncGenerator<any>
let resolving: (() => void) | undefined
let dispatched: any[]
const schema = { type: 'object', properties: { pdfUrl: { oneOf: [{ type: 'string' }, { type: 'null' }] } }, required: ['pdfUrl'], additionalProperties: false } as const
const parent = { id: 'pdf-owner', options: { provider: 'current', model: 'selected' }, session: { requestHeader: () => undefined } } as any
const extract = (signal = new AbortController().signal) => extractPdfLink(ctx, parent, 'Untrusted page content', schema, signal)
const captured = (value: unknown) => async function* () {
  yield { type: 'tool-call-delta', index: 0, id: 'capture', name: 'structured_output', argumentsDelta: JSON.stringify(value) }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
}

beforeEach(async () => {
  ctx = new Context()
  dispatched = []
  resolving = undefined
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['current'], new class extends LlmAdapter {
    async resolveModel(provider: string, model: string) {
      resolving?.()
      return { provider, id: model, name: model, defaultMaxTokens: 1024 }
    }
    async *stream(options: any) { dispatched.push(options); yield* stream(options) }
  }())
})
afterEach(async () => { await ctx.fiber.dispose() })

test('extracts one URL using only a capture declaration', async () => {
  stream = captured({ pdfUrl: 'https://example.test/paper.pdf' })
  expect(await extract()).toBe('https://example.test/paper.pdf')
  expect(dispatched[0].tools.map((tool: any) => tool.name)).toEqual(['structured_output'])
  stream = captured({ pdfUrl: null })
  expect(await extract()).toBeNull()
})

test('refuses operational calls and incomplete streams', async () => {
  stream = async function* () {
    yield { type: 'tool-call-delta', index: 0, id: 'bad', name: 'shell', argumentsDelta: '{}' }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
  await expect(extract()).rejects.toMatchObject({ code: 'LITERATURE_FULLTEXT_UNAVAILABLE' })
  stream = async function* () { yield { type: 'text-delta', index: 0, text: '{"pdfUrl":null}' } }
  await expect(extract()).rejects.toMatchObject({ code: 'LITERATURE_FULLTEXT_UNAVAILABLE' })
  for (const value of [{ pdfUrl: 'file:///secret' }, { pdfUrl: 1 }, { pdfUrl: null, command: 'shell' }]) {
    stream = captured(value)
    await expect(extract()).rejects.toMatchObject({ code: 'LITERATURE_FULLTEXT_UNAVAILABLE' })
  }
})

test('cancellation while resolving model metadata prevents adapter dispatch', async () => {
  const controller = new AbortController()
  resolving = () => controller.abort(new Error('cancel during preparation'))
  stream = captured({ pdfUrl: null })
  await expect(extract(controller.signal)).rejects.toThrow('cancel during preparation')
  expect(dispatched).toHaveLength(0)
})

test('cancellation closes the producer and preserves its reason', async () => {
  const controller = new AbortController()
  let closed = false
  stream = async function* () {
    try { controller.abort(new Error('cancel during stream')); yield { type: 'text-delta', index: 0, text: '{}' } }
    finally { closed = true }
  }
  await expect(extract(controller.signal)).rejects.toThrow('cancel during stream')
  expect(closed).toBe(true)
})
