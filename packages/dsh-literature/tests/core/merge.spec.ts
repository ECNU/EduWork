import { describe, expect, it } from 'vitest'
import { compact, mergeHits } from '@eduwork/dsh-literature/core'
import type { RawHit } from '@eduwork/dsh-literature/core'

describe('compact', () => {
  it('deletes undefined-valued keys in place', () => {
    const value = { a: 1, b: undefined, c: 'x' }
    compact(value)
    expect(value).toEqual({ a: 1, c: 'x' })
  })
})

function dblp(key: string, title: string, year: number, preprint = false, doi?: string, venue?: string): RawHit {
  return compact({
    source: 'dblp',
    title,
    rawTitle: title,
    authors: ['A. Author'],
    year,
    venue,
    doi,
    preprint,
    dblpKey: key,
    url: `https://dblp.org/rec/${key}`,
  })
}

function arxiv(id: string, title: string, year = 2025): RawHit {
  return {
    source: 'arxiv',
    title,
    rawTitle: title,
    authors: ['A. Author'],
    year,
    preprint: true,
    arxivId: id,
    url: `https://arxiv.org/abs/${id}`,
  }
}

describe('mergeHits', () => {
  it('merges the formal dblp record with its CoRR mirror, preferring published metadata', () => {
    const hits = [
      dblp('conf/acl/XiLJCWLY26', 'RIPRAG: Hack a System.', 2026, false, '10.18653/V1/2026.FINDINGS-ACL.833', 'ACL'),
      dblp('journals/corr/abs-2510-10008', 'RIPRAG: Hack a System.', 2025, true, '10.48550/ARXIV.2510.10008', 'CoRR'),
    ]
    const [record] = mergeHits(hits)
    expect(record).toBeDefined()
    expect(record!.published).toBe(true)
    expect(record!.venue).toBe('ACL')
    expect(record!.year).toBe(2026)
    expect(record!.doi).toBe('10.18653/V1/2026.FINDINGS-ACL.833')
    expect(record!.arxivId).toBe('2510.10008')
    expect(record!.dblpKey).toBe('conf/acl/XiLJCWLY26')
    expect(record!.sources).toEqual(['dblp'])
    expect(record!.id).toBe('arxiv:2510.10008')
  })

  it('merges a CoRR hit with its arXiv hit by the derived arXiv id', () => {
    const hits = [
      dblp('journals/corr/abs-2510-10008', 'RIPRAG: Hack a System.', 2025, true, '10.48550/ARXIV.2510.10008', 'CoRR'),
      arxiv('2510.10008', 'RIPRAG: Hack a System.', 2025),
    ]
    const [record] = mergeHits(hits)
    expect(record!.published).toBe(false)
    expect(record!.sources).toEqual(['dblp', 'arxiv'])
    expect(record!.arxivId).toBe('2510.10008')
  })

  it('merges a formal dblp record with an arXiv hit by publisher DOI', () => {
    const hits = [
      dblp('conf/acl/XiLJCWLY26', 'RIPRAG: Hack a System.', 2026, false, '10.18653/V1/2026.FINDINGS-ACL.833', 'ACL'),
      arxiv('2510.10008', 'RIPRAG: Hack a System.', 2025),
    ]
    const [record] = mergeHits(hits)
    expect(record!.published).toBe(true)
    expect(record!.sources).toEqual(['dblp', 'arxiv'])
  })

  it('merges by normalized title when no id or DOI matches', () => {
    const hits = [
      dblp('conf/x/A', 'Batch Normalization.', 2015),
      arxiv('1502.03167', 'Batch Normalization', 2015),
    ]
    const [record] = mergeHits(hits)
    expect(record).toBeDefined()
    expect(record!.sources).toEqual(['dblp', 'arxiv'])
  })

  it('keeps unrelated hits separate and sorts by year descending', () => {
    const hits = [
      dblp('conf/a/Newer', 'Newer Paper.', 2026),
      dblp('conf/b/Older', 'Older Paper.', 2019),
    ]
    const records = mergeHits(hits)
    expect(records.map(record => record.title)).toEqual(['Newer Paper.', 'Older Paper.'])
  })

  it('merges by an identical publisher DOI', () => {
    const hits = [
      dblp('conf/a/X', 'RIPRAG.', 2026, false, '10.18653/V1/2026.X', 'ACL'),
      dblp('conf/b/Y', 'RIPRAG.', 2026, false, '10.18653/V1/2026.X', 'ACL'),
    ]
    const records = mergeHits(hits)
    expect(records).toHaveLength(1)
  })

  it('merges an arXiv hit with a dblp DataCite-DOI hit', () => {
    const hits = [
      arxiv('2510.10008', 'RIPRAG.', 2025),
      compact({ source: 'dblp', title: 'RIPRAG.', rawTitle: 'RIPRAG.', authors: ['A'], year: 2025, preprint: true, dblpKey: 'conf/a/X', doi: '10.48550/arxiv.2510.10008' }) as RawHit,
    ]
    const records = mergeHits(hits)
    expect(records).toHaveLength(1)
    expect(records[0]!.arxivId).toBe('2510.10008')
  })

  it('merges a dblp DataCite-DOI hit with an arXiv hit in reverse order', () => {
    const hits = [
      compact({ source: 'dblp', title: 'RIPRAG.', rawTitle: 'RIPRAG.', authors: ['A'], year: 2025, preprint: true, dblpKey: 'conf/a/X', doi: '10.48550/arxiv.2510.10008' }) as RawHit,
      arxiv('2510.10008', 'RIPRAG.', 2025),
    ]
    const records = mergeHits(hits)
    expect(records).toHaveLength(1)
  })

  it('keeps the accumulator authors when a folded hit carries none', () => {
    const hits = [
      dblp('conf/a/X', 'Paper.', 2026, false, undefined, 'ACL'),
      compact({ source: 'arxiv', title: 'Paper.', rawTitle: 'Paper.', authors: [], year: 2025, preprint: true, arxivId: '1' }) as RawHit,
    ]
    const [record] = mergeHits(hits)
    expect(record!.authors).toEqual(['A. Author'])
  })

  it('retains the accumulator DOI when a formal hit carries none', () => {
    const hits = [
      compact({ source: 'dblp', title: 'Paper.', rawTitle: 'Paper.', authors: ['A'], year: 2025, preprint: true, dblpKey: 'journals/corr/abs-2510-10008', doi: '10.48550/arxiv.2510.10008' }) as RawHit,
      dblp('conf/a/X', 'Paper.', 2026, false, undefined, 'ACL'),
    ]
    const [record] = mergeHits(hits)
    expect(record!.published).toBe(true)
    expect(record!.doi).toBe('10.48550/arxiv.2510.10008')
  })

  it('retains the accumulator venue and year when a formal hit carries none', () => {
    const hits = [
      dblp('conf/a/X', 'Paper.', 2026, false, undefined, 'ACL'),
      compact({ source: 'dblp', title: 'Paper.', rawTitle: 'Paper.', authors: ['A'], preprint: false, dblpKey: 'conf/b/Y' }) as RawHit,
    ]
    const [record] = mergeHits(hits)
    expect(record!.venue).toBe('ACL')
    expect(record!.year).toBe(2026)
  })

  it('keeps the raw title of the formal hit for display', () => {
    const hits = [
      dblp('conf/a/X', 'paper.', 2026, false, undefined, 'ACL'),
      compact({ source: 'arxiv', title: 'paper.', rawTitle: 'Paper', authors: ['A'], year: 2025, preprint: true, arxivId: '1' }) as RawHit,
    ]
    const [record] = mergeHits(hits)
    expect(record!.rawTitle).toBe('paper.')
  })

  it('sorts year-less records last', () => {
    const hits = [
      compact({ source: 'dblp', title: 'No Year.', rawTitle: 'No Year.', authors: ['A'], preprint: false, dblpKey: 'conf/a/NY' }) as RawHit,
      dblp('conf/b/With', 'With Year.', 2020),
      dblp('conf/c/Newer', 'Newer Year.', 2021),
    ]
    const records = mergeHits(hits)
    expect(records.map(record => record.title)).toEqual(['Newer Year.', 'With Year.', 'No Year.'])
  })
})
