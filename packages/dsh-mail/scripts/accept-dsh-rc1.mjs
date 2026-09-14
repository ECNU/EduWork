import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { decideMailPermission } from '../src/host/permission.js'

const runtimeRoot = process.env.DSH_RUNTIME_ROOT
const expectedDsh = process.argv[2] ?? '0.1.2-rc.1'
if (!['0.1.2-rc.1', '0.1.3-alpha.1', '0.1.3-alpha.2', '0.1.5-alpha.1', '0.1.5-rc.1'].includes(expectedDsh)) throw new Error(`Unsupported DSH acceptance target: ${expectedDsh}`)
if (!runtimeRoot) throw new Error(`Set DSH_RUNTIME_ROOT to a clean DeepSeek Harness ${expectedDsh} runtime`)
const runtimeRequire = createRequire(join(runtimeRoot, 'package.json'))
const load = async name => import(pathToFileURL(runtimeRequire.resolve(name)).href)
const versionOf = async name => JSON.parse(await readFile(runtimeRequire.resolve(`${name}/package.json`), 'utf8')).version

const exactDshPackages = [
  '@deepseek-ai/dsh-api-remotes',
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-credentials',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-permission-presets',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-session-projection',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-agent-loop',
  '@deepseek-ai/dsh-user-approval',
  '@deepseek-ai/dsh-tools',
]
for (const name of exactDshPackages) assert.equal(await versionOf(name), expectedDsh, `${name} is not ${expectedDsh}`)
assert.equal(await versionOf('@deepseek-ai/cordis'), '4.0.2')

const [{ Context }, llm, sessionModule, projection, prompt, agentModule, loop, approval, tools] = await Promise.all([
  load('@deepseek-ai/cordis'),
  load('@deepseek-ai/dsh-llm'),
  load('@deepseek-ai/dsh-session'),
  load('@deepseek-ai/dsh-session-projection'),
  load('@deepseek-ai/dsh-system-prompt'),
  load('@deepseek-ai/dsh-agent'),
  load('@deepseek-ai/dsh-agent-loop'),
  load('@deepseek-ai/dsh-user-approval'),
  load('@deepseek-ai/dsh-tools'),
])
const { ToolCallId } = llm
const { Session, SessionId } = sessionModule

function fakeAgent(label) {
  const session = Session.create(SessionId(`dsh-mail-${label}`))
  session.append('turn/start', { turn: 1 })
  return { session }
}

async function setup(preset, outcome) {
  const ctx = new Context()
  await ctx.plugin(llm.default)
  await ctx.plugin(sessionModule.default)
  await ctx.plugin(projection.default)
  await ctx.plugin(prompt.default)
  await ctx.plugin(tools.default)
  await ctx.plugin(agentModule.default)
  await ctx.plugin(loop.default, { agents: [] })
  await ctx.plugin(approval.default)
  ctx.provide('permissionPresets', { current: () => preset })
  let approvals = 0
  let deliveries = 0
  if (outcome !== undefined) ctx.on('approval/request', () => {
    approvals += 1
    return Promise.resolve(outcome)
  })
  ctx.on('tools/pre-execute', (exec, next) => decideMailPermission(ctx, exec, next))
  ctx.tools.register({
    name: 'mail_send',
    description: 'No-network SMTP delivery simulator',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: 'object',
        properties: { status: { type: 'string', enum: ['sent'] } },
        required: ['status'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: value.status }],
    },
    async execute() {
      deliveries += 1
      return { status: 'sent' }
    },
  })
  return { ctx, counts: () => ({ approvals, deliveries }) }
}

const signal = new AbortController().signal
const denied = await setup('workspace-write', 'allowed-once')
const deniedResult = await denied.ctx.tools.execute({ signal, callId: ToolCallId('agentless'), name: 'mail_send', arguments: {} })
assert.equal(deniedResult.isError, true)
assert.match(deniedResult.content[0].text, /Agent-backed session/)
assert.deepEqual(denied.counts(), { approvals: 0, deliveries: 0 })

const rejected = await setup('workspace-write', 'rejected')
const rejectedResult = await rejected.ctx.tools.execute({ signal, callId: ToolCallId('rejected'), name: 'mail_send', arguments: {}, agent: fakeAgent('rejected') })
assert.equal(rejectedResult.isError, true)
assert.match(rejectedResult.content[0].text, /user rejected/)
assert.deepEqual(rejected.counts(), { approvals: 1, deliveries: 0 })

const approved = await setup('workspace-write', 'allowed-once')
const approvedResult = await approved.ctx.tools.execute({ signal, callId: ToolCallId('approved'), name: 'mail_send', arguments: {}, agent: fakeAgent('approved') })
assert.equal(approvedResult.isError, false)
assert.deepEqual(approved.counts(), { approvals: 1, deliveries: 1 })

const fullAccess = await setup('danger-full-access', 'rejected')
const fullAccessResult = await fullAccess.ctx.tools.execute({ signal, callId: ToolCallId('full-access'), name: 'mail_send', arguments: {}, agent: fakeAgent('full-access') })
assert.equal(fullAccessResult.isError, false)
assert.deepEqual(fullAccess.counts(), { approvals: 0, deliveries: 1 })

const host = await import(new URL('../lib/index.js', import.meta.url))
assert.equal(host.name, 'dsh-mail-assistant')
assert.equal(typeof host.apply, 'function')
console.log(`DSH ${expectedDsh} ToolRuntime approval paths and built Mail Host contract accepted without network delivery.`)
