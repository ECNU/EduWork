/**
 * Dependency-graph engine for math-paper-reading structure artifacts,
 * aligned with the upstream skill_pathway_proof contract: batch merging,
 * cited_by reconstruction, shared_node computation, topology metrics,
 * cycle detection, reading paths, and degraded Mermaid rendering.
 * All computations are deterministic pure functions — the upstream skill
 * forbids model-side manual graph traversal.
 * @module @eduwork/dsh-verymath/core
 */
import { VeryMathError } from './error.ts'
import type { MainTheorem, PaperEntity, PaperStructure } from './paper.ts'

/** A structure artifact may arrive as one file or as multiple batch files. */
export type StructureInput = PaperStructure | readonly PaperStructure[]

/** Merge report summarizing what the merge changed. */
export interface MergeReport {
  /** Total entities after merging. */
  readonly totalEntities: number
  /** Number of duplicate-label entities that were merged away (first occurrence wins). */
  readonly mergedDuplicates: number
  /** Dependency edges whose target label is not in the merged set (excluded from graph math). */
  readonly danglingEdges: readonly string[]
  /** Number of reverse edges rebuilt from forward dependencies. */
  readonly rebuiltCitedBy: number
  /** Shared hubs detected after the merge (upstream shared_node rule). */
  readonly sharedNodes: readonly string[]
}

/** Per-entity topology metrics aligned with upstream compute_topology.py. */
export interface EntityTopology {
  readonly label: string
  readonly type: PaperEntity['type']
  /** Number of distinct merged entities depending on this one. */
  readonly inDegree: number
  /** dependencies + uncertain_dependencies count (known labels only). */
  readonly outDegree: number
  /** Upstream shared-node rule: in-degree ≥ 2 and at least one citing THEOREM. */
  readonly sharedNode: boolean
  /** Whether any main theorem transitively depends on this entity. */
  readonly supportsMainTheorem: boolean
  /** Uncertain dependency labels with the `[UNCERTAIN: …]` suffix stripped. */
  readonly uncertainDependencies: readonly string[]
}

/** One cycle found in the dependency graph. */
export interface DependencyCycle {
  readonly labels: readonly string[]
}

/** Topology result for a whole artifact. */
export interface GraphTopology {
  readonly metrics: readonly EntityTopology[]
  readonly cycles: readonly DependencyCycle[]
  /** Bottom-up reproduction order: dependency-free labels first, level by level (Kahn layers). */
  readonly bottomUpLevels: readonly (readonly string[])[]
  /** Top-down order from main theorems along dependency edges (BFS). */
  readonly topDownOrder: readonly string[]
  /** Longest dependency chain (by node count), earliest label first. */
  readonly longestChain: readonly string[]
  /** Labels with no known dependency and no dependent (orphan results). */
  readonly isolated: readonly string[]
  /** Whether the artifact exceeds the upstream full-render threshold (> 40 entities). */
  readonly degradedRendering: boolean
}

/** Type guard: `Array.isArray` cannot narrow `readonly T[]` unions, so this
 * predicate provides reliable narrowing for both branches. */
export function isSingleStructure(input: StructureInput): input is PaperStructure {
  return !Array.isArray(input)
}

/** Strip the upstream `[UNCERTAIN: reason]` suffix from a dependency label. */
export function stripUncertain(dependency: string): string {
  const index = dependency.indexOf(' [')
  return index >= 0 ? dependency.slice(0, index).trim() : dependency.trim()
}

/** Normalize any input shape into the document list. */
function documentsOf(input: StructureInput): readonly PaperStructure[] {
  return isSingleStructure(input) ? [input] : input
}

/**
 * Unique entities across one or more batch artifacts, keyed by label
 * (first occurrence wins, duplicates counted). Order follows input order.
 * @param input - one artifact or a list of batch artifacts.
 */
export function collectEntities(input: StructureInput): { entities: PaperEntity[], duplicates: number } {
  const documents = documentsOf(input)
  const unique = new Map<string, PaperEntity>()
  let duplicates = 0
  for (const document of documents) {
    for (const entity of document.entities ?? []) {
      if (unique.has(entity.label)) duplicates += 1
      else unique.set(entity.label, entity)
    }
  }
  return { entities: [...unique.values()], duplicates }
}

/**
 * Merge batch artifacts per the upstream Skill-2 protocol: dedupe by label,
 * rebuild the reverse index (`cited_by`) from forward `dependencies` and
 * cleaned `uncertain_dependencies`, and compute `shared_node` (in-degree ≥ 2
 * with at least one citing THEOREM). Input artifacts are never mutated; the
 * returned entities are rebuilt copies.
 * @param input - one artifact or a list of batch artifacts.
 * @returns rebuilt entities plus a merge report.
 */
export function mergeBatches(input: StructureInput): { entities: PaperEntity[], report: MergeReport } {
  const { entities: uniqueEntities, duplicates } = collectEntities(input)
  const known = new Set(uniqueEntities.map(entity => entity.label))
  const citedBy = new Map<string, Set<string>>()
  const citingTypes = new Map<string, Set<string>>()
  const dangling = new Set<string>()
  let rebuiltCitedBy = 0
  for (const entity of uniqueEntities) {
    const forward = [
      ...(entity.dependencies ?? []),
      ...(entity.uncertain_dependencies ?? []).map(stripUncertain),
    ]
    for (const rawDependency of forward) {
      const dependency = stripUncertain(rawDependency)
      if (!known.has(dependency)) {
        dangling.add(`${entity.label} -> ${dependency}`)
        continue
      }
      rebuiltCitedBy += 1
      const cited = citedBy.get(dependency) ?? new Set<string>()
      cited.add(entity.label)
      citedBy.set(dependency, cited)
      const types = citingTypes.get(dependency) ?? new Set<string>()
      types.add(entity.type)
      citingTypes.set(dependency, types)
    }
  }
  const sharedNodes: string[] = []
  const entities: PaperEntity[] = uniqueEntities.map(entity => {
    const cited = citedBy.get(entity.label)
    const shared = cited !== undefined && cited.size >= 2 && citingTypes.get(entity.label)?.has('THEOREM') === true
    if (shared) sharedNodes.push(entity.label)
    return {
      ...entity,
      cited_by: cited === undefined ? [] : [...cited].sort(),
      shared_node: shared,
    }
  })
  return {
    entities,
    report: {
      totalEntities: entities.length,
      mergedDuplicates: duplicates,
      danglingEdges: [...dangling].sort(),
      rebuiltCitedBy,
      sharedNodes,
    },
  }
}

/** Detect dependency cycles via colored DFS over forward edges. */
function findCycles(labels: readonly string[], edges: ReadonlyMap<string, readonly string[]>): DependencyCycle[] {
  const state = new Map<string, 1 | 2>()
  const stack: string[] = []
  const cycles: DependencyCycle[] = []
  const visit = (label: string): void => {
    const marker = state.get(label)
    if (marker === 2) return
    if (marker === 1) {
      const start = stack.indexOf(label)
      if (start >= 0) cycles.push({ labels: [...stack.slice(start), label] })
      return
    }
    state.set(label, 1)
    stack.push(label)
    for (const next of edges.get(label) ?? []) visit(next)
    stack.pop()
    state.set(label, 2)
  }
  for (const label of labels) visit(label)
  return cycles
}

/**
 * Compute the full topology of a (possibly batched) artifact: per-entity
 * metrics, cycles, both reading directions, longest chain, and orphans.
 * @param input - one artifact or merged batches.
 * @param mainTheoremLabels - explicit theorem roots; defaults to the artifact's `main_theorems`.
 */
export function computeTopology(
  input: StructureInput,
  mainTheoremLabels?: readonly string[],
): GraphTopology {
  const { entities } = mergeBatches(input)
  const artifact = isSingleStructure(input) ? input : undefined
  const theorems: readonly MainTheorem[] = artifact?.main_theorems ?? []
  const theoremLabels = mainTheoremLabels ?? theorems.map(theorem => theorem.label)
  const byLabel = new Map(entities.map(entity => [entity.label, entity]))
  const dependenciesOf = (entity: PaperEntity): string[] => [
    ...(entity.dependencies ?? []).map(stripUncertain),
    ...(entity.uncertain_dependencies ?? []).map(stripUncertain),
  ].filter(label => byLabel.has(label))
  const dependentsOf = (entity: PaperEntity): string[] => (entity.cited_by ?? []).filter(label => byLabel.has(label))

  const edges = new Map(entities.map((entity): [string, string[]] => [entity.label, dependenciesOf(entity)]))
  const reverseEdges = new Map(entities.map((entity): [string, string[]] => [entity.label, dependentsOf(entity)]))
  const cycles = findCycles(entities.map(entity => entity.label), edges)

  // Transitive main-theorem support: reverse BFS from theorem roots.
  const supports = new Set<string>()
  const supportQueue: string[] = [...theoremLabels]
  while (supportQueue.length > 0) {
    const label = supportQueue.pop()
    if (label === undefined || supports.has(label)) continue
    supports.add(label)
    for (const dependency of edges.get(label) ?? []) supportQueue.push(dependency)
  }

  const metrics: EntityTopology[] = entities.map(entity => ({
    label: entity.label,
    type: entity.type,
    inDegree: dependentsOf(entity).length,
    outDegree: dependenciesOf(entity).length,
    sharedNode: entity.shared_node === true,
    supportsMainTheorem: supports.has(entity.label),
    uncertainDependencies: entity.uncertain_dependencies ?? [],
  }))

  // Bottom-up Kahn layers over forward dependency edges.
  const remaining = new Map(entities.map((entity): [string, number] => [entity.label, dependenciesOf(entity).length]))
  let frontier = entities.filter(entity => dependenciesOf(entity).length === 0).map(entity => entity.label)
  const bottomUpLevels: string[][] = []
  const visited = new Set<string>()
  while (frontier.length > 0) {
    bottomUpLevels.push([...frontier].sort())
    for (const label of frontier) visited.add(label)
    const next: string[] = []
    for (const label of frontier) {
      for (const dependent of reverseEdges.get(label) ?? []) {
        if (visited.has(dependent)) continue
        const count = (remaining.get(dependent) ?? 0) - 1
        remaining.set(dependent, count)
        if (count === 0) next.push(dependent)
      }
    }
    frontier = [...new Set(next)]
  }
  if (cycles.length > 0) {
    // Nodes stuck in or behind cycles never reach in-degree 0; surface them as a trailing level.
    const stuck = entities.map(entity => entity.label).filter(label => !visited.has(label))
    if (stuck.length > 0) bottomUpLevels.push([...stuck].sort())
  }

  // Top-down BFS from main theorems along dependency edges.
  const topDown: string[] = []
  const seen = new Set<string>()
  const bfsQueue: string[] = [...theoremLabels.filter((label: string) => byLabel.has(label))]
  while (bfsQueue.length > 0) {
    const label = bfsQueue.shift()
    if (label === undefined || seen.has(label)) continue
    seen.add(label)
    topDown.push(label)
    for (const dependency of edges.get(label) ?? []) bfsQueue.push(dependency)
  }

  // Longest dependency chain via memoized DFS with cycle guard.
  const depth = new Map<string, { length: number, chain: readonly string[] }>()
  const chainFor = (label: string, active: Set<string>): { length: number, chain: readonly string[] } => {
    const cached = depth.get(label)
    if (cached !== undefined) return cached
    if (active.has(label)) return { length: 0, chain: [label] }
    active.add(label)
    let best: { length: number, chain: readonly string[] } = { length: 0, chain: [label] }
    for (const dependency of edges.get(label) ?? []) {
      const sub = chainFor(dependency, active)
      if (sub.length + 1 > best.length) best = { length: sub.length + 1, chain: [label, ...sub.chain] }
    }
    active.delete(label)
    depth.set(label, best)
    return best
  }
  let longestChain: readonly string[] = []
  for (const label of entities.map(entity => entity.label)) {
    const candidate = chainFor(label, new Set())
    if (candidate.chain.length > longestChain.length) longestChain = candidate.chain
  }

  const isolated = entities
    .filter(entity => dependenciesOf(entity).length === 0 && dependentsOf(entity).length === 0)
    .map(entity => entity.label)
    .sort()

  return {
    metrics,
    cycles,
    bottomUpLevels,
    topDownOrder: topDown,
    longestChain,
    isolated,
    degradedRendering: entities.length > 40,
  }
}

const TYPE_SYMBOLS: Readonly<Record<string, string>> = {
  THEOREM: '⭐', LEMMA: '🔧', PROPOSITION: '📐', CLAIM: '🔶',
  DEFINITION: '🧱', CONSTRUCTION: '🧱', OBSERVATION: '💡', REMARK: '💡',
  COROLLARY: '📎',
}

/** Mermaid node id: alphanumerics and hyphens only. */
function mermaidId(label: string): string {
  const id = label.replace(/[^A-Za-z0-9-]/g, '')
  if (id.length > 0) return id
  let hash = 0
  for (const char of label) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0
  return `n${Math.abs(hash)}`
}

/** Clean one statement into a safe ≤50-char Mermaid display text (upstream §3.2):
 * strip $ delimiters and render commands but keep the inner content (e.g.
 * \mathbb{R}^d → R^d), then sanitize and truncate. */
export function mermaidDisplayText(label: string, statement: string): string {
  const cleaned = statement
    .replace(/\\(mathbb|mathcal|mathfrak|mathrm)/g, '')
    .replace(/\$\s*/g, '')
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const summary = cleaned.length > 0 ? `${label}: ${cleaned}` : label
  const text = summary.length > 50 ? `${summary.slice(0, 47)}...` : summary
  return /[\^_~]/.test(text) ? `"${text.replace(/"/g, '')}"` : text
}

/**
 * Render a full or degraded Mermaid dependency graph (upstream §3/§4/§6):
 * subgraph layering, UNCERTAIN/EXTERNAL dashed edges, shared/auto markers,
 * and the >40-node degradation to depth-2 THEOREM-rooted subgraphs.
 * @param structure - the structure artifact holding the entities.
 * @param options - force full rendering even above the degradation threshold.
 */
export function renderMermaid(
  structure: PaperStructure,
  options: { readonly forceFull?: boolean } = {},
): string {
  requireStructure(structure)
  const { entities } = mergeBatches(structure)
  const byLabel = new Map(entities.map(entity => [entity.label, entity]))
  const lines: string[] = ['graph TD']
  const edgeLines: string[] = []
  const declared = new Set<string>()

  const declare = (entity: PaperEntity): void => {
    if (declared.has(entity.label)) return
    declared.add(entity.label)
    const symbol = TYPE_SYMBOLS[entity.type] ?? '💡'
    const markers = [
      entity.shared_node === true ? ' [*]' : '',
      entity.auto_labeled === true ? ' [AUTO]' : '',
    ].join('')
    lines.push(`    ${mermaidId(entity.label)}[${symbol} ${mermaidDisplayText(entity.label, entity.statement)}]${markers}`)
  }

  const renderEdges = (labels: ReadonlySet<string>): void => {
    for (const entity of entities) {
      if (!labels.has(entity.label)) continue
      for (const dependency of (entity.dependencies ?? []).map(stripUncertain)) {
        if (!byLabel.has(dependency) || !labels.has(dependency)) continue
        edgeLines.push(`    ${mermaidId(entity.label)} --> ${mermaidId(dependency)}`)
      }
      for (const raw of entity.uncertain_dependencies ?? []) {
        const dependency = stripUncertain(raw)
        if (!byLabel.has(dependency) || !labels.has(dependency)) continue
        edgeLines.push(`    ${mermaidId(entity.label)} -.->|⚠️ UNCERTAIN| ${mermaidId(dependency)}`)
      }
      for (const ref of entity.external_refs ?? []) {
        const id = `ext${mermaidId(ref)}`
        if (!declared.has(id)) {
          declared.add(id)
          lines.push(`    ${id}(📎 ${ref.replace(/[{}"]/g, '')})`)
        }
        edgeLines.push(`    ${mermaidId(entity.label)} -.->|📎 EXTERNAL| ${id}`)
      }
    }
  }

  const degraded = entities.length > 40 && options.forceFull !== true
  if (degraded) {
    // Upstream degradation: THEOREM-rooted depth-2 subgraphs only.
    lines.push('    %% ⚠️ >40 entities: degraded to THEOREM-rooted depth-2 subgraphs')
    const roots = entities.filter(entity => entity.type === 'THEOREM')
    for (const root of roots) {
      lines.push(`    subgraph ${mermaidId(root.label)}_sub`)
      const scope = new Set<string>([root.label])
      declare(root)
      for (const dependency of (root.dependencies ?? []).map(stripUncertain)) {
        const entity = byLabel.get(dependency)
        if (entity === undefined) continue
        scope.add(dependency)
        declare(entity)
        for (const nested of (entity.dependencies ?? []).map(stripUncertain)) {
          const nestedEntity = byLabel.get(nested)
          if (nestedEntity === undefined) continue
          scope.add(nested)
          declare(nestedEntity)
        }
      }
      renderEdges(scope)
      lines.push('    end')
    }
    const unrendered = entities.filter(entity => !declared.has(entity.label)).map(entity => entity.label)
    if (unrendered.length > 0) {
      lines.push(`    %% Text list of ${unrendered.length} non-core nodes: ${unrendered.slice(0, 10).join(', ')}${unrendered.length > 10 ? ' …' : ''}`)
    }
  } else {
    // Full rendering with upstream subgraph grouping, bottom-up order.
    const layers: Array<{ title: string, filter: (entity: PaperEntity) => boolean }> = [
      { title: 'Assumptions', filter: entity => entity.type === 'DEFINITION' || entity.type === 'CONSTRUCTION' },
      { title: 'CoreLemmas', filter: entity => (entity.type === 'LEMMA' || entity.type === 'PROPOSITION') && (entity.shared_node === true || (entity.cited_by?.length ?? 0) >= 2) },
      { title: 'TechnicalLemmas', filter: entity => (entity.type === 'LEMMA' || entity.type === 'CLAIM') && entity.shared_node !== true && (entity.cited_by?.length ?? 0) < 2 },
      { title: 'MainResults', filter: entity => entity.type === 'THEOREM' || entity.type === 'COROLLARY' },
    ]
    const grouped = new Set<string>()
    for (const layer of layers) {
      const members = entities.filter(entity => layer.filter(entity) && !grouped.has(entity.label))
      if (members.length === 0) continue
      for (const member of members) grouped.add(member.label)
      lines.push(`    subgraph ${layer.title}`)
      for (const member of members) declare(member)
      lines.push('    end')
    }
    for (const other of entities.filter(entity => !grouped.has(entity.label))) declare(other)
    // Render every node's edges (both endpoints exist by construction).
    renderEdges(new Set(entities.map(entity => entity.label)))
    // External references hang off entities that may have no forward edges;
    // declare their ext nodes regardless so they always render.
    for (const entity of entities) {
      for (const ref of entity.external_refs ?? []) {
        const id = `ext${mermaidId(ref)}`
        if (!declared.has(id)) {
          declared.add(id)
          lines.push(`    ${id}(📎 ${ref.replace(/[{}"\[\]]/g, '')})`)
        }
        edgeLines.push(`    ${mermaidId(entity.label)} -.->|📎 EXTERNAL| ${id}`)
      }
    }
  }
  return [...lines, ...edgeLines].join('\n')
}

/** Throw a structured error when a structure artifact cannot be processed. */
export function requireStructure(value: unknown): PaperStructure {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new VeryMathError('paper structure input must be a JSON object', 'VERYMATH_PAPER_INVALID')
  }
  return value as PaperStructure
}

/** Transitive dependency closure of one entity plus its reading path. */
export interface FocusResult {
  readonly label: string
  /** All labels transitively required by the focus entity (including itself), topologically ordered bottom-up. */
  readonly closure: readonly string[]
  /** BFS layers from the focus entity down to its foundations (level 0 = the focus label). */
  readonly levels: readonly (readonly string[])[]
  /** Whether the focus label resolved to a known entity. */
  readonly found: boolean
}

/**
 * Compute the transitive dependency closure and layered reading path for one
 * entity (upstream skill_pathway_proof §5 reading-path generation, which the
 * skill currently delegates to unreliable model-side BFS).
 * @param input - one artifact or merged batches.
 * @param label - the focus entity label.
 */
export function focusClosure(input: StructureInput, label: string): FocusResult {
  const { entities } = mergeBatches(input)
  const artifact = isSingleStructure(input) ? input : undefined
  const theorems: readonly MainTheorem[] = artifact?.main_theorems ?? []
  // Labels resolve against the merged namespace: entities plus main_theorems
  // (upstream top-down reading paths start at main_theorems, which the
  // compact v4.2 form may omit from entities[]). Main theorems absent from
  // entities participate as leaf nodes with no recorded forward edges.
  const byLabel = new Map(entities.map(entity => [entity.label, entity]))
  const mergedNamespace = new Map(byLabel)
  for (const theorem of theorems) {
    if (!mergedNamespace.has(theorem.label)) {
      mergedNamespace.set(theorem.label, {
        type: 'THEOREM',
        label: theorem.label,
        statement: theorem.statement,
      })
    }
  }
  if (!mergedNamespace.has(label)) {
    return { label, closure: [], levels: [], found: false }
  }
  const dependenciesOf = (entity: PaperEntity): string[] => [
    ...(entity.dependencies ?? []).map(stripUncertain),
    ...(entity.uncertain_dependencies ?? []).map(stripUncertain),
  ].filter(dependency => mergedNamespace.has(dependency))
  const levels: string[][] = [[label]]
  const seen = new Set<string>([label])
  let frontier = [label]
  while (frontier.length > 0) {
    const next: string[] = []
    for (const current of frontier) {
      const entity = mergedNamespace.get(current)
      if (entity === undefined) continue
      for (const dependency of dependenciesOf(entity)) {
        if (!seen.has(dependency)) {
          seen.add(dependency)
          next.push(dependency)
        }
      }
    }
    if (next.length > 0) levels.push([...new Set(next)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)))
    frontier = next
  }
  return { label, closure: [...seen].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)), levels, found: true }
}
