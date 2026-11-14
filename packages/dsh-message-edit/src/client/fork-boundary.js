/**
 * Choose the inclusive fork cut for a Turn: the previous Turn's end plus the
 * standalone events after it, stopping before queued input or the Turn itself.
 * This is the host's own rule for an omitted fork boundary, applied to an
 * earlier Turn, so the branch inherits neither the edited message nor its
 * queue entry.
 */
export function forkBoundary(events, turnStart) {
  const before = events.filter(event => event.seq < turnStart)
  let boundary = before.findLast(event => event.type === 'turn/end')?.seq ?? -1
  for (const event of before) {
    if (event.seq <= boundary) continue
    if (event.type === 'turn/start' || event.type === 'agent/inbox/spliced' || event.type === 'user/message' && event.surfaceOp === 'append') break
    boundary = event.seq
  }
  return boundary
}
