/**
 * Structured extraction artifact for mathematical papers, aligned with the
 * upstream VeryMath `math-paper-reading` skill contract (skill_base.md v4.2
 * JSON schema): paper metadata, section map, main theorems, entities with
 * dependency edges, tables, proof framework, and completeness review.
 * @module @eduwork/dsh-verymath/core
 */
import { VeryMathError } from './error.ts'

/** Paper metadata block. */
export interface PaperMeta {
  readonly title: string
  readonly authors: readonly string[]
  readonly venue?: string
  readonly year?: number
  readonly arxiv_id?: string | null
  readonly source_file?: string | null
  readonly language?: 'EN' | 'CN' | 'other'
  readonly analysis_date?: string
  readonly skill_version?: string
  readonly paper_type?: readonly string[]
  readonly complexity_estimate?: {
    readonly entity_count_estimate?: number
    readonly proof_directions?: number
    readonly skill2_effort?: 'low' | 'medium' | 'high' | 'very_high'
  }
}

/** One section in the section map. */
export interface PaperSection {
  readonly section: string
  readonly title: string
  readonly section_type: string
  readonly core_action?: string
  readonly key_labels?: readonly string[]
  readonly skill2_action?: '正常提取' | '无需处理' | '提取 proof_variant:2'
  readonly appendix?: boolean
}

/** One related-work comparison entry. */
export interface RelatedWorkEntry {
  readonly ref: string
  readonly authors: string
  readonly year?: number
  readonly result_summary: string
}

/** One proof method variant. */
export interface ProofMethod {
  readonly proof_variant?: number
  readonly method: string
  readonly detail?: string
  readonly location?: string
}

/** One main theorem. */
export interface MainTheorem {
  readonly label: string
  readonly short_title?: string
  readonly statement: string
  readonly location?: { readonly section: string; readonly page?: string }
  readonly proof_methods?: readonly ProofMethod[]
  readonly role?: 'main' | 'supporting' | 'corollary'
}

/** Entity kinds recognized by the upstream extraction contract. */
export type EntityKind =
  | 'DEFINITION' | 'LEMMA' | 'PROPOSITION' | 'THEOREM' | 'COROLLARY'
  | 'CONSTRUCTION' | 'CLAIM' | 'OBSERVATION' | 'REMARK'

/** One structural entity (definition, lemma, theorem, …) with dependency edges. */
export interface PaperEntity {
  readonly type: EntityKind
  readonly label: string
  readonly statement: string
  readonly location?: { readonly section: string; readonly page?: string }
  readonly dependencies?: readonly string[]
  readonly uncertain_dependencies?: readonly string[]
  readonly cited_by?: readonly string[]
  readonly external_refs?: readonly string[]
  readonly proof_methods?: readonly ProofMethod[]
  readonly parent_result?: string | null
  readonly role_in_parent?: string | null
  readonly shared_node?: boolean
  readonly auto_labeled?: boolean
}

/** One numeric/computational table. */
export interface PaperTable {
  readonly label: string
  readonly title: string
  readonly data_source?: 'computer_search' | 'formula' | 'mixed'
  readonly location?: { readonly section: string; readonly page?: string }
  readonly rows?: readonly { readonly parameter: string; readonly value: string; readonly source?: string; readonly open?: boolean }[]
}

/** Proof framework summary. */
export interface ProofFramework {
  readonly center_theorem?: string
  readonly dependency_tree?: string
  readonly proof_strategies?: readonly {
    readonly direction?: string
    readonly proof_variant?: number
    readonly method: string
    readonly object_constructed?: string | null
    readonly case_split?: string | null
    readonly key_tools?: readonly string[]
  }[]
  readonly timeline?: readonly {
    readonly step: number
    readonly label: string
    readonly establishes: string
    readonly method: string
    readonly location?: string
    readonly used_by?: readonly string[]
  }[]
  readonly strategy_summary?: string
}

/** Completeness review block. */
export interface CompletenessCheck {
  readonly dependency_integrity?: readonly { readonly edge: string; readonly status: 'ok' | 'missing' | 'external'; readonly note?: string }[]
  readonly self_containment?: 'high' | 'medium' | 'low'
  readonly external_deps?: readonly { readonly label: string; readonly ref: string; readonly impact?: string }[]
  readonly isolated_results?: readonly { readonly label: string; readonly possible_reasons?: readonly string[] }[]
  readonly circular_deps?: readonly string[]
}

/** The complete `<slug>_structure.json` artifact. */
export interface PaperStructure {
  readonly paper: PaperMeta
  readonly section_map?: readonly PaperSection[]
  readonly related_work?: readonly RelatedWorkEntry[]
  readonly paper_summary?: string
  readonly main_theorems?: readonly MainTheorem[]
  readonly theorem_relations?: string
  readonly entities?: readonly PaperEntity[]
  readonly tables?: readonly PaperTable[]
  readonly proof_framework?: ProofFramework
  readonly completeness_check?: CompletenessCheck
}

const ENTITY_KINDS: readonly EntityKind[] = [
  'DEFINITION', 'LEMMA', 'PROPOSITION', 'THEOREM', 'COROLLARY',
  'CONSTRUCTION', 'CLAIM', 'OBSERVATION', 'REMARK',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse and structurally validate one paper-structure artifact: paper
 * metadata must be present, entities must use recognized kinds, and
 * dependency labels must reference known entities or main theorems.
 * @param value - the parsed JSON value of a `<slug>_structure.json`.
 * @returns the validated structure.
 */
export function parsePaperStructure(value: unknown): PaperStructure {
  if (!isRecord(value)) {
    throw new VeryMathError('paper structure must be a JSON object', 'VERYMATH_PAPER_INVALID')
  }
  const paper = value.paper
  if (!isRecord(paper) || typeof paper.title !== 'string' || paper.title.length === 0) {
    throw new VeryMathError('paper structure requires paper.title', 'VERYMATH_PAPER_INVALID')
  }
  // SAFETY: every required field was validated above (paper.title) and every
  // consumed field below is re-narrowed at its use site (ENTITY_KINDS check,
  // dependency label set), so the loosely-typed record satisfies PaperStructure
  // for all fields this module reads; optional fields may be absent per the
  // upstream v4.2 compact form and are handled with `?? []` everywhere.
  const structure = value as unknown as PaperStructure
  const entities = structure.entities ?? []
  const labels = new Set<string>()
  for (const entity of entities) {
    if (!ENTITY_KINDS.includes(entity.type)) {
      throw new VeryMathError(`entity ${entity.label}: unknown type ${String(entity.type)}`, 'VERYMATH_PAPER_INVALID')
    }
    labels.add(entity.label)
  }
  for (const theorem of structure.main_theorems ?? []) labels.add(theorem.label)
  for (const entity of entities) {
    for (const dependency of entity.dependencies ?? []) {
      if (!labels.has(dependency)) {
        throw new VeryMathError(`entity ${entity.label} depends on unknown label ${dependency}`, 'VERYMATH_PAPER_INVALID')
      }
    }
  }
  return structure
}

/**
 * Compute a compact dependency summary: per-entity dependent counts and the
 * entities no other entity depends on (roots of the dependency forest).
 * @param structure - a validated paper structure.
 * @returns counts by label plus root labels.
 */
export function dependencySummary(structure: PaperStructure): {
  readonly dependentCounts: Readonly<Record<string, number>>
  readonly roots: readonly string[]
} {
  const dependentCounts: Record<string, number> = {}
  const dependedOn = new Set<string>()
  for (const entity of structure.entities ?? []) {
    dependentCounts[entity.label] = (dependentCounts[entity.label] ?? 0) + (entity.cited_by?.length ?? 0)
    for (const dependency of entity.dependencies ?? []) dependedOn.add(dependency)
  }
  const known = new Set([...(structure.entities ?? []).map(entity => entity.label), ...(structure.main_theorems ?? []).map(theorem => theorem.label)])
  const roots = [...known].filter(label => !dependedOn.has(label)).sort()
  return { dependentCounts, roots }
}
