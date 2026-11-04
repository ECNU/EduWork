import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire, registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { executeGovernedTool } from '../packages/artifact-services/lib/tool-execution.js'

test('legacy tool dispatch preserves the original execution input', async () => {
  const input = { name: 'example', signal: new AbortController().signal }
  const expected = { isError: false, value: { ok: true } }
  assert.equal(await executeGovernedTool({ tools: { execute(value) { assert.equal(value, input); return expected } } }, input), expected)
})

const runtime = process.env.EDUWORK_TEST_RUNTIME
test('rc.1 service subcalls use the real approval/result pipeline', { skip: !runtime }, async t => {
  const require = createRequire(join(runtime, 'package.json'))
  const load = name => import(pathToFileURL(require.resolve(name)).href)
  const pipelineURL = pathToFileURL(require.resolve('@deepseek-ai/dsh-tools/pipeline')).href
  const hook = registerHooks({ resolve(name, context, next) {
    return name === '@deepseek-ai/dsh-tools/pipeline'
      ? { url: pipelineURL, shortCircuit: true } : next(name, context)
  } })
  t.after(() => hook.deregister())
  const { Context } = await load('@deepseek-ai/cordis')
  const { default: SystemPrompt } = await load('@deepseek-ai/dsh-system-prompt')
  const { default: Tools, defineTool } = await load('@deepseek-ai/dsh-tools')
  const { createScope } = await load('@deepseek-ai/dsh-scope')
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt); await ctx.plugin(Tools)
  let called = 0
  const results = []
  ctx.on('tools/result', (exec, result) => { results.push({ exec, result }) })
  ctx.tools.register(defineTool({ name: 'synthetic', description: 'fixture', parameters: {},
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean', required: true } }, additionalProperties: false }, render: () => [] },
    async execute() { called++; return { ok: true } },
  }))
  const parent = Symbol('parent'), signal = new AbortController().signal
  const call = overrides => executeGovernedTool(ctx, { name: 'synthetic', arguments: {}, callId: 'child', rootCallId: 'root', parent, signal, ...overrides })
  const denied = ctx.on('tools/pre-execute', async () => ({ kind: 'deny', reason: 'denied by fixture' }))
  assert.equal((await call()).isError, true); assert.equal(called, 0); denied()
  const blocked = ctx.on('tools/post-execute', async (_exec, _result, next) => {
    await next(); return { kind: 'block', feedback: [{ type: 'text', text: 'rejected after execution' }] }
  })
  assert.equal((await call()).isError, true); assert.equal(called, 1); blocked()
  const abort = new AbortController(); abort.abort()
  assert.equal((await call({ signal: abort.signal })).isError, true); assert.equal(called, 1)
  const accepted = await call()
  assert.equal(accepted.isError, false); assert.deepEqual(accepted.value, { ok: true }); assert.equal(called, 2)
  assert.equal(results.at(-1).exec.parent, parent); assert.equal(results.at(-1).exec.rootCallId, 'root')
  assert.equal(results.at(-1).result, accepted)
  let scope
  const agent = { id: 'restricted-fixture', get ctx() { return scope.ctx } }
  await ctx.plugin(Object.assign(inner => { scope = createScope(inner, agent) }, { inject: ['tools'] }))
  scope.ctx.tools.restrict({ deny: ['synthetic'] })
  assert.equal((await call({ agent })).isError, true); assert.equal(called, 2)
})
