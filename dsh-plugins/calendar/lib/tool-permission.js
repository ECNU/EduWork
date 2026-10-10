// Who may change the calendar through an agent tool.
//
// Reading a range is ordinary work. Writing is not: the records live only on this
// machine and a wrong write is the user's own calendar, so every tool that writes
// asks first unless the session already runs with approvals disabled. The same
// decision is made for the whole group of tools in one place, so a new write tool
// cannot forget to opt in.

/** Tools that change stored records. */
export const WRITE_TOOLS = new Set([
  'calendar_create_event',
  'calendar_update_event',
  'calendar_delete_event',
  'calendar_occurrence',
])

const WRITE_REASON = 'Allow the Agent to create, change or delete entries in the local calendar'

/**
 * Decide one calendar tool call.
 * @param ctx - Plugin context, for the current permission preset.
 * @param exec - The pending tool call.
 * @param next - Continues to the next decider.
 * @returns Nothing when the call proceeds, otherwise a decision.
 */
export function decideCalendarPermission(ctx, exec, next) {
  if (!WRITE_TOOLS.has(exec.name)) return next()
  if (!exec.agent) return Promise.resolve({ kind: 'deny', reason: 'Calendar writes require an Agent-backed session' })
  if (ctx.permissionPresets.current(exec.agent.session) === 'danger-full-access') return next()
  return Promise.resolve({ kind: 'ask', reason: WRITE_REASON })
}
