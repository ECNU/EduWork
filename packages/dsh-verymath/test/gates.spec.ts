import { describe, expect, it, beforeAll } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkGate, checkGoalApproval, checkWorkstreamCompletion, checkFinalRender } from '../src/core/index.ts'

let ws: string

async function makeWorkstream(root: string, name: string, options: {
  report?: boolean
  sections?: boolean
  reviewer?: string
  approved?: boolean
  coordinator?: string
  blockingReview?: boolean
  blockingResolved?: boolean
}): Promise<string> {
  const dir = join(root, 'workstreams', name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'status.yaml'), options.coordinator !== undefined ? `coordinator: ${options.coordinator}\n` : '')
  if (options.report !== false) {
    const sections = options.sections === false ? '' : '\n## Provenance\n\n## Uncertainty\n\n## Failed Explorations\n'
    await writeFile(join(dir, 'report.md'), `# ${name} report${sections}`)
  }
  if (options.reviewer !== undefined) {
    await mkdir(join(dir, 'reviews'), { recursive: true })
    const review: Record<string, unknown> = { reviewer: options.reviewer, approved: options.approved === true }
    if (options.blockingReview === true) {
      review.severity = 'blocking'
      review.resolved = options.blockingResolved === true
    }
    await writeFile(join(dir, 'reviews', 'r1.json'), JSON.stringify(review))
  }
  return dir
}

beforeAll(async () => {
  ws = await mkdtemp(join(tmpdir(), 'gates-test-'))
  await mkdir(join(ws, 'project'), { recursive: true })
  await writeFile(join(ws, 'project', 'GOALS.yaml'), 'goals:\n  - id: g1\n    status: approved\n')
})

describe('checkGoalApproval', () => {
  it('passes with an approved goal', async () => {
    const result = await checkGoalApproval(ws)
    expect(result.passed).toBe(true)
    expect(result.gate).toBe('goal_approval')
  })

  // Regression: an undefined goalId used to leave `{ goalId: undefined }` in
  // details, which the tool output contract rejects as non-lossless JSON
  // (surfaced by a real run of verymath_research_gate on gate=goal_approval).
  it('keeps details JSON-serializable when no goalId is given', async () => {
    const result = await checkGoalApproval(ws)
    expect(result.details).toEqual({})
    expect(Object.values(result.details).every(value => value !== undefined)).toBe(true)
  })

  it('carries the goalId in details when one is given', async () => {
    const result = await checkGoalApproval(ws, 'g1')
    expect(result.details).toEqual({ goalId: 'g1' })
  })

  it('names a missing goal id', async () => {
    const result = await checkGoalApproval(ws, 'nope')
    expect(result.passed).toBe(false)
    expect(result.issues[0]).toContain('was not found')
  })
})

describe('checkWorkstreamCompletion', () => {
  it('passes a workstream with report, sections, and independent approval', async () => {
    await makeWorkstream(ws, 'ws-good', { reviewer: 'reviewer_a', approved: true, coordinator: 'coordinator_1' })
    const result = await checkWorkstreamCompletion(ws, 'ws-good')
    expect(result.passed).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('flags each missing contract element', async () => {
    const dir = await makeWorkstream(ws, 'ws-bad', { report: false })
    const result = await checkWorkstreamCompletion(ws, 'ws-bad')
    expect(result.passed).toBe(false)
    const joined = result.issues.join(' | ')
    expect(joined).toContain('report.md is missing')
    void dir
  })

  it('rejects coordinator self-approval (independent reviewer required)', async () => {
    await makeWorkstream(ws, 'ws-self', { reviewer: 'coordinator_2', approved: true, coordinator: 'coordinator_2' })
    const result = await checkWorkstreamCompletion(ws, 'ws-self')
    expect(result.passed).toBe(false)
    expect(result.issues.join(' ')).toContain('missing independent reviewer approval')
  })

  it('requires Provenance/Uncertainty/Failed Explorations sections', async () => {
    await makeWorkstream(ws, 'ws-nosec', { sections: false, reviewer: 'reviewer_b', approved: true })
    const result = await checkWorkstreamCompletion(ws, 'ws-nosec')
    const joined = result.issues.join(' | ')
    expect(joined).toContain('Provenance')
    expect(joined).toContain('Uncertainty')
    expect(joined).toContain('Failed Explorations')
  })

  it('blocks on unresolved blocking reviews', async () => {
    await makeWorkstream(ws, 'ws-block', { reviewer: 'reviewer_c', approved: true, blockingReview: true, blockingResolved: false })
    const result = await checkWorkstreamCompletion(ws, 'ws-block')
    expect(result.issues.join(' ')).toContain('blocking review')
  })

  it('accepts resolved blocking reviews', async () => {
    await makeWorkstream(ws, 'ws-block-ok', { reviewer: 'reviewer_d', approved: true, blockingReview: true, blockingResolved: true })
    const result = await checkWorkstreamCompletion(ws, 'ws-block-ok')
    expect(result.passed).toBe(true)
  })
})

describe('checkFinalRender + checkGate dispatch', () => {
  it('approves only passing workstreams for render', async () => {
    const result = await checkFinalRender(ws)
    expect(result.details.approved_workstreams).toContain('ws-good')
    expect(Object.keys(result.details.rejected_workstreams as Record<string, unknown>)).toContain('ws-bad')
  })

  it('dispatches by gate name', async () => {
    const byName = await checkGate(ws, 'final_render')
    expect(byName.gate).toBe('final_render')
    const direct = await checkFinalRender(ws)
    expect(byName.passed).toBe(direct.passed)
  })

  it('throws on an unknown gate', async () => {
    await expect(checkGate(ws, 'nonsense' as 'goal_approval')).rejects.toThrow(/Unsupported gate/)
  })
})
