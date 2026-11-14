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
    // An exact Chinese hit is a Chinese match, not an English one: labelling it
    // `en` made the hit contradict the query the caller sent (querying 流形
    // returned matchedBy 'en').
    if (term.en.toLowerCase() === lower) push(term, 'en')
    else if (term.term_id.toLowerCase() === lower) push(term, 'term_id')
    else if (term.cn === needle) push(term, 'cn')
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
  /**
   * Target row for a correction: when present, the row with this `term_id` is
   * updated in place. Its Chinese translation and the optional fields given are
   * rewritten; its `en` must already match the request's `en`
   * (case-insensitively) and is never rewritten, because renaming a term is not
   * supported here. When absent, the request matches an existing row by the
   * exact `(en, cn)` pair and otherwise adds an alias row.
   */
  readonly term_id?: string
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
  /** term_ids created by this batch (primary rows and `en__N` alias rows). */
  readonly added: readonly string[]
  /** term_ids whose cn/pos/field/source/examples were overwritten, in request order. */
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
 * Merge upsert requests into an existing glossary per the upstream contract.
 *
 * Identity is resolved in this order, which is also what the tool description
 * tells the model:
 *
 * 1. An explicit `term_id` selects that row (the correction path). It must
 *    exist, and its `en` must match the request's `en` case-insensitively:
 *    this function never renames a term or moves a row to another English term.
 * 2. Otherwise the exact `(en case-insensitive, cn exact)` pair selects the row
 *    that already holds that translation, so re-adding a term is idempotent. If
 *    several rows hold that pair the request is rejected as ambiguous rather
 *    than silently picking one.
 * 3. Otherwise a new row is created. Its id continues the upstream alias
 *    sequence for that English term (the lowercased `en`, then `en__1`, …) and
 *    skips ids any other row already uses. This is what keeps two translations
 *    of the same English term as two rows, as `glossary-schema.md` requires,
 *    instead of overwriting the existing translation.
 *
 * The merged document is re-sorted by `(en, cn)` with contiguous `idx`, and the
 * input document is never mutated. Every request is validated by the same
 * rules, so a batch either applies completely or throws.
 *
 * `en` comparison uses `toLowerCase()`, matching how ids are derived; upstream
 * Python uses `casefold()`, so exotic multi-character foldings (e.g. `ß` → `ss`)
 * are not treated as equal here. Glossaries are built from one or the other
 * path, and within a single path the comparison is self-consistent.
 *
 * @param terms - current glossary terms (any order).
 * @param upserts - terms to add or correct.
 * @throws VeryMathError when the input document already breaks an invariant,
 *   when a request names an unknown or blank `term_id`, when the `term_id`
 *   belongs to a different English term, when an address is ambiguous, or when
 *   a correction would duplicate another row's `(en, cn)` pair.
 */
export function upsertTerms(terms: readonly GlossaryTerm[], upserts: readonly TermUpsert[]): UpsertResult {
  const today = todayIso()
  if (!UPSERT_DATE.test(today)) {
    throw new VeryMathError('system date is not ISO; refusing to stamp terms', 'VERYMATH_GLOSSARY_INVALID')
  }
  // Validate before indexing: building the Map first silently drops a row when
  // the input carries a duplicate term_id, which then makes the closing
  // invariant check unable to see the loss it was supposed to report.
  validateGlossaryInvariants(terms)
  const byId = new Map<string, GlossaryTerm>(terms.map(term => [term.term_id, { ...term }]))
  // Exact (en case-insensitive, cn exact) -> term_ids carrying that translation.
  // A list, not a single id: a document can legally hold the same pair twice, and
  // that has to be reported as ambiguous instead of resolved by luck.
  const pairIndex = new Map<string, string[]>()
  const indexPair = (term: GlossaryTerm): void => {
    const key = pairKey(term.en, term.cn)
    const ids = pairIndex.get(key)
    if (ids === undefined) pairIndex.set(key, [term.term_id])
    else ids.push(term.term_id)
  }
  for (const term of byId.values()) indexPair(term)
  const added: string[] = []
  const updated: string[] = []
  // A row created by this batch and then touched again by a later request in the
  // same batch is reported as added only: it did not exist before, so counting it
  // as updated too would make one row look like two changes.
  const recordUpdate = (termId: string): void => {
    if (added.includes(termId)) return
    if (!updated.includes(termId)) updated.push(termId)
  }

  for (const request of upserts) {
    const en = request.en.trim()
    const cn = request.cn.trim()
    if (en.length === 0 || cn.length === 0) {
      throw new VeryMathError('upsert requires non-empty en and cn', 'VERYMATH_GLOSSARY_INVALID')
    }
    const enKey = en.toLowerCase()
    const field = request.field !== undefined && request.field.length > 0 ? [...request.field] : undefined
    const examples = request.example !== undefined ? [{ ...request.example }] : undefined
    const key = pairKey(en, cn)

    let termId: string | undefined
    if (request.term_id !== undefined) {
      // A blank id is a malformed request, not "no id": silently adding would
      // hide the caller's mistake and produce the very overwrite this exists to
      // prevent.
      if (request.term_id.trim().length === 0) {
        throw new VeryMathError(
          'upsert term_id must not be blank; omit term_id to add a translation',
          'VERYMATH_GLOSSARY_INVALID',
        )
      }
      const target = byId.get(request.term_id)
      if (target === undefined) {
        throw new VeryMathError(
          `upsert: no term with term_id ${JSON.stringify(request.term_id)}; query the glossary for the id, or omit term_id to add the translation`,
          'VERYMATH_GLOSSARY_INVALID',
        )
      }
      if (target.en.toLowerCase() !== enKey) {
        throw new VeryMathError(
          `upsert: term_id ${JSON.stringify(request.term_id)} is the English term ${JSON.stringify(target.en)}, not ${JSON.stringify(en)}; renaming or moving a term is not supported — add the new term instead`,
          'VERYMATH_GLOSSARY_INVALID',
        )
      }
      termId = target.term_id
    } else {
      const candidates = pairIndex.get(key) ?? []
      if (candidates.length > 1) {
        throw new VeryMathError(
          `upsert: ${JSON.stringify(en)} already has ${candidates.length} rows with the translation ${JSON.stringify(cn)} (${candidates.join(', ')}); pass term_id to choose one`,
          'VERYMATH_GLOSSARY_INVALID',
        )
      }
      termId = candidates[0]
    }

    if (termId === undefined) {
      const newId = nextTermId(byId, en)
      const created: GlossaryTerm = {
        term_id: newId,
        en,
        cn,
        ...(request.pos !== undefined ? { pos: request.pos } : {}),
        ...(field !== undefined ? { field } : {}),
        ...(request.source !== undefined ? { source: request.source } : {}),
        ...(examples !== undefined ? { examples } : {}),
        created_at: today,
        updated_at: today,
      }
      byId.set(newId, created)
      indexPair(created)
      added.push(newId)
      continue
    }

    const existing = byId.get(termId)
    if (existing === undefined) continue
    const previousKey = pairKey(existing.en, existing.cn)
    if (previousKey !== key) {
      // Re-point the pair index, but never let two rows end up with one pair.
      const owner = (pairIndex.get(key) ?? []).find(id => id !== termId)
      if (owner !== undefined) {
        throw new VeryMathError(
          `upsert: ${JSON.stringify(en)} / ${JSON.stringify(cn)} is already held by ${owner}; pass that term_id instead of rewriting ${termId}`,
          'VERYMATH_GLOSSARY_INVALID',
        )
      }
      const previous = pairIndex.get(previousKey)
      if (previous !== undefined) {
        const remaining = previous.filter(id => id !== termId)
        if (remaining.length === 0) pairIndex.delete(previousKey)
        else pairIndex.set(previousKey, remaining)
      }
      indexPair({ ...existing, cn })
    }
    const pos = keepOr(request.pos, existing.pos)
    const mergedField = keepOr(field, existing.field)
    const source = keepOr(request.source, existing.source)
    const mergedExamples = keepOr(examples, existing.examples)
    byId.set(termId, {
      ...existing,
      // `en` is deliberately not rewritten: a correction fixes the translation,
      // and the stored spelling of the source term is not this function's to
      // change.
      cn,
      ...(pos !== undefined ? { pos } : {}),
      ...(mergedField !== undefined ? { field: mergedField } : {}),
      ...(source !== undefined ? { source } : {}),
      ...(mergedExamples !== undefined ? { examples: mergedExamples } : {}),
      updated_at: today,
    })
    recordUpdate(termId)
  }

  const document = sortGlossary([...byId.values()])
  validateGlossaryInvariants(document)
  return { added, updated, document }
}

/**
 * Exact `(en, cn)` identity key. `en` is compared case-insensitively and `cn`
 * exactly; the pair is JSON-encoded rather than joined with a separator because
 * a separator can appear inside either string (JSON permits `\u0000`), which
 * would let two different pairs share one key and overwrite each other.
 */
function pairKey(en: string, cn: string): string {
  return JSON.stringify([en.toLowerCase(), cn])
}

/**
 * Longest numeric suffix this allocator will parse or emit. Real alias ids are
 * tiny; the bound exists only so a corrupt or hostile document cannot turn a
 * decimal parse into an expensive BigInt conversion. Parsing and emitting share
 * the bound on purpose — a generated id the parser later refuses to read back
 * would be invisible to the next allocation.
 */
const MAX_SUFFIX_DIGITS = 64

/**
 * Allocate the alias-aware `term_id` for a new row, mirroring upstream
 * `glossary_build.py`: continue from the highest suffix already observed for
 * this English term rather than filling historical gaps.
 *
 * Upstream does not restart the search at the bare id: it reads an existing
 * explicit `group__1` as "this group is at index 1" and continues from 2. So a
 * document that kept `group__1` but lost the primary row gets `group__2` next —
 * re-using `group` there would silently hand the "first occurrence" identity to
 * a later translation. Candidates already used by any other row (including a
 * custom id for a different English term) are skipped.
 *
 * The counter is a `BigInt` on purpose. With a `number`, an id such as
 * `group__9007199254740992` makes `occurrence + 1 === occurrence`, so the loop
 * stops advancing and spins forever — and this function is synchronous, so it
 * would hang the host event loop rather than throw.
 * @param byId - current rows, keyed by term_id.
 * @param en - English term of the row being created.
 */
function nextTermId(byId: ReadonlyMap<string, GlossaryTerm>, en: string): string {
  const base = en.toLowerCase()
  const used = new Set<string>()
  let occurrence = 0n
  for (const id of byId.keys()) {
    const lowered = id.toLowerCase()
    used.add(lowered)
    if (lowered === base) {
      if (occurrence < 1n) occurrence = 1n
      continue
    }
    if (!lowered.startsWith(`${base}__`)) continue
    const suffix = lowered.slice(base.length + 2)
    // A non-numeric suffix is a custom id (the upstream schema allows those), not
    // part of this English term's alias sequence.
    if (!/^\d+$/.test(suffix)) continue
    // A numeric suffix this long cannot be a real counter, and **ignoring** it
    // would hand the next translation the bare id — silently reviving the
    // "first occurrence" identity this rule exists to preserve. Refuse instead of
    // pretending the document has no suffix to continue from.
    if (suffix.length > MAX_SUFFIX_DIGITS) {
      throw new VeryMathError(
        `term_id ${JSON.stringify(id)} carries a ${suffix.length}-digit numeric suffix; refusing to allocate a further alias id for ${JSON.stringify(en)}`,
        'VERYMATH_GLOSSARY_INVALID',
      )
    }
    const next = BigInt(suffix) + 1n
    if (next > occurrence) occurrence = next
  }
  // Terminates: `occurrence` strictly increases and `used` is finite, so at most
  // |used| candidates can collide.
  for (;;) {
    // Never emit an id the loop above would itself refuse to read back.
    if (occurrence !== 0n && String(occurrence).length > MAX_SUFFIX_DIGITS) {
      throw new VeryMathError(
        `cannot allocate a further alias id for ${JSON.stringify(en)}: the suffix would exceed ${MAX_SUFFIX_DIGITS} digits`,
        'VERYMATH_GLOSSARY_INVALID',
      )
    }
    const candidate = occurrence === 0n ? base : `${base}__${occurrence}`
    if (!used.has(candidate)) return candidate
    occurrence += 1n
  }
}

/** Result of removing one row. */
export interface DeleteResult {
  /** Whether a row with that id existed. */
  readonly removed: boolean
  /** The document after removal, re-sorted with contiguous idx. */
  readonly document: GlossaryTerm[]
}

/**
 * Remove one row by `term_id`, preserving the document invariants.
 *
 * Deletion is how a duplicate or a wrong alias gets resolved: there is no
 * "merge" operation in the upstream contract, and the panel's job is to let a
 * human drop the row they decided against rather than hand-edit JSON.
 * @param terms - current glossary terms (any order).
 * @param termId - exact id of the row to remove.
 * @throws VeryMathError when the input document already breaks an invariant.
 */
export function deleteTerm(terms: readonly GlossaryTerm[], termId: string): DeleteResult {
  validateGlossaryInvariants(terms)
  const remaining = terms.filter(term => term.term_id !== termId)
  if (remaining.length === terms.length) return { removed: false, document: sortGlossary([...terms]) }
  // Re-sorting reassigns idx, so a deletion cannot leave a numbering hole.
  const document = sortGlossary(remaining)
  validateGlossaryInvariants(document)
  return { removed: true, document }
}
