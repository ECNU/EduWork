import { isPrivateTarget } from './core.js'

const sensitiveActions = new Set(['click', 'type', 'visible', 'screenshot', 'close_tab'])

export function decideBrowserPermission(ctx, exec, next) {
  if (exec.name !== 'browser') return next()
  if (!exec.agent) return Promise.resolve({ kind: 'deny', reason: 'Browser requires an Agent-backed session' })
  const args = exec.arguments ?? {}
  const sensitive = args.mode === 'visible' || sensitiveActions.has(args.action)
    || (args.action === 'navigate' && typeof args.url === 'string' && isPrivateTarget(args.url))
  if (!sensitive || ctx.permissionPresets.current(exec.agent.session) === 'danger-full-access') return next()
  return Promise.resolve({ kind: 'ask', reason: 'Allow the Agent to interact with a web page or open a visible managed browser' })
}
