// What the decision model is shown about one escalation request, and how its answers become a verdict. Pure
// functions over session events and file contents, so they can be tested without a Host.
import { parsePatch } from '@deepseek-ai/dsh-fs-patch'
import { access, constants, lstat, open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, relative, sep } from 'node:path'
import { executedPart, ruleMatch } from './rules.js'
import { questionsFor } from './questions.js'

export const SHELLS = new Set(['bash', 'pwsh'])
export const FILE_TOOLS = new Set(['write', 'edit', 'apply_patch'])
// Thresholds measured on labeled real requests: no request that should have been asked scored above them.
export const THRESHOLDS = Object.freeze({ flagged: 0.7, other: 0.5 })
const SCRIPT_CHARS = 16000

const textOf = content => Array.isArray(content) ? content.filter(block => block?.type === 'text').map(block => block.text).join('\n').trim() : ''
const parsed = raw => {
  if (typeof raw !== 'string') return raw
  try { return JSON.parse(raw) } catch { return undefined }
}

// A long user message keeps its opening and its end, where a reply to the text it quotes usually is. Counted in
// characters, so none is cut in half.
const clip = text => {
  const chars = [...text]
  return chars.length > 300 ? `${chars.slice(0, 100).join('')}…（中间省略 ${chars.length - 300} 字）…${chars.slice(-200).join('')}` : text
}

// A question card the agent showed, as the message the user's answer replied to, and the answer in the user's terms.
const card = questions => questions.map(({ question, options = [] }) =>
  [question, ...options.map(({ label, description }) => `- ${label}${description ? `：${description}` : ''}`)].join('\n')).join('\n')
function answerOf(questions, answers) {
  return answers.map(({ id, selected, custom }) => {
    const text = [selected.length ? `选择${selected.map(label => `“${label}”`).join('')}` : '', custom?.trim() ? `填写：${custom.trim()}` : '']
      .filter(Boolean).join('，') || '跳过'
    const question = questions.find(item => item.id === id)
    return questions.length > 1 ? `${question?.header ?? question?.question ?? id}：${text}` : text
  }).join('；')
}

/**
 * Read the session up to the pending call: the user's messages and answers to the agent's question cards, the
 * assistant message or card the latest one replied to, and the shell commands run before.
 * @param {readonly object[]} events - the session log in order.
 * @param {string} callId - the pending call; reading stops at its log entry, the last one with this ID since IDs are
 *   only unique within a step.
 */
export function sessionFacts(events, callId) {
  const end = events.findLastIndex(({ type, data }) => type === 'tool/call' && data.callId === callId)
  const requests = [], history = [], cards = new Map()
  let assistant = '', lastAssistant = ''
  const reply = (text, to) => { if (text) { requests.push(clip(text)); assistant = to } }
  // An answer given while the card's call waited is that call's result; one given after the call timed out arrives as
  // a user message naming the call and carrying its questions.
  const answered = (questions, answers) => {
    if (Array.isArray(questions) && Array.isArray(answers)) reply(answerOf(questions, answers), card(questions))
  }
  for (const { type, data } of end < 0 ? events : events.slice(0, end)) {
    if (type === 'user/message' && data.source?.kind === 'user') {
      reply(textOf(data.content), lastAssistant)
    } else if (type === 'user/message' && data.source?.kind === 'user-question-reply') {
      const { questions, answers } = parsed(textOf(data.content)) ?? {}
      answered(questions, answers)
    } else if (type === 'assistant/message') {
      lastAssistant = textOf(data.message?.content) || lastAssistant
    } else if (type === 'tool/call') {
      // A later step may reuse a card's ID: the ID stands for the card only until the card's own first result.
      cards.delete(data.callId)
      if (data.name === 'ask_user_question') cards.set(data.callId, parsed(data.arguments)?.questions)
      else if (SHELLS.has(data.name)) {
        const command = parsed(data.arguments)?.command
        if (typeof command === 'string') history.push(command.slice(0, 300))
      }
    } else if (type === 'tool/result' && cards.has(data.message?.toolCallId)) {
      const questions = cards.get(data.message.toolCallId)
      cards.delete(data.message.toolCallId)
      if (!data.message.isError) answered(questions, parsed(textOf(data.message.content))?.answers)
    }
  }
  return { requests: requests.slice(-3), assistant: assistant.slice(-1000), history: history.slice(-6) }
}

// Which file a command runs is known from its text alone only in one form: a single bash command running a literal
// path, directly or through an interpreter whose options take no code (`node -e`, `python3 -c`, `bash -c`), are
// no syntax check (`bash -n`) and read no profile first (`bash -l`), with plain arguments. Sequences, `cd`, variables (including assignments before the
// command, such as BASH_ENV), globs, redirections (which can empty the script first), `..` in the path (interpreters
// resolve it differently) and every other form attach no script; the command itself is still reviewed. Groups:
// interpreter, quote, file; a file starting with - or + would be read as an option.
const ARG = String.raw`(?:[\w./:,@%+=-]+|'[^']*'|"[^"$\x60\\!]*")`
const RUNS = new RegExp(String.raw`^(?:(python3?(?:[ \t]+-[BEIOSsu]+)*|node|(?:bash|sh|zsh)(?:[ \t]+-[euvx]+)*)[ \t]+)?(["']?)((?:~/)?(?![-+])[\w./@+-]+\.(?:py|mjs|js|sh))\2(?:[ \t]+${ARG})*[ \t]*$`)

/**
 * The content of the script a bash command runs, read from disk, so the rules and the model see what it does. Missing,
 * unreadable or non-regular files are left out.
 * @returns {Promise<Record<string, string> | undefined>} the script path as written, mapped to its text.
 */
export async function scriptOf(command, cwd) {
  // Only the separators bash itself skips are trimmed: a carriage return or a Unicode space is part of the name.
  const [, interpreter, quote, path] = command.replace(/^[ \t\n]+|[ \t\n]+$/g, '').match(RUNS) ?? []
  // A bare name run without an interpreter is looked up on PATH, not in the current directory.
  if (!cwd || !path || (!interpreter && !path.includes('/')) || path.split('/').includes('..')) return undefined
  // Quotes keep `~` literal.
  const expanded = quote ? path : path.replace(/^~(?=\/)/, homedir())
  const file = isAbsolute(expanded) ? expanded : `${cwd}${sep}${expanded}`
  if (!(await lstat(file).catch(() => undefined))?.isFile()) return undefined
  // Run directly, a file this process may not execute is refused by the shell and never runs.
  if (!interpreter && await access(file, constants.X_OK).then(() => false, () => true)) return undefined
  const handle = await open(file, 'r')
  try {
    const { buffer, bytesRead } = await handle.read({ buffer: Buffer.alloc(SCRIPT_CHARS * 4), position: 0 })
    const text = buffer.subarray(0, bytesRead).toString('utf8')
    const size = (await handle.stat()).size
    return { [path]: text.length > SCRIPT_CHARS || bytesRead < size ? text.slice(0, SCRIPT_CHARS) + '\n…（后面还有内容，未附上）' : text }
  } finally { await handle.close() }
}

// A file tool's call is shown as what it amounts to: write as the shell command with the same effect, edit as a patch,
// apply_patch as written. What a file holds does not make writing it risky, so long contents are cut; every file the
// call changes, and how, is listed apart from the command.
const CONTENT_CHARS = 4000
const cut = (text, limit) => text.length > limit ? `${text.slice(0, limit)}\n…（后面还有 ${text.length - limit} 字符，未列出）` : text
const prefixed = (prefix, text) => text.replace(/\n$/, '').split('\n').map(line => prefix + line).join('\n')
const quoted = path => /^[\w./~@%+=:,-]+$/.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`

/** @returns {string} the call shown in place of a shell command. */
export function fileCommand(tool, args) {
  if (tool === 'write') {
    const body = cut(args.content.replace(/\n$/, ''), CONTENT_CHARS), lines = body.split('\n')
    // Quoted, so the shell would write the body as it is; a line equal to the delimiter would end it early.
    let end = 'EOF'
    for (let i = 1; lines.includes(end); i++) end = `EOF_${i}`
    return `cat > ${quoted(args.file_path)} <<'${end}'\n${body}\n${end}`
  }
  if (tool === 'edit') {
    return ['*** Begin Patch', `*** Update File: ${args.file_path}`, args.replace_all ? '@@ （替换所有匹配处）' : '@@',
      prefixed('-', cut(args.old_string, CONTENT_CHARS / 2)), prefixed('+', cut(args.new_string, CONTENT_CHARS / 2)), '*** End Patch'].join('\n')
  }
  const out = []
  let used = 0, left = 0
  const note = () => { if (left) out.push(`…（这一段后面还有 ${left} 字符，未列出）`); used = left = 0 }
  for (const line of args.input.split('\n')) {
    if (/^\*\*\* (?:Add|Update|Delete) File: |^\*\*\* End Patch/.test(line)) { note(); out.push(line) }
    else if (left || used + line.length > CONTENT_CHARS) left += line.length + 1
    else { used += line.length + 1; out.push(line) }
  }
  note()
  return out.join('\n')
}

/**
 * The files a file tool's call changes, by the path written in it: written whole (a new file or a replacement),
 * edited in place, possibly moved, or deleted.
 * @returns {{ path: string, change: 'write' | 'edit' | 'delete', to?: string }[]}
 */
export function fileChanges(tool, args) {
  if (tool === 'write') return [{ path: args.file_path, change: 'write' }]
  if (tool === 'edit') return [{ path: args.file_path, change: 'edit' }]
  return parsePatch(args.input).map(op => op.kind === 'add' ? { path: op.path, change: 'write' } : op.kind === 'delete'
    ? { path: op.path, change: 'delete' } : { path: op.path, change: 'edit', ...(op.moveTo !== undefined && { to: op.moveTo }) })
}

const STATES = { write: ['还不存在，会新建', '已存在，会被整个替换'], edit: ['不存在', '已存在，会被修改'], delete: ['不存在', '已存在，会被删除'] }
const home = path => {
  const rest = relative(homedir(), path)
  return rest && !rest.startsWith('..') && !isAbsolute(rest) ? `~/${rest.split(sep).join('/')}` : path
}
// The rules judge a file change by the shell command with the same effect on the real path, a move as writing its
// destination too: a file written to a shell start-up file or ~/.config counts as changing software settings, one
// under ~/.ssh as touching credentials.
function fileRule(files) {
  for (const { real, change, to } of files) {
    const hit = ruleMatch([change === 'delete' ? `rm ${home(real)}` : `cat > ${home(real)}`, ...(to ? [`cat > ${home(to.real)}`] : [])].join('\n'))
    if (hit) return hit
  }
  return null
}

/**
 * The request as the decision model sees it, in the field order it was evaluated with. A file tool's call comes with
 * `files`: each changed file's real path, whether it exists, the change and, for a move, the destination.
 * @returns {{ state: object, questions: object[], flagged: boolean, existing: boolean }} `existing`: the call changes
 *   a file that was there before the session.
 */
export function reviewRequest({ system, workspace, cwd, facts, justification, command, script, files }) {
  const rule = files ? fileRule(files) : ruleMatch([executedPart(command), ...Object.values(script ?? {})].join('\n'))
  // By the real path only, as the created files are recorded: the path as written may now lead elsewhere.
  const own = file => facts.created.includes(file.real)
  const before = file => file?.exists && !own(file)
  const state = {
    系统: system,
    工作区: workspace || '（未知）',
    当前目录: cwd || '（未知）',
    本次会话创建的文件: facts.created.length ? facts.created : '无',
    用户回复的助手消息: facts.assistant || '（无）',
    用户最近的消息: facts.requests.length ? facts.requests : '（无）',
    申请理由: justification || '（无）',
    之前执行的命令: facts.history.length ? facts.history : '（无）',
    风险标记: rule ? `${rule.name}（命令里的这一段：${rule.part.replace(/\s+/g, ' ').slice(0, 300)}）` : '无',
    待执行的命令: command,
    ...(script && { 命令要运行的脚本内容: script }),
    ...(files && { 目标文件: files.map(file => `${file.real}：${STATES[file.change][Number(file.exists)]}${file.exists && own(file) ? '（本次会话创建的）' : ''}`
      + (file.to ? `，并移到 ${file.to.real}${file.to.exists ? `（已存在，会被替换${own(file.to) ? '，本次会话创建的' : ''}）` : ''}` : '')) }),
  }
  return { state, questions: questionsFor({ flagged: Boolean(rule), script: Boolean(script) }), flagged: Boolean(rule),
    existing: Boolean(files?.some(file => before(file) || before(file.to))) }
}

const probability = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
/**
 * Turn the decision model's answers into a score and a verdict. A rule hit is scored by the choice alone; other
 * requests by the mean of P(approve) and P(easy to undo). A file tool changing a file that was there before the session
 * is approved only when the user asked for it as well: its score is at most P(approve), so a small edit the model
 * judges unrequested is not let through for being easy to undo.
 * @param {boolean} flagged
 * @param {object[]} results - one result per question set, in the order of `questions`.
 * @param {boolean} [existing]
 */
export function verdict(flagged, results, existing = false) {
  const decision = results[0]?.answers?.decision
  // An abstention is no answer, whatever probabilities come with it.
  if (decision?.choice === null) throw new Error('Decision service abstained')
  const approve = decision?.probabilities?.auto
  if (!probability(approve)) throw new Error('Decision response has no probability for auto')
  if (flagged) return { score: approve, approved: approve >= THRESHOLDS.flagged }
  const harm = results[1]?.answers?.harm?.noul
  if (!probability(harm)) throw new Error('Decision response has no probability for harm')
  const mean = (approve + 1 - harm) / 2
  const score = existing ? Math.min(mean, approve) : mean
  return { score, approved: score >= THRESHOLDS.other }
}
