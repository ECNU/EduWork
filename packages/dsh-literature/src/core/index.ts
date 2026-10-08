/**
 * Service Definition for the literature capability seam (`ctx.literature`):
 * a source registry plus provider-merging execution for search, record
 * resolution, and BibTeX selection. The dblp source is preferred for formal
 * (published) records and for CoRR-mirrored BibTeX; arXiv is the fallback for
 * preprints dblp has not synced yet.
 * @module @eduwork/dsh-literature/core
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { LiteratureError } from './error.ts'
import type {
  BibtexResult,
  FulltextArtifactKind,
  FulltextResult,
  LiteratureRef,
  LiteratureRecord,
  LiteratureSearchRequest,
  LiteratureSearchResult,
  LiteratureSource,
  RawHit,
} from './types.ts'
import { arxivIdToCorrKey, corrKeyToArxivId, isDblpKey, isHttpUrl, normalizeTitle, parseArxivId, parseDoi } from './normalize.ts'
import { mergeHits } from './merge.ts'
import { bm25TitleScores } from './bm25.ts'
import { httpGet, type HttpLimits } from './http.ts'
import { extractPdfText, extractSource, htmlToMarkdown, minifyLandingPageHtml } from './extract.ts'

export { LiteratureError } from './error.ts'
export type { LiteratureErrorCode } from './error.ts'

/**
 * A cooperative throttle serializing callers at a minimum interval; the source
 * providers share it for polite rate limiting.
 * @param rateLimitMs - the minimum interval between calls, in milliseconds.
 * @returns an async gate that waits out the remaining interval before each call.
 */
export function createThrottle(rateLimitMs: number): () => Promise<void> {
  let next = 0
  return async () => {
    const now = Date.now()
    if (now < next) await new Promise(resolve => setTimeout(resolve, next - now))
    next = Date.now() + rateLimitMs
  }
}
export type {
  BibtexResult,
  BibtexSource,
  FulltextArtifactKind,
  FulltextResult,
  FulltextSource,
  LiteratureFulltextFile,
  LiteratureRecord,
  LiteratureRef,
  LiteratureSearchRequest,
  LiteratureSearchResult,
  LiteratureSource,
  LiteratureSourceId,
  RawHit,
} from './types.ts'
export { arxivIdToCorrKey, corrKeyToArxivId, encodePathSegments, isDblpKey, isHttpUrl, normalizeTitle, parseArxivId, parseDoi, stableRecordId } from './normalize.ts'
export { mergeHits } from './merge.ts'
export { bm25TitleScores } from './bm25.ts'
export { compact, type Defined } from './compact.ts'
export { extractPdfText, extractSource, htmlToMarkdown, isSafeArchivePath, minifyLandingPageHtml, pdfItemText, stripTex, untarSource } from './extract.ts'
export type { HttpGetOptions, HttpGetResult, HttpLimits } from './http.ts'
export { httpGet } from './http.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    literature: LiteratureRuntime
  }
}

/** Recognize a free-form reference into a typed {@link LiteratureRef}. */
function recognize(input: string): LiteratureRef {
  const trimmed = input.trim()
  if (trimmed.length === 0) throw new LiteratureError('empty literature reference', 'LITERATURE_INVALID_REF')
  const arxivId = parseArxivId(trimmed)
  if (arxivId !== null) return { kind: 'arxiv', arxivId }
  const corrArxivId = isDblpKey(trimmed) ? corrKeyToArxivId(trimmed) : null
  if (corrArxivId !== null) return { kind: 'arxiv', arxivId: corrArxivId }
  if (isDblpKey(trimmed)) return { kind: 'dblp', dblpKey: trimmed }
  const doi = parseDoi(trimmed)
  if (doi !== null) return { kind: 'doi', doi }
  if (isHttpUrl(trimmed)) return { kind: 'url', url: trimmed }
  return { kind: 'title', title: trimmed }
}

/** Whether a value looks like a {@link LiteratureError}, even if it comes from a duplicated package copy.
 * The seam routes on the structured `code` taxonomy, so a foreign `LiteratureError` instance from
 * another copy of `@eduwork/dsh-literature/core` must still be recognized.
 */
function isLiteratureError(error: unknown): error is LiteratureError {
  return error instanceof LiteratureError || (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'LiteratureError' &&
    typeof (error as { code?: unknown }).code === 'string'
  )
}

/**
 * Config for the literature seam. `enabledSources` optionally pins which
 * sources run; omitted means every registered `available()` source runs.
 */
export interface LiteratureRuntimeConfig {
  /** Source ids to run; omitted means every registered `available()` source runs. */
  readonly enabledSources?: ('dblp' | 'arxiv')[]
  /** Default search result cap applied after merging. */
  readonly searchMaxResults?: number
  /** Request timeout in milliseconds. */
  readonly timeoutMs?: number
  /** Maximum number of same-origin redirect hops. */
  readonly maxRedirects?: number
  /** Maximum accepted request URL length. */
  readonly maxUrlLength?: number
  /** Byte cap for downloaded full-text artifacts (source tarball, PDF). */
  readonly downloadMaxBytes?: number
  /** Maximum characters retained per extracted text file. */
  readonly extractMaxChars?: number
  /** Maximum characters retained in the readable full-text summary. */
  readonly summaryMaxChars?: number
  /** Maximum characters retained in a fetched publisher landing page (PDF-link analysis). */
  readonly landingPageMaxChars?: number
  /** `User-Agent` header sent on every request. */
  readonly userAgent?: string
}

const DEFAULT_USER_AGENT = 'deepseek-harness/0.1.0 (+https://github.com/deepseek-ai)'

/** The literature access service, registered as `ctx.literature`. */
export class LiteratureRuntime extends Service {
  static Config: z<LiteratureRuntimeConfig> = z.object({
    // Prevent Schemastery from materializing an omitted array as `[]`, which
    // would mean "no sources enabled" instead of "every registered source".
    enabledSources: z.array(z.union(['dblp', 'arxiv'] as const)).default(undefined as unknown as ('dblp' | 'arxiv')[]),
    searchMaxResults: z.number(),
    timeoutMs: z.number(),
    maxRedirects: z.number(),
    maxUrlLength: z.number(),
    downloadMaxBytes: z.number(),
    extractMaxChars: z.number(),
    summaryMaxChars: z.number(),
    landingPageMaxChars: z.number(),
    userAgent: z.string(),
  })

  private readonly sources = new Map<string, LiteratureSource>()
  private readonly enabledSourceIds: readonly string[] | undefined

  /** Resolved service config with every default applied. */
  readonly config: Required<Omit<LiteratureRuntimeConfig, 'enabledSources'>>

  constructor(ctx: Context, config: LiteratureRuntimeConfig = {}) {
    super(ctx, 'literature')
    this.enabledSourceIds = config.enabledSources === undefined ? undefined : [...config.enabledSources]
    this.config = {
      searchMaxResults: config.searchMaxResults ?? 10,
      // Publisher PDF hosts measured up to ~60s on real conference pages; 30s dropped them.
      timeoutMs: config.timeoutMs ?? 60_000,
      maxRedirects: config.maxRedirects ?? 5,
      maxUrlLength: config.maxUrlLength ?? 2048,
      // arXiv source tarballs and publisher PDFs can run tens of MB; the
      // response cap must not truncate them before extraction.
      downloadMaxBytes: config.downloadMaxBytes ?? 100_000_000,
      extractMaxChars: config.extractMaxChars ?? 200_000,
      summaryMaxChars: config.summaryMaxChars ?? 4000,
      landingPageMaxChars: config.landingPageMaxChars ?? 20_000,
      userAgent: config.userAgent ?? DEFAULT_USER_AGENT,
    }
  }

  /**
   * Register a source. Throws {@link LiteratureError} `LITERATURE_PROVIDER_UNAVAILABLE`
   * is not used here — duplicate ids are rejected via a TypeError, matching the
   * seam's single-registration ownership.
   * @param source - the source; its `id` is the registry key.
   * @returns the disposer that unregisters the source.
   */
  registerSource(source: LiteratureSource): () => void {
    if (this.sources.has(source.id)) {
      throw new LiteratureError(`a literature source with id "${source.id}" is already registered`, 'LITERATURE_PROVIDER_UNAVAILABLE')
    }
    this.sources.set(source.id, source)
    return () => {
      this.sources.delete(source.id)
    }
  }

  /** Sources selected to run, resolved at execution time. */
  private selectedSources(): LiteratureSource[] {
    if (this.enabledSourceIds !== undefined) {
      const missing = this.enabledSourceIds.find(id => !this.sources.has(id))
      if (missing !== undefined) {
        throw new LiteratureError(`configured literature source "${missing}" is not registered`, 'LITERATURE_PROVIDER_UNAVAILABLE')
      }
      return this.enabledSourceIds.flatMap((id) => {
        const source = this.sources.get(id)
        return source !== undefined && source.available() ? [source] : []
      })
    }
    return [...this.sources.values()].filter(source => source.available())
  }

  /**
   * Search all selected sources in parallel and merge the normalized hits.
   * @param request - the query and optional per-call cap.
   * @param signal - cancellation.
   * @returns the merged search result.
   */
  async search(request: LiteratureSearchRequest, signal?: AbortSignal): Promise<LiteratureSearchResult> {
    const sources = this.selectedSources()
    if (sources.length === 0) throw new LiteratureError('no usable literature source', 'LITERATURE_PROVIDER_UNAVAILABLE')
    const settled = await Promise.allSettled(sources.map(source => source.search(request, signal)))
    const hits: RawHit[] = []
    let failed = 0
    settled.forEach((outcome) => {
      if (outcome.status === 'fulfilled') hits.push(...outcome.value)
      else {
        failed += 1
        if (isLiteratureError(outcome.reason) && outcome.reason.code === 'LITERATURE_RATE_LIMITED') {
          // One throttled source must not sink the whole search; the other source still answers.
        }
      }
    })
    if (failed === sources.length && hits.length === 0) {
      const first = settled.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
      if (first !== undefined && isLiteratureError(first.reason)) throw first.reason
      throw new LiteratureError('all literature sources failed', 'LITERATURE_PROVIDER_UNAVAILABLE')
    }
    const records = mergeHits(hits)
    const cap = request.maxResults ?? this.config.searchMaxResults
    const truncated = records.length > cap
    return { records: records.slice(0, cap), total: records.length, truncated }
  }

  /**
   * Resolve a free-form reference (title, arXiv id, dblp key, CoRR key, DOI)
   * into one merged record. An exact-identifier reference (arXiv id, dblp
   * key, or DOI) prefers the record carrying that exact identifier over a
   * newer fuzzy title-match hit.
   * @param input - the free-form reference.
   * @param signal - cancellation.
   * @returns the resolved merged record.
   */
  async resolveRecord(input: string, signal?: AbortSignal): Promise<LiteratureRecord> {
    const ref = recognize(input)
    const sources = this.selectedSources()
    if (sources.length === 0) throw new LiteratureError('no usable literature source', 'LITERATURE_PROVIDER_UNAVAILABLE')
    const dblp = sources.find(source => source.id === 'dblp')
    const arxiv = sources.find(source => source.id === 'arxiv')
    const hits: RawHit[] = []
    await this.collect(ref, dblp, arxiv, hits, signal)
    const records = mergeHits(hits)
    const record = this.preferredRecord(records, ref)
    if (record === undefined) throw new LiteratureError(`no literature record found for ${JSON.stringify(input)}`, 'LITERATURE_NO_RESULT')
    return record
  }

  /**
   * Pick the record a resolved reference names: the one carrying the exact
   * identifier, falling back to the year-sorted first record for fuzzy
   * (title/URL) references.
   * @param records - merged records, ordered by year descending.
   * @param ref - the recognized reference.
   * @returns the preferred record, or undefined when none exists.
   */
  private preferredRecord(records: LiteratureRecord[], ref: LiteratureRef): LiteratureRecord | undefined {
    switch (ref.kind) {
      case 'arxiv':
        return records.find(record => record.arxivId === ref.arxivId) ?? records[0]
      case 'dblp':
        return records.find(record => record.dblpKey === ref.dblpKey) ?? records[0]
      case 'doi':
        return records.find(record => record.doi === ref.doi) ?? records[0]
      case 'title': {
        // The sources order their own results (dblp by year, arXiv by
        // relevance), so rerank the merged candidates by BM25 title
        // similarity to the query; ties fall back to the year order.
        const query = normalizeTitle(ref.title)
        const scores = bm25TitleScores(records.map(record => normalizeTitle(record.title)), query)
        let best = 0
        for (let i = 1; i < records.length; i++) {
          const score = scores[i] ?? 0
          const current = scores[best] ?? 0
          const year = records[i]?.year ?? -1
          const bestYear = records[best]?.year ?? -1
          if (score > current || (score === current && year > bestYear)) best = i
        }
        return records[best]
      }
      default:
        return records[0]
    }
  }

  /** Run one source's search, swallowing its failure so a throttled or broken source cannot sink resolution. */
  private async trySearch(source: LiteratureSource, request: LiteratureSearchRequest, signal?: AbortSignal): Promise<RawHit[]> {
    const [outcome] = await Promise.allSettled([source.search(request, signal)])
    return outcome.status === 'fulfilled' ? [...outcome.value] : []
  }

  /** Gather hits from both sources for one recognized reference. */
  private async collect(
    ref: LiteratureRef,
    dblp: LiteratureSource | undefined,
    arxiv: LiteratureSource | undefined,
    hits: RawHit[],
    signal?: AbortSignal,
  ): Promise<void> {
    switch (ref.kind) {
      case 'arxiv': {
        if (arxiv !== undefined) {
          const hit = await arxiv.lookup({ kind: 'arxiv', arxivId: ref.arxivId }, signal)
          if (hit !== null) hits.push(hit)
        }
        const corrKey = arxivIdToCorrKey(ref.arxivId)
        if (dblp !== undefined && corrKey !== null) {
          const corr = await dblp.lookup({ kind: 'dblp', dblpKey: corrKey }, signal)
          if (corr !== null) hits.push(corr)
        }
        const title = hits.find(hit => hit.source === 'arxiv')?.title
        if (dblp !== undefined && title !== undefined) {
          hits.push(...await this.trySearch(dblp, { query: title, maxResults: 5 }, signal))
        }
        return
      }
      case 'dblp': {
        if (dblp !== undefined) {
          const hit = await dblp.lookup(ref, signal)
          if (hit !== null) hits.push(hit)
        }
        const arxivId = corrKeyToArxivId(ref.dblpKey)
        /* v8 ignore next 4 -- recognize maps a CoRR key to the arxiv ref kind, so a dblp ref here is never CoRR */
        if (arxiv !== undefined && arxivId !== null) {
          const hit = await arxiv.lookup({ kind: 'arxiv', arxivId }, signal)
          if (hit !== null) hits.push(hit)
        }
        return
      }
      case 'doi': {
        if (dblp !== undefined) hits.push(...await this.trySearch(dblp, { query: ref.doi, maxResults: 5 }, signal))
        if (arxiv !== undefined) {
          const title = hits.find(hit => hit.source === 'dblp')?.title
          if (title !== undefined) {
            hits.push(...await this.trySearch(arxiv, { query: title, maxResults: 3 }, signal))
          } else {
            // No dblp title to cross-search (dblp failed or has no record);
            // arXiv's own DOI field is the fallback.
            hits.push(...await this.trySearch(arxiv, { query: `doi:${ref.doi}`, maxResults: 3 }, signal))
          }
        }
        return
      }
      case 'url': {
        throw new LiteratureError('a URL reference cannot be resolved to a bibliography record', 'LITERATURE_INVALID_REF')
      }
      case 'title': {
        // Exact-title resolution needs recall: pull the full dblp hit list
        // (the source caps at 1000) so the paper the query names is not
        // truncated away by dblp's year ordering, and rerank later.
        const results = await Promise.allSettled([
          dblp?.search({ query: ref.title, maxResults: 1000 }, signal) ?? Promise.resolve([]),
          arxiv?.search({ query: ref.title, maxResults: 30, phrase: true }, signal) ?? Promise.resolve([]),
        ])
        hits.push(...results.flatMap(outcome => outcome.status === 'fulfilled' ? outcome.value : []))
        return
      }
    }
  }

  /**
   * Select a BibTeX entry for a reference: the formal dblp record wins (a
   * published paper's authoritative entry), then arXiv (the canonical `@misc`
   * form for a still-unpublished preprint — the dblp CoRR `@article`-in-`CoRR`
   * entry is an artifact), then the dblp CoRR mirror as a last resort.
   * @param input - the free-form reference.
   * @param signal - cancellation.
   * @returns the selected BibTeX entry.
   */
  async bibtex(input: string, signal?: AbortSignal): Promise<BibtexResult> {
    const ref = recognize(input)
    const sources = this.selectedSources()
    const dblp = sources.find(source => source.id === 'dblp')
    const arxiv = sources.find(source => source.id === 'arxiv')

    if (ref.kind === 'dblp') {
      const result = dblp !== undefined ? await dblp.bibtex(ref, signal) : null
      if (result !== null) return result
      // A dblp key that is actually a CoRR key resolves to arXiv instead.
      const arxivId = corrKeyToArxivId(ref.dblpKey)
      /* v8 ignore next 4 -- recognize maps a CoRR key to the arxiv ref kind, so a dblp ref here is never CoRR */
      if (arxiv !== undefined && arxivId !== null) {
        const fallback = await arxiv.bibtex({ kind: 'arxiv', arxivId }, signal)
        if (fallback !== null) return fallback
      }
    }
    if (ref.kind === 'arxiv') {
      const corrKey = arxivIdToCorrKey(ref.arxivId)
      // Find the formal (non-CoRR) dblp record when the paper is published;
      // the CoRR record's title feeds the lookup because dblp keeps both.
      if (dblp !== undefined && corrKey !== null) {
        const corrHit = await dblp.lookup({ kind: 'dblp', dblpKey: corrKey }, signal)
        if (corrHit !== null) {
          const formalKey = (await this.trySearch(dblp, { query: corrHit.title, maxResults: 5 }, signal))
            .map(hit => hit.dblpKey)
            .find(key => key !== undefined && corrKeyToArxivId(key) === null)
          if (formalKey !== undefined) {
            const formal = await dblp.bibtex({ kind: 'dblp', dblpKey: formalKey }, signal)
            if (formal !== null) return formal
          }
        }
      }
      if (arxiv !== undefined) {
        const preprint = await arxiv.bibtex(ref, signal)
        if (preprint !== null) return preprint
      }
      if (dblp !== undefined && corrKey !== null) {
        const corr = await dblp.bibtex({ kind: 'dblp', dblpKey: corrKey }, signal)
        if (corr !== null) return corr
      }
    }
    if (ref.kind === 'title' || ref.kind === 'doi') {
      const record = await this.resolveRecord(input, signal)
      const formalKey = record.dblpKey !== undefined && corrKeyToArxivId(record.dblpKey) === null ? record.dblpKey : undefined
      if (formalKey !== undefined && dblp !== undefined) {
        const formal = await dblp.bibtex({ kind: 'dblp', dblpKey: formalKey }, signal)
        if (formal !== null) return formal
      }
      if (record.arxivId !== undefined && arxiv !== undefined) {
        const preprint = await arxiv.bibtex({ kind: 'arxiv', arxivId: record.arxivId }, signal)
        if (preprint !== null) return preprint
      }
      if (record.dblpKey !== undefined && dblp !== undefined) {
        const corr = await dblp.bibtex({ kind: 'dblp', dblpKey: record.dblpKey }, signal)
        if (corr !== null) return corr
      }
    }
    throw new LiteratureError(`no BibTeX available for ${JSON.stringify(input)}`, 'LITERATURE_NO_RESULT')
  }

  /**
   * Acquire full text for a reference, in priority order: the arXiv source
   * tarball, then the arXiv HTML, then the arXiv PDF, then an explicit PDF
   * URL. A record with no downloadable artifact (and a DOI-only or landing
   * page input) throws `LITERATURE_FULLTEXT_UNAVAILABLE`; the model-facing
   * tool resolves the publisher PDF link via {@link landingPage} and a
   * subagent before retrying.
   * @param input - the free-form reference (or an explicit PDF URL).
   * @param signal - cancellation.
   * @returns the full-text acquisition result.
   */
  async fulltext(input: string, signal?: AbortSignal): Promise<FulltextResult> {
    const ref = recognize(input)
    if (ref.kind === 'url') return this.fetchExplicitUrl(ref.url, signal)
    const record = await this.resolveRecord(input, signal)
    const arxiv = this.selectedSources().find(source => source.id === 'arxiv')
    if (record.arxivId !== undefined && arxiv?.downloadFulltext !== undefined) {
      for (const kind of ['source', 'html', 'pdf'] as const) {
        const bytes = await arxiv.downloadFulltext(record.arxivId, kind, signal)
        if (bytes === null) continue
        try {
          return await this.extractArtifact(kind, bytes, record.id)
        } catch (error) {
          // A 200 response that is not the expected artifact kind (e.g. the
          // e-print endpoint serving a PDF for a PDF-only submission) must
          // fall through to the next kind, not abort the acquisition.
          if (!isLiteratureError(error) || error.code !== 'LITERATURE_EXTRACTION_FAILED') throw error
        }
      }
    }
    throw new LiteratureError(`no full text available for ${JSON.stringify(input)}`, 'LITERATURE_FULLTEXT_UNAVAILABLE')
  }

  /** Extract one downloaded artifact kind into the full-text vocabulary. */
  private async extractArtifact(kind: FulltextArtifactKind, bytes: Uint8Array, id: string): Promise<FulltextResult> {
    const { extractMaxChars, summaryMaxChars } = this.config
    if (kind === 'source') {
      const { files, summary } = await extractSource(bytes, { maxFileChars: extractMaxChars, maxSummaryChars: summaryMaxChars })
      return { id, kind: 'fulltext', source: 'arxiv-source', files, summary }
    }
    if (kind === 'html') {
      const markdown = htmlToMarkdown(new TextDecoder().decode(bytes))
      return {
        id,
        kind: 'fulltext',
        source: 'arxiv-html',
        files: [{ path: 'paper.md', kind: 'markdown', content: markdown.slice(0, extractMaxChars) }],
        summary: markdown.slice(0, summaryMaxChars),
      }
    }
    const text = await extractPdfText(bytes)
    return {
      id,
      kind: 'fulltext',
      source: 'arxiv-pdf',
      files: [{ path: 'paper.txt', kind: 'text', content: text.slice(0, extractMaxChars) }],
      summary: text.slice(0, summaryMaxChars),
    }
  }

  /**
   * Fetch an explicit PDF URL and extract its text. Cross-origin redirects are
   * followed (publisher PDF links commonly redirect to a CDN) and the PDF
   * verdict considers the `%PDF-` magic bytes, so a link whose server omits
   * the PDF content type is still recognized.
   */
  private async fetchExplicitUrl(url: string, signal?: AbortSignal): Promise<FulltextResult> {
    const result = await httpGet(url, this.httpLimits(), signal, { followCrossOrigin: true })
    if (result.statusCode !== 200) throw new LiteratureError('the URL returned a non-200 status', 'LITERATURE_FULLTEXT_UNAVAILABLE')
    const contentType = result.contentType ?? ''
    const startsWithPdf = result.body.length >= 5 && new TextDecoder().decode(result.body.subarray(0, 5)) === '%PDF-'
    const looksPdf = contentType.includes('pdf') || /\.pdf(?:\?|$)/iu.test(url) || startsWithPdf
    if (looksPdf) {
      const text = await extractPdfText(result.body)
      return {
        id: url,
        kind: 'fulltext',
        source: 'publisher-pdf',
        files: [{ path: 'paper.txt', kind: 'text', content: text.slice(0, this.config.extractMaxChars) }],
        summary: text.slice(0, this.config.summaryMaxChars),
      }
    }
    throw new LiteratureError('the URL is not a PDF; inspect the page via landingPage', 'LITERATURE_FULLTEXT_UNAVAILABLE')
  }

  /**
   * Fetch a publisher landing page — by DOI through the resolver, or directly
   * by URL — and return its bounded, minified HTML for PDF-link analysis.
   * Style, comments, and whitespace are stripped; inline scripts and
   * header/footer/nav content are kept, since a PDF link can live in any of
   * them.
   * @param input - the DOI or landing-page URL.
   * @param signal - cancellation.
   * @returns the bounded minified page HTML.
   * @throws {@link LiteratureError} `LITERATURE_FULLTEXT_UNAVAILABLE` when the
   *   input is neither a DOI nor a URL, or the page cannot be fetched.
   */
  async landingPage(input: string, signal?: AbortSignal): Promise<string> {
    const ref = recognize(input)
    const target: { url: string; followCrossOrigin: true | undefined } | null = ref.kind === 'doi'
      ? { url: `https://doi.org/${ref.doi}`, followCrossOrigin: true }
      : ref.kind === 'url'
        ? { url: ref.url, followCrossOrigin: undefined }
        : null
    if (target === null) {
      throw new LiteratureError('a landing page requires a DOI or URL reference', 'LITERATURE_FULLTEXT_UNAVAILABLE')
    }
    const result = await httpGet(
      target.url,
      this.httpLimits(),
      signal,
      target.followCrossOrigin === true ? { followCrossOrigin: true } : undefined,
    )
    if (result.statusCode !== 200) throw new LiteratureError('the publisher page returned a non-200 status', 'LITERATURE_FULLTEXT_UNAVAILABLE')
    return minifyLandingPageHtml(new TextDecoder().decode(result.body)).slice(0, this.config.landingPageMaxChars)
  }

  /** Shared transport limits derived from the service config. */
  private httpLimits(): HttpLimits {
    return {
      maxUrlLength: this.config.maxUrlLength,
      maxResponseBytes: this.config.downloadMaxBytes,
      timeoutMs: this.config.timeoutMs,
      maxRedirects: this.config.maxRedirects,
      userAgent: this.config.userAgent,
    }
  }
}

export default LiteratureRuntime
