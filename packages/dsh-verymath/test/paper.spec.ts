import { describe, expect, it } from 'vitest'
import { dependencySummary, mergeStructures, parsePaperBatch, parsePaperStructure } from '../src/core/index.ts'
import { VeryMathError } from '../src/core/index.ts'

function structure(overrides: Record<string, unknown> = {}) {
  return {
    paper: {
      title: 'On the Cohomology of Manifolds',
      authors: ['A. Author'],
      year: 2026,
      arxiv_id: '2601.12345',
      language: 'EN',
      analysis_date: '2026-10-14',
      skill_version: '4.2',
    },
    section_map: [
      { section: '§1', title: 'Introduction', section_type: '引言', skill2_action: '无需处理', appendix: false },
      { section: '§2', title: 'Main results', section_type: '主要结果', skill2_action: '正常提取', appendix: false },
    ],
    main_theorems: [
      {
        label: 'Theorem 2.1',
        statement: 'Every compact manifold has a finite good cover.',
        location: { section: '§2', page: '3' },
        role: 'main',
        proof_methods: [{ proof_variant: 1, method: 'induction on covers', location: '§4' }],
      },
    ],
    entities: [
      {
        type: 'DEFINITION',
        label: 'Definition 1.2',
        statement: 'A good cover is a cover by charts whose finite intersections are diffeomorphic to balls.',
        location: { section: '§1', page: '2' },
      },
      {
        type: 'LEMMA',
        label: 'Lemma 4.1',
        statement: 'Transitions on a good cover are finite order.',
        location: { section: '§4', page: '9' },
        dependencies: ['Definition 1.2'],
        cited_by: ['Theorem 2.1'],
        proof_methods: [{ proof_variant: 1, method: 'direct computation' }],
      },
    ],
    proof_framework: {
      center_theorem: 'Theorem 2.1',
      dependency_tree: 'Theorem 2.1\n  Lemma 4.1\n    Definition 1.2',
      strategy_summary: 'Reduce to good covers, then induct.',
    },
    completeness_check: {
      self_containment: 'high',
    },
    ...overrides,
  }
}

describe('parsePaperStructure', () => {
  it('accepts a complete v4.2 artifact', () => {
    const parsed = parsePaperStructure(structure())
    expect(parsed.paper.title).toBe('On the Cohomology of Manifolds')
    expect(parsed.entities).toHaveLength(2)
  })

  it('accepts the compact upstream form with omitted empty fields', () => {
    const parsed = parsePaperStructure({
      paper: { title: 'Minimal', authors: [] },
      entities: [{ type: 'REMARK', label: 'Remark 1', statement: 'Note.' }],
    })
    expect(parsed.main_theorems).toBeUndefined()
    expect(parsed.entities).toHaveLength(1)
  })

  it('rejects a non-object document and missing paper.title', () => {
    expect(() => parsePaperStructure([1, 2])).toThrow(VeryMathError)
    expect(() => parsePaperStructure({ paper: {} })).toThrow(/paper\.title/)
    expect(() => parsePaperStructure({})).toThrow(/paper\.title/)
  })

  it('rejects unknown entity kinds', () => {
    expect(() => parsePaperStructure(structure({
      entities: [{ type: 'CONJECTURE', label: 'Conjecture 1', statement: 'Maybe.' }],
    }))).toThrow(/unknown type/)
  })

  it('rejects dependency edges pointing at unknown labels', () => {
    expect(() => parsePaperStructure(structure({
      entities: [{
        type: 'LEMMA', label: 'Lemma 4.1', statement: 'S.', dependencies: ['Theorem 9.9'],
      }],
    }))).toThrow(/unknown label Theorem 9\.9/)
  })

  it('accepts dependencies resolved through main_theorems labels', () => {
    const parsed = parsePaperStructure(structure({
      entities: [{
        type: 'LEMMA', label: 'Lemma 4.1', statement: 'S.', dependencies: ['Theorem 2.1'],
      }],
    }))
    expect(parsed.entities?.[0]?.dependencies).toEqual(['Theorem 2.1'])
  })
})

describe('dependencySummary', () => {
  it('counts dependents and finds dependency roots', () => {
    const summary = dependencySummary(parsePaperStructure(structure()))
    // "root" = known label nothing depends on. Theorem 2.1 is depended on by
    // nothing (Lemma 4.1 declares the edge the other way), Definition 1.2 is
    // depended on by Lemma 4.1.
    expect(summary.roots).toContain('Theorem 2.1')
    expect(summary.roots).not.toContain('Definition 1.2')
  })

  it('handles documents with no entities', () => {
    const summary = dependencySummary(parsePaperStructure({ paper: { title: 'Empty' } }))
    expect(summary.roots).toEqual([])
    expect(Object.keys(summary.dependentCounts)).toEqual([])
  })
})

describe('parsePaperBatch', () => {
  const batchA = {
    paper: { title: 'Batched' },
    entities: [{ type: 'DEFINITION', label: 'Definition 1', statement: 'A point.' }],
  }
  const batchB = {
    paper: { title: 'Batched' },
    entities: [{ type: 'LEMMA', label: 'Lemma 2.1', statement: 'A lemma.', dependencies: ['Definition 1'] }],
  }

  it('accepts a dependency that an earlier batch defines', () => {
    // The upstream batch protocol has later artifacts cite earlier labels; the
    // per-file check rejected exactly this before the merge could run.
    expect(() => parsePaperBatch([batchA, batchB])).not.toThrow()
    expect(parsePaperBatch([batchA, batchB])).toHaveLength(2)
  })

  it('rejects a per-file check of the same batch on its own', () => {
    expect(() => parsePaperStructure(batchB)).toThrow(/unknown label Definition 1/)
  })

  it('still rejects a dependency missing from every artifact', () => {
    const orphan = {
      paper: { title: 'Batched' },
      entities: [{ type: 'CLAIM', label: 'Claim 9', statement: 'x', dependencies: ['Nope 42'] }],
    }
    expect(() => parsePaperBatch([batchA, orphan])).toThrow(/unknown label Nope 42/)
  })

  it('counts main theorems from any artifact as known labels', () => {
    const citing = {
      paper: { title: 'Batched' },
      entities: [{ type: 'LEMMA', label: 'Lemma 3', statement: 'x', dependencies: ['Theorem 7'] }],
    }
    const theoremOnly = { paper: { title: 'Batched' }, main_theorems: [{ label: 'Theorem 7', statement: 'y' }] }
    expect(() => parsePaperBatch([theoremOnly, citing])).not.toThrow()
  })

  it('validates entity kinds before merging', () => {
    const bad = { paper: { title: 'Batched' }, entities: [{ type: 'CONJECTURE', label: 'C1', statement: 'x' }] }
    expect(() => parsePaperBatch([batchA, bad])).toThrow(/unknown type/)
  })
})

describe('mergeStructures', () => {
  it('folds every batch entity and main theorem into one structure', () => {
    const a = {
      paper: { title: 'Merged' },
      entities: [
        { type: 'DEFINITION', label: 'Definition 1', statement: 'A point.' },
        { type: 'THEOREM', label: 'Theorem 1', statement: 'Main.', dependencies: ['Definition 1'] },
      ],
    }
    const b = {
      paper: { title: 'Merged' },
      main_theorems: [{ label: 'Theorem 2', statement: 'Second main.' }],
      entities: [{ type: 'LEMMA', label: 'Lemma 3', statement: 'x', dependencies: ['Theorem 1'] }],
    }
    const merged = mergeStructures([a, b])
    expect(merged.paper.title).toBe('Merged')
    expect(merged.entities?.map(entry => entry.label).sort()).toEqual(['Definition 1', 'Lemma 3', 'Theorem 1'])
    expect(merged.main_theorems?.map(entry => entry.label)).toEqual(['Theorem 2'])
    // cited_by is rebuilt by the merge, which is what makes the render faithful.
    expect(merged.entities?.find(entry => entry.label === 'Theorem 1')?.cited_by).toEqual(['Lemma 3'])
  })

  it('keeps a single artifact intact', () => {
    const single = { paper: { title: 'One' }, entities: [{ type: 'THEOREM', label: 'T', statement: 'x' }] }
    expect(mergeStructures(single).paper.title).toBe('One')
    expect(mergeStructures(single).entities).toHaveLength(1)
  })
})
