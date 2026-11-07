/**
 * SageMath reference search engine — clean-room TypeScript implementation of
 * the lookup scoring contract described by the VeryMath `sage_ref_search.py`
 * behavior (query/term scoring weights, excerpt extraction). No GPLv3 code is
 * copied: this module only implements a documented scoring shape against a
 * CC BY-SA corpus (SageMath official docs) that the user places outside the
 * package (default `~/.verymath/sagemath-corpus`).
 * @module @eduwork/dsh-verymath/core
 */
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import readline from 'node:readline'
import { VeryMathError } from './error.ts'

/** Default corpus root (user-side, outside the npm package). */
export function defaultCorpusRoot(): string {
  const env = process.env.VERYMATH_SAGE_CORPUS
  return env !== undefined && env.length > 0 ? resolve(env) : join(homedir(), '.verymath', 'sagemath-corpus')
}

/** One manifest row (subset of fields the scorer uses). */
export interface SageRefRow {
  readonly path: string
  readonly api_path: string
  readonly domain: string
  readonly title: string
  readonly symbols: readonly string[]
  readonly methods: readonly string[]
  readonly headings: readonly string[]
  readonly preview: string
  readonly examples: readonly string[]
  readonly bytes: number
  readonly lines: number
}

/** One scored search hit. */
export interface SageRefHit {
  readonly row: SageRefRow
  readonly score: number
  readonly excerpt: string
}

/** Resolve and validate the corpus root: manifest + api/ must exist. */
export async function resolveCorpusRoot(configured?: string): Promise<string> {
  const root = configured !== undefined && configured.length > 0 ? resolve(configured) : defaultCorpusRoot()
  const manifestPath = join(root, 'reference_manifest.jsonl')
  try {
    const info = await stat(manifestPath)
    if (!info.isFile()) throw new Error('manifest is not a file')
  } catch (error) {
    throw new VeryMathError(
      `SageMath reference corpus not found at ${root} (expected reference_manifest.jsonl + api/). ` +
        'Place the SageMath docs corpus there, or set VERYMATH_SAGE_CORPUS. ' +
        'The corpus is SageMath official documentation (CC BY-SA 3.0) and is distributed separately from this MIT package.',
      'VERYMATH_SAGE_CORPUS_MISSING',
      { cause: error },
    )
  }
  return root
}

/** Tokenize a query into lowercase terms (>1 char, alphanumeric+underscore). */
export function termsFor(query: string): string[] {
  return (query.match(/[A-Za-z0-9_]+/g) ?? [])
    .filter(term => term.length > 1)
    .map(term => term.toLowerCase())
}

/**
 * Score one manifest row against the query, mirroring the documented weight
 * table: exact-substring boosts on title/path/symbols/methods/headings/preview
 * plus per-term additive scores capped on full-text repetition.
 */
export function scoreRow(row: SageRefRow, query: string, terms: readonly string[], text: string): number {
  const queryLower = query.toLowerCase().trim()
  const title = row.title.toLowerCase()
  const path = row.api_path.toLowerCase()
  const symbols = row.symbols.join(' ').toLowerCase()
  const methods = row.methods.join(' ').toLowerCase()
  const headings = row.headings.join(' ').toLowerCase()
  const preview = row.preview.toLowerCase()
  const textLower = text.toLowerCase()

  let score = 0
  if (queryLower.length > 0) {
    if (title.includes(queryLower)) score += 90
    if (path.includes(queryLower)) score += 70
    if (symbols.includes(queryLower)) score += 80
    if (methods.includes(queryLower)) score += 75
    if (headings.includes(queryLower)) score += 55
    if (preview.includes(queryLower)) score += 35
    if (textLower.includes(queryLower)) score += 25
  }
  for (const term of terms) {
    if (title.includes(term)) score += 16
    if (symbols.includes(term)) score += 12
    if (methods.includes(term)) score += 10
    if (path.includes(term)) score += 8
    if (headings.includes(term)) score += 6
    if (preview.includes(term)) score += 4
    const count = textLower.split(term).length - 1
    if (count > 0) score += Math.min(18, count)
  }
  return score
}

/** Extract a numbered context snippet around the first match in a document. */
export function findExcerpt(lines: readonly string[], query: string, terms: readonly string[], context = 2): string {
  const queryLower = query.toLowerCase().trim()
  for (const [index, line] of lines.entries()) {
    const lowered = line.toLowerCase()
    if ((queryLower.length > 0 && lowered.includes(queryLower)) || terms.some(term => lowered.includes(term))) {
      const start = Math.max(0, index - context)
      const stop = Math.min(lines.length, index + context + 1)
      const snippet: string[] = []
      for (let lineno = start; lineno < stop; lineno += 1) {
        const value = lines[lineno]?.replace(/\s+$/u, '') ?? ''
        if (value.length > 0) snippet.push(`${lineno + 1}: ${value}`)
      }
      return snippet.join('\n')
    }
  }
  return ''
}

/** Parse one JSONL manifest line into a row (tolerating absent optional fields). */
function parseRow(value: unknown): SageRefRow {
  const record = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const asArray = (input: unknown): string[] =>
    Array.isArray(input) ? input.map(item => String(item)) : []
  return {
    path: String(record.path ?? ''),
    api_path: String(record.api_path ?? ''),
    domain: String(record.domain ?? ''),
    title: String(record.title ?? ''),
    symbols: asArray(record.symbols),
    methods: asArray(record.methods),
    headings: asArray(record.headings),
    preview: String(record.preview ?? ''),
    examples: asArray(record.examples),
    bytes: Number(record.bytes ?? 0),
    lines: Number(record.lines ?? 0),
  }
}

/**
 * Load the full manifest (3196 rows, ~4.6MB JSONL — parsed per call; callers
 * batching multiple queries should hold the result).
 */
export async function loadManifest(corpusRoot?: string): Promise<SageRefRow[]> {
  const root = await resolveCorpusRoot(corpusRoot)
  const raw = await readFile(join(root, 'reference_manifest.jsonl'), 'utf8')
  const rows: SageRefRow[] = []
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue
    try {
      rows.push(parseRow(JSON.parse(line)))
    } catch {
      // Skip malformed lines rather than failing the whole manifest.
    }
  }
  return rows
}

/** Resolve a manifest `path` (which carries a `references/api/` prefix) against the corpus root. */
export function docPath(root: string, row: Pick<SageRefRow, 'path'>): string {
  const stripped = row.path.replace(/^references\//u, '')
  return join(root, stripped)
}

/** Read one corpus document as text + line array. */
export async function readCorpusDoc(root: string, row: SageRefRow): Promise<{ text: string, lines: string[] }> {
  const text = await readFile(docPath(root, row), 'utf8')
  return { text, lines: text.split('\n') }
}

/** Read only the lines around `aroundLine` (1-based) from a large corpus doc. */
export async function readCorpusDocWindow(
  root: string,
  row: SageRefRow,
  aroundLine: number,
  windowSize = 40,
): Promise<string[]> {
  const lines: string[] = []
  const start = Math.max(1, aroundLine - windowSize)
  const stop = aroundLine + windowSize
  const stream = createReadStream(docPath(root, row), { encoding: 'utf8' })
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity })
  let lineno = 0
  for await (const line of reader) {
    lineno += 1
    if (lineno < start) continue
    lines.push(line)
    if (lineno >= stop) break
  }
  return lines
}

/**
 * Search the corpus: score every manifest row (title/path/symbols/methods/
 * headings/preview against the manifest's own metadata — no doc reads for
 * scoring), take the top hits, then load excerpts for the best `withExcerpts`.
 * @param rows - manifest rows (from {@link loadManifest}).
 * @param query - user query, e.g. "elliptic curve rank" or "solve ODE".
 * @param options - result cap (default 8) and how many excerpts to extract (default 3).
 */
export async function searchSageRefs(
  rows: readonly SageRefRow[],
  query: string,
  options: { readonly limit?: number; readonly withExcerpts?: number; readonly corpusRoot?: string } = {},
): Promise<SageRefHit[]> {
  const limit = options.limit ?? 8
  const withExcerpts = options.withExcerpts ?? 3
  const terms = termsFor(query)
  const scored = rows
    .map(row => ({ row, score: scoreRow(row, query, terms, row.preview) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
  if (withExcerpts <= 0) return scored.map(item => ({ row: item.row, score: item.score, excerpt: '' }))
  const root = await resolveCorpusRoot(options.corpusRoot)
  const hits: SageRefHit[] = []
  for (const [index, item] of scored.entries()) {
    let excerpt = ''
    if (index < withExcerpts) {
      try {
        const doc = await readCorpusDoc(root, item.row)
        excerpt = findExcerpt(doc.lines, query, terms)
      } catch {
        excerpt = ''
      }
    }
    hits.push({ row: item.row, score: item.score, excerpt })
  }
  return hits
}
