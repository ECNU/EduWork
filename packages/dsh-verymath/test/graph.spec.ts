import { describe, expect, it } from 'vitest'
import {
  computeTopology,
  focusClosure,
  mergeBatches,
  mermaidDisplayText,
  renderMermaid,
  stripUncertain,
  collectEntities,
  collectMainTheorems,
  type PaperStructure,
} from '../src/core/index.ts'
import { VeryMathError } from '../src/core/index.ts'

function entity(label: string, type: string, dependencies: string[] = [], extra: Record<string, unknown> = {}) {
  return { type, label, statement: `${label} statement`, dependencies, ...extra }
}

function structure(entities: Record<string, unknown>[], theorems: string[] = []): PaperStructure {
  return {
    paper: { title: 'Test Paper', authors: ['T'] },
    ...(theorems.length > 0
      ? { main_theorems: theorems.map(label => ({ label, statement: `${label} S.` })) }
      : {}),
    entities: entities as PaperStructure['entities'],
  }
}

describe('stripUncertain', () => {
  it('strips the upstream [UNCERTAIN: reason] suffix', () => {
    expect(stripUncertain('Lemma 3.1 [UNCERTAIN: no explicit reference]')).toBe('Lemma 3.1')
    expect(stripUncertain('Lemma 3.1')).toBe('Lemma 3.1')
    expect(stripUncertain('Ref [9]')).toBe('Ref')
  })
})

describe('mergeBatches', () => {
  it('merges duplicate labels across batches and rebuilds cited_by', () => {
    const batchA = structure([entity('Def 1', 'DEFINITION'), entity('Lemma 2', 'LEMMA', ['Def 1'])])
    const batchB = structure([entity('Def 1', 'DEFINITION'), entity('Theorem 3', 'THEOREM', ['Lemma 2', 'Def 1'])])
    const { entities, report } = mergeBatches([batchA, batchB])
    expect(report.totalEntities).toBe(3)
    expect(report.mergedDuplicates).toBe(1)
    const def = entities.find(entry => entry.label === 'Def 1')
    expect(def?.cited_by).toEqual(['Lemma 2', 'Theorem 3'])
    // shared_node: in-degree 2, cited by a THEOREM.
    expect(def?.shared_node).toBe(true)
    expect(report.sharedNodes).toContain('Def 1')
  })

  it('does not mark shared_node without a citing THEOREM', () => {
    const doc = structure([
      entity('Def 1', 'DEFINITION'),
      entity('Lemma 2', 'LEMMA', ['Def 1']),
      entity('Lemma 3', 'LEMMA', ['Def 1']),
    ])
    const { entities } = mergeBatches(doc)
    expect(entities.find(entry => entry.label === 'Def 1')?.shared_node).toBe(false)
  })

  it('counts uncertain dependencies after stripping the suffix', () => {
    const doc = structure([
      entity('Lemma 1', 'LEMMA'),
      entity('Theorem 2', 'THEOREM', [], { uncertain_dependencies: ['Lemma 1 [UNCERTAIN: inferred]'] }),
      entity('Lemma 3', 'LEMMA', [], { uncertain_dependencies: ['Lemma 1 [UNCERTAIN: inferred]'] }),
    ])
    const { entities, report } = mergeBatches(doc)
    expect(entities.find(entry => entry.label === 'Lemma 1')?.cited_by).toEqual(['Lemma 3', 'Theorem 2'])
    expect(report.rebuiltCitedBy).toBe(2)
    expect(report.danglingEdges).toEqual([])
  })

  it('reports dangling edges to unknown labels', () => {
    const doc = structure([entity('Theorem 1', 'THEOREM', ['Ghost Lemma'])])
    const { report } = mergeBatches(doc)
    expect(report.danglingEdges).toEqual(['Theorem 1 -> Ghost Lemma'])
  })

  it('never mutates the input artifacts', () => {
    const doc = structure([entity('Def 1', 'DEFINITION'), entity('Theorem 2', 'THEOREM', ['Def 1'])])
    const before = JSON.stringify(doc)
    mergeBatches(doc)
    expect(JSON.stringify(doc)).toBe(before)
  })
})

describe('collectEntities', () => {
  it('dedupes by label and counts duplicates', () => {
    const { entities, duplicates } = collectEntities([
      structure([entity('A', 'DEFINITION'), entity('B', 'DEFINITION')]),
      structure([entity('A', 'DEFINITION'), entity('C', 'DEFINITION')]),
    ])
    expect(entities.map(entry => entry.label).sort()).toEqual(['A', 'B', 'C'])
    expect(duplicates).toBe(1)
  })
})

describe('computeTopology', () => {
  const doc = structure(
    [
      entity('Def 1', 'DEFINITION'),
      entity('Lemma 1', 'LEMMA', ['Def 1']),
      entity('Lemma 2', 'LEMMA', ['Def 1']),
      entity('Theorem 1', 'THEOREM', ['Lemma 1', 'Lemma 2']),
      entity('Remark 1', 'REMARK'),
    ],
    ['Theorem 1'],
  )

  it('computes in/out degrees from merged edges', () => {
    const topology = computeTopology(doc)
    const def = topology.metrics.find(entry => entry.label === 'Def 1')
    expect(def?.inDegree).toBe(2)
    expect(def?.outDegree).toBe(0)
    const theorem = topology.metrics.find(entry => entry.label === 'Theorem 1')
    expect(theorem?.inDegree).toBe(0)
    expect(theorem?.outDegree).toBe(2)
  })

  it('orders bottom-up levels dependency-first', () => {
    const topology = computeTopology(doc)
    expect(topology.bottomUpLevels[0]).toEqual(['Def 1', 'Remark 1'])
    expect(topology.bottomUpLevels[1]).toEqual(['Lemma 1', 'Lemma 2'])
    expect(topology.bottomUpLevels[2]).toEqual(['Theorem 1'])
  })

  it('top-down BFS starts at main theorems', () => {
    const topology = computeTopology(doc)
    expect(topology.topDownOrder[0]).toBe('Theorem 1')
    expect(topology.topDownOrder).toContain('Lemma 1')
    expect(topology.topDownOrder).not.toContain('Remark 1')
  })

  it('marks main-theorem support transitively', () => {
    const topology = computeTopology(doc)
    expect(topology.metrics.find(entry => entry.label === 'Def 1')?.supportsMainTheorem).toBe(true)
    expect(topology.metrics.find(entry => entry.label === 'Remark 1')?.supportsMainTheorem).toBe(false)
  })

  it('finds the longest chain and isolated nodes', () => {
    const topology = computeTopology(doc)
    expect(topology.longestChain).toContain('Theorem 1')
    expect(topology.longestChain).toContain('Def 1')
    expect(topology.isolated).toEqual(['Remark 1'])
    expect(topology.degradedRendering).toBe(false)
  })

  it('detects cycles and still emits a trailing bottom-up level', () => {
    const cyclic = structure([
      entity('A', 'LEMMA', ['B']),
      entity('B', 'LEMMA', ['A']),
      entity('C', 'DEFINITION', ['A']),
    ])
    const topology = computeTopology(cyclic)
    expect(topology.cycles).toHaveLength(1)
    expect(topology.cycles[0]?.labels).toEqual(['A', 'B', 'A'])
    // The whole graph is cycle-locked (C depends on A): Kahn never starts, so all
    // nodes surface in the trailing stuck level.
    expect(topology.bottomUpLevels).toEqual([['A', 'B', 'C']])
  })

  it('accepts explicit theorem labels overriding main_theorems', () => {
    const topology = computeTopology(doc, ['Lemma 1'])
    expect(topology.topDownOrder[0]).toBe('Lemma 1')
  })

  it('keeps the reading directions when artifacts arrive as batches', () => {
    // Regression: batch merging unions `entities` only, so the main theorems from
    // the first artifact used to be dropped and every reading direction came back
    // empty on the exact path `verymath_paper_graph` uses for `extraPaths`.
    const second = structure([entity('Claim 1', 'CLAIM', ['Theorem 1'])])
    const batched = computeTopology([doc, second])
    expect(batched.topDownOrder[0]).toBe('Theorem 1')
    expect(batched.topDownOrder).toContain('Lemma 1')
    expect(batched.metrics.find(entry => entry.label === 'Def 1')?.supportsMainTheorem).toBe(true)
    expect(batched.metrics.find(entry => entry.label === 'Remark 1')?.supportsMainTheorem).toBe(false)
  })

  it('collects main theorems across batches, first occurrence winning on a duplicate', () => {
    // The second batch contributes a NEW theorem and repeats one from the first,
    // so both the union and the first-wins rule are actually exercised.
    const second: PaperStructure = {
      paper: { title: 'batch two', authors: [] },
      main_theorems: [
        { label: 'Theorem 1', statement: 'DUPLICATE — must not replace the first.' },
        { label: 'Theorem 9', statement: 'Only in batch two.' },
      ],
      entities: [],
    }
    const collected = collectMainTheorems([doc, second])
    expect(collected.map(theorem => theorem.label)).toEqual(['Theorem 1', 'Theorem 9'])
    expect(collected[0]?.statement).not.toContain('DUPLICATE')
    expect(collectMainTheorems(doc)).toHaveLength(1)
  })

  it('walks a main theorem that has no entity', () => {
    // The compact v4.2 form may carry a theorem only in main_theorems; the top-down
    // direction must still start there instead of coming back empty.
    const metadataOnly: PaperStructure = {
      paper: { title: 'meta', authors: [] },
      main_theorems: [{ label: 'Theorem Only', statement: 'No entity.' }],
      entities: [entity('Lemma 0', 'LEMMA')],
    }
    const topology = computeTopology(metadataOnly)
    expect(topology.topDownOrder).toEqual(['Theorem Only'])
    expect(focusClosure(metadataOnly, 'Theorem Only')).toMatchObject({ found: true, closure: ['Theorem Only'] })
  })

  it('flags degradation above 40 entities', () => {
    const many = structure(
      Array.from({ length: 41 }, (_, index) => entity(`X${index}`, 'DEFINITION')),
    )
    expect(computeTopology(many).degradedRendering).toBe(true)
  })
})

describe('mermaidDisplayText', () => {
  it('strips LaTeX render commands and truncates to 50 chars', () => {
    expect(mermaidDisplayText('Def 1', 'A subset $\\mathbb{R}^d$ of euclidean space')).toBe('"Def 1: A subset R^dof euclidean space"')
    const long = mermaidDisplayText('T', 'x'.repeat(80))
    expect(long.length).toBeLessThanOrEqual(53)
    expect(long.endsWith('...')).toBe(true)
  })

  it('quotes texts with mermaid-sensitive characters', () => {
    const text = mermaidDisplayText('L', 'bounds x_i for all i')
    expect(text.startsWith('"')).toBe(true)
    expect(text.endsWith('"')).toBe(true)
  })
})

describe('renderMermaid', () => {
  const doc = structure(
    [
      entity('Def 1', 'DEFINITION'),
      entity('Lemma 1', 'LEMMA', ['Def 1'], { cited_by: ['Theorem 1', 'Lemma 2'] }),
      entity('Lemma 2', 'LEMMA', ['Def 1'], { uncertain_dependencies: ['Lemma 1 [UNCERTAIN: inferred]'] }),
      entity('Theorem 1', 'THEOREM', ['Lemma 1', 'Lemma 2']),
      entity('Cor 1', 'COROLLARY', ['Theorem 1']),
      entity('Obs 1', 'OBSERVATION', [], { external_refs: ['[9] GPY'] }),
    ],
    ['Theorem 1'],
  )

  it('renders nodes with symbols and layer subgraphs', () => {
    const mermaid = renderMermaid(doc)
    expect(mermaid.startsWith('graph TD')).toBe(true)
    expect(mermaid).toContain('subgraph Assumptions')
    expect(mermaid).toContain('subgraph MainResults')
    expect(mermaid).toContain('⭐')
    expect(mermaid).toContain('🧱')
  })

  it('renders UNCERTAIN edges dashed and external refs', () => {
    const mermaid = renderMermaid(doc)
    expect(mermaid).toContain('-.->|⚠️ UNCERTAIN|')
    expect(mermaid).toContain('-.->|📎 EXTERNAL|')
    expect(mermaid).toContain('ext9GPY')
  })

  it('marks shared and auto-labeled nodes', () => {
    const mermaid = renderMermaid(doc)
    expect(mermaid).toContain('[*]')
    const auto = renderMermaid(structure(
      [entity('Claim-X-1', 'CLAIM', ['Def 1'], { auto_labeled: true }), entity('Def 1', 'DEFINITION')],
    ))
    expect(auto).toContain('[AUTO]')
  })

  it('degrades above 40 entities to THEOREM-rooted subgraphs', () => {
    const many = structure(
      [
        entity('Theorem 1', 'THEOREM', ['Def 1']),
        ...Array.from({ length: 45 }, (_, index) => entity(`Def${index}`, 'DEFINITION', index === 0 ? [] : [`Def${index - 1}`])),
      ],
      ['Theorem 1'],
    )
    // Chain Def0 -> Def1 -> ... -> Def44; Theorem 1 depends on Def 1 (dangling) so root subgraph is small.
    many.entities = [entity('Theorem 1', 'THEOREM', ['Def0']), ...many.entities ?? []]
    const degraded = renderMermaid(many)
    expect(degraded).toContain('degraded to THEOREM-rooted depth-2 subgraphs')
    expect(degraded).toContain('subgraph Theorem1_sub')
    expect(degraded).toContain('Text list of')
    const full = renderMermaid(many, { forceFull: true })
    expect(full).not.toContain('degraded to THEOREM-rooted')
  })

  it('throws a structured error for non-object input', () => {
    expect(() => renderMermaid(undefined as unknown as PaperStructure)).toThrow(VeryMathError)
  })
})

describe('focusClosure', () => {
  const doc = structure(
    [
      entity('Def 1', 'DEFINITION'),
      entity('Lemma 1', 'LEMMA', ['Def 1']),
      entity('Lemma 2', 'LEMMA', ['Def 1']),
      entity('Theorem 1', 'THEOREM', ['Lemma 1', 'Lemma 2']),
    ],
    ['Theorem 1'],
  )

  it('returns the transitive closure in BFS layers', () => {
    const focus = focusClosure(doc, 'Theorem 1')
    expect(focus.found).toBe(true)
    expect(focus.levels[0]).toEqual(['Theorem 1'])
    expect(focus.levels[1]).toEqual(['Lemma 1', 'Lemma 2'])
    expect(focus.levels[2]).toEqual(['Def 1'])
    expect(focus.closure).toEqual(['Def 1', 'Lemma 1', 'Lemma 2', 'Theorem 1'])
  })

  it('reports not-found labels without throwing', () => {
    const focus = focusClosure(doc, 'Nope 9')
    expect(focus.found).toBe(false)
    expect(focus.closure).toEqual([])
  })

  it('resolves labels in main_theorems even when absent from entities (compact v4.2 form)', () => {
    // Maynard-style artifact: theorems live only in main_theorems[].
    const compact: PaperStructure = {
      paper: { title: 'Compact form', authors: ['A'] },
      main_theorems: [{ label: 'Theorem 1.2', statement: 'S.' }],
      entities: [entity('Def 1', 'DEFINITION')],
    }
    const focus = focusClosure(compact, 'Theorem 1.2')
    expect(focus.found).toBe(true)
    expect(focus.levels[0]).toEqual(['Theorem 1.2'])
    // No recorded edges from the synthetic theorem node: single-layer closure.
    expect(focus.levels).toHaveLength(1)
    expect(focus.closure).toEqual(['Theorem 1.2'])
  })

  it('follows dependencies from an entities-backed theorem through the merged namespace', () => {
    // If the artifact later adds dependencies onto the theorem entity, closure traverses them.
    const linked = structure(
      [
        entity('Def 1', 'DEFINITION'),
        entity('Lemma 1', 'LEMMA', ['Def 1']),
        entity('Theorem 1.2', 'THEOREM', ['Lemma 1']),
      ],
      ['Theorem 1.2'],
    )
    const focus = focusClosure(linked, 'Theorem 1.2')
    expect(focus.found).toBe(true)
    expect(focus.levels).toEqual([['Theorem 1.2'], ['Lemma 1'], ['Def 1']])
    expect(focus.closure).toEqual(['Def 1', 'Lemma 1', 'Theorem 1.2'])
  })
})
