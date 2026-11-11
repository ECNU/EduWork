// What the decision model is shown about one escalation request, and how its answers become a verdict. Pure
// functions over session events and file contents, so they can be tested without a Host.
import { lstat, open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { executedPart, ruleMatch, split } from './rules.js'
import { questionsFor } from './questions.js'

export const SHELLS = new Set(['bash', 'pwsh'])
// Thresholds measured on labeled real requests: no request that should have been asked scored above them.
export const THRESHOLDS = Object.freeze({ flagged: 0.7, other: 0.5 })
const SCRIPT_CHARS = 16000

const textOf = content => Array.isArray(content) ? content.filter(block => block?.type === 'text').map(block => block.text).join('\n').trim() : ''
const parsed = raw => {
  if (typeof raw !== 'string') return raw
  try { return JSON.parse(raw) } catch { return undefined }
}

/**
 * Read the session up to the pending call: the user's messages, the assistant message the latest one replied to and
 * the shell commands run before.
 * @param {readonly object[]} events - the session log in order.
 * @param {string} callId - the pending call; reading stops at its log entry, the last one with this ID since IDs are
 *   only unique within a step.
 */
export function sessionFacts(events, callId) {
  const end = events.findLastIndex(({ type, data }) => type === 'tool/call' && data.callId === callId)
  const requests = [], history = []
  let assistant = '', lastAssistant = ''
  for (const { type, data } of end < 0 ? events : events.slice(0, end)) {
    if (type === 'user/message' && data.source?.kind === 'user') {
      const text = textOf(data.content)
      if (text) { requests.push(text.slice(0, 300)); assistant = lastAssistant }
    } else if (type === 'assistant/message') {
      lastAssistant = textOf(data.message?.content) || lastAssistant
    } else if (type === 'tool/call' && SHELLS.has(data.name)) {
      const command = parsed(data.arguments)?.command
      if (typeof command === 'string') history.push(command.slice(0, 300))
    }
  }
  return { requests: requests.slice(-3), assistant: assistant.slice(-1000), history: history.slice(-6) }
}

// A segment that runs a script file, directly or through an interpreter with options that neither take inline code
// (`node -e`, `python3 -c`, `bash -c`) nor only check syntax (`bash -n`); `cd` segments before it move the base.
const RUNS = /^(?:\w+=\S*\s+)*(?:(?:python3?(?:\s+-[BEIOSsu]+)*|node|(?:bash|sh|zsh)(?:\s+-[eluvx]+)*|pwsh(?:\s+-(?:NoProfile|NonInteractive|NoLogo|ExecutionPolicy\s+\w+))*(?:\s+-File)?)\s+)?["']?([^\s;&|<>"']+\.(?:py|mjs|js|sh|ps1))["']?(?:\s|$)/
const home = path => path.replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/, homedir())

/**
 * The content of the first local script the command runs, read from disk, so the rules and the model see what it
 * does. Missing, unreadable or non-regular files are left out.
 * @returns {Promise<Record<string, string> | undefined>} the script path as written, mapped to its text.
 */
export async function scriptOf(command, cwd) {
  if (!cwd) return undefined
  let dir = cwd
  for (const segment of split(executedPart(command))) {
    const cd = segment.match(/^cd\s+["']?([^"';&|]+?)["']?$/)
    if (cd) { dir = resolve(dir, home(cd[1])); continue }
    const path = segment.match(RUNS)?.[1]
    if (!path) continue
    const file = resolve(dir, home(path))
    if (!(await lstat(file).catch(() => undefined))?.isFile()) return undefined
    const handle = await open(file, 'r')
    try {
      const { buffer, bytesRead } = await handle.read({ buffer: Buffer.alloc(SCRIPT_CHARS * 4), position: 0 })
      const text = buffer.subarray(0, bytesRead).toString('utf8')
      const size = (await handle.stat()).size
      return { [path]: text.length > SCRIPT_CHARS || bytesRead < size ? text.slice(0, SCRIPT_CHARS) + '\n…（后面还有内容，未附上）' : text }
    } finally { await handle.close() }
  }
  return undefined
}

/**
 * The request as the decision model sees it, in the field order it was evaluated with.
 * @returns {{ state: object, questions: object[], flagged: boolean }}
 */
export function reviewRequest({ system, workspace, cwd, facts, justification, command, script }) {
  const rule = ruleMatch([executedPart(command), ...Object.values(script ?? {})].join('\n'))
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
  }
  return { state, questions: questionsFor({ flagged: Boolean(rule), script: Boolean(script) }), flagged: Boolean(rule) }
}

const probability = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
/**
 * Turn the decision model's answers into a score and a verdict. A rule hit is scored by the choice alone; other
 * requests by the mean of P(approve) and P(easy to undo).
 * @param {boolean} flagged
 * @param {object[]} results - one result per question set, in the order of `questions`.
 */
export function verdict(flagged, results) {
  const approve = results[0]?.answers?.decision?.probabilities?.auto
  if (!probability(approve)) throw new Error('Decision response has no probability for auto')
  if (flagged) return { score: approve, approved: approve >= THRESHOLDS.flagged }
  const harm = results[1]?.answers?.harm?.noul
  if (!probability(harm)) throw new Error('Decision response has no probability for harm')
  const score = (approve + 1 - harm) / 2
  return { score, approved: score >= THRESHOLDS.other }
}
