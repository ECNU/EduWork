import { normalizeURL, resolvesToPrivateTarget } from '@chatecnu-work/dsh-tool-browser/core'

const prefix = 'mcp__playwright-mcp__'
const readTools = new Set(['browser_snapshot', 'browser_console_messages', 'browser_network_requests', 'browser_wait_for'])
const fullAccess = (ctx, exec) => exec.agent && ctx.sandboxPolicy.resolve({ session: exec.agent.session }).mode === 'danger-full-access'

// browser_navigate and browser_tabs action=new are the only tools that take a URL.
const requestedURL = (name, args) => name === 'browser_navigate' || (name === 'browser_tabs' && args?.action === 'new' && args.url !== undefined)
  ? args?.url
  : undefined

// Per Session: origins the user approved by confirming a private navigation, and
// whether the page Playwright last reported is a private origin nobody approved.
const sessions = new WeakMap()
function sessionState(exec) {
  let state = sessions.get(exec.agent.session)
  if (!state) sessions.set(exec.agent.session, state = { approved: new Set(), unapprovedPage: undefined })
  return state
}

export function browserGuard(ctx, exec) {
  if (!exec.name.startsWith(prefix)) return
  if (!exec.agent) return 'Browser requires an Agent-backed session'
  if (exec.name === prefix + 'browser_run_code_unsafe' && !fullAccess(ctx, exec)) {
    return 'Browser host code requires full access. Use the regular browser tools for page navigation and interaction.'
  }
  const name = exec.name.slice(prefix.length)
  if (name === 'browser_navigate' || requestedURL(name, exec.arguments) !== undefined) {
    try { normalizeURL(exec.arguments?.url) } catch { return 'Browser navigation requires an HTTP(S) URL without embedded credentials' }
  }
}

// Preserve public interaction confirmations. Final denials use tools.guard so
// a later pre-execute listener cannot override the unsafe-code boundary.
// Private targets are decided on resolved addresses, not the hostname text.
export async function browserPermission(ctx, exec, next, options) {
  if (!exec.name.startsWith(prefix)) return next()
  const denial = browserGuard(ctx, exec)
  if (denial) return { kind: 'deny', reason: denial }
  if (fullAccess(ctx, exec)) return next()
  const name = exec.name.slice(prefix.length)
  const url = requestedURL(name, exec.arguments)
  if (url !== undefined) {
    if (!sessionState(exec).approved.has(new URL(normalizeURL(url)).origin) && await resolvesToPrivateTarget(url, options)) {
      const reason = 'Allow the Agent to open a page on this computer or a private network'
      return { kind: 'ask', reason, displayReason: { en: reason, zh: '允许智能体打开本机或内网上的网页' } }
    }
    // A public new tab is as harmless as a public navigation.
    return next()
  }
  const reads = (readTools.has(name) && exec.arguments?.filename === undefined) || (name === 'browser_tabs' && exec.arguments?.action === 'list')
  if (reads && sessionState(exec).unapprovedPage === undefined) return next()
  const reason = 'Allow the Agent to interact with a web page or access a private browser target'
  return { kind: 'ask', reason, displayReason: {
    en: reason,
    zh: '允许智能体操作网页，或访问内网、本机等非公开浏览器地址',
  } }
}

// Playwright MCP reports the current page as "- Page URL: <url>" and every tab as
// "- <i>: [title](<url>)" whenever a page changed since its previous response.
function reportedPages(result) {
  const urls = []
  for (const block of result.content ?? []) {
    if (block?.type !== 'text' || typeof block.text !== 'string') continue
    for (const line of block.text.split('\n')) {
      const page = line.match(/^- Page URL: (\S+)\s*$/)
      const tab = line.match(/^- \d+:.*\]\((\S+)\)(?: \[crashed\])?\s*$/)
      const current = page !== null || / \(current\) /.test(line)
      const url = page?.[1] ?? tab?.[1]
      if (url && /^https?:/i.test(url)) urls.push({ url, current })
    }
  }
  return urls
}

/**
 * Withhold a browser result when it shows a private page the user did not
 * approve: a public page redirected there, its hostname re-resolved to a private
 * address, or a click landed there. Confirming a private navigation approves its
 * origin for the rest of the Session.
 */
export async function browserResult(ctx, exec, result, next, options) {
  if (!exec.name.startsWith(prefix) || !exec.agent || result.isError || fullAccess(ctx, exec)) return next()
  const state = sessionState(exec)
  const name = exec.name.slice(prefix.length)
  const url = requestedURL(name, exec.arguments)
  // The call ran, so a private target was confirmed by the user.
  if (url !== undefined && await resolvesToPrivateTarget(url, options)) state.approved.add(new URL(normalizeURL(url)).origin)
  const blocked = []
  for (const page of reportedPages(result)) {
    const origin = new URL(page.url).origin
    const unapproved = !state.approved.has(origin) && await resolvesToPrivateTarget(page.url, options)
    if (page.current) state.unapprovedPage = unapproved ? origin : undefined
    if (unapproved) blocked.push(origin)
  }
  if (blocked.length === 0) return next()
  return {
    kind: 'block',
    feedback: [{
      type: 'text',
      text: `The browser reached ${[...new Set(blocked)].join(', ')}, which is on this computer or a private network and was not approved. The page content was withheld. To use it, open that address with browser_navigate so the user can confirm.`,
    }],
  }
}
