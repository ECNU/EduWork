export function settingsFixture() {
  let snapshot = { open: false, activeId: undefined }
  let opened = 0
  const listeners = new Set()
  const update = open => {
    snapshot = { open, activeId: undefined }
    for (const listener of [...listeners]) listener()
  }
  const owner = {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    actions: {
      open() { opened += 1; update(true) },
      close() { update(false) },
    },
  }
  return {
    owner,
    opened: () => opened,
    slots: { entries: name => name === 'sidebar.settings' ? [{ store: { create: () => owner } }] : [] },
  }
}
