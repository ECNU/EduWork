import { afterEach, describe, expect, it, vi } from 'vitest'
import { DblpSource, type DblpLimits } from '@eduwork/dsh-literature/dblp'

const LIMITS: DblpLimits = {
  maxUrlLength: 2048,
  maxResponseBytes: 1_000_000,
  timeoutMs: 5000,
  maxRedirects: 3,
  userAgent: 'test',
  rateLimitMs: 0,
}

const SEARCH_JSON = JSON.stringify({
  result: {
    hits: {
      hit: [{
        info: {
          key: 'journals/corr/abs-2510-10008',
          title: 'RIPRAG: Hack a System.',
          venue: 'CoRR',
          year: '2025',
          type: 'Informal and Other Publications',
          access: 'open',
          doi: '10.48550/ARXIV.2510.10008',
          ee: 'https://doi.org/10.48550/arXiv.2510.10008',
          url: 'https://dblp.org/rec/journals/corr/abs-2510-10008',
          authors: { author: [{ text: 'Meng Xi 0002' }, { text: 'Sihan Lv' }] },
        },
      }],
    },
  },
})

/** Sparse shapes: a single-hit object, a hit with no info, missing/odd fields. */
const SEARCH_SPARSE = JSON.stringify({
  result: {
    hits: {
      hit: [
        {
          info: {
            key: 'conf/a/X',
            title: 'Paper',
            type: 'Conference and Workshop Papers',
            ee: ['https://doi.org/10.18653/V1/2026.X'],
            authors: { author: { text: 'Solo' } },
          },
        },
        {},
        { info: { key: 'conf/b/Y', title: 'No Year.', year: '', access: 'closed', authors: { author: { text: 42 } } } },
      ],
    },
  },
})

/** A single non-array hit with missing key/title/authors and a non-DOI ee. */
const SEARCH_SINGLE = JSON.stringify({
  result: {
    hits: {
      hit: { info: { type: 'Informal and Other Publications', ee: 'https://example.com/x' } },
    },
  },
})

const REC_XML = '<dblp><article key="conf/acl/X" mdate="2026"><author>A. Author</author><title>Paper.</title><year>2026</year><journal>ACL</journal><ee type="oa">https://doi.org/10.18653/V1/2026.X</ee></article></dblp>'

const REC_XML_BOOKTITLE = '<dblp><inproceedings key="conf/acl/X" mdate="2026"><author>A. Author</author><title>Paper.</title><year>2026</year><booktitle>ACL 2026</booktitle><ee type="oa">https://doi.org/10.18653/V1/2026.X</ee></inproceedings></dblp>'

const REC_XML_SPARSE = '<dblp><article key="journals/corr/abs-1" publtype="informal"><author>B</author><title>No Venue</title><ee>https://example.com/x</ee></article></dblp>'

const REC_XML_EMPTY = '<dblp><article key="conf/a/X"><author>C</author></article></dblp>'

function source(): DblpSource {
  return new DblpSource('https://dblp.org', LIMITS, async () => {})
}

function stubFetch(body: string, status = 200): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status, headers: { 'content-type': 'text/plain' } })))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DblpSource', () => {
  it('is always available', () => {
    expect(source().available()).toBe(true)
  })
})

describe('DblpSource.search', () => {
  it('maps search hits to normalized records with the CoRR arXiv bridge', async () => {
    stubFetch(SEARCH_JSON)
    const hits = await source().search({ query: 'riprag' })
    expect(hits.length).toBe(1)
    expect(hits[0]!.arxivId).toBe('2510.10008')
    expect(hits[0]!.preprint).toBe(true)
    expect(hits[0]!.doi).toBe('10.48550/arxiv.2510.10008')
    expect(hits[0]!.authors).toEqual(['Meng Xi 0002', 'Sihan Lv'])
    expect(hits[0]!.openAccessUrl).toBe('https://doi.org/10.48550/arXiv.2510.10008')
  })
  it('throws LITERATURE_FETCH_FAILED on a non-200 response', async () => {
    stubFetch('not found', 404)
    await expect(source().search({ query: 'x' })).rejects.toMatchObject({ code: 'LITERATURE_FETCH_FAILED' })
  })
  it('throws LITERATURE_RATE_LIMITED on a throttled response', async () => {
    stubFetch('slow down', 429)
    await expect(source().search({ query: 'x' })).rejects.toMatchObject({ code: 'LITERATURE_RATE_LIMITED' })
  })
  it('throws LITERATURE_FETCH_FAILED on a malformed search response', async () => {
    stubFetch('not json', 200)
    await expect(source().search({ query: 'x' })).rejects.toMatchObject({ code: 'LITERATURE_FETCH_FAILED' })
  })
  it('returns no hits for an empty result', async () => {
    stubFetch(JSON.stringify({ result: { hits: {} } }))
    expect(await source().search({ query: 'x' })).toEqual([])
  })
  it('tolerates sparse hit shapes', async () => {
    stubFetch(SEARCH_SPARSE)
    const hits = await source().search({ query: 'x' })
    expect(hits).toHaveLength(2)
    expect(hits[0]!.doi).toBe('10.18653/v1/2026.x')
    expect(hits[0]!.authors).toEqual(['Solo'])
    expect(hits[1]!.authors).toEqual([])
  })
  it('maps a single non-array hit with missing identity fields', async () => {
    stubFetch(SEARCH_SINGLE)
    const hits = await source().search({ query: 'x' })
    expect(hits).toHaveLength(1)
    expect(hits[0]!.title).toBe('')
    expect(hits[0]!.dblpKey).toBeUndefined()
    expect(hits[0]!.doi).toBeUndefined()
    expect(hits[0]!.authors).toEqual([])
  })
  it('decodes HTML entities in search hit titles', async () => {
    stubFetch(JSON.stringify({ result: { hits: { hit: [{ info: { key: 'conf/a/X', title: 'AT&amp;T &amp; Co.' } }] } } }))
    const hits = await source().search({ query: 'x' })
    expect(hits[0]!.rawTitle).toBe('AT&T & Co.')
    expect(hits[0]!.title).toBe('at&t & co')
  })
})

describe('DblpSource.lookup', () => {
  it('parses a record XML for a dblp key', async () => {
    stubFetch(REC_XML)
    const hit = await source().lookup({ kind: 'dblp', dblpKey: 'conf/acl/X' })
    expect(hit).not.toBeNull()
    expect(hit!.preprint).toBe(false)
    expect(hit!.venue).toBe('ACL')
    expect(hit!.doi).toBe('10.18653/v1/2026.x')
  })
  it('parses an inproceedings record XML with a booktitle venue', async () => {
    stubFetch(REC_XML_BOOKTITLE)
    const hit = await source().lookup({ kind: 'dblp', dblpKey: 'conf/acl/X' })
    expect(hit!.venue).toBe('ACL 2026')
    expect(hit!.preprint).toBe(false)
  })
  it('decodes HTML entities in a record title', async () => {
    stubFetch('<dblp><article key="conf/a/X"><author>A</author><title>RIPRAG &amp; Friends.</title></article></dblp>')
    const hit = await source().lookup({ kind: 'dblp', dblpKey: 'conf/a/X' })
    expect(hit!.rawTitle).toBe('RIPRAG & Friends')
    expect(hit!.title).toBe('riprag & friends')
  })
  it('parses a sparse record XML', async () => {
    stubFetch(REC_XML_SPARSE)
    const hit = await source().lookup({ kind: 'dblp', dblpKey: 'journals/corr/abs-1' })
    expect(hit!.preprint).toBe(true)
    expect(hit!.title).toBe('no venue')
  })
  it('parses a record XML missing the title and ee', async () => {
    stubFetch(REC_XML_EMPTY)
    const hit = await source().lookup({ kind: 'dblp', dblpKey: 'conf/a/X' })
    expect(hit!.title).toBe('')
    expect(hit!.doi).toBeUndefined()
    expect(hit!.preprint).toBe(false)
  })
  it('returns null for a non-dblp reference', async () => {
    expect(await source().lookup({ kind: 'arxiv', arxivId: '1' })).toBeNull()
  })
  it('returns null on a non-200 response', async () => {
    stubFetch('nope', 404)
    expect(await source().lookup({ kind: 'dblp', dblpKey: 'conf/a/X' })).toBeNull()
  })
})

describe('DblpSource.bibtex', () => {
  it('fetches a formal bibtex and labels its source', async () => {
    stubFetch('@inproceedings{acl, title={Paper}}')
    const result = await source().bibtex({ kind: 'dblp', dblpKey: 'conf/acl/X' })
    expect(result?.source).toBe('dblp-formal')
    expect(result?.published).toBe(true)
  })
  it('labels a CoRR bibtex as dblp-corr', async () => {
    stubFetch('@article{corr}')
    const result = await source().bibtex({ kind: 'dblp', dblpKey: 'journals/corr/abs-2510-10008' })
    expect(result?.source).toBe('dblp-corr')
    expect(result?.published).toBe(false)
  })
  it('returns null on a non-200 response', async () => {
    stubFetch('nope', 404)
    expect(await source().bibtex({ kind: 'dblp', dblpKey: 'conf/a/X' })).toBeNull()
  })
  it('returns null for an empty body', async () => {
    stubFetch('  ')
    expect(await source().bibtex({ kind: 'dblp', dblpKey: 'conf/a/X' })).toBeNull()
  })
  it('returns null for a non-dblp reference', async () => {
    expect(await source().bibtex({ kind: 'arxiv', arxivId: '1' })).toBeNull()
  })
})

describe('DblpSource path encoding', () => {
  it('preserves slash separators in the bibtex URL', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      return new Response('@inproceedings{x}', { status: 200 })
    }))
    const result = await source().bibtex({ kind: 'dblp', dblpKey: 'conf/asru/LinLLWALL25' })
    expect(result?.source).toBe('dblp-formal')
    expect(calls[0]).toContain('https://dblp.org/rec/conf/asru/LinLLWALL25.bib?param=1')
  })

  it('preserves slash separators in the lookup URL', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      return new Response('<article><title>X.</title></article>', { status: 200 })
    }))
    await source().lookup({ kind: 'dblp', dblpKey: 'conf/asru/LinLLWALL25' })
    expect(calls[0]).toContain('https://dblp.org/rec/conf/asru/LinLLWALL25.xml')
  })
})
