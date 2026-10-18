import { isPrivateTarget, normalizeURL } from '@chatecnu-work/dsh-tool-browser/core'

const prefix = 'mcp__playwright-mcp__'
const readTools = new Set(['browser_snapshot', 'browser_console_messages', 'browser_network_requests', 'browser_wait_for'])
const fullAccess = (ctx, exec) => exec.agent && ctx.sandboxPolicy.resolve({ session: exec.agent.session }).mode === 'danger-full-access'

export function browserGuard(ctx, exec) {
  if (!exec.name.startsWith(prefix)) return
  if (!exec.agent) return 'Browser requires an Agent-backed session'
  if (exec.name === prefix + 'browser_run_code_unsafe' && !fullAccess(ctx, exec)) {
    return 'Browser host code requires full access. Use the regular browser tools for page navigation and interaction.'
  }
  if (exec.name === prefix + 'browser_navigate') {
    try { normalizeURL(exec.arguments?.url) } catch { return 'Browser navigation requires an HTTP(S) URL without embedded credentials' }
  }
}

// Preserve public interaction confirmations. Final denials use tools.guard so
// a later pre-execute listener cannot override the unsafe-code boundary.
export function browserPermission(ctx, exec, next) {
  if (!exec.name.startsWith(prefix)) return next()
  const denial = browserGuard(ctx, exec)
  if (denial) return { kind: 'deny', reason: denial }
  if (fullAccess(ctx, exec)) return next()
  const name = exec.name.slice(prefix.length)
  if ((readTools.has(name) && exec.arguments?.filename === undefined) || (name === 'browser_tabs' && exec.arguments?.action === 'list')) return next()
  if (name === 'browser_navigate' && !isPrivateTarget(exec.arguments?.url)) return next()
  return { kind: 'ask', reason: 'Allow the Agent to interact with a web page or access a private browser target' }
}
