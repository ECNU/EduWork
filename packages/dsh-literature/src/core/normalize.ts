/**
 * Pure, source-independent normalization and identifier recognition for the
 * literature seam: title canonicalization, arXiv/dblp/DOI/URL recognition, and
 * the dblp CoRR↔arXiv key bridge.
 * @module @eduwork/dsh-literature/core/normalize
 */

/** arXiv identifier as the model or a source reports it (no `arXiv:` prefix). */
export type ArxivId = string

/** dblp record key (`conf/…`, `journals/…`, `journals/corr/abs-…`). */
export type DblpKey = string

/**
 * Strip LaTeX/HTML punctuation to a comparable title key. Letters, digits,
 * whitespace, and the sign characters `+` `#` `&` survive, so titles that
 * differ only in those signs (e.g. `C++` vs `C#` vs `C`) stay distinct.
 * @param title - the title to canonicalize
 * @returns the normalized title key
 */
export function normalizeTitle(title: string): string {
  return title
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s+#&]/gu, ' ')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

/** New-style arXiv id `YYMM.NNNNN` with an optional `vN` version suffix. */
const NEW_ARXIV_ID = /^\d{4}\.\d{4,5}(?:v\d+)?$/u

/** Old-style arXiv id `cat/YYMMNNN` (category prefix, then a 7-digit number). */
const OLD_ARXIV_ID = /^[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?$/u

/** dblp key prefixes that name a record tree. */
const DBLP_KEY_PREFIXES = /^(?:conf|journals|books|series|phd|reference|tr|ms|www|persons)\//u

/** CoRR record key `journals/corr/abs-YYMM-NNNN(N)`. */
const CORR_KEY = /^journals\/corr\/abs-(\d{4})-(\d{4,5})$/u

/** DOI `10.xxxx/…`. */
const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/u

/** Strip an optional `arXiv:` prefix and any `vN` version suffix. */
function stripVersion(id: string): string {
  return id.replace(/v\d+$/u, '')
}

/**
 * Percent-encode one value for use as a URL path segment while preserving
 * `/` separators: dblp record keys (`conf/…`) and old-style arXiv ids
 * (`cat/YYMMNNN`) are multi-segment paths whose slashes must stay literal.
 * @param value - the key or id to encode.
 * @returns the encoded path.
 */
export function encodePathSegments(value: string): string {
  return value.split('/').map(segment => encodeURIComponent(segment)).join('/')
}

/** Whether the input names a new-style arXiv id and, if so, return its bare form.
 * @param input - the candidate string
 * @returns the bare arXiv id, or null
 */
export function parseNewArxivId(input: string): ArxivId | null {
  const candidate = input.replace(/^arXiv:/iu, '').trim()
  if (!NEW_ARXIV_ID.test(candidate)) return null
  return stripVersion(candidate)
}

/** Whether the input names an old-style arXiv id and, if so, return its bare form.
 * @param input - the candidate string
 * @returns the bare arXiv id, or null
 */
export function parseOldArxivId(input: string): ArxivId | null {
  const candidate = input.replace(/^arXiv:/iu, '').trim()
  if (!OLD_ARXIV_ID.test(candidate)) return null
  return stripVersion(candidate)
}

/** Whether the input names either arXiv id form, returning its bare id.
 * @param input - the candidate string
 * @returns the bare arXiv id, or null
 */
export function parseArxivId(input: string): ArxivId | null {
  return parseNewArxivId(input) ?? parseOldArxivId(input)
}

/** Whether the input names a dblp record key.
 * @param input - the candidate string
 * @returns whether it names a dblp key
 */
export function isDblpKey(input: string): boolean {
  return DBLP_KEY_PREFIXES.test(input.trim())
}

/** Derive the arXiv id from a dblp CoRR key, or `null` when it is not CoRR.
 * @param key - the dblp key
 * @returns the derived arXiv id, or null
 */
export function corrKeyToArxivId(key: DblpKey): ArxivId | null {
  const match = CORR_KEY.exec(key.trim())
  return match === null ? null : `${match[1]}.${match[2]}`
}

/**
 * Derive the dblp CoRR key for a new-style arXiv id, or `null` for old-style
 * ids whose CoRR key form is not a direct rewrite.
 * @param arxivId - the bare arXiv id (`YYMM.NNNNN`).
 * @returns the dblp CoRR key, or null
 */
export function arxivIdToCorrKey(arxivId: ArxivId): DblpKey | null {
  const bare = parseNewArxivId(arxivId)
  if (bare === null) return null
  return `journals/corr/abs-${bare.replace('.', '-')}`
}

/** Extract a DOI from a bare input, or `null`.
 * @param input - the candidate string
 * @returns the lowercased DOI, or null
 */
export function parseDoi(input: string): string | null {
  const candidate = input.replace(/^doi:/iu, '').replace(/^https?:\/\/doi\.org\//iu, '').trim()
  return DOI_PATTERN.test(candidate) ? candidate.toLowerCase() : null
}

/** Whether the input is an http(s) URL.
 * @param input - the candidate string
 * @returns whether it is an http(s) URL
 */
export function isHttpUrl(input: string): boolean {
  return /^https?:\/\//iu.test(input.trim())
}

/**
 * A stable synthetic id the model may echo back to the bibtex/fulltext tools.
 * Prefer the arXiv id (enables full text), then the dblp key, then the DOI,
 * then the normalized title.
 * @param parts - the record identity fields
 * @returns the stable synthetic id
 */
export function stableRecordId(parts: {
  readonly arxivId: string | undefined
  readonly dblpKey: string | undefined
  readonly doi: string | undefined
  readonly title: string
}): string {
  if (parts.arxivId !== undefined) return `arxiv:${parts.arxivId}`
  if (parts.dblpKey !== undefined) return `dblp:${parts.dblpKey}`
  if (parts.doi !== undefined) return `doi:${parts.doi}`
  return `title:${normalizeTitle(parts.title)}`
}
