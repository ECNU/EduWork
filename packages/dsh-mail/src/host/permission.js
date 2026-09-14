import { TOOL_NAMES } from './constants.js'

const SEND_APPROVAL_REASON = 'Send this email through the configured SMTP account. Review the recipients, subject, and attachments shown in the tool call.'

/**
 * Route mail sending through DSH's native permission-preset waterfall.
 * The independent sendEnabled guard still runs after this decision, so Full
 * Access never enables mail by itself; it only suppresses the per-call prompt
 * after the user has explicitly enabled sending in Mail assistant settings.
 */
export function decideMailPermission(ctx, exec, next) {
  if (exec.name !== TOOL_NAMES.send) return next()
  const agent = exec.agent
  if (agent === undefined) {
    return Promise.resolve({ kind: 'deny', reason: 'Mail sending requires an Agent-backed session' })
  }
  if (ctx.permissionPresets.current(agent.session) === 'danger-full-access') return next()
  return Promise.resolve({ kind: 'ask', reason: SEND_APPROVAL_REASON })
}

export const internals = Object.freeze({ SEND_APPROVAL_REASON })
