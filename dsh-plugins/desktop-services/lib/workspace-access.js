import { realpathSync } from 'node:fs'

export const name = 'eduwork-workspace-access'
export const inject = ['desktopBoundary', 'workspaceRegistry', 'sandboxPolicy']

// Only a real grant failure is evidence; a missing WRITE_OWNER alone is not.
export function failedWorkspaceGrant(exec, result, policy, canonical = realpathSync.native) {
  if (!exec.agent?.session || result?.isError !== true || typeof result.error?.message !== 'string') return
  const { mode, workspaceRoot } = policy.resolve({ session: exec.agent.session })
  if (mode !== 'workspace-write' || !workspaceRoot) return
  const path = canonical(workspaceRoot)
  const expected = `SetNamedSecurityInfoW failed (Win32 5): grantWrite(${path})`
  if (result.error.message.toLowerCase() !== expected.toLowerCase()) return
  return path
}

/** Observe actual failures only; never replay a command after adjusting access. */
export function observeWorkspaceAccess({ on, resolveWorkspace, repair, failed, signal }) {
  const seen = new Set()
  let queue = Promise.resolve()
  on('tools/result', (exec, result) => {
    queue = queue.then(async () => {
      if (signal?.aborted) return
      const path = await resolveWorkspace(exec, result)
      if (!path || signal?.aborted || seen.has(path.toLowerCase())) return
      seen.add(path.toLowerCase())
      await repair(path)
    }).catch(error => { if (!signal?.aborted) failed(error) })
  })
  return () => queue
}

export function apply(ctx) {
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort())
  observeWorkspaceAccess({
    on: (event, listener) => ctx.on(event, listener), signal: lifetime.signal,
    resolveWorkspace: async (exec, result) => {
      const path = failedWorkspaceGrant(exec, result, ctx.sandboxPolicy)
      if (!path) return
      const workspace = await ctx.workspaceRegistry.resolveByPath(path)
      if (workspace && realpathSync.native(workspace.path).toLowerCase() === path.toLowerCase()) return path
    },
    repair: async path => {
      const { nativeBridge } = await ctx.desktopBoundary.ready
      if (lifetime.signal.aborted) return
      const response = await fetch(nativeBridge.baseURL + '/v1/desktop/workspace-access', {
        method: 'POST', headers: { authorization: 'Bearer ' + nativeBridge.token, 'content-type': 'application/json' },
        body: JSON.stringify({ path }), signal: lifetime.signal,
      })
      if (!response.ok) throw new Error('Desktop workspace access diagnosis is unavailable')
    },
    failed: error => console.warn(`[workspace-access] ${error.message}`),
  })
}
