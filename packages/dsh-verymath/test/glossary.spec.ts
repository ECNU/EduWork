import { describe, expect, it } from 'vitest'
import {
  parseGlossary,
  queryGlossary,
  sortGlossary,
  upsertTerms,
  validateGlossaryInvariants,
  type GlossaryTerm,
} from '../src/core/index.ts'
import { VeryMathError } from '../src/core/index.ts'

const today = '2026-10-14'

function term(overrides: Partial<GlossaryTerm> = {}): GlossaryTerm {
  return {
    term_id: 'manifold',
    en: 'manifold',
    cn: '流形',
    created_at: today,
    updated_at: today,
    ...overrides,
  }
}

describe('parseGlossary', () => {
  it('accepts a valid document with optional fields', () => {
    const terms = parseGlossary([
      term({ idx: 1, pos: '名词', field: ['拓扑学'], source: '新英汉数学词汇', examples: [{ en: 'a smooth manifold', cn: '光滑流形' }] }),
      { term_id: 'group', en: 'group', cn: '群', created_at: today, updated_at: today },
    ])
    expect(terms).toHaveLength(2)
    expect(terms[0]?.field).toEqual(['拓扑学'])
    expect(terms[1]?.pos).toBeUndefined()
  })

  it('rejects a non-array document', () => {
    expect(() => parseGlossary({})).toThrow(VeryMathError)
    try {
      parseGlossary('nope')
      expect.unreachable()
    } catch (error) {
      expect((error as VeryMathError).code).toBe('VERYMATH_GLOSSARY_INVALID')
    }
  })

  it('rejects entries missing required fields with the entry index', () => {
    try {
      parseGlossary([{ en: 'group', cn: '群' }])
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(VeryMathError)
      expect((error as VeryMathError).message).toContain('glossary entry 0')
      expect((error as VeryMathError).message).toContain('term_id')
    }
  })

  it('drops malformed optional fields silently (compact upstream form)', () => {
    const terms = parseGlossary([
      term({ field: 'not-an-array' as unknown as string[], examples: [{ en: 'x' }] }),
    ])
    expect(terms[0]?.field).toBeUndefined()
    expect(terms[0]?.examples).toBeUndefined()
  })
})

describe('sortGlossary', () => {
  it('sorts by en then cn and reassigns contiguous idx', () => {
    const sorted = sortGlossary([
      term({ term_id: 'zebra', en: 'zebra', cn: '斑马' }),
      term({ term_id: 'group', en: 'group', cn: '群' }),
      term({ term_id: 'group__1', en: 'group', cn: '群' }),
      term({ term_id: 'axiom-of-choice', en: 'axiom of choice', cn: '选择公理' }),
    ])
    expect(sorted.map(entry => entry.en)).toEqual(['axiom of choice', 'group', 'group', 'zebra'])
    expect(sorted.map(entry => entry.idx)).toEqual([1, 2, 3, 4])
  })

  it('does not mutate the input', () => {
    const input = [term({ term_id: 'zebra', en: 'zebra', cn: '斑马' })]
    const snapshot = [...input]
    sortGlossary(input)
    expect(input).toEqual(snapshot)
  })
})

describe('validateGlossaryInvariants', () => {
  it('accepts unique ids and ISO dates', () => {
    expect(() => validateGlossaryInvariants([term(), term({ term_id: 'group', en: 'group', cn: '群' })])).not.toThrow()
  })

  it('rejects duplicate term_id values', () => {
    expect(() => validateGlossaryInvariants([term(), term()])).toThrow(/duplicate term_id/)
  })

  it('rejects non-ISO dates', () => {
    expect(() => validateGlossaryInvariants([term({ created_at: '2026/10/14' })])).toThrow(/YYYY-MM-DD/)
  })

  it('rejects non-contiguous idx numbering', () => {
    expect(() => validateGlossaryInvariants([term({ idx: 1 }), term({ term_id: 'group', en: 'group', cn: '群', idx: 3 })]))
      .toThrow(/contiguous/)
  })
})

describe('queryGlossary', () => {
  const glossary = sortGlossary([
    term(),
    term({ term_id: 'smooth-manifold', en: 'smooth manifold', cn: '光滑流形', field: ['微分几何'] }),
    term({ term_id: 'group', en: 'group', cn: '群' }),
    term({ term_id: 'cohomology', en: 'cohomology', cn: '上同调', field: ['代数拓扑', '微分几何'] }),
  ])

  it('matches exact English terms first', () => {
    const { hits } = queryGlossary(glossary, 'manifold')
    expect(hits[0]?.matchedBy).toBe('en')
    expect(hits[0]?.term.cn).toBe('流形')
  })

  it('matches exact Chinese terms', () => {
    const { hits } = queryGlossary(glossary, '群')
    expect(hits[0]?.term.term_id).toBe('group')
  })

  it('falls back to English prefix', () => {
    const { hits } = queryGlossary(glossary, 'coh')
    expect(hits.map(hit => hit.term.term_id)).toEqual(['cohomology'])
    expect(hits[0]?.matchedBy).toBe('en-prefix')
  })

  it('falls back to Chinese substring', () => {
    const { hits } = queryGlossary(glossary, '流形')
    // Both entries contain 流形; hits follow document (en,cn) order.
    expect(hits.map(hit => hit.term.term_id)).toEqual(['manifold', 'smooth-manifold'])
  })

  it('matches by subfield name', () => {
    const { hits } = queryGlossary(glossary, '代数拓扑')
    expect(hits[0]?.matchedBy).toBe('field')
    expect(hits[0]?.term.term_id).toBe('cohomology')
  })

  it('returns empty for empty queries and dedupes hits', () => {
    expect(queryGlossary(glossary, '  ')).toEqual({ hits: [], total: 0 })
    const { hits } = queryGlossary(glossary, 'manifold', 1)
    expect(hits).toHaveLength(1)
  })

  it('reports the deduplicated candidate total across stages', () => {
    // 'manifold' hits the same term via en and en-prefix: 1 unique candidate.
    // 'smooth manifold' does not start with 'manifold', so it never matches.
    const limited = queryGlossary(glossary, 'manifold', 1)
    expect(limited.total).toBe(1)
    expect(limited.hits).toHaveLength(1)
    const full = queryGlossary(glossary, 'manifold')
    expect(full.total).toBe(full.hits.length)
    // A cn-substring query matches both 流形 and 光滑流形 without truncation.
    const chinese = queryGlossary(glossary, '流形')
    expect(chinese.total).toBe(2)
    expect(chinese.hits).toHaveLength(2)
  })
})

describe('queryGlossary field filter', () => {
  // manifold 光滑流形 style polysemy: same en, different translations per field.
  const glossary = sortGlossary([
    term({ term_id: 'norm', en: 'norm', cn: '范数', field: ['泛函分析'], examples: [{ en: 'operator norm', cn: '算子范数' }] }),
    term({ term_id: 'norm__1', en: 'norm', cn: '规范', field: ['代数数论'] }),
  ])

  it('restricts candidates by exact subfield', () => {
    const { hits } = queryGlossary(glossary, 'norm', { field: '代数数论' })
    expect(hits).toHaveLength(1)
    expect(hits[0]?.term.cn).toBe('规范')
    const functional = queryGlossary(glossary, 'norm', { field: '泛函分析' })
    expect(functional.hits[0]?.term.cn).toBe('范数')
  })

  it('returns empty when no term carries the subfield', () => {
    const { hits, total } = queryGlossary(glossary, 'norm', { field: '测度论' })
    expect(hits).toEqual([])
    expect(total).toBe(0)
  })

  it('keeps the bare-number limit form working', () => {
    const { hits } = queryGlossary(glossary, 'norm', 1)
    expect(hits).toHaveLength(1)
  })
})

describe('upsertTerms', () => {
  it('adds new terms with derived term_id and re-sorts with contiguous idx', () => {
    const existing = sortGlossary([term({ term_id: 'manifold', en: 'manifold', cn: '流形' })])
    const result = upsertTerms(existing, [{ en: 'group', cn: '群' }])
    expect(result.added).toEqual(['group'])
    expect(result.updated).toEqual([])
    expect(result.document.map(entry => entry.en)).toEqual(['group', 'manifold'])
    expect(result.document.map(entry => entry.idx)).toEqual([1, 2])
    const added = result.document.find(entry => entry.term_id === 'group')
    expect(added?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('updates an existing term in place, preserving created_at and bumping updated_at', () => {
    const existing = sortGlossary([term({ term_id: 'manifold', en: 'manifold', cn: '流形', created_at: '2020-01-01' })])
    const result = upsertTerms(existing, [{ en: 'manifold', cn: '流形（几何）', source: 'upsert test' }])
    expect(result.added).toEqual([])
    expect(result.updated).toEqual(['manifold'])
    const updated = result.document.find(entry => entry.term_id === 'manifold')
    expect(updated?.cn).toBe('流形（几何）')
    expect(updated?.created_at).toBe('2020-01-01')
    expect(updated?.source).toBe('upsert test')
  })

  it('keeps existing optional fields when the request omits them', () => {
    const existing = sortGlossary([term({ term_id: 'norm', en: 'norm', cn: '范数', field: ['泛函分析'], examples: [{ en: 'op norm', cn: '算子范数' }] })])
    const result = upsertTerms(existing, [{ en: 'norm', cn: '范数' }])
    const merged = result.document.find(entry => entry.term_id === 'norm')
    expect(merged?.field).toEqual(['泛函分析'])
    expect(merged?.examples).toEqual([{ en: 'op norm', cn: '算子范数' }])
  })

  it('never mutates the input document', () => {
    const existing = sortGlossary([term()])
    const before = JSON.stringify(existing)
    upsertTerms(existing, [{ en: 'group', cn: '群' }])
    expect(JSON.stringify(existing)).toBe(before)
  })

  it('rejects empty en or cn', () => {
    const existing = sortGlossary([term()])
    expect(() => upsertTerms(existing, [{ en: '  ', cn: 'x' }])).toThrow(/non-empty/)
    expect(() => upsertTerms(existing, [{ en: 'x', cn: '' }])).toThrow(/non-empty/)
  })
})
