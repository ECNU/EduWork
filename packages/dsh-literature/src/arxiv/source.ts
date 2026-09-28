/**
 * The arXiv source provider: Atom search, exact-id lookup, per-record BibTeX,
 * and full-text artifact download (source tarball / HTML / PDF).
 * @module @eduwork/dsh-literature/arxiv/source
 */

import { XMLParser } from 'fast-xml-parser'
import type { BibtexResult, LiteratureRef, LiteratureSource, RawHit } from '@eduwork/dsh-literature/core'
import { compact, encodePathSegments, httpGet, LiteratureError, normalizeTitle, parseDoi, type HttpLimits } from '@eduwork/dsh-literature/core'

/** One Atom feed entry, flattened from the arXiv query response. */
interface AtomEntry {
  readonly id: string
  readonly title: string
  readonly summary?: string
  /** First-submission date (`published`); the year of the record. */
  readonly published?: string
  /** Last-revision date (`updated`); the year of the latest version. */
  readonly updated?: string
  readonly doi?: string
  readonly journalRef?: string
  readonly authors: string[]
}

/** Extract the bare arXiv id from an Atom entry id/URL. */
function arxivIdOf(id: string): string | undefined {
  const match = /arxiv\.org\/abs\/([^v\s]+)/u.exec(id)
  if (match === null) return undefined
  return match[1]
}

/** A tolerant Atom parser over the arxiv API response. */
class Atom {
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    trimValues: true,
  })

  parseEntries(xml: string): AtomEntry[] {
    const doc = this.parser.parse(xml) as { feed?: { entry?: unknown } }
    const raw = doc.feed?.entry
    if (raw === undefined) return []
    const list = Array.isArray(raw) ? raw : [raw]
    return list.map(entry => this.toEntry(entry))
  }

  private toEntry(entry: unknown): AtomEntry {
    const e = entry as Record<string, unknown>
    const authorRaw = e.author
    const authors = (Array.isArray(authorRaw) ? authorRaw : authorRaw === undefined ? [] : [authorRaw])
      .flatMap((author) => {
        const name = (author as { name?: unknown }).name
        return typeof name === 'string' && name.length > 0 ? [name] : []
      })
    return compact({
      id: typeof e.id === 'string' ? e.id : '',
      title: typeof e.title === 'string' ? e.title : '',
      summary: typeof e.summary === 'string' ? e.summary : undefined,
      published: typeof e.published === 'string' ? e.published : undefined,
      updated: typeof e.updated === 'string' ? e.updated : undefined,
      doi: typeof e['arxiv:doi'] === 'string' ? e['arxiv:doi'] : undefined,
      journalRef: typeof e['arxiv:journal_ref'] === 'string' ? e['arxiv:journal_ref'] : undefined,
      authors,
    })
  }
}

/** Transport limits for arXiv requests. */
export interface ArxivLimits extends HttpLimits {
  /** Polite minimum interval between requests, in milliseconds. */
  readonly rateLimitMs: number
  /** Exponential-backoff base delay in milliseconds (429/503 retries wait `rateLimitBackoffBaseMs × 2^retry`). */
  readonly rateLimitBackoffBaseMs: number
  /** Maximum rate-limit backoff retries (429/503). */
  readonly rateLimitBackoffMaxRetries: number
}

/** Whether a status code means arXiv throttled or is transiently unavailable. */
function isRateLimited(status: number): boolean {
  return status === 429 || status === 503
}

/**
 * Wait `ms` milliseconds, rejecting with the seam's abort error when the
 * caller cancels during the wait.
 * @param ms - the delay in milliseconds.
 * @param signal - caller cancellation.
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new LiteratureError('literature request aborted', 'LITERATURE_FETCH_FAILED'))
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new LiteratureError('literature request aborted', 'LITERATURE_FETCH_FAILED'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** The arXiv source registered on the literature seam. */
export class ArxivSource implements LiteratureSource {
  readonly id = 'arxiv' as const
  private readonly atom = new Atom()

  constructor(
    private readonly apiBase: string,
    private readonly wwwBase: string,
    private readonly limits: ArxivLimits,
    private readonly throttle: () => Promise<void>,
  ) {}

  /** No credentials to check — the public arXiv API is always usable. */
  available(): boolean {
    return true
  }

  async search(
    request: { readonly query: string; readonly maxResults?: number; readonly phrase?: boolean },
    signal?: AbortSignal,
  ): Promise<readonly RawHit[]> {
    await this.throttle()
    const max = Math.max(1, Math.min(request.maxResults ?? 10, 30))
    // Unquoted multi-word `all:` queries degenerate to an OR of single terms
    // on arXiv, burying the exact paper; phrase searches quote the query.
    const searchQuery = request.phrase === true ? `all:"${request.query}"` : `all:${request.query}`
    const url = `${this.apiBase}/api/query?search_query=${encodeURIComponent(searchQuery)}&start=0&max_results=${max}`
    const result = await this.get(url, signal)
    this.throwIfUnavailable(result.statusCode, url)
    return this.atom.parseEntries(new TextDecoder().decode(result.body)).map(entry => this.toHit(entry))
  }

  /** Throw the seam's failure code for a non-200 search response. */
  private throwIfUnavailable(statusCode: number, url: string): void {
    if (statusCode === 200) return
    if (isRateLimited(statusCode)) {
      throw new LiteratureError(`arXiv throttled the search: ${url}`, 'LITERATURE_RATE_LIMITED')
    }
    throw new LiteratureError(`arXiv search failed with status ${statusCode}: ${url}`, 'LITERATURE_FETCH_FAILED')
  }

  async lookup(ref: LiteratureRef, signal?: AbortSignal): Promise<RawHit | null> {
    if (ref.kind !== 'arxiv') return null
    await this.throttle()
    const url = `${this.apiBase}/api/query?id_list=${encodeURIComponent(ref.arxivId)}`
    const result = await this.get(url, signal)
    if (result.statusCode !== 200) return null
    const entry = this.atom.parseEntries(new TextDecoder().decode(result.body))[0]
    return entry === undefined ? null : this.toHit(entry)
  }

  async bibtex(ref: LiteratureRef, signal?: AbortSignal): Promise<BibtexResult | null> {
    if (ref.kind !== 'arxiv') return null
    await this.throttle()
    const url = `${this.wwwBase}/bibtex/${encodePathSegments(ref.arxivId)}`
    const result = await this.get(url, signal)
    if (result.statusCode !== 200) return null
    const bibtex = new TextDecoder().decode(result.body).trim()
    if (bibtex.length === 0) return null
    return {
      bibtex,
      source: 'arxiv',
      published: false,
      note: 'arXiv BibTeX: the year may reflect the latest version, not the original submission.',
    }
  }

  async downloadFulltext(arxivId: string, kind: 'source' | 'html' | 'pdf', signal?: AbortSignal): Promise<Uint8Array | null> {
    await this.throttle()
    const path = kind === 'source' ? `/e-print/${arxivId}` : kind === 'html' ? `/html/${arxivId}` : `/pdf/${arxivId}`
    const url = `${this.wwwBase}${path}`
    const result = await this.get(url, signal)
    if (result.statusCode !== 200) return null
    // A PDF-only submission serves its PDF at `/e-print` as well. The source
    // artifact is genuinely unavailable in that case, so report null and let
    // the seam fall through to HTML/PDF instead of trying to gunzip a PDF.
    if (kind === 'source') {
      const contentType = result.contentType ?? ''
      const startsWithPdf = result.body.length >= 5 && new TextDecoder().decode(result.body.subarray(0, 5)) === '%PDF-'
      if (contentType.includes('pdf') || startsWithPdf) return null
    }
    return result.body
  }

  /** Map one Atom entry to a normalized preprint hit. */
  private toHit(entry: AtomEntry): RawHit {
    const arxivId = arxivIdOf(entry.id)
    const doi = entry.doi !== undefined ? parseDoi(entry.doi) ?? entry.doi.toLowerCase() : undefined
    // The record year is the first submission (`published`), not the latest
    // revision (`updated`), so a paper revised years later keeps its original
    // publication year.
    const date = entry.published ?? entry.updated
    return compact({
      source: 'arxiv',
      title: normalizeTitle(entry.title),
      rawTitle: entry.title,
      authors: entry.authors,
      year: date !== undefined ? Number(date.slice(0, 4)) : undefined,
      venue: entry.journalRef,
      doi,
      arxivId,
      preprint: true,
      url: arxivId !== undefined ? `https://arxiv.org/abs/${arxivId}` : undefined,
      openAccessUrl: arxivId !== undefined ? `https://arxiv.org/pdf/${arxivId}` : undefined,
      abstract: entry.summary,
    })
  }

  private get(url: string, signal?: AbortSignal): ReturnType<typeof httpGet> {
    // Retry rate-limit and transient-unavailable responses with exponential
    // backoff, so a throttled call survives instead of silently returning
    // empty results.
    const { rateLimitBackoffMaxRetries, rateLimitBackoffBaseMs } = this.limits
    const retry = async (attempt: number): Promise<Awaited<ReturnType<typeof httpGet>>> => {
      const result = await httpGet(url, this.limits, signal)
      if (attempt >= rateLimitBackoffMaxRetries || !isRateLimited(result.statusCode)) return result
      await sleep(rateLimitBackoffBaseMs * 2 ** attempt, signal)
      return retry(attempt + 1)
    }
    return retry(0)
  }
}
