// Declarative build stages: each stage declares the stages it consumes and the
// parameters that change its output, so the runner can order them, run
// independent ones together and leave a checkpoint a later invocation trusts.
// Nothing here knows about macOS, Windows or Web assembly; an orchestrator
// supplies the stages and the platform behaviour.
import { createHash } from 'node:crypto'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { ensureDir, pathExists, removeTree, sha256File, statEntry, writeText } from './build-util.mjs'

export const CHECKPOINT_SCHEMA_VERSION = 1

const unix = path => path.split(sep).join('/')
const digest = value => createHash('sha256').update(value).digest('hex')

export class Stage {
  constructor(definition) { this.definition = definition }

  get name() { return this.definition.name }
  get description() { return this.definition.description ?? '' }
  /** Hashed dependencies: changing one of these changes this stage's output. */
  get requires() { return [...(this.definition.requires ?? [])] }
  /** Declared but unhashed dependencies: an ordering edge only. */
  get dependsOn() { return [...(this.definition.dependsOn ?? [])] }
  get outputs() { return [...(this.definition.outputs ?? [])] }
  /**
   * Outputs this stage creates but does not own: a later stage appends to them,
   * so their digest is not a stable fingerprint. They are still verified to
   * exist, and they still count as declared so two stages cannot create the
   * same tree at once.
   */
  get mutableOutputs() { return [...(this.definition.mutableOutputs ?? [])] }
  /**
   * Extra paths this stage owns that are not artifacts: a stage that writes into
   * a parent directory or a scratch area lists them here so a rerun starts from
   * a clean slate instead of tripping its own "must be a new directory" guard.
   * Anything already declared as an output is cleaned without being listed.
   */
  get clean() { return [...(this.definition.clean ?? [])] }
  get run() { return this.definition.run }
}

export function stage(definition) {
  if (!definition?.name) throw new Error('A stage requires a name')
  if (typeof definition.run !== 'function') throw new Error(`Stage ${definition.name} requires a run function`)
  return new Stage(definition)
}

/**
 * Digest a stage artifact. Directories are hashed as their sorted file list so
 * a reordered readdir cannot look like a modification.
 */
export async function digestPath(path) {
  const entry = await statEntry(path)
  if (!entry) return null
  if (entry.isSymbolicLink()) return { kind: 'link', target: (await lstat(path)).isSymbolicLink() ? 'symlink' : 'file' }
  if (entry.isFile()) return { kind: 'file', sha256: await sha256File(path), size: entry.size }
  if (!entry.isDirectory()) return null
  const files = []
  const pending = [path]
  while (pending.length) {
    const directory = pending.pop()
    const names = (await readdir(directory)).sort((a, b) => a.localeCompare(b, 'en'))
    for (const name of names) {
      const child = join(directory, name)
      const childEntry = await statEntry(child)
      if (!childEntry) continue
      const rel = unix(relative(path, child))
      if (childEntry.isSymbolicLink()) files.push({ path: rel, kind: 'link' })
      else if (childEntry.isDirectory()) pending.push(child)
      else files.push({ path: rel, size: childEntry.size, sha256: await sha256File(child) })
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'))
  return { kind: 'tree', files, sha256: digest(JSON.stringify(files)) }
}

async function readCheckpoint(path) {
  if (!await pathExists(path)) return null
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    throw new Error(`Checkpoint is unreadable (${error.message}): ${path}`)
  }
}

function assertCheckpointMatches(checkpoint, workspace) {
  if (checkpoint.schemaVersion !== CHECKPOINT_SCHEMA_VERSION) {
    throw new Error(`Checkpoint schema ${checkpoint.schemaVersion} is unsupported (expected ${CHECKPOINT_SCHEMA_VERSION}): ${workspace.checkpointFile}`)
  }
  if (checkpoint.parametersDigest !== workspace.parametersDigest) {
    throw new Error(
      'Checkpoint was written for different pipeline arguments; ' +
      `remove ${workspace.checkpointFile} to build this workspace from scratch`,
    )
  }
}

function buildGraph(stages) {
  const graph = new Map()
  for (const entry of stages) {
    for (const name of [...entry.requires, ...entry.dependsOn]) {
      if (!stages.some(other => other.name === name)) throw new Error(`Stage ${entry.name} requires unknown stage ${name}`)
    }
    graph.set(entry.name, [...entry.requires, ...entry.dependsOn])
  }
  const order = []
  const state = new Map()
  const visit = (name, trail) => {
    if (state.get(name) === 'done') return
    if (state.get(name) === 'active') throw new Error(`Stage dependency cycle: ${[...trail, name].join(' -> ')}`)
    state.set(name, 'active')
    for (const dependency of graph.get(name) ?? []) visit(dependency, [...trail, name])
    state.set(name, 'done')
    order.push(name)
  }
  for (const entry of stages) visit(entry.name, [])
  return { graph, order: order.map(name => stages.find(entry => entry.name === name)) }
}

/** Every stage that transitively consumes `name`, including `name`. */
export function dependentsOf(stages, name) {
  const result = new Set([name])
  for (let grew = true; grew;) {
    grew = false
    for (const entry of stages) {
      if (result.has(entry.name)) continue
      if ([...entry.requires, ...entry.dependsOn].some(parent => result.has(parent))) {
        result.add(entry.name)
        grew = true
      }
    }
  }
  return result
}

/**
 * One output may only be created by one stage. Two stages writing the same tree
 * cannot be ordered against each other, so a parallel run would corrupt it; the
 * shared desktop product is instead created once and appended to afterwards by
 * stages that declare the appended paths, not the tree.
 */
function assertOutputOwnership(stages) {
  const owners = new Map()
  for (const entry of stages) {
    for (const output of [...entry.outputs, ...entry.mutableOutputs, ...entry.clean]) {
      const previous = owners.get(output)
      if (previous && previous !== entry.name) {
        throw new Error(`Stages ${previous} and ${entry.name} both create ${output}; only one stage may create an output`)
      }
      owners.set(output, entry.name)
    }
  }
}

function contractDigest(entry) {
  return digest(JSON.stringify({
    requires: entry.requires, dependsOn: entry.dependsOn, outputs: entry.outputs,
    mutableOutputs: entry.mutableOutputs, clean: entry.clean,
  }))
}

async function inputsDigest(entry, workspace) {
  const declared = entry.definition.inputs
  if (!declared) return digest('{}')
  const value = typeof declared === 'function' ? await declared(workspace) : declared
  return digest(JSON.stringify(value))
}

/**
 * A rerun of a stage starts by removing what that stage owns. The runner creates
 * these paths, so it may clear them; every stage script keeps its own "must be a
 * new directory" guard for direct CLI use, and the runner simply never trips it.
 *
 * Cleaning happens after the satisfied check, never before: a skipped stage's
 * artifacts must still be on disk for verification.
 */
async function cleanOutputs(entry, workspace, log) {
  const owned = [...entry.outputs, ...entry.mutableOutputs, ...entry.clean]
  for (const output of owned) {
    const path = workspace.resolvePath(output)
    if (!await pathExists(path)) continue
    log(`clean   ${entry.name} — ${output}`)
    await removeTree(path)
  }
}

async function recordArtifacts(entry, workspace) {
  const artifacts = {}
  for (const output of entry.outputs) {
    const path = workspace.resolvePath(output)
    const value = await digestPath(path)
    if (!value) {
      const error = new Error(`Stage ${entry.name} did not produce ${path}`)
      error.code = 'EDUWORK_MISSING_ARTIFACT'
      throw error
    }
    artifacts[output] = value
  }
  // A tree a later stage appends to has no stable digest. Record what this stage
  // created for diagnostics, but promise only that the tree still exists.
  for (const output of entry.mutableOutputs) {
    const path = workspace.resolvePath(output)
    const value = await digestPath(path)
    if (!value) {
      const error = new Error(`Stage ${entry.name} did not produce ${path}`)
      error.code = 'EDUWORK_MISSING_ARTIFACT'
      throw error
    }
    artifacts[output] = { kind: 'mutable', createdAs: value.kind === 'tree' ? value.sha256 : value.sha256 ?? null }
  }
  return artifacts
}

async function verifyArtifacts(entry, workspace, record) {
  for (const [output, recorded] of Object.entries(record.artifacts ?? {})) {
    const path = workspace.resolvePath(output)
    const actual = await digestPath(path)
    if (!actual) {
      const error = new Error(
        `Stage ${entry.name} is recorded as complete but ${path} is missing; ` +
        `remove ${workspace.checkpointFile} to rebuild this workspace`,
      )
      error.code = 'EDUWORK_VANISHED_ARTIFACT'
      throw error
    }
    if (recorded.kind === 'mutable') continue
    if (JSON.stringify(recorded) !== JSON.stringify(actual)) {
      const error = new Error(
        `Stage ${entry.name} output was modified after it was recorded: ${path}; ` +
        `remove ${workspace.checkpointFile} to rebuild this workspace`,
      )
      error.code = 'EDUWORK_MODIFIED_ARTIFACT'
      throw error
    }
  }
}

/**
 * A resumable build workspace. The checkpoint records the run arguments and the
 * artifact digest each stage produced. A later invocation may re-enter the same
 * workspace; it may not reinterpret it under different arguments, and it may not
 * find a recorded artifact missing or modified. Two stages that declare the same
 * output in the same workspace cannot run together, so a shared tree such as the
 * desktop product is only ever written by one stage at a time.
 */
export class Workspace {
  constructor({ root, checkpointFile, parameters = {}, stages = [], platform = process.platform }) {
    this.root = resolve(root)
    this.checkpointFile = resolve(checkpointFile ?? join(this.root, 'pipeline-checkpoint.json'))
    this.parameters = parameters
    this.parametersDigest = digest(JSON.stringify(parameters))
    this.platform = platform
    this.stages = stages
    this.byName = new Map(stages.map(entry => [entry.name, entry]))
    const { order } = buildGraph(stages)
    this.order = order
    assertOutputOwnership(stages)
    this.completed = new Map()
    this.executed = []
    this.skipped = []
    this.checkpoint = null
  }

  resolvePath(path) {
    const expanded = String(path).replace(/\{(\w+)\}/g, (unused, name) => {
      if (name === 'workspace') return this.root
      const value = this.parameters[name]
      if (value === undefined || value === null) throw new Error(`Path template uses an unknown parameter: {${name}}`)
      return String(value)
    })
    return resolve(this.root, expanded)
  }

  /**
   * Enter the workspace. A checkpoint authorizes re-entry; a non-empty directory
   * without one is a mistake unless the caller adopts it explicitly.
   */
  async enter({ force = false } = {}) {
    const existing = await readCheckpoint(this.checkpointFile)
    if (existing) {
      assertCheckpointMatches(existing, this)
      this.checkpoint = existing
      for (const [name, record] of Object.entries(existing.stages ?? {})) this.completed.set(name, record)
      return { reused: true }
    }
    if (await pathExists(this.root)) {
      const names = (await readdir(this.root)).filter(name => name !== 'pipeline-checkpoint.json')
      if (names.length && !force) {
        const error = new Error(
          `${this.root} is not empty and holds no pipeline checkpoint; ` +
          'move it away, pass --reuse-workspace to adopt it, or choose another --workspace',
        )
        error.code = 'EDUWORK_WORKSPACE_CONFLICT'
        throw error
      }
    }
    await ensureDir(this.root)
    this.checkpoint = {
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      kind: 'eduwork-build-checkpoint',
      platform: this.platform,
      workspace: this.root,
      pipeline: this.parameters,
      parametersDigest: this.parametersDigest,
      stages: {},
    }
    return { reused: false }
  }

  async save() {
    this.checkpoint.updatedAt = new Date().toISOString()
    await ensureDir(this.root)
    await writeText(this.checkpointFile, `${JSON.stringify(this.checkpoint, null, 2)}\n`)
  }

  /** Drop a stage and everything downstream of it, so a rerun rebuilds them. */
  invalidate(name) {
    if (!this.byName.has(name)) throw new Error(`Unknown stage: ${name}`)
    const affected = dependentsOf(this.stages, name)
    for (const entry of affected) {
      this.completed.delete(entry)
      delete this.checkpoint.stages[entry]
    }
    return [...affected]
  }
}

/**
 * Run the stages that are not already satisfied, in dependency order, with at
 * most `jobs` running at once. Independent stages overlap; a stage whose inputs
 * or recorded artifacts changed is rerun.
 */
export async function runStages(workspace, { jobs = 1, force = [], log = console.log } = {}) {
  const forced = new Set(force)
  const state = new Map(workspace.stages.map(entry => [entry.name, 'pending']))
  const failures = []
  const running = new Map()

  const runnable = entry => [...entry.requires, ...entry.dependsOn].every(name => state.get(name) === 'completed')

  const complete = async (entry) => {
    const dependencies = [...entry.requires, ...entry.dependsOn]
    const dependenciesDigest = digest(JSON.stringify(dependencies.map(name => [name, workspace.completed.get(name)?.sha256 ?? null])))
    const inputs = await inputsDigest(entry, workspace)
    const record = workspace.completed.get(entry.name)
    const satisfied = record
      && !forced.has(entry.name)
      && record.parametersDigest === inputs
      && record.dependenciesDigest === dependenciesDigest
      && record.contractDigest === contractDigest(entry)
    if (satisfied) {
      await verifyArtifacts(entry, workspace, record)
      workspace.skipped.push(entry.name)
      log(`skip    ${entry.name}${entry.description ? ` — ${entry.description}` : ''}`)
      return
    }
    log(`run     ${entry.name}${entry.description ? ` — ${entry.description}` : ''}`)
    const started = Date.now()
    await cleanOutputs(entry, workspace, log)
    await entry.run(workspace)
    const artifacts = await recordArtifacts(entry, workspace)
    const next = {
      parametersDigest: inputs,
      dependenciesDigest,
      contractDigest: contractDigest(entry),
      artifacts,
      sha256: digest(JSON.stringify(artifacts)),
      durationMs: Date.now() - started,
      completedAt: new Date().toISOString(),
    }
    workspace.completed.set(entry.name, next)
    workspace.checkpoint.stages[entry.name] = next
    workspace.executed.push(entry.name)
    await workspace.save()
    log(`done    ${entry.name} in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  }

  let wake = []
  let settled = false

  const notify = () => {
    const pending = wake
    wake = []
    for (const resolve of pending) resolve()
  }

  const attempt = async (entry) => {
    state.set(entry.name, 'running')
    try {
      await complete(entry)
      state.set(entry.name, 'completed')
    } catch (error) {
      state.set(entry.name, 'failed')
      failures.push({ name: entry.name, error })
    } finally {
      notify()
    }
  }

  // Workers take whichever stage is claimable now. Independent branches overlap;
  // a worker that finds nothing waits for the next completion rather than
  // assuming the rest is finished, since a dependency may still be in flight.
  const worker = async () => {
    while (!settled) {
      if (failures.length) return
      const entry = claim()
      if (entry) {
        await attempt(entry)
        continue
      }
      const allSettledNow = [...state.values()].every(value => value === 'completed' || value === 'failed')
      if (allSettledNow) return
      await new Promise(resolve => wake.push(resolve))
    }
  }

  const claim = () => {
    for (const entry of workspace.order) {
      if (state.get(entry.name) !== 'pending') continue
      if (!runnable(entry)) continue
      return entry
    }
    return null
  }

  await Promise.all(Array.from({ length: Math.max(1, jobs) }, () => worker()))
  settled = true

  const blocked = workspace.stages.filter(entry => state.get(entry.name) === 'pending').map(entry => entry.name)
  if (failures.length) {
    const first = failures[0]
    const error = new Error(`Stage ${first.name} failed: ${first.error.message}`)
    error.cause = first.error
    error.failures = failures
    error.blocked = blocked
    // A single failing stage keeps its own code so callers can react to a
    // vanished or modified artifact rather than parsing the message.
    if (failures.length === 1) error.code = first.error.code
    throw error
  }
  return { executed: workspace.executed, skipped: workspace.skipped }
}
