import { basename } from 'node:path'
import { isPrivateTarget, normalizeURL } from '@chatecnu-work/dsh-tool-browser/core'

const prefix = 'mcp__playwright-mcp__'
const readTools = new Set(['browser_snapshot', 'browser_find', 'browser_console_messages', 'browser_network_requests', 'browser_network_request', 'browser_wait_for'])
const fullAccess = (ctx, exec) => exec.agent && ctx.sandboxPolicy.resolve({ session: exec.agent.session }).mode === 'danger-full-access'
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

// Approval copy names the action: elements by the Agent's own description from
// the page snapshot, and the values it enters, shortened.
const shorten = value => {
  const text = String(value).replace(/\s+/gu, ' ').trim()
  return text.length > 60 ? `${text.slice(0, 59)}…` : text
}
const en = value => value === undefined ? 'a page element' : `"${shorten(value)}"`
const zh = value => value === undefined ? '页面元素' : `“${shorten(value)}”`
const actions = {
  browser_click: a => {
    const [verbEn, verbZh] = a.doubleClick ? ['double-click', '双击'] : a.button === 'right' ? ['right-click', '右键点击'] : ['click', '点击']
    return [`${verbEn} ${en(a.element)}`, `${verbZh}${zh(a.element)}`]
  },
  browser_type: a => [`type ${en(a.text)} into ${en(a.element)}${a.submit ? ' and submit it' : ''}`, `在${zh(a.element)}中输入${zh(a.text)}${a.submit ? '并提交' : ''}`],
  browser_fill_form: a => {
    const choice = field => field.type === 'checkbox' || field.type === 'radio'
    return [
      `fill in the form: ${a.fields.map(f => choice(f) ? `${f.value === 'true' ? 'check' : 'uncheck'} ${en(f.name)}` : `${en(f.name)} as ${en(f.value)}`).join(', ')}`,
      `填写表单：${a.fields.map(f => choice(f) ? `${f.value === 'true' ? '选中' : '取消选中'}${zh(f.name)}` : `${zh(f.name)}填${zh(f.value)}`).join('，')}`,
    ]
  },
  browser_select_option: a => [`select ${a.values.map(en).join(', ')} in ${en(a.element)}`, `在${zh(a.element)}中选择${a.values.map(zh).join('、')}`],
  browser_hover: a => [`hover over ${en(a.element)}`, `把鼠标移到${zh(a.element)}上`],
  browser_drag: a => [`drag ${en(a.startElement)} to ${en(a.endElement)}`, `把${zh(a.startElement)}拖到${zh(a.endElement)}`],
  browser_drop: a => a.paths?.length
    ? [`drop ${a.paths.map(path => en(basename(path))).join(', ')} onto ${en(a.element)}`, `把${a.paths.map(path => zh(basename(path))).join('、')}拖放到${zh(a.element)}`]
    : [`drop data onto ${en(a.element)}`, `把数据拖放到${zh(a.element)}`],
  browser_press_key: a => [`press ${shorten(a.key)}`, `按下 ${shorten(a.key)} 键`],
  browser_navigate: a => [`open the private address ${shorten(a.url)}`, `打开本机或内网地址 ${shorten(a.url)}`],
  browser_navigate_back: () => ['go back to the previous page', '返回上一页'],
  browser_tabs: a => a.action === 'new'
    ? [`open the private address ${shorten(a.url)} in a new tab`, `在新标签页打开本机或内网地址 ${shorten(a.url)}`]
    : ['close a tab', '关闭标签页'],
  browser_evaluate: a => a.element === undefined ? ['run a script in the page', '在网页中运行脚本'] : [`run a script on ${en(a.element)}`, `对${zh(a.element)}运行脚本`],
  browser_file_upload: a => a.paths === undefined ? ['cancel the file chooser', '取消选择文件']
    : !a.paths.length ? ['clear the chosen files', '清空已选择的文件']
      : [`upload ${a.paths.map(path => en(basename(path))).join(', ')}`, `上传${a.paths.map(path => zh(basename(path))).join('、')}`],
  browser_handle_dialog: a => !a.accept ? ['dismiss the page\'s dialog', '取消网页弹出的对话框']
    : a.promptText === undefined ? ['accept the page\'s dialog', '确认网页弹出的对话框']
      : [`enter ${en(a.promptText)} in the page's dialog and accept it`, `在网页弹出的对话框中输入${zh(a.promptText)}并确认`],
  browser_take_screenshot: () => ['take a screenshot of the page and save it in the workspace', '截取网页截图并保存到工作区'],
  browser_resize: a => [`resize the browser to ${a.width}×${a.height}`, `把浏览器窗口调整为 ${a.width}×${a.height}`],
  browser_close: () => ['close the browser', '关闭浏览器'],
}
const describe = (name, args) => {
  // Reads ask only to save their result to a file.
  if (readTools.has(name)) return [`save page data to ${en(args.filename)}`, `把网页数据保存到${zh(args.filename)}`]
  // Malformed arguments still ask and then reach the server's own validation.
  try { return actions[name]?.(args) } catch {}
}

// Preserve public interaction confirmations. Final denials use tools.guard so
// a later pre-execute listener cannot override the unsafe-code boundary.
export function browserPermission(ctx, exec, next) {
  if (!exec.name.startsWith(prefix)) return next()
  const denial = browserGuard(ctx, exec)
  if (denial) return { kind: 'deny', reason: denial }
  if (fullAccess(ctx, exec)) return next()
  const name = exec.name.slice(prefix.length)
  const args = exec.arguments ?? {}
  // Reading pages, switching tabs and opening public pages do not ask.
  if (readTools.has(name) ? args.filename === undefined : name === 'browser_tabs' && args.action !== 'close' && !opens(name, args)) return next()
  if (opens(name, args) && !isPrivateTarget(args.url)) return next()
  const [english, chinese] = describe(name, args) ?? [`use the browser tool ${name}`, `使用浏览器工具 ${name}`]
  const reason = `Allow the Agent to ${english}`
  return { kind: 'ask', reason, displayReason: { en: reason, zh: `允许智能体${chinese}` } }
}
