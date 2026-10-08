import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArxivSource, type ArxivLimits } from '@eduwork/dsh-literature/arxiv'

const LIMITS: ArxivLimits = {
  maxUrlLength: 2048,
  maxResponseBytes: 1_000_000,
  timeoutMs: 5000,
  maxRedirects: 3,
  userAgent: 'test',
  rateLimitMs: 0,
  rateLimitBackoffBaseMs: 1000,
  rateLimitBackoffMaxRetries: 0,
}

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2510.10008v1</id>
    <title>RIPRAG: Hack a System.</title>
    <summary>An abstract.</summary>
    <published>2025-10-08T00:00:00Z</published>
    <updated>2026-03-01T00:00:00Z</updated>
    <author><name>Meng Xi</name></author>
    <author><name>Sihan Lv</name></author>
    <arxiv:doi>10.18653/V1/2026.FINDINGS-ACL.833</arxiv:doi>
    <arxiv:journal_ref>ACL 2026</arxiv:journal_ref>
  </entry>
</feed>`

/** Sparse entries: missing fields, a non-arxiv id, a single author, an invalid DOI. */
const ATOM_SPARSE = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2510.10008v1</id>
    <title>RIPRAG.</title>
  </entry>
  <entry>
    <id>https://example.com/not-arxiv</id>
    <title>Bare.</title>
    <author><name>A</name></author>
    <author><name> </name></author>
  </entry>
  <entry></entry>
  <entry>
    <id>http://arxiv.org/abs/2510.20001v1</id>
    <title>Single.</title>
    <author><name>Solo</name></author>
    <arxiv:doi>not-a-doi</arxiv:doi>
  </entry>
</feed>`

function source(): ArxivSource {
  return new ArxivSource('https://export.arxiv.org', 'https://arxiv.org', LIMITS, async () => {})
}

function stubFetch(body: string, status = 200): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status, headers: { 'content-type': 'application/atom+xml' } })))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('ArxivSource', () => {
  it('is always available', () => {
    expect(source().available()).toBe(true)
  })
})

describe('ArxivSource.search', () => {
  it('maps Atom entries to normalized preprint hits', async () => {
    stubFetch(ATOM)
    const hits = await source().search({ query: 'riprag' })
    expect(hits.length).toBe(1)
    expect(hits[0]!.arxivId).toBe('2510.10008')
    expect(hits[0]!.preprint).toBe(true)
    expect(hits[0]!.venue).toBe('ACL 2026')
    expect(hits[0]!.year).toBe(2025)
    expect(hits[0]!.authors).toEqual(['Meng Xi', 'Sihan Lv'])
  })
  it('throws LITERATURE_FETCH_FAILED on a non-200 response', async () => {
    stubFetch('nope', 404)
    await expect(source().search({ query: 'x' })).rejects.toMatchObject({ code: 'LITERATURE_FETCH_FAILED' })
  })
  it('uses the first-submission year when the entry was revised later', async () => {
    // ATOM carries published 2025 and updated 2026; the record year is 2025.
    stubFetch(ATOM)
    const hits = await source().search({ query: 'riprag' })
    expect(hits[0]!.year).toBe(2025)
  })
  it('quotes the query for a phrase search', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      return new Response('<feed xmlns="http://www.w3.org/2005/Atom"></feed>', { status: 200 })
    }))
    await source().search({ query: 'attention is all you need', phrase: true })
    expect(calls[0]).toContain(encodeURIComponent('all:"attention is all you need"'))
    await source().search({ query: 'attention is all you need' })
    expect(calls[1]).toContain(encodeURIComponent('all:attention is all you need'))
  })
  it('maps multiple entries and tolerates missing fields', async () => {
    stubFetch(ATOM_SPARSE)
    const hits = await source().search({ query: 'x' })
    expect(hits).toHaveLength(4)
    expect(hits[0]!.arxivId).toBe('2510.10008')
    expect(hits[0]!.authors).toEqual([])
    expect(hits[1]!.arxivId).toBeUndefined()
    expect(hits[1]!.authors).toEqual(['A'])
  })
})

describe('ArxivSource.lookup', () => {
  it('returns the single entry for an id', async () => {
    stubFetch(ATOM)
    const hit = await source().lookup({ kind: 'arxiv', arxivId: '2510.10008' })
    expect(hit?.arxivId).toBe('2510.10008')
  })
  it('returns null on a non-200 response', async () => {
    stubFetch('nope', 404)
    expect(await source().lookup({ kind: 'arxiv', arxivId: '1' })).toBeNull()
  })
  it('returns null for a 200 response with no entries', async () => {
    stubFetch('<feed xmlns="http://www.w3.org/2005/Atom"></feed>')
    expect(await source().lookup({ kind: 'arxiv', arxivId: '1' })).toBeNull()
  })
  it('returns null for a non-arxiv reference', async () => {
    expect(await source().lookup({ kind: 'dblp', dblpKey: 'conf/a/X' })).toBeNull()
  })
})

describe('ArxivSource.bibtex', () => {
  it('fetches bibtex with an arxiv provenance note', async () => {
    stubFetch('@misc{key}')
    const result = await source().bibtex({ kind: 'arxiv', arxivId: '2510.10008' })
    expect(result?.source).toBe('arxiv')
    expect(result?.published).toBe(false)
    expect(result?.note).toContain('arXiv BibTeX')
  })
  it('returns null on a non-200 response', async () => {
    stubFetch('nope', 404)
    expect(await source().bibtex({ kind: 'arxiv', arxivId: '1' })).toBeNull()
  })
  it('returns null for an empty body', async () => {
    stubFetch('   ')
    expect(await source().bibtex({ kind: 'arxiv', arxivId: '1' })).toBeNull()
  })
  it('returns null for a non-arxiv reference', async () => {
    expect(await source().bibtex({ kind: 'dblp', dblpKey: 'conf/a/X' })).toBeNull()
  })
})

describe('ArxivSource.downloadFulltext', () => {
  it('routes the artifact kind to the right path', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      return new Response('bytes', { status: 200 })
    }))
    const s = source()
    expect(await s.downloadFulltext('2510.10008', 'source')).toBeInstanceOf(Uint8Array)
    await s.downloadFulltext('2510.10008', 'html')
    await s.downloadFulltext('2510.10008', 'pdf')
    expect(calls).toEqual([
      'https://arxiv.org/e-print/2510.10008',
      'https://arxiv.org/html/2510.10008',
      'https://arxiv.org/pdf/2510.10008',
    ])
  })
  it('returns null on a 404', async () => {
    stubFetch('missing', 404)
    expect(await source().downloadFulltext('2510.10008', 'source')).toBeNull()
  })
  it('returns null for a PDF-only e-print when asking for the source artifact', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('%PDF-1.7', {
      status: 200,
      headers: { 'content-type': 'application/pdf' },
    })))
    expect(await source().downloadFulltext('2505.09633', 'source')).toBeNull()
  })
})

describe('ArxivSource rate-limit backoff', () => {
  function backedOff(overrides: Partial<ArxivLimits> = {}): ArxivSource {
    return new ArxivSource('https://export.arxiv.org', 'https://arxiv.org', { ...LIMITS, rateLimitBackoffBaseMs: 1000, rateLimitBackoffMaxRetries: 8, ...overrides }, async () => {})
  }

  it('retries a 429 with a base-delay wait and succeeds', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('nope', { status: 429 }))
      .mockResolvedValue(new Response(ATOM, { status: 200, headers: { 'content-type': 'application/atom+xml' } }))
    vi.stubGlobal('fetch', fetchMock)
    const promise = backedOff().search({ query: 'riprag' })
    await vi.advanceTimersByTimeAsync(999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    const hits = await promise
    expect(hits).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries a 503 as transient', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('nope', { status: 503 }))
      .mockResolvedValue(new Response(ATOM, { status: 200, headers: { 'content-type': 'application/atom+xml' } }))
    vi.stubGlobal('fetch', fetchMock)
    const promise = backedOff().search({ query: 'riprag' })
    await vi.advanceTimersByTimeAsync(1000)
    const hits = await promise
    expect(hits).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws LITERATURE_RATE_LIMITED when the retry budget is exhausted', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () => new Response('nope', { status: 429 }))
    vi.stubGlobal('fetch', fetchMock)
    const promise = backedOff({ rateLimitBackoffMaxRetries: 2 }).search({ query: 'x' })
    // Pre-attach a handler so the rejection is not "unhandled" between the
    // fake-timer advances; `rejects` below still observes it.
    promise.catch(() => {})
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000)
    await expect(promise).rejects.toMatchObject({ code: 'LITERATURE_RATE_LIMITED' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('propagates cancellation during a backoff wait', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 429 })))
    const controller = new AbortController()
    const promise = backedOff().search({ query: 'x' }, controller.signal)
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await expect(promise).rejects.toMatchObject({ code: 'LITERATURE_FETCH_FAILED' })
  })
})

describe('ArxivSource path encoding', () => {
  it('preserves the category slash in an old-style id bibtex URL', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      return new Response('@misc{x}', { status: 200 })
    }))
    await source().bibtex({ kind: 'arxiv', arxivId: 'cs.CL/0506123' })
    expect(calls[0]).toContain('https://arxiv.org/bibtex/cs.CL/0506123')
  })
})
