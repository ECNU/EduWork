import test from 'node:test'
import assert from 'node:assert/strict'
import { inheritedHistory, hideInheritedHistory } from '../src/client/inherited-history.js'

const snapshot = nodes => ({ views: new Map([['chat', { nodes: new Map(nodes.map(node => [node.key, node])) }]]) })
const node = (key, anchorSeq, turn) => ({ key, anchorSeq, location: { kind: 'step', turn: { turn } } })

test('source tool groups and paging are hidden while side tool groups remain visible', () => {
  const state = inheritedHistory(snapshot([node('source-tool', 3, 1), node('side-tool', 12, 2)]), 10)
  assert.deepEqual(state, { inherited: ['source-tool'], turns: ['1'], empty: false, hidePager: true })
})

test('mixed turns and unknown anchors are not hidden as complete source groups', () => {
  const state = inheritedHistory(snapshot([node('source', 3, 1), node('live', 12, 1), node('unknown', undefined, 4)]), 10)
  assert.deepEqual(state.turns, [])
  assert.deepEqual(state.inherited, ['source'])
})

test('paging remains available for long side transcripts after inherited rows leave the window', () => {
  assert.equal(inheritedHistory(snapshot([node('live', 100, 5)]), 10).hidePager, false)
  assert.equal(inheritedHistory(snapshot([node('source', 3, 1)]), 10).empty, true)
})

test('fractional projected anchors participate in visibility and empty-state decisions', () => {
  const state = inheritedHistory(snapshot([node('source', 2.5, 1), node('stream', 12.5, 2)]), 10)
  assert.equal(state.empty, false)
  assert.deepEqual(state.inherited, ['source'])
  assert.deepEqual(state.turns, ['1'])
})

test('streaming text mutations do not rescan the whole transcript; new rows do', t => {
  const original = globalThis.MutationObserver
  let callback, scans = 0
  globalThis.MutationObserver = class {
    constructor(fn) { callback = fn }
    observe() {}
    disconnect() {}
  }
  t.after(() => { globalThis.MutationObserver = original })
  const root = { querySelectorAll: () => { scans++; return [] } }
  const dispose = hideInheritedHistory(root, { inherited: [], turns: [], hidePager: false })
  assert.equal(scans, 3)
  const target = { matches: () => false }
  for (let i = 0; i < 500; i++) callback([{ type: 'childList', target, addedNodes: [{ nodeType: 3 }], removedNodes: [] }])
  assert.equal(scans, 3)
  const row = { nodeType: 1, matches: selector => selector.includes('data-chat-node-key'), querySelector: () => null }
  callback([{ type: 'childList', target, addedNodes: [row], removedNodes: [] }])
  assert.equal(scans, 6)
  dispose()
})
