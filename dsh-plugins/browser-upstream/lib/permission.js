import { basename } from 'node:path'
import { isPrivateTarget, normalizeURL } from '@chatecnu-work/dsh-tool-browser/core'
import { LOOKS, QUIET, callFor, covered, elementOf, pageOf } from './read-act.js'

const prefix = 'mcp__playwright-mcp__'
const access = (ctx, exec) => exec.agent && ctx.sandboxPolicy.resolve({ session: exec.agent.session }).mode
const fullAccess = (ctx, exec) => access(ctx, exec) === 'danger-full-access'
// The address a navigation or a new tab opens.
const opens = (name, args) => name === 'browser_navigate' || name === 'browser_tabs' && args?.action === 'new' && args.url !== undefined

export function browserGuard(ctx, exec) {
  if (!exec.name.startsWith(prefix)) return
  if (!exec.agent) return 'Browser requires an Agent-backed session'
  const name = exec.name.slice(prefix.length)
  if (name === 'browser_run_code_unsafe' && !fullAccess(ctx, exec)) {
    return 'Browser host code requires full access. Use the regular browser tools for page navigation and interaction.'
  }
  if (opens(name, exec.arguments)) {
    try { normalizeURL(exec.arguments?.url) } catch { return 'Browser navigation requires an HTTP(S) URL without embedded credentials' }
  }
}

// Approval copy names the action: elements as the page shows them, and the
// values the Agent enters, shortened.
const shorten = (value, max = 60) => {
  const text = String(value).replace(/\s+/gu, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
const en = value => value === undefined ? 'a page element' : `"${shorten(value)}"`
const zh = value => value === undefined ? '页面元素' : `“${shorten(value)}”`
const files = paths => [paths.map(path => en(basename(path))).join(', '), paths.map(path => zh(basename(path))).join('、')]

// Browser steps run without asking, as in Codex's and Magentic-UI's browsers:
// the user's request covers opening pages, following links, filling in
// fields and the like. The application asks by itself only for what is risky
// whatever the task, and for going into a local or private network from
// another site. The steps the browser skill lists for the user's confirmation
// the Agent asks about itself, with browser_act's confirm.
const risky = {
  browser_evaluate: a => a.element === undefined ? ['run a script in the page', '在网页中运行脚本'] : [`run a script on ${en(a.element)}`, `对${zh(a.element)}运行脚本`],
  browser_file_upload: a => {
    if (!a.paths?.length) return
    const [nameEn, nameZh] = files(a.paths)
    return [`upload ${nameEn}`, `上传${nameZh}`]
  },
  browser_drop: a => {
    if (!a.paths?.length) return
    const [nameEn, nameZh] = files(a.paths)
    return [`drop ${nameEn} onto ${en(a.element)}`, `把${nameZh}拖放到${zh(a.element)}`]
  },
  browser_handle_dialog: a => !a.accept ? undefined
    : a.promptText === undefined ? ['accept the page\'s dialog', '确认网页弹出的对话框']
      : [`enter ${en(a.promptText)} in the page's dialog and accept it`, `在网页弹出的对话框中输入${zh(a.promptText)}并确认`],
  browser_close: () => ['close the browser', '关闭浏览器'],
}
const plain = new Set(['browser_click', 'browser_type', 'browser_fill_form', 'browser_select_option', 'browser_hover', 'browser_drag', 'browser_press_key', 'browser_navigate_back', 'browser_tabs', 'browser_resize'])
const origin = url => { try { return new URL(url).origin } catch {} }

// What a browser tool call would do that needs the user's leave, if anything,
// from the page `here` the Agent acts on, when that is known.
function question(name, args, writable, here) {
  // A screenshot reads the page as well: without a file name it comes back to
  // the Agent and is kept in MCP's own output folder, as its other output is.
  if (LOOKS.has(name)) {
    if (args.filename === undefined || writable) return
    return name === 'browser_take_screenshot' ? [`save a screenshot of the page as ${en(args.filename)}`, `把网页截图保存为${zh(args.filename)}`] : [`save page data to ${en(args.filename)}`, `把网页数据保存到${zh(args.filename)}`]
  }
  if (opens(name, args)) {
    if (!isPrivateTarget(args.url) || origin(args.url) === origin(here)) return
    return name === 'browser_navigate' ? [`open the private address ${shorten(args.url)}`, `打开本机或内网地址 ${shorten(args.url)}`]
      : [`open the private address ${shorten(args.url)} in a new tab`, `在新标签页打开本机或内网地址 ${shorten(args.url)}`]
  }
  if (plain.has(name)) return
  // Malformed arguments still ask and then reach the server's own validation.
  if (name in risky) try { return risky[name](args) } catch {}
  return [`use the browser tool ${name}`, `使用浏览器工具 ${name}`]
}
const ask = questions => {
  const reason = `Allow the Agent to ${questions.map(q => q[0]).join('; ')}`
  return { kind: 'ask', reason, displayReason: { en: reason, zh: `允许智能体${questions.map(q => q[1]).join('；')}` } }
}

// browser_act's steps, as the Agent's request for confirmation lists them.
const listed = {
  click: (_a, element) => [`click ${en(element?.name)}`, `点击${zh(element?.name)}`],
  type: (a, element) => [`type ${en(a.text)} into ${en(element?.name)}${a.submit ? ' and submit it' : ''}`, `在${zh(element?.name)}中输入${zh(a.text)}${a.submit ? '并提交' : ''}`],
  select: (a, element) => [`select ${en(a.option)} in ${en(element?.name)}`, `在${zh(element?.name)}中选择${zh(a.option)}`],
  press: a => [`press ${shorten(a.key)}`, `按下 ${shorten(a.key)} 键`],
  back: () => ['go back to the previous page', '返回上一页'],
}
// One question for the outcome the Agent asks about, which also names what the
// application itself would ask about, such as a link into a private network.
const confirmation = (why, steps, risks) => {
  const reason = `Confirm: ${shorten(why, 300)}. The Agent will ${steps.map(q => q[0]).join('; ')}${risks.length ? `. This includes: ${risks.map(q => q[0]).join('; ')}` : ''}`
  return { kind: 'ask', reason, displayReason: { en: reason, zh: `请确认：${shorten(why, 300)}。智能体将${steps.map(q => q[1]).join('；')}${risks.length ? `。其中包括：${risks.map(q => q[1]).join('；')}` : ''}` } }
}

// Final denials use tools.guard so a later pre-execute listener cannot
// override the unsafe-code boundary. browser_read and browser_act ask once,
// before they start, for what their MCP calls will do; those calls then run
// under that answer.
export function browserPermission(ctx, exec, next) {
  const mode = access(ctx, exec), writable = mode === 'workspace-write'
  // Only browser_act acts on the page the Agent read: it checks before its
  // first action that the browser is still there, which the user may have left.
  const here = exec.name === 'browser_act' ? pageOf(exec.agent) : undefined
  if (exec.name === 'browser_read' || exec.name === 'browser_act') {
    const args = exec.arguments ?? {}
    const acts = exec.name === 'browser_act' ? (args.actions ?? []).filter(action => !QUIET.has(action.do)).map(action => [action, elementOf(exec.agent, action.ref)]) : []
    const calls = exec.name === 'browser_read'
      ? args.url === undefined ? [] : [{ name: 'browser_navigate', arguments: { url: args.url } }]
      : acts.map(([action, element]) => callFor(action, element)).filter(Boolean)
    const questions = calls.map(call => question(call.name, call.arguments, writable, here)).filter(Boolean)
    if (exec.name === 'browser_act' && args.confirm !== undefined) return confirmation(args.confirm, acts.map(([action, element]) => listed[action.do]?.(action, element)).filter(Boolean), questions)
    if (mode === 'danger-full-access') return next()
    return questions.length ? ask(questions) : next()
  }
  if (!exec.name.startsWith(prefix)) return next()
  const denial = browserGuard(ctx, exec)
  if (denial) return { kind: 'deny', reason: denial }
  if (mode === 'danger-full-access' || covered.has(exec.parent)) return next()
  const why = question(exec.name.slice(prefix.length), exec.arguments ?? {}, writable)
  return why ? ask([why]) : next()
}
