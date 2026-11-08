/**
 * Keep the existing workbench action surface: status reads share the display
 * observer, diagnostics keeps its direct authoritative read, and every other
 * action still runs through the coordinator with the same return value.
 */
export function createWorkbenchUpdateHandler({ getCoordinator, observer, runWorkbench }) {
  return async action => {
    const coordinator = getCoordinator()
    if (!coordinator) return runWorkbench(action)
    if (action === 'diagnostics') {
      return runWorkbench(action, await coordinator.action('status').catch(error => ({ error: error.message })))
    }
    if (action === 'status') return observer.status()
    const result = await coordinator.action(action)
    observer.record(result)
    return result
  }
}
