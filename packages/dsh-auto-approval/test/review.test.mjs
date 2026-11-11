import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
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

test('scriptOf reads the script a single command runs and truncates long ones', async () => {
  const root = fileURLToPath(new URL('../../../dist/dev-checks/auto-approval/', import.meta.url))
  await mkdir(root, { recursive: true })
  const dir = await mkdtemp(join(root, 'script-'))
  for (const path of ['work/tools', 'outside/nested']) await mkdir(join(dir, path), { recursive: true })
  await symlink('../outside/nested', join(dir, 'work/link'))
  const files = { 'work/task.sh': 'echo here', 'work/tools/sync.sh': 'rsync -a out/ host.example:/srv/\n', 'outside/nested/task.sh': 'echo nested',
    'work/big.py': 'x'.repeat(20000), 'work/run.mjs': 'console.log(1)', 'work/plain.sh': 'echo plain', 'work/group.sh': 'echo group',
    'work/~/task.sh': 'echo literal tilde' }
  await mkdir(join(dir, 'work/~'))
  for (const [path, text] of Object.entries(files)) await writeFile(join(dir, path), text)
  for (const path of ['work/task.sh', 'work/tools/sync.sh', 'work/~/task.sh']) await chmod(join(dir, path), 0o755)
  await chmod(join(dir, 'work/group.sh'), 0o654) // others may run it; its owner, this process, may not
  const work = join(dir, 'work')
  assert.deepEqual(await scriptOf('bash tools/sync.sh', work), { 'tools/sync.sh': files['work/tools/sync.sh'] })
  assert.deepEqual(await scriptOf(`${work}/tools/sync.sh --dry-run`, '/'), { [`${work}/tools/sync.sh`]: files['work/tools/sync.sh'] })
  assert.deepEqual(await scriptOf("bash -ex 'tools/sync.sh' prod", work), { 'tools/sync.sh': files['work/tools/sync.sh'] })
  assert.deepEqual(await scriptOf("./task.sh --all 'a > b'", work), { './task.sh': 'echo here' })
  assert.deepEqual(await scriptOf('bash link/task.sh', work), { 'link/task.sh': 'echo nested' })
  assert.deepEqual(await scriptOf('node run.mjs --port 3000', work), { 'run.mjs': 'console.log(1)' })
  // Quotes keep `~` literal: the file is the one under the current directory.
  assert.deepEqual(await scriptOf('bash "~/task.sh"', work), { '~/task.sh': 'echo literal tilde' })
  assert.deepEqual(await scriptOf("'~/task.sh'", work), { '~/task.sh': 'echo literal tilde' })
  const big = await scriptOf('python3 -I big.py', work)
  assert.equal(big['big.py'].length, 16000 + '\n…（后面还有内容，未附上）'.length)
  // Run directly, a file needs its execute bit; through an interpreter it only needs to be readable.
  assert.equal(await scriptOf('./plain.sh', work), undefined)
  assert.equal(await scriptOf('./group.sh', work), undefined)
  assert.deepEqual(await scriptOf('bash plain.sh', work), { 'plain.sh': 'echo plain' })
  for (const command of ['bash missing.sh', 'ls tools', 'bash tools']) assert.equal(await scriptOf(command, work), undefined, command)
})

test('scriptOf attaches nothing when the text alone does not say which file runs', async () => {
  const root = fileURLToPath(new URL('../../../dist/dev-checks/auto-approval/', import.meta.url))
  await mkdir(root, { recursive: true })
  const dir = await mkdtemp(join(root, 'noscript-'))
  for (const path of ['tools', 'tools extra', '$DIR']) await mkdir(join(dir, path))
  for (const path of ['task.sh', 'tools/task.sh', 'tools extra/task.sh', '$DIR/task.sh', 'quoted.sh', 'quoted.sh extra.sh', 'run.ps1']) await writeFile(join(dir, path), 'echo x')
  for (const command of [
    // A bare name runs from PATH; inline code and syntax checks do not run the file they name.
    'task.sh --all', 'node -e "task.sh"', 'node -p task.sh', 'python3 -c task.sh', 'bash -c tools/task.sh', 'bash -n tools/task.sh', 'bash -l tools/task.sh', 'pwsh -File run.ps1',
    // Sequences, cd, variables, globs, quoting and comments.
    'cd tools && bash task.sh', 'cd tools | cat; bash task.sh', 'DIR=tools; bash $DIR/task.sh', 'BASH_ENV=./startup.sh bash task.sh', 'NODE_ENV=production node task.sh', 'bash $DIR/task.sh', 'bash t*.sh', 'bash "quoted.sh extra.sh"',
    'exit 0; bash task.sh', 'false && bash task.sh', 'bash task.sh > task.sh', './tools/../task.sh', 'node tools/../task.sh', 'printf done # ; cd tools\nbash task.sh', "node <<'JS'\n// ; bash task.sh\nJS", 'bash task.sh | tee log',
  ]) assert.equal(await scriptOf(command, dir), undefined, command)
})

test('verdict: thresholds per kind, malformed answers are failures', () => {
  const choice = auto => ({ answers: { decision: { type: 'choice', choice: auto >= 0.5 ? 'auto' : 'ask', probabilities: { auto, ask: 1 - auto } } } })
  const harm = noul => ({ answers: { harm: { type: 'noul', noul } } })
  assert.deepEqual(verdict(true, [choice(THRESHOLDS.flagged)]), { score: THRESHOLDS.flagged, approved: true })
  assert.equal(verdict(true, [choice(0.69)]).approved, false)
  const mean = verdict(false, [choice(0.6), harm(0.4)])
  assert.ok(Math.abs(mean.score - 0.6) < 1e-9 && mean.approved)
  assert.equal(verdict(false, [choice(0.6), harm(0.8)]).approved, false)
  assert.throws(() => verdict(true, [{ answers: { decision: { type: 'choice', choice: null } } }]), /abstained/)
  assert.throws(() => verdict(true, [{ answers: { decision: { type: 'choice', choice: null, probabilities: { auto: 1, ask: 0 } } } }]), /abstained/)
  assert.throws(() => verdict(true, [{ answers: { decision: { type: 'choice', choice: 'auto' } } }]), /auto/)
  assert.throws(() => verdict(false, [choice(0.9), { answers: { harm: { type: 'noul' } } }]), /harm/)
})
