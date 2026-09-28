import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  LiteratureError,
  LiteratureRuntime,
  compact,
  type FulltextResult,
  type LiteratureSource,
  type RawHit,
} from '@eduwork/dsh-literature/core'

const TARBALL_B64 = 'H4sIAAAAAAAAA+2TTUvEMBBAc+6vmLvSnfQjPQl60/see2nT0S2bJpJksVL636VgIbCKwlIUzbvMkMBkMsNzVu7YxiBiVZXAEHlVYhhXgPEyy6tCFJhzhjwTPAdWbt3Ywsn5xjJE5Q4X1Vk/ssZfQDjTMA9xVu6Gptepp3GrPhBRiOLT/XNxtv8iKwUw3KqhkH++/7oz8jSQ9lI1zk2N9b1UNCd1S0+9ntbbOQEc8fkKQZphOUjuSSkDL8aqLoXakfS90dOD9tbMsKfRw4EspUlNugvK/NgwIh+y+G/p0aVt3271xhf+Y16d+59j9P9SvuP/7bvx05Fer8H3XtHNdAf7JZmjrpFIJPJneQMsZmBUAA4AAA=='

function dblpHit(key: string, title: string, year = 2026, preprint = false, doi?: string): RawHit {
  return compact({
    source: 'dblp',
    title,
    rawTitle: title,
    authors: ['A. Author'],
    year,
    preprint,
    dblpKey: key,
    doi,
    url: `https://dblp.org/rec/${key}`,
  })
}

function arxivHit(id: string, title: string): RawHit {
  return { source: 'arxiv', title, rawTitle: title, authors: ['A. Author'], year: 2025, preprint: true, arxivId: id }
}

interface SourceOpts {
  readonly search?: (request: { query: string; maxResults?: number }) => Promise<readonly RawHit[]>
  readonly lookup?: (ref: Parameters<LiteratureSource['lookup']>[0]) => Promise<RawHit | null>
  readonly bibtex?: (ref: Parameters<LiteratureSource['bibtex']>[0]) => Promise<{ bibtex: string; source: 'dblp-formal' | 'dblp-corr' | 'arxiv'; published: boolean } | null>
  readonly downloadFulltext?: (arxivId: string, kind: string) => Promise<Uint8Array | null>
  readonly available?: () => boolean
}

function source(id: 'dblp' | 'arxiv', opts: SourceOpts = {}): LiteratureSource {
  return {
    id,
    available: opts.available ?? (() => true),
    search: opts.search ?? (async () => []),
    lookup: opts.lookup ?? (async () => null),
    bibtex: opts.bibtex ?? (async () => null),
    ...(opts.downloadFulltext !== undefined ? { downloadFulltext: opts.downloadFulltext } : {}),
  }
}

function tarball(): Uint8Array {
  return new Uint8Array(Buffer.from(TARBALL_B64, 'base64'))
}

const PDF_B64 = 'JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgNjEyIDc5Ml0vQ29udGVudHMgNCAwIFIvUmVzb3VyY2VzPDwvRm9udDw8L0YxIDUgMCBSPj4+Pj4+ZW5kb2JqCjQgMCBvYmo8PC9MZW5ndGggNDQ+PnN0cmVhbQpCVCAvRjEgMjQgVGYgMTAwIDcwMCBUZCAoSGVsbG8gUERGKSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmo8PC9UeXBlL0ZvbnQvU3VidHlwZS9UeXBlMS9CYXNlRm9udC9IZWx2ZXRpY2E+PmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNTQgMDAwMDAgbiAKMDAwMDAwMDM0NiAwMDAwMCBuIAp0cmFpbGVyPDwvU2l6ZSA2L1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKNDA2CiUlRU9GCg=='

function pdfBytes(): Uint8Array {
  return new Uint8Array(Buffer.from(PDF_B64, 'base64'))
}

let ctx: Context | undefined

afterEach(async () => {
  vi.unstubAllGlobals()
  await ctx?.fiber.dispose()
  ctx = undefined
})

function mount(config: ConstructorParameters<typeof LiteratureRuntime>[1] = {}): LiteratureRuntime {
  ctx = new Context()
  return new LiteratureRuntime(ctx, config)
}

describe('LiteratureRuntime registration', () => {
  it('rejects duplicate source ids and disposes on unregister', () => {
    const runtime = mount()
    runtime.registerSource(source('dblp'))
    expect(() => runtime.registerSource(source('dblp'))).toThrow(LiteratureError)
  })

  it('throws when no usable source is selected', async () => {
    const runtime = mount()
    await expect(runtime.search({ query: 'x' })).rejects.toThrow(LiteratureError)
  })

  it('honours the enabledSources config', async () => {
    const runtime = mount({ enabledSources: ['arxiv'] })
    runtime.registerSource(source('arxiv', { search: async () => [arxivHit('1', 'Paper')] }))
    runtime.registerSource(source('dblp'))
    const result = await runtime.search({ query: 'x' })
    expect(result.records.map(record => record.arxivId)).toEqual(['1'])
  })

  it('does not materialize an omitted enabledSources into an empty array', () => {
    // The Loader validates plugin config through the static Config schema;
    // Schemastery turns an omitted `z.array` field into `[]`, which would mean
    // "no sources enabled" instead of "every registered source runs".
    const validated = LiteratureRuntime.Config['~standard'].validate({}) as { value?: { enabledSources?: unknown } }
    expect('enabledSources' in (validated.value ?? {})).toBe(false)
  })
})

describe('LiteratureRuntime.search', () => {
  it('merges hits from both sources and truncates', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp', { search: async () => [dblpHit('conf/a/X', 'Paper A.'), dblpHit('conf/b/Y', 'Paper B.')] }))
    runtime.registerSource(source('arxiv', { search: async () => [arxivHit('1', 'Paper A.')] }))
    const result = await runtime.search({ query: 'paper', maxResults: 1 })
    expect(result.total).toBe(2)
    expect(result.truncated).toBe(true)
    expect(result.records.length).toBe(1)
    expect(result.records[0]!.sources).toEqual(['dblp', 'arxiv'])
  })

  it('still answers when one source is rate-limited', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp', {
      search: async () => { throw new LiteratureError('throttled', 'LITERATURE_RATE_LIMITED') },
    }))
    runtime.registerSource(source('arxiv', { search: async () => [arxivHit('1', 'Paper')] }))
    const result = await runtime.search({ query: 'x' })
    expect(result.records.length).toBe(1)
  })

  it('rethrows the first rejection when every source fails', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp', {
      search: async () => { throw new LiteratureError('boom', 'LITERATURE_FETCH_FAILED') },
    }))
    await expect(runtime.search({ query: 'x' })).rejects.toMatchObject({ code: 'LITERATURE_FETCH_FAILED' })
  })
})

describe('LiteratureRuntime.resolveRecord', () => {
  it('resolves an arXiv id through the CoRR bridge and a title search', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp', {
      lookup: async ref => ref.kind === 'dblp' && ref.dblpKey === 'journals/corr/abs-2510-10008'
        ? dblpHit('journals/corr/abs-2510-10008', 'RIPRAG.', 2025, true)
        : null,
      search: async () => [dblpHit('conf/acl/X', 'RIPRAG.', 2026)],
    }))
    runtime.registerSource(source('arxiv', {
      lookup: async () => arxivHit('2510.10008', 'RIPRAG.'),
    }))
    const record = await runtime.resolveRecord('2510.10008')
    expect(record.published).toBe(true)
    expect(record.dblpKey).toBe('conf/acl/X')
    expect(record.arxivId).toBe('2510.10008')
  })

  it('resolves a title by searching both sources', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp', { search: async () => [dblpHit('conf/a/X', 'Paper.')] }))
    runtime.registerSource(source('arxiv', { search: async () => [arxivHit('1', 'Paper.')] }))
    const record = await runtime.resolveRecord('Paper')
    expect(record.title).toBe('Paper.')
  })

  it('throws LITERATURE_NO_RESULT when nothing matches', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp'))
    runtime.registerSource(source('arxiv'))
    await expect(runtime.resolveRecord('nothing')).rejects.toMatchObject({ code: 'LITERATURE_NO_RESULT' })
  })

  it('rejects an empty reference', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp'))
    await expect(runtime.resolveRecord('  ')).rejects.toMatchObject({ code: 'LITERATURE_INVALID_REF' })
  })
})

describe('LiteratureRuntime.bibtex', () => {
  it('prefers the arXiv bibtex over the dblp CoRR mirror for an unpublished preprint', async () => {
    const runtime = mount()
    const dblpBib = { bibtex: '@article{corr}', source: 'dblp-corr' as const, published: false }
    runtime.registerSource(source('dblp', {
      bibtex: async ref => ref.kind === 'dblp' && ref.dblpKey === 'journals/corr/abs-2510-10008' ? dblpBib : null,
    }))
    runtime.registerSource(source('arxiv', { bibtex: async () => ({ bibtex: '@misc{arxiv}', source: 'arxiv', published: false }) }))
    const result = await runtime.bibtex('2510.10008')
    expect(result.source).toBe('arxiv')
    expect(result.bibtex).toBe('@misc{arxiv}')
  })

  it('uses the formal dblp bibtex for a published paper queried by arXiv id', async () => {
    const runtime = mount()
    const corrHit = dblpHit('journals/corr/abs-1512-03385', 'Deep residual learning for image recognition.', 2015, true)
    runtime.registerSource(source('dblp', {
      lookup: async ref => ref.kind === 'dblp' && ref.dblpKey === 'journals/corr/abs-1512-03385' ? corrHit : null,
      search: async () => [dblpHit('conf/cvpr/HeZRS16', 'Deep Residual Learning for Image Recognition.', 2016)],
      bibtex: async ref => ref.kind === 'dblp' && ref.dblpKey === 'conf/cvpr/HeZRS16'
        ? { bibtex: '@inproceedings{cvpr}', source: 'dblp-formal', published: true }
        : null,
    }))
    runtime.registerSource(source('arxiv', { bibtex: async () => ({ bibtex: '@misc{arxiv}', source: 'arxiv', published: false }) }))
    const result = await runtime.bibtex('1512.03385')
    expect(result.source).toBe('dblp-formal')
    expect(result.bibtex).toBe('@inproceedings{cvpr}')
  })

  it('falls back to the dblp CoRR mirror when the arXiv bibtex is unavailable', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp', {
      bibtex: async ref => ref.kind === 'dblp' && ref.dblpKey === 'journals/corr/abs-2510-10008'
        ? { bibtex: '@article{corr}', source: 'dblp-corr', published: false }
        : null,
    }))
    runtime.registerSource(source('arxiv', { bibtex: async () => null }))
    const result = await runtime.bibtex('2510.10008')
    expect(result.source).toBe('dblp-corr')
  })

  it('falls back to arXiv when dblp has no CoRR record', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp'))
    runtime.registerSource(source('arxiv', { bibtex: async () => ({ bibtex: '@misc{arxiv}', source: 'arxiv', published: false }) }))
    const result = await runtime.bibtex('2510.10008')
    expect(result.source).toBe('arxiv')
  })

  it('resolves a title and uses the formal dblp bibtex', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp', {
      search: async () => [dblpHit('conf/acl/X', 'RIPRAG.', 2026)],
      bibtex: async () => ({ bibtex: '@inproceedings{acl}', source: 'dblp-formal', published: true }),
    }))
    runtime.registerSource(source('arxiv'))
    const result = await runtime.bibtex('RIPRAG')
    expect(result.source).toBe('dblp-formal')
  })

  it('throws LITERATURE_NO_RESULT when no BibTeX exists', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp'))
    runtime.registerSource(source('arxiv'))
    await expect(runtime.bibtex('nothing')).rejects.toMatchObject({ code: 'LITERATURE_NO_RESULT' })
  })
})

describe('LiteratureRuntime.fulltext', () => {
  it('extracts the arXiv source tarball', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp'))
    runtime.registerSource(source('arxiv', {
      lookup: async () => arxivHit('2510.10008', 'Paper.'),
      downloadFulltext: async (_id, kind) => kind === 'source' ? tarball() : null,
    }))
    const result = await runtime.fulltext('2510.10008')
    expect(result.kind).toBe('fulltext')
    expect(result.source).toBe('arxiv-source')
    expect(result.files.length).toBeGreaterThan(0)
  })

  it('falls back to the HTML artifact when the source response is not gzip', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp'))
    runtime.registerSource(source('arxiv', {
      lookup: async () => arxivHit('2510.10008', 'Paper.'),
      downloadFulltext: async (_id, kind) => kind === 'source'
        ? new TextEncoder().encode('a PDF-only submission serves its PDF here')
        : kind === 'html' ? new TextEncoder().encode('<h1>Paper</h1>') : null,
    }))
    const result = await runtime.fulltext('2510.10008')
    expect(result.source).toBe('arxiv-html')
  })

  it('falls back to the PDF artifact when source extraction fails and HTML is absent', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp'))
    runtime.registerSource(source('arxiv', {
      lookup: async () => arxivHit('2510.10008', 'Paper.'),
      downloadFulltext: async (_id, kind) => kind === 'source'
        ? new TextEncoder().encode('not gzip')
        : kind === 'html' ? null : pdfBytes(),
    }))
    const result = await runtime.fulltext('2510.10008')
    expect(result.source).toBe('arxiv-pdf')
  })

  it('falls back when the source extraction error comes from a duplicated core copy', async () => {
    const proto = LiteratureRuntime.prototype as unknown as {
      extractArtifact: (kind: string, bytes: Uint8Array, id: string) => Promise<FulltextResult>
    }
    const original = proto.extractArtifact
    const spy = vi.spyOn(proto, 'extractArtifact').mockImplementation(async function (this: unknown, kind, bytes, id) {
      if (kind === 'source') {
        throw Object.assign(new Error('the downloaded source is not a valid gzip archive'), { name: 'LiteratureError', code: 'LITERATURE_EXTRACTION_FAILED' })
      }
      return original.call(this, kind, bytes, id)
    })
    try {
      const runtime = mount()
      runtime.registerSource(source('dblp'))
      runtime.registerSource(source('arxiv', {
        lookup: async () => arxivHit('2510.10008', 'Paper.'),
        downloadFulltext: async (_id, kind) => kind === 'source'
          ? new TextEncoder().encode('%PDF-')
          : kind === 'html' ? null : pdfBytes(),
      }))
      const result = await runtime.fulltext('2510.10008')
      expect(result.source).toBe('arxiv-pdf')
    } finally {
      spy.mockRestore()
    }
  })

  it('throws for a DOI-only record with no arXiv full text', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp', {
      search: async request => request.query.includes('10.18653') ? [dblpHit('conf/a/X', 'Paper.', 2026, false, '10.18653/v1/2026.x')] : [],
    }))
    await expect(runtime.fulltext('10.18653/V1/2026.X')).rejects.toMatchObject({ code: 'LITERATURE_FULLTEXT_UNAVAILABLE' })
  })

  it('throws for an explicit non-PDF URL', async () => {
    const runtime = mount()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<h1>Page</h1>', { status: 200, headers: { 'content-type': 'text/html' } })))
    await expect(runtime.fulltext('https://example.com/paper')).rejects.toMatchObject({ code: 'LITERATURE_FULLTEXT_UNAVAILABLE' })
  })

  it('extracts the arXiv HTML artifact', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp'))
    runtime.registerSource(source('arxiv', {
      lookup: async () => arxivHit('2510.10008', 'Paper.'),
      downloadFulltext: async (_id, kind) => kind === 'html' ? new TextEncoder().encode('<h1>Paper</h1>') : null,
    }))
    const result = await runtime.fulltext('2510.10008')
    expect(result.source).toBe('arxiv-html')
    expect(result.files[0]!.path).toBe('paper.md')
  })

  it('extracts the arXiv PDF artifact', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp'))
    runtime.registerSource(source('arxiv', {
      lookup: async () => arxivHit('2510.10008', 'Paper.'),
      downloadFulltext: async (_id, kind) => kind === 'pdf' ? pdfBytes() : null,
    }))
    const result = await runtime.fulltext('2510.10008')
    expect(result.source).toBe('arxiv-pdf')
    expect(result.summary).toContain('Hello PDF')
  })

  it('fetches an explicit PDF URL', async () => {
    const runtime = mount()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(pdfBytes() as BodyInit, { status: 200, headers: { 'content-type': 'application/pdf' } })))
    const result = await runtime.fulltext('https://example.com/paper.pdf')
    expect(result.source).toBe('publisher-pdf')
    expect(result.summary).toContain('Hello PDF')
  })

  it('throws when no full text is available', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp', { search: async () => [dblpHit('conf/a/X', 'Paper.', 2026)] }))
    await expect(runtime.fulltext('10.18653/v1/2026.x')).rejects.toMatchObject({ code: 'LITERATURE_FULLTEXT_UNAVAILABLE' })
  })
})

describe('LiteratureRuntime.landingPage', () => {
  it('follows the DOI resolver and returns bounded minified HTML', async () => {
    const runtime = mount()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<h1>Publisher</h1><a href="/paper.pdf">PDF</a>', { status: 200 })))
    const html = await runtime.landingPage('10.18653/v1/2026.x')
    expect(html).toContain('Publisher')
    expect(html).toContain('<a href="/paper.pdf">')
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('https://doi.org/10.18653/v1/2026.x'), expect.anything())
  })

  it('fetches a landing-page URL directly', async () => {
    const runtime = mount()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<h1>Page</h1>', { status: 200, headers: { 'content-type': 'text/html' } })))
    const html = await runtime.landingPage('https://example.com/landing')
    expect(html).toContain('Page')
  })

  it('bounds the HTML by the landingPageMaxChars config', async () => {
    const runtime = mount({ landingPageMaxChars: 5 })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<h1>Publisher</h1>', { status: 200 })))
    const html = await runtime.landingPage('10.18653/v1/2026.x')
    expect(html.length).toBeLessThanOrEqual(5)
  })

  it('keeps a PDF link that lives in an inline script', async () => {
    const runtime = mount()
    const html = '<html><head><style>.x{}</style><script>window.location = "https://example.com/paper.pdf";</script></head><body><h1>Page</h1></body></html>'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })))
    const minified = await runtime.landingPage('https://example.com/landing')
    expect(minified).toContain('https://example.com/paper.pdf')
    expect(minified).not.toContain('<style')
  })

  it('rejects a non-DOI non-URL input', async () => {
    const runtime = mount()
    await expect(runtime.landingPage('a bare title')).rejects.toMatchObject({ code: 'LITERATURE_FULLTEXT_UNAVAILABLE' })
  })

  it('rejects a non-200 landing page', async () => {
    const runtime = mount()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })))
    await expect(runtime.landingPage('https://example.com/landing')).rejects.toMatchObject({ code: 'LITERATURE_FULLTEXT_UNAVAILABLE' })
  })
})

describe('LiteratureRuntime edge references', () => {
  it('resolves a non-CoRR dblp key', async () => {
    const runtime = mount()
    const lookup = vi.fn(async (ref: { kind: string }) => ref.kind === 'dblp' ? dblpHit('conf/a/X', 'Paper.', 2026) : null)
    runtime.registerSource(source('dblp', { lookup }))
    runtime.registerSource(source('arxiv', { lookup: vi.fn(async () => null) }))
    const record = await runtime.resolveRecord('conf/a/X')
    expect(record.dblpKey).toBe('conf/a/X')
  })

  it('resolves a DOI reference through the dblp search and the arXiv title search', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp', {
      search: async request => request.query.includes('10.18653') ? [dblpHit('conf/a/X', 'Paper.', 2026)] : [],
    }))
    const arxivSearch = vi.fn(async () => [arxivHit('2510.10008', 'Paper.')])
    runtime.registerSource(source('arxiv', { search: arxivSearch }))
    const record = await runtime.resolveRecord('10.18653/V1/2026.X')
    expect(record.arxivId).toBe('2510.10008')
    expect(arxivSearch).toHaveBeenCalled()
  })

  it('rejects a URL reference in resolveRecord', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp'))
    await expect(runtime.resolveRecord('https://example.com/x')).rejects.toMatchObject({ code: 'LITERATURE_INVALID_REF' })
  })

  it('fetches bibtex for a direct dblp key', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp', {
      bibtex: async ref => ref.kind === 'dblp' ? { bibtex: '@inproceedings{x}', source: 'dblp-formal', published: true } : null,
    }))
    runtime.registerSource(source('arxiv'))
    const result = await runtime.bibtex('conf/a/X')
    expect(result.source).toBe('dblp-formal')
  })

  it('falls back to arXiv bibtex for a CoRR dblp key', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp'))
    runtime.registerSource(source('arxiv', {
      bibtex: async () => ({ bibtex: '@misc{x}', source: 'arxiv', published: false }),
    }))
    const result = await runtime.bibtex('journals/corr/abs-2510-10008')
    expect(result.source).toBe('arxiv')
  })

  it('resolves a DOI reference for bibtex through dblp', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp', {
      search: async request => request.query.includes('10.18653') ? [dblpHit('conf/a/X', 'Paper.', 2026)] : [],
      bibtex: async () => ({ bibtex: '@inproceedings{x}', source: 'dblp-formal', published: true }),
    }))
    runtime.registerSource(source('arxiv'))
    const result = await runtime.bibtex('10.18653/V1/2026.X')
    expect(result.source).toBe('dblp-formal')
  })

  it('throws when a configured source is missing', async () => {
    const runtime = mount({ enabledSources: ['arxiv', 'dblp'] })
    runtime.registerSource(source('arxiv'))
    await expect(runtime.search({ query: 'x' })).rejects.toMatchObject({ code: 'LITERATURE_PROVIDER_UNAVAILABLE' })
  })

  it('disposes a source through its disposer', async () => {
    const runtime = mount()
    const disposer = runtime.registerSource(source('dblp'))
    disposer()
    await expect(runtime.search({ query: 'x' })).rejects.toMatchObject({ code: 'LITERATURE_PROVIDER_UNAVAILABLE' })
  })

  it('skips an unavailable source', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp', { available: () => false }))
    await expect(runtime.search({ query: 'x' })).rejects.toMatchObject({ code: 'LITERATURE_PROVIDER_UNAVAILABLE' })
  })

  it('throws when an enabled source is registered but unavailable', async () => {
    const runtime = mount({ enabledSources: ['dblp'] })
    runtime.registerSource(source('dblp', { available: () => false }))
    await expect(runtime.search({ query: 'x' })).rejects.toMatchObject({ code: 'LITERATURE_PROVIDER_UNAVAILABLE' })
  })

  it('reports the all-failed error when a source rejects with a plain Error', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp', { search: async () => { throw new Error('boom') } }))
    await expect(runtime.search({ query: 'x' })).rejects.toMatchObject({ code: 'LITERATURE_PROVIDER_UNAVAILABLE' })
  })

  it('throws no-source in resolveRecord', async () => {
    const runtime = mount()
    await expect(runtime.resolveRecord('x')).rejects.toMatchObject({ code: 'LITERATURE_PROVIDER_UNAVAILABLE' })
  })

  it('resolves an arXiv id with a null arXiv lookup', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp', { lookup: async () => null }))
    runtime.registerSource(source('arxiv', { lookup: async () => null }))
    await expect(runtime.resolveRecord('2510.10008')).rejects.toMatchObject({ code: 'LITERATURE_NO_RESULT' })
  })

  it('resolves a DOI with no dblp hit', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp', { search: async () => [] }))
    runtime.registerSource(source('arxiv', { search: async () => [] }))
    await expect(runtime.resolveRecord('10.18653/v1/x')).rejects.toMatchObject({ code: 'LITERATURE_NO_RESULT' })
  })

  it('resolves a title with only one source', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp', { search: async () => [dblpHit('conf/a/X', 'Paper.', 2026)] }))
    const record = await runtime.resolveRecord('Paper')
    expect(record.dblpKey).toBe('conf/a/X')
  })

  it('throws no-result for bibtex with a dblp key and no dblp source', async () => {
    const runtime = mount()
    runtime.registerSource(source('arxiv', { bibtex: async () => null }))
    await expect(runtime.bibtex('conf/a/X')).rejects.toMatchObject({ code: 'LITERATURE_NO_RESULT' })
  })

  it('falls back to arXiv bibtex for an arXiv id without a dblp source', async () => {
    const runtime = mount()
    runtime.registerSource(source('arxiv', { bibtex: async () => ({ bibtex: '@misc{x}', source: 'arxiv', published: false }) }))
    const result = await runtime.bibtex('2510.10008')
    expect(result.source).toBe('arxiv')
  })

  it('resolves an arXiv id with an arXiv: prefix and version suffix', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp', { bibtex: async () => null }))
    runtime.registerSource(source('arxiv', {
      bibtex: async ref => ref.kind === 'arxiv' ? { bibtex: '@misc{x}', source: 'arxiv', published: false } : null,
    }))
    const result = await runtime.bibtex('arXiv:2510.10008v2')
    expect(result.source).toBe('arxiv')
  })

  it('falls back to arXiv bibtex for a title whose dblp bibtex is null', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp', {
      search: async () => [dblpHit('conf/a/X', 'Paper.', 2026)],
      bibtex: async () => null,
    }))
    runtime.registerSource(source('arxiv', {
      search: async () => [arxivHit('2510.10008', 'Paper.')],
      bibtex: async () => ({ bibtex: '@misc{x}', source: 'arxiv', published: false }),
    }))
    const result = await runtime.bibtex('Paper')
    expect(result.source).toBe('arxiv')
  })

  it('rejects a non-200 explicit URL', async () => {
    const runtime = mount()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })))
    await expect(runtime.fulltext('https://example.com/paper')).rejects.toMatchObject({ code: 'LITERATURE_FULLTEXT_UNAVAILABLE' })
  })

  it('detects a .pdf URL without a pdf content type', async () => {
    const runtime = mount()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(pdfBytes() as BodyInit, { status: 200, headers: { 'content-type': 'application/octet-stream' } })))
    const result = await runtime.fulltext('https://example.com/paper.pdf')
    expect(result.source).toBe('publisher-pdf')
  })

  it('throws for a content-type-less 200 URL that is not a PDF', async () => {
    const runtime = mount()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
    await expect(runtime.fulltext('https://example.com/landing')).rejects.toMatchObject({ code: 'LITERATURE_FULLTEXT_UNAVAILABLE' })
  })

  it('resolves an arXiv id when only dblp is enabled', async () => {
    const runtime = mount({ enabledSources: ['dblp'] })
    runtime.registerSource(source('dblp', { lookup: async () => null }))
    await expect(runtime.resolveRecord('2510.10008')).rejects.toMatchObject({ code: 'LITERATURE_NO_RESULT' })
  })

  it('resolves an old-style arXiv id whose CoRR key cannot be derived', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp', { lookup: async () => null, search: async () => [] }))
    runtime.registerSource(source('arxiv', { lookup: async () => arxivHit('cs.CL/0506123', 'Paper.') }))
    const record = await runtime.resolveRecord('cs.CL/0506123')
    expect(record.arxivId).toBe('cs.CL/0506123')
  })

  it('prefers the exact arXiv-id record over a newer fuzzy title-match hit', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp', {
      lookup: async () => null,
      search: async () => [dblpHit('journals/sivp/XuLX24', 'A different paper.', 2024, false, '10.1007/x')],
    }))
    runtime.registerSource(source('arxiv', { lookup: async () => arxivHit('1512.03385', 'Deep residual learning for image recognition.') }))
    const record = await runtime.resolveRecord('1512.03385')
    expect(record.arxivId).toBe('1512.03385')
    expect(record.id).toBe('arxiv:1512.03385')
  })

  it('prefers the exact dblp-key record over a newer fuzzy title-match hit', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp', {
      lookup: async () => dblpHit('conf/cvpr/HeZRS16', 'Deep residual learning for image recognition.', 2016),
      search: async () => [dblpHit('journals/sivp/XuLX24', 'A different paper.', 2024, false, '10.1007/x')],
    }))
    runtime.registerSource(source('arxiv', { search: async () => [] }))
    const record = await runtime.resolveRecord('conf/cvpr/HeZRS16')
    expect(record.dblpKey).toBe('conf/cvpr/HeZRS16')
  })

  it('picks the title-matching record over a newer fuzzy hit', async () => {
    // The real paper is in the fuzzy candidates but a newer same-topic paper
    // sorts first by year; the title match must win.
    const runtime = mount()
    runtime.registerSource(source('dblp', {
      search: async () => [
        dblpHit('journals/sivp/XuLX24', 'Multi-residual unit fusion and Wasserstein distance-based deep transfer learning for mill load recognition.', 2024, false, '10.1007/x'),
        dblpHit('conf/cvpr/HeZRS16', 'Deep Residual Learning for Image Recognition.', 2016),
      ],
    }))
    runtime.registerSource(source('arxiv', { search: async () => [] }))
    const record = await runtime.resolveRecord('Deep residual learning for image recognition')
    expect(record.dblpKey).toBe('conf/cvpr/HeZRS16')
  })

  it('requests the full dblp hit list and a phrase arXiv search for title resolution', async () => {
    const runtime = mount()
    const dblpSearch = vi.fn(async () => [dblpHit('conf/cvpr/HeZRS16', 'Deep Residual Learning for Image Recognition.', 2016)])
    const arxivSearch = vi.fn(async () => [])
    runtime.registerSource(source('dblp', { search: dblpSearch }))
    runtime.registerSource(source('arxiv', { search: arxivSearch }))
    await runtime.resolveRecord('Deep residual learning for image recognition')
    expect(dblpSearch).toHaveBeenCalledWith(expect.objectContaining({ maxResults: 1000 }), undefined)
    expect(arxivSearch).toHaveBeenCalledWith(expect.objectContaining({ maxResults: 30, phrase: true }), undefined)
  })

  it('picks an exact normalized title match even when another hit contains all query words', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp', {
      search: async () => [
        dblpHit('conf/nips/Vaswani17', 'Attention Is All You Need.', 2017),
        dblpHit('journals/corr/abs-2407-15516', 'Attention Is All You Need But You Don\'t Need All Of It For Inference of Large Language Models.', 2024, false, '10.1007/x'),
      ],
    }))
    runtime.registerSource(source('arxiv', { search: async () => [] }))
    const record = await runtime.resolveRecord('Attention is all you need')
    expect(record.dblpKey).toBe('conf/nips/Vaswani17')
  })

  it('ties title matches by publication year descending', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp', {
      search: async () => [
        dblpHit('journals/corr/HeZRS15', 'Deep Residual Learning for Image Recognition.', 2015, true),
        dblpHit('conf/cvpr/HeZRS16', 'Deep Residual Learning for Image Recognition.', 2016),
      ],
    }))
    runtime.registerSource(source('arxiv', { search: async () => [] }))
    const record = await runtime.resolveRecord('Deep residual learning for image recognition')
    expect(record.dblpKey).toBe('conf/cvpr/HeZRS16')
  })

  it('resolves a dblp key when only arxiv is enabled', async () => {
    const runtime = mount({ enabledSources: ['arxiv'] })
    runtime.registerSource(source('arxiv'))
    await expect(runtime.resolveRecord('conf/a/X')).rejects.toMatchObject({ code: 'LITERATURE_NO_RESULT' })
  })

  it('resolves a dblp key whose lookup returns null', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp', { lookup: async () => null }))
    runtime.registerSource(source('arxiv'))
    await expect(runtime.resolveRecord('conf/a/X')).rejects.toMatchObject({ code: 'LITERATURE_NO_RESULT' })
  })

  it('resolves a DOI when only dblp is enabled', async () => {
    const runtime = mount({ enabledSources: ['dblp'] })
    runtime.registerSource(source('dblp', { search: async () => [dblpHit('conf/a/X', 'Paper.', 2026)] }))
    const record = await runtime.resolveRecord('10.18653/v1/x')
    expect(record.dblpKey).toBe('conf/a/X')
  })

  it('finds no record for a DOI when only arxiv is enabled', async () => {
    const runtime = mount({ enabledSources: ['arxiv'] })
    runtime.registerSource(source('arxiv', { search: async () => [] }))
    await expect(runtime.resolveRecord('10.18653/v1/x')).rejects.toMatchObject({ code: 'LITERATURE_NO_RESULT' })
  })

  it('resolves a title when only arxiv is enabled', async () => {
    const runtime = mount({ enabledSources: ['arxiv'] })
    runtime.registerSource(source('arxiv', { search: async () => [arxivHit('1', 'Paper.')] }))
    const record = await runtime.resolveRecord('Paper')
    expect(record.arxivId).toBe('1')
  })

  it('resolves a title when a source rejects', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp', { search: async () => { throw new LiteratureError('boom', 'LITERATURE_FETCH_FAILED') } }))
    runtime.registerSource(source('arxiv', { search: async () => [arxivHit('1', 'Paper.')] }))
    const record = await runtime.resolveRecord('Paper')
    expect(record.arxivId).toBe('1')
  })

  it('resolves a DOI when the dblp search is throttled and arXiv still answers', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp', { search: async () => { throw new LiteratureError('throttled', 'LITERATURE_RATE_LIMITED') } }))
    const arxivSearch = vi.fn(async () => [arxivHit('2510.10008', 'Paper.')])
    runtime.registerSource(source('arxiv', { search: arxivSearch }))
    const record = await runtime.resolveRecord('10.18653/V1/2026.X')
    expect(record.arxivId).toBe('2510.10008')
  })

  it('falls back to the arXiv bibtex when the formal-record search is throttled', async () => {
    const runtime = mount()
    const corrHit = dblpHit('journals/corr/abs-2510-10008', 'RIPRAG.', 2025, true)
    runtime.registerSource(source('dblp', {
      lookup: async ref => ref.kind === 'dblp' && ref.dblpKey === 'journals/corr/abs-2510-10008' ? corrHit : null,
      search: async () => { throw new LiteratureError('throttled', 'LITERATURE_RATE_LIMITED') },
    }))
    runtime.registerSource(source('arxiv', { bibtex: async () => ({ bibtex: '@misc{arxiv}', source: 'arxiv', published: false }) }))
    const result = await runtime.bibtex('2510.10008')
    expect(result.source).toBe('arxiv')
  })

  it('rethrows the rate-limit error when both sources are throttled', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp', { search: async () => { throw new LiteratureError('throttled', 'LITERATURE_RATE_LIMITED') } }))
    runtime.registerSource(source('arxiv', { search: async () => { throw new LiteratureError('throttled', 'LITERATURE_RATE_LIMITED') } }))
    await expect(runtime.search({ query: 'x' })).rejects.toMatchObject({ code: 'LITERATURE_RATE_LIMITED' })
  })

  it('throws for bibtex on an arXiv id when arxiv is absent', async () => {
    const runtime = mount({ enabledSources: ['dblp'] })
    runtime.registerSource(source('dblp', { bibtex: async () => null }))
    await expect(runtime.bibtex('2510.10008')).rejects.toMatchObject({ code: 'LITERATURE_NO_RESULT' })
  })

  it('throws for bibtex on a title that resolves to dblp-only', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp', { search: async () => [dblpHit('conf/a/X', 'Paper.', 2026)], bibtex: async () => null }))
    runtime.registerSource(source('arxiv', { search: async () => [], bibtex: async () => null }))
    await expect(runtime.bibtex('Paper')).rejects.toMatchObject({ code: 'LITERATURE_NO_RESULT' })
  })

  it('throws for bibtex on an arXiv id whose arXiv bibtex is also null', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp', { bibtex: async () => null }))
    runtime.registerSource(source('arxiv', { bibtex: async () => null }))
    await expect(runtime.bibtex('2510.10008')).rejects.toMatchObject({ code: 'LITERATURE_NO_RESULT' })
  })

  it('throws for bibtex on a title that resolves arxiv-only with null arXiv bibtex', async () => {
    const runtime = mount()
    runtime.registerSource(source('dblp', { search: async () => [], bibtex: async () => null }))
    runtime.registerSource(source('arxiv', {
      search: async () => [arxivHit('2510.10008', 'Paper.')],
      bibtex: async () => null,
    }))
    await expect(runtime.bibtex('Paper')).rejects.toMatchObject({ code: 'LITERATURE_NO_RESULT' })
  })
})
