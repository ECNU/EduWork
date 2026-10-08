/**
 * The dblp source provider: search via the JSON search API, exact-key lookup
 * via the record XML, and per-record BibTeX via `/rec/<key>.bib?param=1`.
 * @module @eduwork/dsh-literature/dblp/source
 */

import type { LiteratureRef, LiteratureSource, RawHit } from '@eduwork/dsh-literature/core'
import type { BibtexResult } from '@eduwork/dsh-literature/core'
import { corrKeyToArxivId, compact, encodePathSegments, httpGet, LiteratureError, normalizeTitle, parseDoi, type HttpLimits } from '@eduwork/dsh-literature/core'

/** Whether a status code means dblp throttled or is transiently unavailable. */
function isRateLimited(status: number): boolean {
  return status === 429 || status === 503
}

/** Decode the HTML entities dblp embeds in titles (`&amp;`, `&lt;`, numeric references). */
function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gu, '&')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;|&apos;/gu, "'")
    .replace(/&#x([0-9a-f]+);/giu, (match, hex: string) => {
      const code = Number.parseInt(hex, 16)
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    })
    .replace(/&#(\d+);/gu, (match, dec: string) => {
      const code = Number.parseInt(dec, 10)
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    })
}

/** dblp search hit `info` fields (a subset of the search API JSON). */
interface DblpHitInfo {
  readonly key?: string
  readonly title?: string
  readonly venue?: string
  readonly year?: string
  readonly type?: string
  readonly access?: string
  readonly doi?: string
  readonly ee?: string | string[]
  readonly url?: string
  readonly authors?: { readonly author?: unknown }
}

/** Extract the `info` object of every hit, tolerating the search API shapes. */
function infoOf(hits: unknown): DblpHitInfo[] {
  const result = hits as { readonly result?: { readonly hits?: { readonly hit?: unknown } } }
  const hit = result.result?.hits?.hit
  if (hit === undefined) return []
  const list = Array.isArray(hit) ? hit : [hit]
  return list.flatMap((entry): DblpHitInfo[] => {
    const info = (entry as { readonly info?: DblpHitInfo }).info
    return info === undefined ? [] : [info]
  })
}

/** Normalize the search API's `authors.author` (object-or-array) to strings. */
function authorNames(authors: unknown): string[] {
  const author = (authors as { readonly author?: unknown } | undefined)?.author
  if (author === undefined) return []
  const list = Array.isArray(author) ? author : [author]
  return list.flatMap((entry) => {
    const text = (entry as { readonly text?: unknown }).text
    return typeof text === 'string' && text.length > 0 ? [text] : []
  })
}

/** The `ee` field (string-or-array) reduced to a single link. */
function firstEe(ee: string | string[] | undefined): string | undefined {
  if (typeof ee === 'string') return ee
  return ee?.[0]
}

/** Map one search hit to a normalized record. */
function fromHitInfo(info: DblpHitInfo): RawHit {
  const key = info.key ?? ''
  const arxivId = corrKeyToArxivId(key) ?? undefined
  const preprint = (info.type ?? '').startsWith('Informal')
  const ee = firstEe(info.ee)
  const doi = (info.doi ?? (ee !== undefined ? parseDoi(ee) ?? undefined : undefined))?.toLowerCase()
  const rawTitle = decodeHtmlEntities(info.title ?? '')
  return compact({
    source: 'dblp',
    title: normalizeTitle(rawTitle),
    rawTitle,
    authors: authorNames(info.authors),
    year: info.year !== undefined && info.year !== '' ? Number(info.year) : undefined,
    venue: info.venue,
    doi,
    arxivId,
    preprint,
    dblpKey: key === '' ? undefined : key,
    url: info.url,
    openAccessUrl: info.access === 'open' ? ee : undefined,
  })
}

/** Transport limits for dblp requests. */
export interface DblpLimits extends HttpLimits {
  /** Polite minimum interval between requests, in milliseconds. */
  readonly rateLimitMs: number
}

/** Minimal record-XML extraction (dblp's simple, well-formed structure). */
interface RecordXml {
  readonly preprint: boolean
  readonly title: string
  readonly year?: number
  readonly venue?: string
  readonly authors: readonly string[]
  readonly ee?: string
  readonly url?: string
}

/** Parse the small record XML into the fields the source exposes. */
function parseRecordXml(xml: string, key: string): RecordXml {
  const article = /<article\b[^>]*\bpubltype="([^"]*)"/u.exec(xml)
  const preprint = article?.[1] === 'informal'
  const title = decodeHtmlEntities(/<title>([\s\S]*?)<\/title>/u.exec(xml)?.[1]?.replace(/\.$/, '') ?? '')
  const yearRaw = /<year>(\d{4})<\/year>/u.exec(xml)?.[1]
  // Formal records name the venue in `<journal>` (article) or `<booktitle>`
  // (inproceedings); CoRR mirror records carry no venue element at all.
  const venue = /<journal>([\s\S]*?)<\/journal>/u.exec(xml)?.[1] ?? /<booktitle>([\s\S]*?)<\/booktitle>/u.exec(xml)?.[1]
  const authors = [...xml.matchAll(/<author>([\s\S]*?)<\/author>/gu)]
    .flatMap(match => match.slice(1).map(name => name.trim()))
  const oa = /<ee type="oa">([\s\S]*?)<\/ee>/u.exec(xml)?.[1]
  const ee = oa ?? /<ee>([\s\S]*?)<\/ee>/u.exec(xml)?.[1]
  return compact({
    preprint,
    title,
    year: yearRaw !== undefined ? Number(yearRaw) : undefined,
    venue,
    authors,
    ee,
    url: `https://dblp.org/rec/${key}`,
  })
}

/** The dblp source registered on the literature seam. */
export class DblpSource implements LiteratureSource {
  readonly id = 'dblp' as const

  constructor(
    private readonly baseUrl: string,
    private readonly limits: DblpLimits,
    private readonly throttle: () => Promise<void>,
  ) {}

  /** No credentials to check — the public dblp API is always usable. */
  available(): boolean {
    return true
  }

  async search(request: { readonly query: string; readonly maxResults?: number }, signal?: AbortSignal): Promise<readonly RawHit[]> {
    await this.throttle()
    // dblp accepts up to 1000 hits per request; exact-title resolution pulls the full list.
    const max = Math.max(1, Math.min(request.maxResults ?? 10, 1000))
    const url = `${this.baseUrl}/search/publ/api?q=${encodeURIComponent(request.query)}&format=json&h=${max}&f=0`
    const result = await this.get(url, signal)
    this.throwIfUnavailable(result.statusCode, url)
    let parsed: unknown
    try {
      parsed = JSON.parse(new TextDecoder().decode(result.body))
    } catch (error: unknown) {
      throw new LiteratureError('dblp returned an invalid search response', 'LITERATURE_FETCH_FAILED', { cause: error })
    }
    return infoOf(parsed).map(fromHitInfo)
  }

  /** Throw the seam's failure code for a non-200 search response. */
  private throwIfUnavailable(statusCode: number, url: string): void {
    if (statusCode === 200) return
    if (isRateLimited(statusCode)) {
      throw new LiteratureError(`dblp throttled the search: ${url}`, 'LITERATURE_RATE_LIMITED')
    }
    throw new LiteratureError(`dblp search failed with status ${statusCode}: ${url}`, 'LITERATURE_FETCH_FAILED')
  }

  async lookup(ref: LiteratureRef, signal?: AbortSignal): Promise<RawHit | null> {
    if (ref.kind !== 'dblp') return null
    await this.throttle()
    const url = `${this.baseUrl}/rec/${encodePathSegments(ref.dblpKey)}.xml`
    const result = await this.get(url, signal)
    if (result.statusCode !== 200) return null
    const record = parseRecordXml(new TextDecoder().decode(result.body), ref.dblpKey)
    const doi = record.ee !== undefined ? parseDoi(record.ee) ?? undefined : undefined
    const arxivId = corrKeyToArxivId(ref.dblpKey) ?? undefined
    return compact({
      source: 'dblp',
      title: normalizeTitle(record.title),
      rawTitle: record.title,
      authors: record.authors,
      year: record.year,
      venue: record.venue,
      doi,
      arxivId,
      preprint: record.preprint,
      dblpKey: ref.dblpKey,
      url: record.url,
      openAccessUrl: record.ee,
    })
  }

  async bibtex(ref: LiteratureRef, signal?: AbortSignal): Promise<BibtexResult | null> {
    if (ref.kind !== 'dblp') return null
    await this.throttle()
    const url = `${this.baseUrl}/rec/${encodePathSegments(ref.dblpKey)}.bib?param=1`
    const result = await this.get(url, signal)
    if (result.statusCode !== 200) return null
    const bibtex = new TextDecoder().decode(result.body).trim()
    if (bibtex.length === 0) return null
    const corr = corrKeyToArxivId(ref.dblpKey) !== null
    return {
      bibtex,
      source: corr ? 'dblp-corr' : 'dblp-formal',
      published: !corr,
    }
  }

  private get(url: string, signal?: AbortSignal): ReturnType<typeof httpGet> {
    return httpGet(url, this.limits, signal)
  }
}
