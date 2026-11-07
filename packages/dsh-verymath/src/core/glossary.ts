/**
 * Bilingual glossary data model aligned with the upstream VeryMath
 * `math-glossary` contract (glossary.schema.json v1): an array of term
 * entries sorted by (en, cn) with contiguous 1-based `idx` numbering,
 * plus the cross-entry invariants the upstream contract requires.
 * @module @eduwork/dsh-verymath/core
 */
import { VeryMathError } from './error.ts'

/** One bilingual term entry (upstream `math-glossary` contract). */
export interface GlossaryTerm {
  /** Unique id: lowercased `en`, with an `__N` suffix on alias rows. */
  readonly term_id: string
  /** English term as written in the source. */
  readonly en: string
  /** Chinese translation; on alias rows this is the alias. */
  readonly cn: string
  /** Optional 1-based contiguous position after sorting. */
  readonly idx?: number
  /** Optional part of speech in Chinese (名词 / 动词 / …). */
  readonly pos?: string
  /** Optional subfields, multi-value (代数拓扑, 拓扑学…). */
  readonly field?: readonly string[]
  /** Optional source reference label. */
  readonly source?: string
  /** Optional bilingual example sentences. */
  readonly examples?: readonly { readonly en: string; readonly cn: string }[]
  /** ISO date (YYYY-MM-DD). */
  readonly created_at: string
  /** ISO date (YYYY-MM-DD). */
  readonly updated_at: string
}

/** Parse a loose value into a glossary term entry, or return a problem description. */
function coerceTerm(value: unknown): { term: GlossaryTerm } | { problem: string } {
  if (typeof value !== 'object' || value === null) return { problem: `entry is ${describe(value)}, expected an object` }
  const record = value as Record<string, unknown>
  const problems: string[] = []
  for (const field of ['term_id', 'en', 'cn', 'created_at', 'updated_at'] as const) {
    if (typeof record[field] !== 'string' || (record[field] as string).length === 0) {
      problems.push(`${field} must be a non-empty string`)
    }
  }
  if (problems.length > 0) return { problem: problems.join('; ') }
  // Build the complete entry in one pass: GlossaryTerm fields are readonly,
  // so optional fields are included up front instead of assigned afterwards.
  const fields = Array.isArray(record.field)
    ? record.field.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : []
  const examples = Array.isArray(record.examples)
    ? record.examples.flatMap((entry) => {
        if (typeof entry !== 'object' || entry === null) return []
        const example = entry as Record<string, unknown>
        if (typeof example.en !== 'string' || typeof example.cn !== 'string') return []
        return [{ en: example.en, cn: example.cn }]
      })
    : []
  const term: GlossaryTerm = {
    term_id: record.term_id as string,
    en: record.en as string,
    cn: record.cn as string,
    ...(typeof record.idx === 'number' ? { idx: record.idx } : {}),
    ...(typeof record.pos === 'string' && record.pos.length > 0 ? { pos: record.pos } : {}),
    ...(typeof record.source === 'string' && record.source.length > 0 ? { source: record.source } : {}),
    ...(fields.length > 0 ? { field: fields } : {}),
    ...(examples.length > 0 ? { examples } : {}),
    created_at: record.created_at as string,
    updated_at: record.updated_at as string,
  }
  return { term }
}

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return typeof value
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Whether a value parses as a complete validated glossary document. */
export function parseGlossary(value: unknown): GlossaryTerm[] {
  if (!Array.isArray(value)) {
    throw new VeryMathError(`glossary document must be an array, got ${describe(value)}`, 'VERYMATH_GLOSSARY_INVALID')
  }
  const terms: GlossaryTerm[] = []
  for (const [index, entry] of value.entries()) {
    const result = coerceTerm(entry)
    if ('problem' in result) {
      throw new VeryMathError(`glossary entry ${index}: ${result.problem}`, 'VERYMATH_GLOSSARY_INVALID')
    }
    terms.push(result.term)
  }
  return terms
}

/**
 * Sort terms by (en, cn) using stable code-point order and reassign
 * contiguous 1-based `idx` values, the upstream write-path invariant.
 * @param terms - terms in any order; the input is not mutated.
 * @returns a new sorted array with `idx` reassigned.
 */
export function sortGlossary(terms: readonly GlossaryTerm[]): GlossaryTerm[] {
  const sorted = [...terms].sort((left, right) =>
    compareCodePoints(left.en, right.en) || compareCodePoints(left.cn, right.cn),
  )
  return sorted.map((term, index) => ({ ...term, idx: index + 1 }))
}

function compareCodePoints(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

/** Validate the cross-entry invariants of a stored glossary document. */
export function validateGlossaryInvariants(terms: readonly GlossaryTerm[]): void {
  const seen = new Map<string, number>()
  for (const term of terms) {
    seen.set(term.term_id, (seen.get(term.term_id) ?? 0) + 1)
    for (const field of ['created_at', 'updated_at'] as const) {
      if (!ISO_DATE.test(term[field])) {
        throw new VeryMathError(`term ${term.term_id}: ${field} must be YYYY-MM-DD`, 'VERYMATH_GLOSSARY_INVALID')
      }
    }
  }
  const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id)
  if (duplicates.length > 0) {
    throw new VeryMathError(`duplicate term_id values: ${duplicates.join(', ')}`, 'VERYMATH_GLOSSARY_INVALID')
  }
  const ids = terms.map(term => term.idx).filter(index => index !== undefined)
  if (ids.length > 0) {
    const expected = terms.map((_, index) => index + 1)
    const actual = ids
    const contiguous = actual.length === terms.length && actual.every((value, index) => value === expected[index])
    if (!contiguous) {
      throw new VeryMathError('idx numbering must be contiguous 1-based over the sorted document', 'VERYMATH_GLOSSARY_INVALID')
    }
  }
}

/** One glossary query hit. */
export interface GlossaryHit {
  readonly term: GlossaryTerm
  /** Which field matched: en (exact), en-prefix, cn, field, or term_id. */
  readonly matchedBy: 'en' | 'en-prefix' | 'cn' | 'field' | 'term_id'
}

/** Options for {@link queryGlossary}. */
export interface GlossaryQueryOptions {
  /** Maximum hits returned (default 20). */
  readonly limit?: number
  /** Restrict candidates to terms whose `field` array contains this subfield exactly (upstream usage-guide disambiguation strategy 2). */
  readonly field?: string
}

/**
 * Query a parsed glossary: exact en/cn match first, then prefix, substring,
 * and subfield hits. `total` is the deduplicated candidate count before the
 * limit cut, so callers can detect truncation.
 * @param terms - validated glossary terms.
 * @param query - an English/Chinese term, a term_id, or a subfield name.
 * @param options - limit and optional subfield disambiguation filter; a bare
 *   number is accepted as the limit for backwards compatibility.
 */
export function queryGlossary(terms: readonly GlossaryTerm[], query: string, options: GlossaryQueryOptions | number = {}): { hits: GlossaryHit[], total: number } {
  const opts = typeof options === 'number' ? { limit: options } : options
  const limit = opts.limit ?? 20
  const fieldFilter = opts.field?.trim()
  const candidates = fieldFilter !== undefined && fieldFilter.length > 0
    ? terms.filter(term => term.field?.includes(fieldFilter) === true)
    : terms
  const needle = query.trim()
  if (needle.length === 0) return { hits: [], total: 0 }
  const lower = needle.toLowerCase()
  const hits: GlossaryHit[] = []
  const matched = new Set<string>()
  let total = 0
  const push = (term: GlossaryTerm, matchedBy: GlossaryHit['matchedBy']) => {
    if (matched.has(term.term_id)) return
    matched.add(term.term_id)
    total += 1
    if (hits.length < limit) hits.push({ term, matchedBy })
  }
  for (const term of candidates) {
    if (term.en.toLowerCase() === lower || term.cn === needle) push(term, 'en')
    else if (term.term_id.toLowerCase() === lower) push(term, 'term_id')
  }
  for (const term of candidates) {
    if (term.en.toLowerCase().startsWith(lower)) push(term, 'en-prefix')
  }
  for (const term of candidates) {
    if (term.cn.includes(needle)) push(term, 'cn')
  }
  for (const term of candidates) {
    if (term.field?.some(entry => entry === needle || entry.includes(needle))) push(term, 'field')
  }
  return { hits, total }
}

/** One term upsert request for {@link upsertTerms}. */
export interface TermUpsert {
  /** English term. */
  readonly en: string
  /** Chinese translation (or alias). */
  readonly cn: string
  /** Optional part of speech in Chinese. */
  readonly pos?: string
  /** Optional subfields. */
  readonly field?: readonly string[]
  /** Optional source label. */
  readonly source?: string
  /** Optional bilingual example. */
  readonly example?: { readonly en: string; readonly cn: string }
}

/** Result of one upsert batch. */
export interface UpsertResult {
  /** New terms that did not exist before (by term_id). */
  readonly added: readonly string[]
  /** Existing terms whose cn/pos/field/source/examples were overwritten. */
  readonly updated: readonly string[]
  /** The complete re-sorted document ready to write (idx reassigned, today's dates on changed rows). */
  readonly document: GlossaryTerm[]
}

const UPSERT_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Today as an ISO date (upsert stamps updated_at/created_at). */
function todayIso(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** Optional-field merge: keep the request value, else keep the existing one. */
function keepOr<T>(request: T | undefined, existing: T | undefined): T | undefined {
  return request !== undefined ? request : existing
}

/**
 * Merge upsert requests into an existing glossary per the upstream contract:
 * term_id is the lowercased en for the primary translation and `en__N` for
 * additional alias rows of the same en; an existing term with the same
 * (term_id) is updated in place; the merged document is re-sorted by
 * (en, cn) with contiguous idx. The input document is never mutated.
 * @param terms - current glossary terms (any order).
 * @param upserts - terms to add or update.
 * @throws VeryMathError when the merged document breaks an invariant.
 */
export function upsertTerms(terms: readonly GlossaryTerm[], upserts: readonly TermUpsert[]): UpsertResult {
  const today = todayIso()
  for (const date of [today]) {
    if (!UPSERT_DATE.test(date)) {
      throw new VeryMathError('system date is not ISO; refusing to stamp terms', 'VERYMATH_GLOSSARY_INVALID')
    }
  }
  const byId = new Map(terms.map(term => [term.term_id, { ...term }]))
  const added: string[] = []
  const updated: string[] = []
  for (const request of upserts) {
    const en = request.en.trim()
    const cn = request.cn.trim()
    if (en.length === 0 || cn.length === 0) {
      throw new VeryMathError('upsert requires non-empty en and cn', 'VERYMATH_GLOSSARY_INVALID')
    }
    const termId = en.toLowerCase()
    const existing = byId.get(termId)
    const field = request.field !== undefined && request.field.length > 0 ? [...request.field] : undefined
    const examples = request.example !== undefined ? [{ ...request.example }] : undefined
    if (existing !== undefined) {
      const pos = keepOr(request.pos, existing.pos)
      const mergedField = keepOr(field, existing.field)
      const source = keepOr(request.source, existing.source)
      const mergedExamples = keepOr(examples, existing.examples)
      byId.set(termId, {
        ...existing,
        cn,
        ...(pos !== undefined ? { pos } : {}),
        ...(mergedField !== undefined ? { field: mergedField } : {}),
        ...(source !== undefined ? { source } : {}),
        ...(mergedExamples !== undefined ? { examples: mergedExamples } : {}),
        updated_at: today,
      })
      updated.push(termId)
    } else {
      byId.set(termId, {
        term_id: termId,
        en,
        cn,
        ...(request.pos !== undefined ? { pos: request.pos } : {}),
        ...(field !== undefined ? { field } : {}),
        ...(request.source !== undefined ? { source: request.source } : {}),
        ...(examples !== undefined ? { examples } : {}),
        created_at: today,
        updated_at: today,
      })
      added.push(termId)
    }
  }
  const document = sortGlossary([...byId.values()])
  validateGlossaryInvariants(document)
  return { added, updated, document }
}
