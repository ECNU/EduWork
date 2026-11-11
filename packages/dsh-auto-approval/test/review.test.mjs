import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reviewRequest, scriptOf, sessionFacts, THRESHOLDS, verdict } from '../lib/review.js'

const user = text => ({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })
const assistant = text => ({ type: 'assistant/message', data: { message: { content: text ? [{ type: 'text', text }] : [] } } })
const call = (callId, name, args) => ({ type: 'tool/call', data: { callId, name, arguments: JSON.stringify(args) } })

test('session facts: recent requests, the message the latest one replied to and earlier commands, up to the pending call', () => {
  const events = [
    user('first request'), assistant('first answer'),
    call('pending', 'bash', { command: 'npm test' }), // an earlier step reused the ID
    call('c2', 'write', { file_path: 'notes/plan.md', content: 'x' }),
    { type: 'user/message', data: { source: { kind: 'tool' }, content: [{ type: 'text', text: 'tool output is not the user' }] } },
    user('second request'), user('third request'), assistant('Shall I deploy to the test server?'), assistant(''),
    user('x'.repeat(400)),
    call('c4', 'pwsh', { command: 'Get-ChildItem' }),
    call('pending', 'bash', { command: 'ssh test-host deploy', sandbox_permissions: 'danger-full-access' }),
    call('later', 'bash', { command: 'not seen' }),
  ]
  const facts = sessionFacts(events, 'pending')
  assert.deepEqual(facts.requests, ['second request', 'third request', 'x'.repeat(300)])
  assert.equal(facts.assistant, 'Shall I deploy to the test server?')
  assert.deepEqual(facts.history, ['npm test', 'Get-ChildItem'])
  assert.deepEqual(sessionFacts(events.slice(0, 3), 'missing').history, ['npm test'])
})

test('the review state keeps the evaluated field order; a rule hit quotes its part and asks one question', () => {
  const facts = { requests: ['部署到测试服务器'], assistant: '要部署吗？', history: [], created: [] }
  const flagged = reviewRequest({ system: 'macOS，shell 为 bash', workspace: '/work', cwd: '/work/site', facts, justification: '部署', command: "npm run build && ssh test-host 'deploy'" })
  assert.deepEqual(Object.keys(flagged.state), ['系统', '工作区', '当前目录', '本次会话创建的文件', '用户回复的助手消息', '用户最近的消息', '申请理由', '之前执行的命令', '风险标记', '待执行的命令'])
  assert.equal(flagged.state.工作区, '/work')
  assert.equal(flagged.state.当前目录, '/work/site')
  assert.equal(flagged.state.风险标记, "远程连接（命令里的这一段：ssh test-host 'deploy'）")
  assert.equal(flagged.flagged, true)
  assert.deepEqual(flagged.questions.map(Object.keys), [['decision']])
  assert.match(flagged.questions[0].decision.instructions, /括号里是命令里对应的那一段/)

  const plain = reviewRequest({ system: 'macOS，shell 为 bash', facts: { requests: [], assistant: '', history: [], created: [] }, command: 'mkdir -p ~/Downloads/out', script: { 'run.sh': 'echo hi' } })
  assert.equal(plain.state.风险标记, '无')
  assert.equal(plain.state.工作区, '（未知）')
  assert.equal(plain.state.申请理由, '（无）')
  assert.deepEqual(plain.state.命令要运行的脚本内容, { 'run.sh': 'echo hi' })
  assert.deepEqual(plain.questions.map(Object.keys), [['decision'], ['harm']])
  assert.doesNotMatch(plain.questions[0].decision.instructions, /括号里/)
  assert.match(plain.questions[1].harm.instructions, /按脚本实际会做的事判断/)
})

test('the rules also see the content of the script a command runs', () => {
  const facts = { requests: [], assistant: '', history: [], created: [] }
  assert.equal(reviewRequest({ cwd: '/w', facts, command: 'bash tools/sync.sh', script: { 'tools/sync.sh': 'rsync -a out/ host.example:/srv/' } }).flagged, true)
})

test('scriptOf reads the script a command runs, following cd, and truncates long ones', async () => {
  const root = fileURLToPath(new URL('../../../dist/dev-checks/auto-approval/', import.meta.url))
  await mkdir(root, { recursive: true })
  const dir = await mkdtemp(join(root, 'script-'))
  await mkdir(join(dir, 'tools'))
  await writeFile(join(dir, 'tools/sync.sh'), 'rsync -a out/ host.example:/srv/\n')
  await writeFile(join(dir, 'big.py'), 'x'.repeat(20000))
  assert.deepEqual(await scriptOf('cd tools && bash sync.sh', dir), { 'sync.sh': 'rsync -a out/ host.example:/srv/\n' })
  assert.deepEqual(await scriptOf(`${dir}/tools/sync.sh --dry-run`, '/'), { [`${dir}/tools/sync.sh`]: 'rsync -a out/ host.example:/srv/\n' })
  const big = await scriptOf('python3 -I big.py', dir)
  assert.equal(big['big.py'].length, 16000 + '\n…（后面还有内容，未附上）'.length)
  assert.equal(await scriptOf('bash missing.sh', dir), undefined)
  assert.equal(await scriptOf('ls tools', dir), undefined)
  assert.equal(await scriptOf('bash tools', dir), undefined)
})

test('verdict: thresholds per kind, malformed answers are failures', () => {
  const choice = auto => ({ answers: { decision: { type: 'choice', choice: auto >= 0.5 ? 'auto' : 'ask', probabilities: { auto, ask: 1 - auto } } } })
  const harm = noul => ({ answers: { harm: { type: 'noul', noul } } })
  assert.deepEqual(verdict(true, [choice(THRESHOLDS.flagged)]), { score: THRESHOLDS.flagged, approved: true })
  assert.equal(verdict(true, [choice(0.69)]).approved, false)
  const mean = verdict(false, [choice(0.6), harm(0.4)])
  assert.ok(Math.abs(mean.score - 0.6) < 1e-9 && mean.approved)
  assert.equal(verdict(false, [choice(0.6), harm(0.8)]).approved, false)
  assert.throws(() => verdict(true, [{ answers: { decision: { type: 'choice', choice: null } } }]), /auto/)
  assert.throws(() => verdict(false, [choice(0.9), { answers: { harm: { type: 'noul' } } }]), /harm/)
})
