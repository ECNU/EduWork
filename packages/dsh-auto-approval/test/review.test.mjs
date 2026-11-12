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

test('session facts: an answer on a question card is the user\'s reply to that card, in time or after the call timed out', () => {
  const folder = { id: 'old', header: '旧文件夹', question: '~/synthetic-old 要怎么处理？', options: [{ label: '删除', description: '直接删掉' }, { label: '保留' }] }
  const target = { id: 'where', question: '放在哪里？' }
  const result = (callId, value, isError = false) => ({ type: 'tool/result', data: { message: { toolCallId: callId, isError, content: [{ type: 'text', text: JSON.stringify(value) }] } } })
  const late = (callId, questions, answers) => ({ type: 'user/message', data: { source: { kind: 'user-question-reply', callId, outcome: 'answered' }, content: [{ type: 'text', text: JSON.stringify({ kind: 'answer_to_pending_question', tool: 'ask_user_question', callId, questions, answers }) }] } })
  const events = [
    user('清理一下主目录'), assistant('先看看有哪些旧文件夹'),
    call('q1', 'ask_user_question', { questions: [folder] }),
    result('q1', { answers: [{ id: 'old', selected: ['删除'] }] }),
    call('pending', 'bash', { command: 'rm -rf ~/synthetic-old', sandbox_permissions: 'danger-full-access' }),
  ]
  const facts = sessionFacts(events, 'pending')
  assert.deepEqual(facts.requests, ['清理一下主目录', '选择“删除”'])
  assert.equal(facts.assistant, '~/synthetic-old 要怎么处理？\n- 删除：直接删掉\n- 保留')
  // A timed-out call's result is no answer; the late reply carries the questions. Several questions are named,
  // a free-form answer is quoted and a skipped one says so.
  const timed = [
    user('整理文件'),
    call('q2', 'ask_user_question', { questions: [folder, target] }),
    result('q2', { pending: true, callId: 'q2', message: 'no answer yet' }),
    result('q3', { answers: [{ id: 'x', selected: ['not a card'] }] }),
    late('q2', [folder, target], [{ id: 'old', selected: [] }, { id: 'where', selected: [], custom: ' ~/Archive ' }]),
    call('pending', 'bash', { command: 'mv x ~/Archive/', sandbox_permissions: 'danger-full-access' }),
  ]
  assert.deepEqual(sessionFacts(timed, 'pending').requests, ['整理文件', '旧文件夹：跳过；放在哪里？：填写：~/Archive'])
  // A failed card call adds nothing.
  const failed = [user('整理文件'), call('q4', 'ask_user_question', { questions: [folder] }), result('q4', { answers: [{ id: 'old', selected: ['删除'] }] }, true)]
  assert.deepEqual(sessionFacts(failed, 'none').requests, ['整理文件'])
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

test('a file tool changing a file that was there before the session is told apart from one it made or creates', () => {
  const facts = { requests: [], assistant: '', history: [], created: ['/w/mine.md'] }
  const existing = (...files) => reviewRequest({ facts, command: 'x', files: files.map(file => ({ display: file.real, change: 'edit', ...file })) }).existing
  assert.equal(existing({ real: '/w/new.md', exists: false, change: 'write' }), false)
  assert.equal(existing({ real: '/w/mine.md', exists: true }), false)
  assert.equal(existing({ real: '/w/mine.md', exists: true }, { real: '/w/old.md', exists: true }), true)
  // Moved onto a file that is there, which it replaces.
  const moved = { real: '/w/mine.md', exists: true, to: { display: '/w/old.md', real: '/w/old.md', exists: true } }
  assert.equal(existing(moved), true)
  assert.deepEqual(reviewRequest({ facts, command: 'x', files: [{ display: '/w/mine.md', change: 'edit', ...moved }] }).state.目标文件,
    ['/w/mine.md：已存在，会被修改（本次会话创建的），并移到 /w/old.md（已存在，会被替换）'])
  assert.equal(existing({ ...moved, to: { display: 'a', real: '/w/a.md', exists: false } }), false)
  assert.equal(reviewRequest({ facts, command: 'npm test' }).existing, false)
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
  assert.deepEqual(await scriptOf('  ./task.sh\n', work), { './task.sh': 'echo here' })
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
  for (const path of ['task.sh', 'tools/task.sh', 'tools extra/task.sh', '$DIR/task.sh', 'quoted.sh', 'quoted.sh extra.sh', 'run.ps1', '+task.sh']) await writeFile(join(dir, path), 'echo x')
  assert.deepEqual(await scriptOf('bash ./+task.sh', dir), { './+task.sh': 'echo x' })
  for (const command of [
    // A bare name runs from PATH; inline code and syntax checks do not run the file they name.
    'task.sh --all', 'bash +task.sh', "bash '+task.sh'", 'sh +task.sh', 'node -e "task.sh"', 'node -p task.sh', 'python3 -c task.sh', 'bash -c tools/task.sh', 'bash -n tools/task.sh', 'bash -l tools/task.sh', 'pwsh -File run.ps1',
    // Sequences, cd, variables, globs, quoting and comments.
    'cd tools && bash task.sh', 'cd tools | cat; bash task.sh', 'DIR=tools; bash $DIR/task.sh', 'BASH_ENV=./startup.sh bash task.sh', 'NODE_ENV=production node task.sh', 'bash $DIR/task.sh', 'bash t*.sh', 'bash "quoted.sh extra.sh"',
    'exit 0; bash task.sh', 'false && bash task.sh', 'bash task.sh > task.sh', 'bash task.sh\r', 'bash task.sh\u00a0', 'bash task.sh\u2028', './tools/../task.sh', 'node tools/../task.sh', 'printf done # ; cd tools\nbash task.sh', "node <<'JS'\n// ; bash task.sh\nJS", 'bash task.sh | tee log',
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
  // A file that was there before: approved only if the model also judges the change requested.
  assert.ok(verdict(false, [choice(0.4), harm(0.1)]).approved)
  assert.deepEqual(verdict(false, [choice(0.4), harm(0.1)], true), { score: 0.4, approved: false })
  assert.ok(Math.abs(verdict(false, [choice(0.9), harm(0.6)], true).score - 0.65) < 1e-9)
  assert.throws(() => verdict(true, [{ answers: { decision: { type: 'choice', choice: null } } }]), /abstained/)
  assert.throws(() => verdict(true, [{ answers: { decision: { type: 'choice', choice: null, probabilities: { auto: 1, ask: 0 } } } }]), /abstained/)
  assert.throws(() => verdict(true, [{ answers: { decision: { type: 'choice', choice: 'auto' } } }]), /auto/)
  assert.throws(() => verdict(false, [choice(0.9), { answers: { harm: { type: 'noul' } } }]), /harm/)
})
