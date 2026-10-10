// Compatibility for the default npm Runtime, which has no native quit inspector.
// Query live services at quit time; notifications and the renderer are not task state.
export async function inspectDesktopQuit(ctx) {
  const agents = ctx.get('agents'), jobs = ctx.get('jobs')
  if (!agents || !jobs) throw Error('Desktop task services unavailable')
  const live = agents.list()
  const activeTasks = live.some(agent => agent.status === 'running'
    || agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.length > 0)
    || [undefined, ...live].some(agent => jobs.list(agent)
      .some(job => job.status === 'running' || job.status === 'stopping'))
  let scheduledTasks = false
  for (const agent of live) {
    const events = agent.session.ownEvents()
    if (!events.some(event => event.type === 'schedule/change')) continue
    const { foldScheduleEvents } = await import('@deepseek-ai/dsh-schedule')
    if (foldScheduleEvents(events).active.length) { scheduledTasks = true; break }
  }
  return { activeTasks, scheduledTasks }
}
