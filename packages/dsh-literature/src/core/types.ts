/**
 * Shared vocabulary for the literature capability seam: source identifiers,
 * normalized records, requests/results, and the provider interface.
 * @module @eduwork/dsh-literature/core/types
 */

/** Stable source identifiers registered on the literature seam. */
export type LiteratureSourceId = 'dblp' | 'arxiv'

/** One normalized bibliography hit produced by a source search. */
export interface RawHit {
  /** Source that produced this hit. */
  readonly source: LiteratureSourceId
  /** Source-independent normalized title (trimmed, trailing sentence punctuation dropped). */
  readonly title: string
  /** Source-native title as returned (may carry TeX or HTML entities). */
  readonly rawTitle: string
  readonly authors: readonly string[]
  readonly year?: number
  /** Venue name (`ACL`, `CoRR`, a journal name) without volume/number. */
  readonly venue?: string
  /** Publisher DOI (`10.xxxx/…`), distinct from arXiv's `10.48550` DataCite DOI. */
  readonly doi?: string
  /** arXiv identifier (`YYMM.NNNNN`, or an old-style `cat/YYMMNNN`). */
  readonly arxivId?: string
  /** True for a preprint/informal record (dblp CoRR or arXiv-only). */
  readonly preprint: boolean
  /** dblp record key (`conf/…`, `journals/…`), present only on dblp hits. */
  readonly dblpKey?: string
  /** Primary landing link (dblp rec page or arXiv abs page). */
  readonly url?: string
  /** Open-access electronic-edition link when the source provides one. */
  readonly openAccessUrl?: string
  /** Abstract, when the source carries one (arXiv). */
  readonly abstract?: string
}

/** A merged canonical record across one or both sources. */
export interface LiteratureRecord {
  /** Stable synthetic id; the model may pass it back to the bibtex/fulltext tools. */
  readonly id: string
  /** Normalized title (lowercase, punctuation stripped); the dedupe and BM25 key. */
  readonly title: string
  /** Source-native title for display (original case and punctuation), when a source carried one. */
  readonly rawTitle?: string
  readonly authors: readonly string[]
  readonly year?: number
  readonly venue?: string
  readonly doi?: string
  readonly arxivId?: string
  readonly dblpKey?: string
  /** True when a formal (published) dblp record contributed to this record. */
  readonly published: boolean
  /** Which sources contributed. */
  readonly sources: readonly LiteratureSourceId[]
  readonly url?: string
  readonly openAccessUrl?: string
  readonly abstract?: string
}

/** A resolved reference the provider methods key off of. */
export type LiteratureRef =
  | { readonly kind: 'arxiv'; readonly arxivId: string }
  | { readonly kind: 'dblp'; readonly dblpKey: string }
  | { readonly kind: 'doi'; readonly doi: string }
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'title'; readonly title: string }

/** Search request vocabulary. */
export interface LiteratureSearchRequest {
  /** Free-form query (title words, author, keywords). */
  readonly query: string
  readonly maxResults?: number
  /** Exact-phrase search; sources that support it quote the query (used by exact-title resolution). */
  readonly phrase?: boolean
}

/** Search result vocabulary. */
export interface LiteratureSearchResult {
  readonly records: readonly LiteratureRecord[]
  readonly total: number
  /** True when `records` was truncated to `maxResults` after merging. */
  readonly truncated: boolean
}

/** Which source supplied a BibTeX entry. */
export type BibtexSource = 'dblp-formal' | 'dblp-corr' | 'arxiv'

/** BibTeX result vocabulary. */
export interface BibtexResult {
  readonly bibtex: string
  readonly source: BibtexSource
  /** True when the entry reflects a formal (published) record. */
  readonly published: boolean
  /** Optional human-facing caveat (e.g. arXiv-year unreliability). */
  readonly note?: string
}

/** One extracted text file the full-text tool should persist through `ctx.fs`. */
export interface LiteratureFulltextFile {
  /** Path relative to the extracted tree root. */
  readonly path: string
  readonly kind: 'tex' | 'bib' | 'markdown' | 'text' | 'other'
  /** Bounded text content (already capped by the service config). */
  readonly content: string
}

/** Where a successful full-text acquisition came from. */
export type FulltextSource = 'arxiv-source' | 'arxiv-html' | 'arxiv-pdf' | 'publisher-pdf'

/** The full-text artifact kinds a source can download. */
export type FulltextArtifactKind = 'source' | 'html' | 'pdf'

/** Full-text result vocabulary: always extracted body text. */
export interface FulltextResult {
  /** Stable id of the resolved record (or the explicit PDF URL), used as the workspace subdirectory name. */
  readonly id: string
  readonly kind: 'fulltext'
  readonly source?: FulltextSource
  readonly files: readonly LiteratureFulltextFile[]
  /** Bounded readable extraction (abstract or body prose). */
  readonly summary: string
}

/** Provider interface a source implements to join the seam. */
export interface LiteratureSource {
  readonly id: LiteratureSourceId
  /** Cheap local availability check; must not make network calls. */
  available(): boolean
  /** Search this source and return normalized hits. */
  search(request: LiteratureSearchRequest, signal?: AbortSignal): Promise<readonly RawHit[]>
  /** Exact-identifier lookup (dblp by key, arXiv by id), or `null` when the source has no such record. */
  lookup(ref: LiteratureRef, signal?: AbortSignal): Promise<RawHit | null>
  /** Fetch BibTeX for a resolved reference this source understands, or `null` when it has no such record. */
  bibtex(ref: LiteratureRef, signal?: AbortSignal): Promise<BibtexResult | null>
  /** Download one full-text artifact for an arXiv id, or `null` when the source has none (arXiv only). */
  downloadFulltext?(arxivId: string, kind: FulltextArtifactKind, signal?: AbortSignal): Promise<Uint8Array | null>
}
