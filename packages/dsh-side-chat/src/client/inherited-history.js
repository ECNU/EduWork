// Keep the source context in the Session; hide only its transcript presentation.
export function inheritedHistory(snapshot, seedLength) {
  const inherited = [], inheritedTurns = new Set(), ownTurns = new Set()
  let own = false
  for (const node of snapshot?.views.get('chat')?.nodes.values() ?? []) {
    const seq = node.anchorSeq
    if (!Number.isFinite(seq)) continue
    const turn = node.location?.turn?.turn
    if (seq < seedLength) {
      inherited.push(node.key)
      if (turn !== undefined) inheritedTurns.add(String(turn))
    } else {
      own = true
      if (turn !== undefined) ownTurns.add(String(turn))
    }
  }
  return {
    inherited,
    turns: [...inheritedTurns].filter(turn => !ownTurns.has(turn)),
    empty: !own,
    // Older side-chat pages remain available once the source prefix is outside
    // the loaded window. Never hide a pager solely because the Session is seeded.
    hidePager: seedLength > 0 && (inherited.length > 0 || !own),
  }
}

export function hideInheritedHistory(root, state) {
  const keys = new Set(state.inherited), turns = new Set(state.turns)
  const changed = new Map()
  const mark = (element, hide) => {
    if (hide) {
      if (!changed.has(element)) changed.set(element, element.hidden)
      element.hidden = true
      element.setAttribute('data-side-inherited-history', '')
    } else if (changed.has(element)) {
      element.hidden = changed.get(element)
      element.removeAttribute('data-side-inherited-history')
      changed.delete(element)
    }
  }
  const update = () => {
    for (const row of root.querySelectorAll('[data-chat-node-key]')) {
      // Some native process and tail rows have no anchor of their own, but
      // still belong to a turn whose projected messages are all inherited.
      mark(row, keys.has(row.getAttribute('data-chat-node-key')) || turns.has(row.getAttribute('data-chat-turn')))
    }
    // Collapsed groups can render a header without mounting any member rows.
    for (const group of root.querySelectorAll('[data-chat-group-key]')) {
      mark(group, turns.has(group.getAttribute('data-chat-turn')))
    }
    // The native pager is the direct button wrapper before the flow slot.
    for (const flow of root.querySelectorAll('[data-chat-flow]')) {
      for (const child of flow.children) {
        if (!child.hasAttribute('data-slot') && child.querySelector(':scope > button')) mark(child, state.hidePager)
      }
    }
  }
  update()
  const relevant = '[data-chat-node-key],[data-chat-group-key],[data-chat-flow]'
  const marked = '[data-side-inherited-history]'
  const observer = new MutationObserver(records => {
    let rescan = false
    for (const record of records) {
      if (record.type === 'attributes') { rescan = true; continue }
      for (const removed of record.removedNodes) {
        if (removed.nodeType !== 1) continue
        const detached = [
          ...(removed.matches(marked) ? [removed] : []),
          ...removed.querySelectorAll(marked),
        ]
        for (const element of detached) {
          if (!changed.has(element)) continue
          element.hidden = changed.get(element)
          element.removeAttribute('data-side-inherited-history')
          changed.delete(element)
        }
      }
      for (const added of record.addedNodes) {
        if (added.nodeType !== 1) continue
        // Streaming text and Markdown spans do not change row ownership.
        // Re-scan only when a row/group/flow or its pager is mounted.
        if (added.matches(relevant) || added.querySelector(relevant)
          || record.target.matches?.('[data-chat-flow]')) rescan = true
      }
    }
    if (rescan) update()
  })
  observer.observe(root, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['data-chat-node-key', 'data-chat-group-key', 'data-chat-turn'] })
  return () => {
    observer.disconnect()
    for (const [element, hidden] of changed) {
      element.hidden = hidden
      element.removeAttribute('data-side-inherited-history')
    }
  }
}
