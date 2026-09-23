import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile, symlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import * as productDeliveries from '../dsh-plugins/tool-artifact-publish/lib/native.js'

const { values } = parseArgs({ options: { runtime: { type: 'string' }, output: { type: 'string' } } })
if (!values.runtime || !values.output) throw new Error('Use --runtime <candidate> --output <new synthetic directory>')
const runtime = resolve(values.runtime), output = resolve(values.output)
const receipt = JSON.parse(await readFile(join(runtime, '.chatecnu-dsh-runtime.json'), 'utf8'))
assert.equal(receipt.dshVersion, '0.1.7-alpha.2')
assert.equal(receipt.dshCommit, '00102833dfaee1da9f48a3a8eae9d34005a75218')
await mkdir(output)
const require = createRequire(join(runtime, 'package.json'))
const load = name => import(pathToFileURL(require.resolve(name)).href)
const { Context } = await load('@deepseek-ai/cordis')
const { default: Tools, defineTool } = await load('@deepseek-ai/dsh-tools')
const { default: Agents } = await load('@deepseek-ai/dsh-agent')
const { default: Fs } = await load('@deepseek-ai/dsh-fs-local')
const { default: Projections } = await load('@deepseek-ai/dsh-session-projection')
const { default: SystemPrompt } = await load('@deepseek-ai/dsh-system-prompt')
const { turnBoundaryProjectionDefinition } = await load('@deepseek-ai/dsh-agent-loop')
const { createScope } = await load('@deepseek-ai/dsh-scope')
const { Session, SESSION_FORMAT_VERSION } = await load('@deepseek-ai/dsh-session')
const ctx = new Context(), root = join(output, 'workspace')
await mkdir(root)
await writeFile(join(root, '报告.txt'), 'Synthetic product output')
await writeFile(join(root, 'empty.txt'), '')
await writeFile(join(output, 'outside.txt'), 'Must not be published')
await symlink(output, join(root, 'outside'), process.platform === 'win32' ? 'junction' : 'dir')
const report = { success: false, scope: 'real DSH tools, filesystem, scopes and sessions; synthetic generator', checks: [] }
try {
  for (const plugin of [SystemPrompt, Tools, Agents, Projections]) await ctx.plugin(plugin)
  await ctx.plugin(Fs, { cwd: root })
  ctx.sessionProjections.register(turnBoundaryProjectionDefinition)
  await ctx.plugin(productDeliveries)
  let sequence = 0
  const makeOwner = async () => {
    const id = 'synthetic-' + ++sequence
    const session = Session.create(id, [], { version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd: root, isSeeded: false })
    let scope
    const owner = { id, session, options: {}, status: 'idle', get ctx() { return scope.ctx },
      send() {}, followup() {}, inject() {}, cancel() {}, whenIdle: async () => {},
      runMaintenance: task => task(new AbortController().signal) }
    await ctx.plugin(Object.assign(inner => { scope = createScope(inner, owner) }, { inject: ['tools'] }))
    await ctx.agents.register(owner)
    session.append('turn/start', { turn: 1 })
    return owner
  }
  const owner = await makeOwner(), other = await makeOwner()
  const outputContract = { schema: { type: 'object', additionalProperties: false, properties: { relativePath: { type: 'string', required: true } } }, render: () => [] }
  ctx.tools.register(defineTool({ name: 'image_generate', description: 'Synthetic generator contract',
    parameters: { path: { type: 'string', required: true }, fail: { type: 'boolean' } }, output: outputContract,
    execute: async args => { if (args.fail) throw new Error('Synthetic generation failure'); return { relativePath: args.path } } }))
  const execute = (name, args, agent = owner, signal = new AbortController().signal) => ctx.tools.execute({
    callId: 'call-' + ++sequence, name, arguments: args, agent, signal })
  const deliveries = agent => agent.session.snapshotEvents().filter(event => event.type === 'deliverables/presented')
  assert.equal((await execute('image_generate', { path: '报告.txt' })).isError, false)
  assert.equal(deliveries(owner).length, 1)
  assert.deepEqual(deliveries(owner)[0].data.files, [{ path: '报告.txt' }])
  assert.equal(deliveries(other).length, 0)
  report.checks.push('successful files use the owning session; no cross-session publication')
  for (const args of [{ path: '报告.txt', fail: true }, { path: 'missing.txt' }, { path: 'empty.txt' },
    { path: '../outside.txt' }, { path: 'outside/outside.txt' }, { path: root + '/报告.txt' }]) await execute('image_generate', args)
  const aborted = new AbortController(); aborted.abort()
  await execute('image_generate', { path: '报告.txt' }, owner, aborted.signal)
  assert.equal(deliveries(owner).length, 1)
  report.checks.push('failed, cancelled, missing, empty, absolute and escaping files produce no delivery')
  const block = ctx.on('tools/post-execute', async (_exec, _result, next) => {
    await next(); return { kind: 'block', feedback: [{ type: 'text', text: 'Synthetic policy denial' }] }
  })
  assert.equal((await execute('image_generate', { path: '报告.txt' })).isError, true)
  block(); assert.equal(deliveries(owner).length, 1)
  report.checks.push('final policy rejection cannot publish a prepared file')
  ctx.tools.register(defineTool({ name: 'synthetic_batch', description: 'Synthetic nested transport',
    parameters: { fail: { type: 'boolean' } }, output: outputContract,
    execute: async (args, exec) => {
      await ctx.tools.execute({ callId: 'nested-' + ++sequence, rootCallId: exec.rootCallId, parent: exec.token,
        name: 'image_generate', arguments: { path: '报告.txt' }, agent: exec.agent, signal: exec.signal })
      assert.equal(deliveries(owner).length, 1, 'Nested delivery committed before its transport')
      if (args.fail) throw new Error('Synthetic outer failure')
      return { relativePath: '报告.txt' }
    } }))
  assert.equal((await execute('synthetic_batch', { fail: true })).isError, true)
  assert.equal(deliveries(owner).length, 1)
  assert.equal((await execute('synthetic_batch', {})).isError, false)
  assert.equal(deliveries(owner).length, 2)
  report.checks.push('nested output waits for the final successful transport')
  const replay = Session.create(owner.id, owner.session.snapshotEvents(), owner.session.header)
  assert.equal(replay.snapshotEvents().filter(event => event.type === 'deliverables/presented').length, 2)
  report.checks.push('native delivery events survive session replay')
  report.success = true
} finally {
  await ctx.fiber.dispose()
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
}
console.log(JSON.stringify(report, null, 2))
