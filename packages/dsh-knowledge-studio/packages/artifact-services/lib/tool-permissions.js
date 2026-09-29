/**
 * File effects use the effective sandbox policy, not the UI preset name.
 * Custom presets can select workspace-write too. Older hosts without the
 * policy service retain their canonical preset behavior; unknown modes ask.
 */
export function artifactPolicy(ctx, exec) {
  if (!exec.agent) return undefined
  const resolver = ctx.get?.('sandboxPolicy')
  if (resolver) return resolver.resolve({ session: exec.agent.session })
  return { mode: ctx.permissionPresets.current(exec.agent.session) }
}

/** Fixed workspace operations reuse write access; arbitrary code needs separate approval. */
export async function decideWorkspaceWrite(ctx, exec, next, reason, { executesCode = false } = {}) {
  if (!exec.agent) return { kind: 'deny', reason: 'Artifact writes require an Agent-backed session' }
  if (!exec.agent.session.header.cwd) return { kind: 'deny', reason: 'Artifact writes require a session workspace' }
  const policy = artifactPolicy(ctx, exec)
  if (policy?.mode === 'danger-full-access') return next()
  if (!executesCode && policy?.mode === 'workspace-write') {
    // The process-backed renderers keep their own canonical path fences.
    // A custom policy may narrow the root, so do not silently widen it to cwd.
    if (policy.workspaceRoot !== undefined) {
      const options = { cwd: exec.agent.session.header.cwd, signal: exec.signal }
      const root = await ctx.fs.resolve('.', options)
      const allowed = await ctx.fs.resolve(policy.workspaceRoot, options)
      if (!ctx.fs.contains(allowed, root)) {
        return { kind: 'deny', reason: 'Artifact workspace is outside the allowed write root' }
      }
    }
    return next()
  }
  return { kind: 'ask', reason }
}
