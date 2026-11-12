// The locked DSH Runtime end to end: a scripted model asks for a shell escalation, the real agent loop, tool pipeline
// and approval service run it, and the plugin answers before the client's answerer.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath } from 'node:fs/promises'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

async function decisionService(t, auto) {
  const bodies = []
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    bodies.push(body)
    const answers = Object.fromEntries(Object.keys(body.questions).map(id => [id, id === 'harm'
      ? { type: 'noul', noul: 0.1 } : { type: 'choice', choice: 'auto', probabilities: { auto, ask: 1 - auto } }]))
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ answers }))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)) })
  return { baseURL: `http://127.0.0.1:${server.address().port}/v1`, bodies }
}

const chunks = block => [
  { type: 'block-start', index: 0, blockType: block.type },
  ...block.type === 'text' ? [{ type: 'text-delta', index: 0, text: block.text }] : [{ type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments }],
  { type: 'block-end', index: 0, block },
  { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
  { type: 'finish', reason: { kind: block.type === 'text' ? 'stop' : 'tool-calls' } },
]

// `before` are tool calls the model makes in earlier steps; `hook` adds a pre-execute policy after the plugin's; `cd`
// moves the session's current directory before the request, as `/cd` does; `escalation` replaces the escalating bash
// call with another tool's, given the session's home; `answer` mounts the question card tool and answers its cards.
async function run(t, { auto, preset = 'auto-approval', command, workdir, before = [], hook, cd, escalation, answer }) {
  const { Context } = await import('@deepseek-ai/cordis')
  const { createUserMessage, LlmAdapter } = await import('@deepseek-ai/dsh-llm')
  const { defineTool } = await import('@deepseek-ai/dsh-tools')
  const { approveEscalation } = await import('@deepseek-ai/dsh-sandbox')
  const { baseURL, bodies } = await decisionService(t, auto)
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const root = fileURLToPath(new URL('../../../dist/dev-checks/auto-approval/runtime/', import.meta.url))
  await mkdir(root, { recursive: true })
  const home = await mkdtemp(join(root, 'run-'))
  const load = async (name, config) => { const module = await import(name); await ctx.plugin(module.default ?? module, config) }
  for (const name of ['@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-session-projection', '@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-tool-executor-native']) await load(name)
  for (const [name, config] of [
    ['@deepseek-ai/dsh-session-persistence-jsonl', { root: join(home, 'sessions') }],
    ['@deepseek-ai/dsh-agent-loop', { agents: [] }],
    ['@deepseek-ai/dsh-user-approval', {}],
    ['@deepseek-ai/dsh-working-directory', { defaultDirectory: home }],
    ['@deepseek-ai/dsh-sandbox-policy', { mode: 'workspace-write', workspaceRoot: home }],
    // The file system that confines writes to the workspace, as the desktop composes it, so file tools can escalate.
    ['@deepseek-ai/dsh-fs-sandbox', {}],
    ['@deepseek-ai/dsh-tool-fs', { read: false, readImage: false, edit: false, write: true, applyPatch: true }],
  ]) await load(name, config)
  if (answer) {
    for (const name of ['@deepseek-ai/dsh-user-questions', '@deepseek-ai/dsh-tool-ask-user']) await load(name)
    ctx.on('user-questions/request', answer)
  }
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'fixture', model: 'fixture' }) })
  // The preset table belongs to the permission plugin; only its read is used here.
  ctx.provide('permissionPresets', { current: () => preset })
  const steps = [
    ...before,
    escalation?.(home) ?? { type: 'tool-call', id: 'call-1', name: 'bash', arguments: JSON.stringify({ description: 'Copy the report', command, ...(workdir && { workdir }), sandbox_permissions: 'danger-full-access', justification: 'Write the report to Downloads' }) },
    { type: 'text', text: 'Done.' },
  ]
  let step = 0
  const requests = []
  ctx.llm.registerAdapter(['fixture'], new class extends LlmAdapter {
    resolveModel(provider, model) { return Promise.resolve({ provider, id: model, name: model }) }
    async *stream(options) { requests.push(options); yield* chunks(steps[step++]) }
  }())
  const outcomes = []
  ctx.tools.register(defineTool({
    name: 'bash', description: 'Run a shell command.',
    parameters: { description: { type: 'string', required: true }, command: { type: 'string', required: true }, workdir: { type: 'string' }, sandbox_permissions: { type: 'string' }, justification: { type: 'string' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (!args.sandbox_permissions) return 'ran'
      // The same approval path the official bash tool uses for a sandbox escalation.
      const mode = await approveEscalation({ requestedMode: args.sandbox_permissions, justification: args.justification, effectiveMode: 'workspace-write', subject: 'command' },
        { approver: ctx.get('approval'), agent: exec.agent, callId: exec.callId, toolName: 'bash', signal: exec.signal }).catch(error => error.message)
      outcomes.push(mode)
      return String(mode)
    },
  }))
  // The client's answerer composes after the plugins and declines whatever reaches it.
  const userAnswers = []
  ctx.on('approval/request', req => { userAnswers.push(req.callId); return 'rejected' })
  if (hook) ctx.on('tools/pre-execute', hook)
  await load(new URL('../lib/index.js', import.meta.url).href, { enabled: true, authMode: 'none', baseURL, model: 'fixture-model' })
  const handle = await ctx.agents.create({ sessionId: 'auto-approval-fixture', meta: { cwd: home }, agentOptions: { provider: 'fixture', model: 'fixture' } })
  if (cd) await ctx.workingDirectory.set(handle.agent, await cd(home))
  handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Copy the report to my Downloads folder.' }], source: { kind: 'user' } }))
  await handle.agent.whenIdle()
  const events = handle.agent.session.snapshotEvents()
  const notices = events.filter(({ type, data }) => type === 'user/message' && data.source.kind === 'auto-approval')
  return { home, bodies, outcomes, userAnswers, events, notices, requests }
}

const runtime = { skip: !process.env.EDUWORK_AUTO_APPROVAL_RUNTIME, timeout: 20_000 }

const call = (id, name, args) => ({ type: 'tool-call', id, name, arguments: JSON.stringify(args) })

test('real Runtime: an approved escalation runs without reaching the user, with the session read correctly', runtime, async t => {
  const result = await run(t, { auto: 0.9, command: 'cp report.csv ~/Downloads/', before: [
    call('call-w', 'write', { file_path: 'notes/new.md', content: 'x' }),
    // An earlier step reused the escalation's ID: its finished call must not make the later one ambiguous.
    call('call-1', 'bash', { description: 'List', command: 'ls' }),
  ] })
  assert.deepEqual(result.outcomes, ['danger-full-access'])
  assert.deepEqual(result.userAnswers, [])
  assert.equal(result.bodies.length, 2)
  const { state } = result.bodies[0]
  assert.deepEqual(state.用户最近的消息, ['Copy the report to my Downloads folder.'])
  assert.equal(state.待执行的命令, 'cp report.csv ~/Downloads/')
  assert.equal(state.申请理由, 'Write the report to Downloads')
  assert.deepEqual(state.之前执行的命令, ['ls'])
  assert.equal(state.本次会话创建的文件.length, 1)
  assert.match(state.本次会话创建的文件[0], /notes\/new\.md$/)
  const decided = result.events.filter(event => event.type === 'approval/decided')
  assert.equal(decided.length, 1)
  assert.equal(decided[0].data.outcome, 'allowed-once')
  // The notice follows the call's result into the next step.
  assert.deepEqual(result.notices.map(({ data }) => data.source), [{ kind: 'auto-approval', form: 'notice', summary: '已自动放行（分数 0.900）' }])
  assert.match(JSON.stringify(result.requests.at(-1).messages), /<system-reminder>\\n自动审批放行了这次越界申请，没有询问用户（bash）。这条是运行环境的记录，不是用户发的消息。/)
})

test('real Runtime: after the session changes directory, the workspace is still the sandbox boundary', runtime, async t => {
  const outside = async home => { await mkdir(`${home}-outside`); return `${home}-outside` }
  const result = await run(t, { auto: 0.9, command: 'cp report.csv ~/Downloads/', workdir: 'sub', cd: outside })
  const { state } = result.bodies[0]
  assert.equal(state.工作区, await realpath(result.home))
  assert.equal(state.当前目录, join(await realpath(`${result.home}-outside`), 'sub'))
})

test('real Runtime: a call another policy asks about goes to the user without a review', runtime, async t => {
  const result = await run(t, { auto: 0.9, command: 'cp report.csv ~/Downloads/', hook: (exec, next) => exec.name === 'bash' ? { kind: 'ask', reason: 'hook asks' } : next() })
  assert.equal(result.bodies.length, 0)
  assert.deepEqual(result.userAnswers, ['call-1'])
  assert.deepEqual(result.outcomes, [])
  assert.deepEqual(result.notices, [])
})

test('real Runtime: a low score and another preset leave the decision to the user', runtime, async t => {
  const low = await run(t, { auto: 0.6, command: 'git push origin main' })
  assert.equal(low.bodies.length, 1)
  assert.match(low.bodies[0].state.风险标记, /^推送和发布（命令里的这一段：git push origin main）$/)
  assert.deepEqual(low.userAnswers, ['call-1'])
  assert.match(low.outcomes[0], /rejected/)
  assert.deepEqual(low.notices.map(({ data }) => data.source.summary), ['交给用户确认（命中规则，分数 0.600）'])
  const other = await run(t, { auto: 0.9, preset: 'workspace-write', command: 'cp report.csv ~/Downloads/' })
  assert.equal(other.bodies.length, 0)
  assert.deepEqual(other.userAnswers, ['call-1'])
  assert.deepEqual(other.notices, [])
})

test('real Runtime: a file tool escalation is reviewed with the file it writes, then the write runs', runtime, async t => {
  let outside
  const result = await run(t, { auto: 0.9, escalation: home => {
    outside = `${home}-outside`
    return call('call-1', 'write', { file_path: '../' + outside.split('/').pop() + '/report.md', content: '# Report\n', sandbox_permissions: 'danger-full-access', justification: 'Write the report next to the workspace' })
  } })
  assert.deepEqual(result.userAnswers, [])
  assert.equal(result.bodies.length, 2)
  const { state } = result.bodies[0]
  assert.match(state.系统, /，文件工具 write$/)
  assert.equal(state.待执行的命令, `cat > ../${outside.split('/').pop()}/report.md <<'EOF'\n# Report\nEOF`)
  assert.deepEqual(state.目标文件, [`${join(await realpath(join(outside, '..')), outside.split('/').pop())}/report.md：还不存在，会新建`])
  assert.equal(await readFile(join(outside, 'report.md'), 'utf8'), '# Report\n')
  assert.deepEqual(result.notices.map(({ data }) => data.source.summary), ['已自动放行（分数 0.900）'])
})

test('real Runtime: the user\'s answer on a question card is read as their reply to it', runtime, async t => {
  const card = { id: 'dest', question: '报告放到哪里？', options: [{ label: '下载目录', description: '复制到 ~/Downloads' }, { label: '不用了' }] }
  const result = await run(t, { auto: 0.9, command: 'cp report.csv ~/Downloads/', before: [call('call-q', 'ask_user_question', { questions: [card] })],
    answer: () => ({ answers: [{ id: 'dest', selected: ['下载目录'] }] }) })
  assert.deepEqual(result.userAnswers, [])
  const { state } = result.bodies[0]
  assert.deepEqual(state.用户最近的消息, ['Copy the report to my Downloads folder.', '选择“下载目录”'])
  assert.equal(state.用户回复的助手消息, '报告放到哪里？\n- 下载目录：复制到 ~/Downloads\n- 不用了')
})
