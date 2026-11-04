// Align the native cards by sharing their measured footer clearance. The
// footer can be empty, populated or resized independently in either session.
export function alignComposerDocks(root, sourceSessionId) {
  let frame = 0, disposed = false, entries = []
  const restore = () => {
    for (const { node, value, priority } of entries) {
      if (value) node.style.setProperty('min-height', value, priority)
      else node.style.removeProperty('min-height')
    }
  }
  const schedule = () => { if (!disposed && !frame) frame = requestAnimationFrame(update) }
  const resize = new ResizeObserver(schedule)
  const mutations = new MutationObserver(schedule)
  function update() {
    frame = 0
    const source = [...document.querySelectorAll('[data-conversation-content]')].find(node =>
      node.dataset.conversationSession === sourceSessionId && !node.closest('[data-eduwork-side-chat]') && node.getBoundingClientRect().height > 0)
    const docks = [source?.querySelector('[data-composer-dock]'), root.querySelector('[data-composer-dock]')]
    if (!docks.every(Boolean) || root.getBoundingClientRect().height === 0) {
      restore(); entries = []; resize.disconnect(); resize.observe(root)
      return
    }
    if (docks.some((node, index) => entries[index]?.node !== node)) {
      restore()
      entries = docks.map(node => ({ node, value: node.style.getPropertyValue('min-height'), priority: node.style.getPropertyPriority('min-height') }))
      resize.disconnect(); resize.observe(root)
      for (const node of docks) resize.observe(node)
    }
    // Read natural sizes, not the minimum assigned in the previous frame,
    // so the clearance can shrink when the statistics disappear.
    restore()
    const height = Math.max(...docks.map(node => node.getBoundingClientRect().height))
    for (const node of docks) {
      const css = getComputedStyle(node)
      const inset = css.boxSizing === 'border-box' ? 0
        : ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce((sum, key) => sum + (parseFloat(css[key]) || 0), 0)
      node.style.setProperty('min-height', `${Math.max(0, height - inset)}px`)
    }
  }
  resize.observe(root)
  mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-conversation-session', 'hidden'] })
  schedule()
  return () => { disposed = true; cancelAnimationFrame(frame); resize.disconnect(); mutations.disconnect(); restore() }
}
