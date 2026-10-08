import { describe, expect, it } from 'vitest'
import {
  arxivIdToCorrKey,
  corrKeyToArxivId,
  encodePathSegments,
  isDblpKey,
  isHttpUrl,
  normalizeTitle,
  parseArxivId,
  parseDoi,
  stableRecordId,
} from '@eduwork/dsh-literature/core'

describe('normalizeTitle', () => {
  it('lowercases, collapses whitespace, and drops punctuation', () => {
    expect(normalizeTitle('  Attention   IS   All You Need.  ')).toBe('attention is all you need')
  })
  it('strips LaTeX braces and punctuation', () => {
    expect(normalizeTitle('{RIPRAG}: Hack a System!')).toBe('riprag hack a system')
  })
  it('keeps sign characters so C++, C#, and C stay distinct', () => {
    expect(normalizeTitle('C++')).toBe('c++')
    expect(normalizeTitle('C#')).toBe('c#')
    expect(normalizeTitle('C')).toBe('c')
    expect(normalizeTitle('AT&T')).toBe('at&t')
  })
})

describe('parseArxivId', () => {
  it('parses new-style ids with and without version', () => {
    expect(parseArxivId('2510.10008')).toBe('2510.10008')
    expect(parseArxivId('2510.10008v2')).toBe('2510.10008')
    expect(parseArxivId('arXiv:1706.03762')).toBe('1706.03762')
  })
  it('parses old-style ids', () => {
    expect(parseArxivId('cs.CL/0506123')).toBe('cs.CL/0506123')
  })
  it('returns null for non-ids', () => {
    expect(parseArxivId('attention is all you need')).toBeNull()
    expect(parseArxivId('10.1109/DAC.2021')).toBeNull()
  })
})

describe('dblp key and CoRR bridge', () => {
  it('recognizes dblp keys by prefix', () => {
    expect(isDblpKey('conf/acl/XiLJCWLY26')).toBe(true)
    expect(isDblpKey('journals/corr/abs-2510-10008')).toBe(true)
    expect(isDblpKey('attention is all you need')).toBe(false)
  })
  it('derives the arXiv id from a CoRR key', () => {
    expect(corrKeyToArxivId('journals/corr/abs-2510-10008')).toBe('2510.10008')
    expect(corrKeyToArxivId('conf/acl/XiLJCWLY26')).toBeNull()
  })
  it('derives the CoRR key from a new-style arXiv id', () => {
    expect(arxivIdToCorrKey('2510.10008')).toBe('journals/corr/abs-2510-10008')
    expect(arxivIdToCorrKey('cs.CL/170603762')).toBeNull()
  })
})

describe('parseDoi', () => {
  it('parses bare and prefixed DOIs, lowercasing them', () => {
    expect(parseDoi('10.18653/V1/2026.FINDINGS-ACL.833')).toBe('10.18653/v1/2026.findings-acl.833')
    expect(parseDoi('https://doi.org/10.48550/arXiv.2510.10008')).toBe('10.48550/arxiv.2510.10008')
    expect(parseDoi('attention is all you need')).toBeNull()
  })
})

describe('isHttpUrl', () => {
  it('recognizes http(s) URLs only', () => {
    expect(isHttpUrl('https://arxiv.org/pdf/2510.10008')).toBe(true)
    expect(isHttpUrl('ftp://arxiv.org')).toBe(false)
  })
})

describe('stableRecordId', () => {
  it('prefers the arXiv id, then dblp key, then DOI, then title', () => {
    expect(stableRecordId({ arxivId: '2510.10008', dblpKey: 'conf/acl/X', doi: '10.1/x', title: 'T' })).toBe('arxiv:2510.10008')
    expect(stableRecordId({ arxivId: undefined, dblpKey: 'conf/acl/X', doi: '10.1/x', title: 'T' })).toBe('dblp:conf/acl/X')
    expect(stableRecordId({ arxivId: undefined, dblpKey: undefined, doi: '10.1/x', title: 'T' })).toBe('doi:10.1/x')
    expect(stableRecordId({ arxivId: undefined, dblpKey: undefined, doi: undefined, title: 'Hello, World!' })).toBe('title:hello world')
  })
})

describe('encodePathSegments', () => {
  it('preserves slash separators and encodes other characters', () => {
    expect(encodePathSegments('conf/asru/LinLLWALL25')).toBe('conf/asru/LinLLWALL25')
    expect(encodePathSegments('journals/corr/abs-2407-15516')).toBe('journals/corr/abs-2407-15516')
    expect(encodePathSegments('a b/c')).toBe('a%20b/c')
  })
})
