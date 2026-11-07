/**
 * Co-Mathematician research-workspace gate checks — TypeScript port of the
 * documented workspace contract (upstream `harness/co_math/gating.py`):
 * three gates over a plain-file workspace layout
 * (`project/GOALS.yaml`, `workstreams/<id>/{status.yaml, report.md, reviews/}`).
 * Pure file-contract validation, no upstream code copied.
 * @module @eduwork/dsh-verymath/core
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { VeryMathError } from './error.ts'
import { load as loadYaml } from 'js-yaml'

/** Result of one gate check. */
export interface GateResult {
  readonly gate: 'goal_approval' | 'workstream_completion' | 'final_render'
  readonly passed: boolean
  readonly issues: readonly string[]
  readonly details: Readonly<Record<string, unknown>>
}

/** The workspace root containing `project/` and `workstreams/`. */
export function workspaceRoots(workspace: string): { projectDir: string, workstreamsDir: string } {
  return { projectDir: join(workspace, 'project'), workstreamsDir: join(workspace, 'workstreams') }
}

/** Read `project/GOALS.yaml`; a missing file means "no goals recorded". */
export async function loadGoals(workspace: string): Promise<{ goals: Array<Record<string, unknown>> }> {
  const { projectDir } = workspaceRoots(workspace)
  try {
    const raw = await readFile(join(projectDir, 'GOALS.yaml'), 'utf8')
    const data = (loadYaml(raw) ?? {}) as Record<string, unknown>
    const goals = Array.isArray(data.goals) ? data.goals as Array<Record<string, unknown>> : []
    return { goals }
  } catch {
    return { goals: [] }
  }
}


/** List workstream directories (recognized by their marker files). */
export async function listWorkstreams(workspace: string, workstreamId?: string): Promise<string[]> {
  const { workstreamsDir } = workspaceRoots(workspace)
  if (workstreamId !== undefined) {
    return [join(workstreamsDir, workstreamId)]
  }
  try {
    const entries = await readdir(workstreamsDir, { withFileTypes: true })
    const dirs: string[] = []
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory()) continue
      const dir = join(workstreamsDir, entry.name)
      if (await isWorkstreamDir(dir)) dirs.push(dir)
    }
    return dirs
  } catch {
    return []
  }
}

async function isWorkstreamDir(dir: string): Promise<boolean> {
  for (const marker of ['status.yaml', 'WORKSTREAM.md', 'report.md', 'messages.jsonl']) {
    try {
      await stat(join(dir, marker))
      return true
    } catch {
      // try next marker
    }
  }
  return false
}

interface ReviewInfo {
  readonly file: string
  readonly reviewer: string
  readonly approved: boolean
  readonly severity: string
  readonly resolved: boolean
  readonly resolves: readonly string[]
}

async function loadStatus(workstream: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(join(workstream, 'status.yaml'), 'utf8')
    return (loadYaml(raw) ?? {}) as Record<string, unknown>
  } catch {
    return {}
  }
}

async function loadReviews(workstream: string): Promise<ReviewInfo[]> {
  let files: string[]
  try {
    files = (await readdir(join(workstream, 'reviews'))).filter(name => name.endsWith('.json')).sort()
  } catch {
    return []
  }
  const reviews: ReviewInfo[] = []
  for (const file of files) {
    try {
      const data = JSON.parse(await readFile(join(workstream, 'reviews', file), 'utf8')) as Record<string, unknown>
      reviews.push({
        file,
        reviewer: String(data.reviewer ?? file.replace(/\.json$/u, '')),
        approved: data.approved === true,
        // Upstream contract: only an explicit severity === 'blocking' blocks.
        severity: String(data.severity ?? ''),
        resolved: data.resolved === true,
        resolves: Array.isArray(data.resolves) ? data.resolves.map(item => String(item)) : [],
      })
    } catch {
      reviews.push({ file, reviewer: file.replace(/\.json$/u, ''), approved: false, severity: 'blocking', resolved: false, resolves: [] })
    }
  }
  return reviews
}

/** Whether a report body contains the `## <section>` heading (case-insensitive, exact line). */
export function hasSection(text: string, section: string): boolean {
  const expected = `## ${section}`.toLowerCase()
  return text.split('\n').some(line => line.trim().toLowerCase() === expected)
}

/** Issues for one workstream per the upstream completion contract. */
export async function workstreamIssues(workstream: string): Promise<string[]> {
  const label = workstream.split('/').pop() ?? workstream
  const issues: string[] = []
  const status = await loadStatus(workstream)
  const reviews = await loadReviews(workstream)
  let reportText: string | undefined
  try {
    reportText = await readFile(join(workstream, 'report.md'), 'utf8')
  } catch {
    reportText = undefined
  }

  if (reportText === undefined) issues.push(`${label}: report.md is missing.`)

  const approvedReviewers = reviews.filter(review => review.approved).map(review => review.reviewer)
  const coordinator = String(status.coordinator ?? 'workstream_coordinator')
  const independentApprovals = approvedReviewers.filter(reviewer => reviewer !== coordinator)
  if (independentApprovals.length === 0) {
    issues.push(`${label}: missing independent reviewer approval.`)
  }

  const resolvedNames = new Set<string>()
  for (const review of reviews) {
    if (review.resolved) {
      resolvedNames.add(review.file)
      resolvedNames.add(review.file.replace(/\.json$/u, ''))
    }
    for (const target of review.resolves) {
      resolvedNames.add(target)
      resolvedNames.add(target.split('/').pop() ?? target)
      resolvedNames.add(target.replace(/\.json$/u, ''))
    }
  }
  for (const review of reviews) {
    if (review.severity === 'blocking' && !resolvedNames.has(review.file) && !resolvedNames.has(review.file.replace(/\.json$/u, ''))) {
      issues.push(`${label}: blocking review in ${review.file}.`)
    }
  }

  if (reportText !== undefined) {
    if (!hasSection(reportText, 'Provenance')) issues.push(`${label}: report.md is missing a Provenance section.`)
    if (!hasSection(reportText, 'Uncertainty')) issues.push(`${label}: report.md is missing an Uncertainty section.`)
    if (!hasSection(reportText, 'Failed Explorations')) issues.push(`${label}: report.md is missing a Failed Explorations section.`)
  }
  return issues
}

/**
 * Gate 1: at least one goal in `project/GOALS.yaml` has `status: approved`
 * (or the named goal does).
 */
export async function checkGoalApproval(workspace: string, goalId?: string): Promise<GateResult> {
  const { goals } = await loadGoals(workspace)
  const issues: string[] = []
  if (goalId !== undefined) {
    const goal = goals.find(goal => String(goal.id ?? '') === goalId)
    if (goal === undefined) {
      issues.push(`Goal ${goalId} was not found.`)
    } else if (String(goal.status ?? '').toLowerCase() !== 'approved') {
      issues.push(`Goal ${goalId} is not approved (status: ${String(goal.status ?? 'missing')}).`)
    }
  } else if (!goals.some(goal => String(goal.status ?? '').toLowerCase() === 'approved')) {
    issues.push('No approved goals are recorded.')
  }
  return { gate: 'goal_approval', passed: issues.length === 0, issues, details: goalId !== undefined ? { goalId } : {} }
}

/**
 * Gate 2: every (selected) workstream has report.md, an independent reviewer
 * approval, no unresolved blocking reviews, and the three mandatory sections.
 */
export async function checkWorkstreamCompletion(workspace: string, workstreamId?: string): Promise<GateResult> {
  const workstreams = await listWorkstreams(workspace, workstreamId)
  const issues: string[] = []
  const details: Record<string, unknown> = { workstreams: workstreams.map(path => path.split('/').pop()) }
  if (workstreams.length === 0) issues.push('No workstream directories were found.')
  for (const workstream of workstreams) issues.push(...(await workstreamIssues(workstream)))
  return { gate: 'workstream_completion', passed: issues.length === 0, issues, details }
}

/**
 * Gate 3: which workstreams would pass the completion gate (final render
 * approval set).
 */
export async function checkFinalRender(workspace: string): Promise<GateResult> {
  const workstreams = await listWorkstreams(workspace)
  const approved: string[] = []
  const rejected: Record<string, readonly string[]> = {}
  for (const workstream of workstreams) {
    const label = workstream.split('/').pop() ?? workstream
    const issues = await workstreamIssues(workstream)
    if (issues.length === 0) approved.push(label)
    else rejected[label] = issues
  }
  const issues = approved.length > 0 ? [] : ['No reviewed workstream reports are ready to render.']
  return { gate: 'final_render', passed: issues.length === 0, issues, details: { approved_workstreams: approved, rejected_workstreams: rejected } }
}

/** Dispatch one gate by name (upstream `check_gate` shape). */
export async function checkGate(
  workspace: string,
  gate: 'goal_approval' | 'workstream_completion' | 'final_render',
  options: { readonly goalId?: string; readonly workstreamId?: string } = {},
): Promise<GateResult> {
  if (gate === 'goal_approval') return checkGoalApproval(workspace, options.goalId)
  if (gate === 'workstream_completion') return checkWorkstreamCompletion(workspace, options.workstreamId)
  if (gate === 'final_render') return checkFinalRender(workspace)
  throw new VeryMathError(`Unsupported gate: ${String(gate)}`, 'VERYMATH_IO')
}
