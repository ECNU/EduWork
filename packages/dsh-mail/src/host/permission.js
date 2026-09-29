import { TOOL_NAMES } from './constants.js'

const SEND_APPROVAL_REASON = 'Send this email through the configured SMTP account. Review the recipients, subject, and attachments shown in the tool call.'

/**
 * Route mail sending through DSH's native permission-preset waterfall.
 * The independent sendEnabled guard still runs after this decision, so Full
 * Access never enables mail by itself; it only suppresses the per-call prompt
 * after the user has explicitly enabled sending in Mail assistant settings.
 */
export function decideMailPermission(ctx, exec, next) {
  if (exec.name === TOOL_NAMES.attachment) return decideAttachmentWrite(ctx, exec, next)
  if (exec.name !== TOOL_NAMES.send) return next()
  const agent = exec.agent
  if (agent === undefined) {
    return Promise.resolve({ kind: 'deny', reason: 'Mail sending requires an Agent-backed session' })
  }
  if (ctx.permissionPresets.current(agent.session) === 'danger-full-access') return next()
  return Promise.resolve({ kind: 'ask', reason: SEND_APPROVAL_REASON })
}

async function decideAttachmentWrite(ctx, exec, next) {
  if (!exec.agent) return { kind: 'deny', reason: 'Attachment downloads require an Agent-backed session' }
  if (!exec.agent.session.header?.cwd) return { kind: 'deny', reason: 'Attachment downloads require a session workspace' }
  const resolver = ctx.get?.('sandboxPolicy')
  const policy = resolver ? resolver.resolve({ session: exec.agent.session })
    : { mode: ctx.permissionPresets.current(exec.agent.session) }
  if (policy?.mode === 'danger-full-access') return next()
  if (policy?.mode === 'workspace-write') {
    if (policy.workspaceRoot !== undefined) {
      const options = { cwd: exec.agent.session.header.cwd, signal: exec.signal }
      const root = await ctx.fs.resolve('.', options)
      const allowed = await ctx.fs.resolve(policy.workspaceRoot, options)
      if (!ctx.fs.contains(allowed, root)) return { kind: 'deny', reason: 'Attachment workspace is outside the allowed write root' }
    }
    return next()
  }
  return { kind: 'ask', reason: 'Save this mail attachment in the current workspace' }
}

export const internals = Object.freeze({ SEND_APPROVAL_REASON })
