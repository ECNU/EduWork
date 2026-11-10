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

  it('matches exact Chinese terms as Chinese matches', () => {
    const { hits } = queryGlossary(glossary, '群')
    expect(hits[0]?.term.term_id).toBe('group')
    // A Chinese query must not report an English-field match (it used to say 'en').
    expect(hits[0]?.matchedBy).toBe('cn')
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

  it('updates a term in place when the exact (en, cn) pair already exists', () => {
    const existing = sortGlossary([term({ term_id: 'manifold', en: 'manifold', cn: '流形', created_at: '2020-01-01' })])
    const result = upsertTerms(existing, [{ en: 'manifold', cn: '流形', source: 'upsert test' }])
    expect(result.added).toEqual([])
    expect(result.updated).toEqual(['manifold'])
    const updated = result.document.find(entry => entry.term_id === 'manifold')
    expect(updated?.cn).toBe('流形')
    expect(updated?.created_at).toBe('2020-01-01')
    expect(updated?.source).toBe('upsert test')
  })

  it('corrects a translation when term_id selects the row', () => {
    const existing = sortGlossary([term({ term_id: 'manifold', en: 'manifold', cn: '流形', created_at: '2020-01-01' })])
    const result = upsertTerms(existing, [{ term_id: 'manifold', en: 'manifold', cn: '流形（几何）', source: 'upsert test' }])
    expect(result.added).toEqual([])
    expect(result.updated).toEqual(['manifold'])
    const updated = result.document.find(entry => entry.term_id === 'manifold')
    expect(updated?.cn).toBe('流形（几何）')
    expect(updated?.created_at).toBe('2020-01-01')
    expect(updated?.source).toBe('upsert test')
    expect(result.document).toHaveLength(1)
  })

  it('stores a second translation of the same English term as an alias row', () => {
    const existing = sortGlossary([term({ term_id: 'group', en: 'group', cn: '群' })])
    const result = upsertTerms(existing, [{ en: 'group', cn: '分组', field: ['计算数学'] }])
    expect(result.added).toEqual(['group__1'])
    expect(result.updated).toEqual([])
    // Order-independent: the document is sorted by (en, cn), and 分 < 群 by code point.
    expect(Object.fromEntries(result.document.map(entry => [entry.term_id, entry.cn]))).toEqual({
      group: '群',
      group__1: '分组',
    })
  })

  it('updates an existing alias row instead of overwriting the primary (regression)', () => {
    // The shape the bundled Python build script produces for two translations,
    // and the exact case where the previous implementation replaced the primary
    // translation 群 with 分组 and left two rows saying the same thing.
    const existing = sortGlossary([
      term({ term_id: 'group', en: 'group', cn: '群' }),
      term({ term_id: 'group__1', en: 'group', cn: '分组' }),
    ])
    const result = upsertTerms(existing, [{ en: 'group', cn: '分组' }])
    expect(result.updated).toEqual(['group__1'])
    expect(result.added).toEqual([])
    expect(Object.fromEntries(result.document.map(entry => [entry.term_id, entry.cn]))).toEqual({
      group: '群',
      group__1: '分组',
    })
  })

  it('is idempotent when the same (en, cn) pair is added twice in one batch', () => {
    const result = upsertTerms([], [{ en: 'norm', cn: '范数' }, { en: 'norm', cn: '范数' }])
    expect(result.added).toEqual(['norm'])
    // Created by this batch, so it is reported as added only, never both.
    expect(result.updated).toEqual([])
    expect(result.document).toHaveLength(1)
  })

  it('allocates alias ids per batch for three translations of one term', () => {
    const result = upsertTerms([], [
      { en: 'group', cn: '群' },
      { en: 'group', cn: '分组' },
      { en: 'group', cn: '团' },
    ])
    expect(result.added).toEqual(['group', 'group__1', 'group__2'])
    expect(Object.fromEntries(result.document.map(entry => [entry.term_id, entry.cn]))).toEqual({
      group: '群',
      group__1: '分组',
      group__2: '团',
    })
  })

  it('continues from the highest known suffix instead of filling gaps', () => {
    // Primary row deleted, alias __1 kept: the next translation must not claim
    // the bare id, which carries the upstream "first occurrence" identity.
    const onlyAlias = sortGlossary([term({ term_id: 'group__1', en: 'group', cn: '分组' })])
    expect(upsertTerms(onlyAlias, [{ en: 'group', cn: '团' }]).added).toEqual(['group__2'])

    // base + __4 present: continue at __5, do not reuse __1/__2/__3.
    const gapped = sortGlossary([
      term({ term_id: 'group', en: 'group', cn: '群' }),
      term({ term_id: 'group__4', en: 'group', cn: '分组' }),
    ])
    expect(upsertTerms(gapped, [{ en: 'group', cn: '团' }]).added).toEqual(['group__5'])
  })

  it('skips a candidate id another English term already uses', () => {
    const existing = sortGlossary([
      term({ term_id: 'group', en: 'group', cn: '群' }),
      term({ term_id: 'group__2', en: 'group', cn: '分组' }),
      term({ term_id: 'group__3', en: 'group notation', cn: '群的记号' }),
    ])
    // __3 is taken by another English term, so the next free id is __4.
    expect(upsertTerms(existing, [{ en: 'group', cn: '团' }]).added).toEqual(['group__4'])
  })

  it('matches an English term case-insensitively', () => {
    const existing = sortGlossary([term({ term_id: 'manifold', en: 'Manifold', cn: '流形' })])
    const result = upsertTerms(existing, [{ en: 'manifold', cn: '流形', source: 'case test' }])
    expect(result.added).toEqual([])
    expect(result.updated).toEqual(['manifold'])
    // The stored source spelling is not rewritten by a pair match.
    expect(result.document[0]?.en).toBe('Manifold')
    expect(result.document[0]?.source).toBe('case test')
  })

  it('rejects a term_id that does not exist', () => {
    expect(() => upsertTerms([term()], [{ term_id: 'nope', en: 'manifold', cn: '流形' }]))
      .toThrow(/no term with term_id/)
  })

  it('matches term_id exactly, without case folding it', () => {
    // A term_id is an opaque identity: 'Manifold' is a different row from
    // 'manifold', and a near-miss must be reported rather than resolved.
    const existing = sortGlossary([term({ term_id: 'manifold', en: 'manifold', cn: '流形' })])
    expect(() => upsertTerms(existing, [{ term_id: 'Manifold', en: 'manifold', cn: '流形物' }]))
      .toThrow(/no term with term_id "Manifold"/)
  })

  it('rejects a blank term_id instead of treating it as absent', () => {
    expect(() => upsertTerms([term()], [{ term_id: '   ', en: 'manifold', cn: '流形' }]))
      .toThrow(/must not be blank/)
  })

  it('rejects a term_id that belongs to a different English term', () => {
    expect(() => upsertTerms([term()], [{ term_id: 'manifold', en: 'morphism', cn: '态射' }]))
      .toThrow(/is the English term "manifold", not "morphism"/)
  })

  it('rejects a correction that would duplicate another row (en, cn) pair', () => {
    const existing = sortGlossary([
      term({ term_id: 'group', en: 'group', cn: '群' }),
      term({ term_id: 'group__1', en: 'group', cn: '分组' }),
    ])
    expect(() => upsertTerms(existing, [{ term_id: 'group', en: 'group', cn: '分组' }]))
      .toThrow(/already held by group__1/)
  })

  it('rejects an ambiguous (en, cn) match and names the candidate ids', () => {
    const existing = sortGlossary([
      term({ term_id: 'group', en: 'group', cn: '群' }),
      term({ term_id: 'group__1', en: 'group', cn: '群' }),
    ])
    expect(() => upsertTerms(existing, [{ en: 'group', cn: '群' }]))
      .toThrow(/2 rows with the translation/)
  })

  it('terminates when an id carries a suffix beyond the safe integer range', () => {
    // `Number` cannot represent 2^53 + 1, so a counter derived from these ids
    // used to stop advancing and spin forever (synchronously — hanging the host
    // event loop). The counter is a BigInt now.
    const existing = sortGlossary([
      term({ term_id: 'group', en: 'group', cn: '群' }),
      term({ term_id: 'group__9007199254740991', en: 'group', cn: '分组' }),
      term({ term_id: 'group__9007199254740992', en: 'group', cn: '团' }),
    ])
    const result = upsertTerms(existing, [{ en: 'group', cn: '群组' }])
    expect(result.added).toEqual(['group__9007199254740993'])
    expect(result.document).toHaveLength(4)
  })

  it('keeps the sequence self-consistent across the 32-to-33 digit boundary', () => {
    // The allocator must never emit an id its own reader refuses to parse: with a
    // 32-digit cap, a 33-digit suffix was ignored and the next translation got the
    // bare id back (breaking "continue from the highest known suffix").
    const nines32 = '9'.repeat(32)
    const boundary = sortGlossary([term({ term_id: `group__${nines32}`, en: 'group', cn: '分组' })])
    const generated = upsertTerms(boundary, [{ en: 'group', cn: '团' }]).added[0]
    expect(generated).toBe(`group__1${'0'.repeat(32)}`)
    // And that generated id is read back as the new high-water mark.
    const chained = sortGlossary(upsertTerms(boundary, [{ en: 'group', cn: '团' }]).document)
    expect(upsertTerms(chained, [{ en: 'group', cn: '群' }]).added[0]).toBe(`group__1${'0'.repeat(32).slice(1)}1`)
  })

  it('continues from a 33-digit suffix instead of restarting at the bare id', () => {
    const suffix33 = '1' + '0'.repeat(32) // 10^32
    const existing = sortGlossary([term({ term_id: `group__${suffix33}`, en: 'group', cn: '分组' })])
    // 10^32 + 1 is 33 digits: '1', 31 zeros, '1'.
    expect(upsertTerms(existing, [{ en: 'group', cn: '团' }]).added[0]).toBe(`group__1${'0'.repeat(31)}1`)
  })

  it('treats a zero-padded suffix by its numeric value', () => {
    const existing = sortGlossary([term({ term_id: `group__${'0'.repeat(32)}4`, en: 'group', cn: '分组' })])
    // Suffix 4 is the high-water mark, so the next alias is 5 — carried in plain
    // decimal, not in the padded spelling.
    expect(upsertTerms(existing, [{ en: 'group', cn: '团' }]).added).toEqual(['group__5'])
  })

  it('refuses an absurd numeric suffix instead of silently restarting at the bare id', () => {
    const absurd = '9'.repeat(70)
    const existing = sortGlossary([term({ term_id: `group__${absurd}`, en: 'group', cn: '分组' })])
    expect(() => upsertTerms(existing, [{ en: 'group', cn: '团' }]))
      .toThrow(/70-digit numeric suffix/)
  })

  it('does not confuse two (en, cn) pairs that differ only at a NUL boundary', () => {
    // A NUL-joined key made these two pairs identical, so the second request
    // overwrote a row belonging to a different English term.
    const existing = sortGlossary([term({ term_id: 'x', en: 'a', cn: 'b\u0000c' })])
    const result = upsertTerms(existing, [{ en: 'a\u0000b', cn: 'c' }])
    expect(result.updated).toEqual([])
    expect(result.added).toEqual(['a\u0000b'])
    const preserved = result.document.find(entry => entry.term_id === 'x')
    expect(preserved?.cn).toBe('b\u0000c')
  })

  it('rejects an input document with duplicate term_ids before indexing it', () => {
    const duplicated = [term(), term()]
    expect(() => upsertTerms(duplicated, [{ en: 'group', cn: '群' }])).toThrow(/duplicate term_id/)
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
