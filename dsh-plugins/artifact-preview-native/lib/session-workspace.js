// Native history browsing does not attach a live Agent. Observe the official
// persisted Session without creating one or accepting a caller-supplied cwd.
export async function sessionCwd(ctx, sessionId, signal) {
  signal?.throwIfAborted()
  const live = ctx.sessions.get(sessionId)
  if (live) return live.header?.cwd
  const query = ctx.get('sessionQuery')
  if (typeof query?.observeSession !== 'function') return undefined
  let observation
  try {
    observation = await query.observeSession(sessionId, { signal, projectionMode: 'none' })
    if (observation.header.id !== sessionId) throw new Error('preview session identity does not match')
    signal?.throwIfAborted()
    return observation.header.cwd
  } catch (error) {
    if (error?.code === 'SESSION_QUERY_SESSION_NOT_FOUND') return undefined
    throw error
  } finally { observation?.[Symbol.dispose]() }
}
