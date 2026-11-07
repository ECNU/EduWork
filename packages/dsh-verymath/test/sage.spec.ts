import { describe, expect, it } from 'vitest'
import {
  docPath,
  findExcerpt,
  loadManifest,
  resolveCorpusRoot,
  scoreRow,
  searchSageRefs,
  termsFor,
  type SageRefRow,
} from '../src/core/index.ts'
import { VeryMathError } from '../src/core/index.ts'

// The local machine has the corpus at ~/.verymath/sagemath-corpus (installed from
// the CC BY-SA SageMath docs). Tests skip gracefully when it is absent.
const corpusAvailable = await resolveCorpusRoot().then(() => true).catch(() => false)

function row(overrides: Partial<SageRefRow> = {}): SageRefRow {
  return {
    path: 'references/api/test/doc.txt',
    api_path: 'sage.rings.polynomial',
    domain: 'rings',
    title: 'Polynomial rings',
    symbols: ['PolynomialRing'],
    methods: ['gen', 'basis'],
    headings: ['Construction', 'Examples'],
    preview: 'Create a polynomial ring and its generators.',
    examples: ['R.<x> = PolynomialRing(QQ)'],
    bytes: 1024,
    lines: 40,
    ...overrides,
  }
}

describe('termsFor', () => {
  it('tokenizes and drops short terms', () => {
    expect(termsFor('Elliptic Curve rank over QQ')).toEqual(['elliptic', 'curve', 'rank', 'over', 'qq'])
  })
})

describe('scoreRow', () => {
  it('ranks exact title matches above preview matches', () => {
    const base = row()
    const strong = scoreRow(base, 'polynomial rings', termsFor('polynomial rings'), base.preview)
    const weak = scoreRow(row({ title: 'Unrelated' }), 'polynomial rings', termsFor('polynomial rings'), 'mentions polynomial rings in passing')
    expect(strong).toBeGreaterThan(weak)
  })

  it('adds per-term scores across fields', () => {
    const score = scoreRow(row(), 'ring basis', termsFor('ring basis'), 'basis basis basis')
    expect(score).toBeGreaterThan(30)
  })
})

describe('findExcerpt', () => {
  it('returns a numbered context window around the first match', () => {
    const lines = ['intro', 'alpha', 'the elliptic curve group', 'beta', 'outro']
    const excerpt = findExcerpt(lines, 'elliptic curve', termsFor('elliptic curve'))
    // context=2 → 2 lines above + match + 2 lines below (clamped to doc bounds).
    expect(excerpt.split('\n')).toHaveLength(5)
    expect(excerpt).toContain('3: the elliptic curve group')
  })

  it('returns empty when nothing matches', () => {
    expect(findExcerpt(['a', 'b'], 'zzz', termsFor('zzz'))).toBe('')
  })
})

describe('docPath', () => {
  it('strips the references/ prefix from manifest paths', () => {
    expect(docPath('/corpus', row())).toBe('/corpus/api/test/doc.txt')
  })
})

describe.skipIf(!corpusAvailable)('live corpus (installed at ~/.verymath/sagemath-corpus)', () => {
  it('loads the full manifest', async () => {
    const rows = await loadManifest()
    expect(rows.length).toBeGreaterThan(3000)
  })

  it('searches with excerpts from real documents', async () => {
    const rows = await loadManifest()
    const hits = await searchSageRefs(rows, 'elliptic curve', { limit: 5, withExcerpts: 2 })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]?.score).toBeGreaterThan(50)
    expect(hits[0]?.excerpt.length).toBeGreaterThan(0)
  })

  it('throws the structured corpus-missing error when the root is wrong', async () => {
    await expect(loadManifest('/nonexistent-corpus-xyz')).rejects.toThrow(VeryMathError)
  })
})
