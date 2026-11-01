// Optional clients extend the existing selection toolbar, keeping one owner
// for selection capture, source identity and annotation encoding.
export function createSelectionActions() {
  let snapshot = []
  const listeners = new Set()
  const emit = () => { for (const listener of listeners) listener() }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    register(action) {
      if (!action.id || typeof action.label !== 'function' || typeof action.run !== 'function'
        || snapshot.some(item => item.id === action.id)) throw new Error('Invalid or duplicate selection action')
      snapshot = [...snapshot, action]; emit()
      return () => { snapshot = snapshot.filter(item => item !== action); emit() }
    },
  }
}
