// Declarative build stages: each stage declares the stages it consumes and the
// parameters that change its output, so the runner can order them, run
// independent ones together and leave a checkpoint a later invocation trusts.
// Nothing here knows about macOS, Windows or Web assembly; an orchestrator
// supplies the stages and the platform behaviour.
import { createHash } from 'node:crypto'
import { lstat, mkdir, readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import {
  ensureDir, pathExists, removeTree, sha256File, sleep, statEntry, writeText,
} from './build-util.mjs'

export const CHECKPOINT_SCHEMA_VERSION = 1

// How thorough an artifact check is. Recorded per artifact so a later run knows
// what the recorded digest actually proves.
//
//   bytes — every file was hashed. The strongest check, and the default.
//   size  — only the file list and byte sizes were compared. Detects a missing
//           or added file, and a changed file only when its size changed. Cheap
//           on a large tree, and the honest choice when hashing it would cost
//           more than rebuilding the stage it guards.
//   trust — the path was recorded but not checked. Selected explicitly, and
//           reported at every re-entry so it can never be mistaken for a check.
export const VERIFY_BYTES = 'bytes'
export const VERIFY_SIZE = 'size'
export const VERIFY_TRUST = 'trust'

/**
 * Byte budget for one artifact digest. Below it, files are hashed; above it the
 * digest falls back to the file list and sizes. 2 GiB is where hashing starts to
 * cost more than the rebuild it protects on the trees this pipeline produces.
 */
export const DEFAULT_DIGEST_BUDGET_BYTES = 2 * 1024 * 1024 * 1024

const unix = path => path.split(sep).join('/')
const digest = value => createHash('sha256').update(value).digest('hex')

/**
 * Walk a path and describe it. `budget` bounds the work: a tree larger than the
 * budget is described by its file list and sizes instead of its contents, and
 * the caller is told which happened.
 */
export async function digestPath(path, { budget = DEFAULT_DIGEST_BUDGET_BYTES } = {}) {
  const entry = await statEntry(path)
  if (!entry) return null
  if (entry.isSymbolicLink()) return { kind: 'link', target: (await lstat(path)).isSymbolicLink() ? 'symlink' : 'file' }
  if (entry.isFile()) {
    // A single file over budget is still hashed: one large file is a bounded
    // read, unlike a tree of tens of thousands of small ones.
    return { kind: 'file', verify: VERIFY_BYTES, sha256: await sha256File(path), size: entry.size }
  }
  if (!entry.isDirectory()) return null
  const files = []
  let totalBytes = 0
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
      else {
        files.push({ path: rel, size: childEntry.size })
        totalBytes += childEntry.size
      }
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'))
  const verify = totalBytes > budget ? VERIFY_SIZE : VERIFY_BYTES
  if (verify === VERIFY_BYTES) {
    for (const row of files) {
      if (row.kind === 'link') continue
      row.sha256 = await sha256File(join(path, ...row.path.split('/')))
    }
  }
  return {
    kind: 'tree',
    verify,
    bytes: totalBytes,
    files,
    sha256: digest(JSON.stringify(files)),
  }
}

/** The two digests are comparable only when both were taken the same way. */
function sameVerification(recorded, actual) {
  if (recorded.verify === VERIFY_TRUST || actual.verify === VERIFY_TRUST) return false
  // A single file or a link has no depth to choose: it is hashed or it is a
  // pointer, so its record needs no marker.
  const depthOf = value => value.verify ?? VERIFY_BYTES
  return depthOf(recorded) === depthOf(actual)
}


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
  /**
   * How the runner verifies this stage's artifacts on re-entry. Defaults to the
   * workspace budget: hash everything under it, and fall back to the file list
   * plus sizes for a tree too large to hash cheaply. `'trust'` records the
   * artifacts without checking them, which is only ever right for something the
   * build regenerates from scratch anyway.
   */
  get verify() { return this.definition.verify }
  /** Per-stage override of the workspace digest budget. */
  get digestBudget() { return this.definition.digestBudget }
  get run() { return this.definition.run }
}

export function stage(definition) {
  if (!definition?.name) throw new Error('A stage requires a name')
  if (typeof definition.run !== 'function') throw new Error(`Stage ${definition.name} requires a run function`)
  return new Stage(definition)
}

/** Whether a pid is alive. EPERM means it exists but belongs to another user. */
function processAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
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
  if (JSON.stringify(checkpoint.pipeline?.sourceIdentity) !== JSON.stringify(workspace.parameters.sourceIdentity)) {
    const error = new Error('Source inputs changed since this checkpoint; use a new build workspace')
    error.code = 'EDUWORK_SOURCE_CHANGED'
    throw error
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
    mutableOutputs: entry.mutableOutputs, clean: entry.clean, verify: entry.verify ?? null,
  }))
}

/** How thorough a check this stage's artifacts get, and the budget that decides it. */
function verificationOf(entry, workspace) {
  return {
    mode: entry.verify ?? VERIFY_BYTES,
    budget: entry.digestBudget ?? workspace.digestBudget,
  }
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
  const { mode, budget } = verificationOf(entry, workspace)
  const artifacts = {}
  for (const output of entry.outputs) {
    const path = workspace.resolvePath(output)
    if (mode === VERIFY_TRUST) {
      if (!await pathExists(path)) {
        const error = new Error(`Stage ${entry.name} did not produce ${path}`)
        error.code = 'EDUWORK_MISSING_ARTIFACT'
        throw error
      }
      artifacts[output] = { kind: 'trusted' }
      continue
    }
    const value = await digestPath(path, { budget })
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
    if (!await pathExists(path)) {
      const error = new Error(`Stage ${entry.name} did not produce ${path}`)
      error.code = 'EDUWORK_MISSING_ARTIFACT'
      throw error
    }
    const value = mode === VERIFY_TRUST ? null : await digestPath(path, { budget })
    artifacts[output] = {
      kind: 'mutable',
      createdAs: value?.sha256 ?? null,
      createdVerify: value?.verify ?? null,
    }
  }
  return artifacts
}

/**
 * Confirm a recorded artifact is still the one the checkpoint described.
 *
 * A `size` digest is genuinely weaker than a `bytes` digest, so it is reported
 * rather than passed over: the operator should know a stage was admitted on
 * sizes alone. A `trust` record is not a check at all and says so every time.
 */
async function verifyArtifacts(entry, workspace, record, log) {
  const { budget } = verificationOf(entry, workspace)
  for (const [output, recorded] of Object.entries(record.artifacts ?? {})) {
    const path = workspace.resolvePath(output)
    if (recorded.kind === 'trusted') {
      if (!await pathExists(path)) {
        const error = new Error(
          `Stage ${entry.name} is recorded as complete but ${path} is missing; ` +
          `remove ${workspace.checkpointFile} to rebuild this workspace`,
        )
        error.code = 'EDUWORK_VANISHED_ARTIFACT'
        throw error
      }
      log(`note    ${entry.name} — ${output} was recorded unverified (verify: trust)`)
      continue
    }
    const actual = await digestPath(path, { budget })
    if (!actual) {
      const error = new Error(
        `Stage ${entry.name} is recorded as complete but ${path} is missing; ` +
        `remove ${workspace.checkpointFile} to rebuild this workspace`,
      )
      error.code = 'EDUWORK_VANISHED_ARTIFACT'
      throw error
    }
    // A mutable tree is appended to by later stages, so its digest is not a
    // fingerprint; existence was the promise. The appended paths are checked by
    // whichever stage declares them.
    if (recorded.kind === 'mutable') continue
    // Comparing a size digest against a bytes digest would report a mismatch
    // that says nothing about the artifact. Re-digest rather than compare
    // unlike records, and report the weaker one.
    if (!sameVerification(recorded, actual)) {
      log(`note    ${entry.name} — ${output} recorded as ${recorded.verify ?? VERIFY_BYTES}, re-checked as ${actual.verify}; treating as changed`)
      const error = new Error(
        `Stage ${entry.name} output was recorded with a different verification depth: ${path}; ` +
        `remove ${workspace.checkpointFile} to rebuild this workspace`,
      )
      error.code = 'EDUWORK_MODIFIED_ARTIFACT'
      throw error
    }
    if (actual.verify === VERIFY_SIZE) {
      log(`note    ${entry.name} — ${output} verified by size only (${actual.bytes} bytes over the digest budget)`)
    }
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
  constructor({
    root, checkpointFile, parameters = {}, stages = [], platform = process.platform,
    digestBudget = DEFAULT_DIGEST_BUDGET_BYTES, lockWaitMs = 0,
  }) {
    this.root = resolve(root)
    this.checkpointFile = resolve(checkpointFile ?? join(this.root, 'pipeline-checkpoint.json'))
    this.lockFile = `${this.checkpointFile}.lock`
    this.parameters = parameters
    this.parametersDigest = digest(JSON.stringify(parameters))
    this.platform = platform
    this.stages = stages
    this.byName = new Map(stages.map(entry => [entry.name, entry]))
    const { order } = buildGraph(stages)
    this.order = order
    assertOutputOwnership(stages)
    this.digestBudget = digestBudget
    this.lockWaitMs = lockWaitMs
    this.completed = new Map()
    this.executed = []
    this.skipped = []
    this.checkpoint = null
    this.released = false
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
   *
   * Entry takes an exclusive lock on the workspace. Two processes sharing one
   * workspace would interleave stage runs and overwrite each other's checkpoint
   * records, and the one-owner-per-output rule below only holds inside a single
   * process. The lock is released by `release()`, which every entry point must
   * call in a `finally`.
   */
  async enter({ force = false, log = console.log } = {}) {
    await this.acquireLock({ log })
    try {
      const existing = await readCheckpoint(this.checkpointFile)
      if (existing) {
        assertCheckpointMatches(existing, this)
        this.assertCatalogUnchanged(existing, log)
        this.checkpoint = existing
        for (const [name, record] of Object.entries(existing.stages ?? {})) this.completed.set(name, record)
        return { reused: true }
      }
      if (await pathExists(this.root)) {
        // The lock directory is taken before this check, so it is not foreign
        // content; neither is a checkpoint, which is handled above.
        const ours = new Set([this.checkpointFile, this.lockFile])
        const names = (await readdir(this.root))
          .map(name => join(this.root, name))
          .filter(path => !ours.has(path))
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
        catalogDigest: this.catalogDigest(),
        stages: {},
      }
      return { reused: false }
    } catch (error) {
      // A failed entry must not hold the lock; a stale lock would block every
      // later run until someone noticed. A lock this process already held before
      // the failed entry is not ours to drop.
      if (!this.lockReentered) await this.release(log)
      throw error
    }
  }

  /** A digest of the stage catalog itself, so a changed pipeline is detectable. */
  catalogDigest() {
    return digest(JSON.stringify(this.stages.map(entry => ({
      name: entry.name,
      requires: entry.requires,
      dependsOn: entry.dependsOn,
      outputs: entry.outputs,
      mutableOutputs: entry.mutableOutputs,
      clean: entry.clean,
    })).sort((a, b) => a.name.localeCompare(b.name, 'en'))))
  }

  /**
   * Compare the checkpoint's stage set with the one this run was given.
   *
   * Without this, a stage that was deleted would leave its record behind
   * forever, and — worse — a stage whose *dependencies* were narrowed would keep
   * reusing a `dependenciesDigest` computed from an edge that no longer exists.
   * Both are silent: the recorded artifacts are still on disk, so nothing else
   * notices. A pipeline whose shape changed is not the pipeline that produced
   * this workspace, so the mismatch stops the run instead of being absorbed.
   */
  assertCatalogUnchanged(checkpoint, log) {
    const recorded = checkpoint.catalogDigest
    // A checkpoint written before the catalog was recorded cannot be compared;
    // adopting it silently would be exactly the silent reuse this prevents.
    if (!recorded) {
      const error = new Error(
        `Checkpoint records no stage catalog; it predates this check: ${this.checkpointFile}. ` +
        'Remove it to rebuild this workspace',
      )
      error.code = 'EDUWORK_CATALOG_CHANGED'
      throw error
    }
    if (recorded === this.catalogDigest()) return
    const recordedNames = new Set(Object.keys(checkpoint.stages ?? {}))
    const currentNames = new Set(this.stages.map(entry => entry.name))
    const removed = [...recordedNames].filter(name => !currentNames.has(name)).sort()
    const added = [...currentNames].filter(name => !recordedNames.has(name)).sort()
    const detail = [
      removed.length ? `stages recorded but no longer declared: ${removed.join(', ')}` : '',
      added.length ? `stages added since the checkpoint: ${added.join(', ')}` : '',
      !removed.length && !added.length ? 'a stage\'s declared dependencies or outputs changed' : '',
    ].filter(Boolean).join('; ')
    log(`note    stage catalog differs from the checkpoint — ${detail}`)
    const error = new Error(
      `The stage catalog changed since this workspace was built (${detail}); ` +
      `remove ${this.checkpointFile} to rebuild this workspace from scratch`,
    )
    error.code = 'EDUWORK_CATALOG_CHANGED'
    error.removedStages = removed
    error.addedStages = added
    throw error
  }

  /**
   * Take the workspace lock. The lock is a directory, created atomically, which
   * is the one filesystem operation that is atomic on every platform this build
   * supports. The owner record lets a later run recover a lock whose process is
   * gone, so a killed build does not strand the workspace.
   */
  async acquireLock({ log = console.log } = {}) {
    await ensureDir(this.root)
    const deadline = this.lockWaitMs > 0 ? Date.now() + this.lockWaitMs : 0
    let announced = false
    for (;;) {
      try {
        await mkdir(this.lockFile)
        await writeText(join(this.lockFile, 'owner.json'), `${JSON.stringify({
          pid: process.pid, startedAt: new Date().toISOString(), platform: this.platform,
        }, null, 2)}\n`)
        this.lockOwner = { pid: process.pid }
        return
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
      }
      let owner = null
      try {
        owner = JSON.parse(await readFile(join(this.lockFile, 'owner.json'), 'utf8'))
      } catch {
        // The owner record may not be written yet, or the holder is releasing.
      }
      // A lock this process already holds is re-entrant. The entry points run one
      // workspace at a time, and a caller may legitimately enter, run, and enter
      // again; the lock exists to keep a *second* process out, not to serialize a
      // process against itself.
      if (owner?.pid === process.pid) {
        this.lockOwner = owner
        // Marked as ours from a previous entry in this process, so a later
        // failed `enter` must not release a lock the first entry still needs.
        this.lockReentered = true
        return
      }
      if (owner?.pid && !processAlive(owner.pid)) {
        log(`note    recovered workspace lock after a stopped process (pid ${owner.pid})`)
        await removeTree(this.lockFile)
        continue
      }
      if (!owner?.pid) {
        // A lock directory with no owner record is a process between mkdir and
        // write. Give it a moment before deciding it is debris.
        await sleep(500)
        const still = await statEntry(this.lockFile)
        if (still) {
          let recheck = null
          try {
            recheck = JSON.parse(await readFile(join(this.lockFile, 'owner.json'), 'utf8'))
          } catch {
            // Still no owner.
          }
          if (!recheck?.pid) {
            const age = Date.now() - still.mtimeMs
            if (age > 60000) {
              log('note    recovered workspace lock with no owner record')
              await removeTree(this.lockFile)
              continue
            }
          }
        }
        continue
      }
      if (!announced) {
        log(`waiting for workspace lock held by pid ${owner.pid}${owner.startedAt ? ` since ${owner.startedAt}` : ''}`)
        announced = true
      }
      if (deadline && Date.now() > deadline) {
        const error = new Error(
          `Workspace is locked by pid ${owner.pid}; ${this.root} is in use. ` +
          'Wait for that run, or use a different --workspace',
        )
        error.code = 'EDUWORK_WORKSPACE_LOCKED'
        throw error
      }
      await sleep(1000)
    }
  }

  /** Release the lock. Safe to call more than once. */
  async release(log = console.log) {
    if (this.released) return
    this.released = true
    if (!this.lockOwner) return
    // Only remove a lock this process still owns; another process may have
    // recovered it after a crash, and deleting its lock would let two runs in.
    try {
      const owner = JSON.parse(await readFile(join(this.lockFile, 'owner.json'), 'utf8'))
      if (owner?.pid !== process.pid) return
    } catch {
      return
    }
    await removeTree(this.lockFile).catch(error => log(`note    could not release workspace lock: ${error.message}`))
  }

  async save() {
    this.checkpoint.updatedAt = new Date().toISOString()
    this.checkpoint.catalogDigest = this.catalogDigest()
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
 * Group the stages into the waves a perfectly parallel run would produce: every
 * stage in a wave can run at once, and each wave depends only on earlier ones.
 * This is derived from the declared edges rather than hand-written, so it cannot
 * drift from the graph.
 */
export function parallelSets(stages) {
  const depth = new Map()
  const visiting = new Set()
  const depthOf = name => {
    if (depth.has(name)) return depth.get(name)
    // A cycle is rejected by the graph builder before a run starts; this guard
    // keeps the helper safe to call on its own instead of recursing forever.
    if (visiting.has(name)) return 0
    const entry = stages.find(candidate => candidate.name === name)
    if (!entry) return 0
    visiting.add(name)
    const dependencies = [...entry.requires, ...entry.dependsOn]
    const value = dependencies.length ? Math.max(...dependencies.map(depthOf)) + 1 : 0
    visiting.delete(name)
    depth.set(name, value)
    return value
  }
  for (const entry of stages) depthOf(entry.name)
  const byLevel = new Map()
  for (const entry of stages) {
    const level = depth.get(entry.name)
    if (!byLevel.has(level)) byLevel.set(level, [])
    byLevel.get(level).push(entry.name)
  }
  // Dense, lowest level first. A cycle can leave level 0 unused, and an array
  // with a hole in it would make the widest-wave reduction below return NaN.
  return [...byLevel.keys()].sort((a, b) => a - b).map(level => byLevel.get(level))
}

/**
 * Run a workspace to completion and always give up its lock.
 *
 * Every entry point should call this rather than `runStages` directly: the lock
 * taken by `enter` has to be released whether the run passed, failed or threw,
 * and a leaked lock would block the next invocation until someone removed it by
 * hand.
 */
export async function runPipeline(workspace, options = {}) {
  const log = options.log ?? console.log
  try {
    return await runStages(workspace, options)
  } finally {
    await workspace.release(log)
  }
}

/**
 * The widest wave: how many stages a run can usefully execute at once. Asking
 * for more workers than this can never finish sooner, which is what makes it a
 * defensible default for `jobs`.
 */
export function maxParallelism(stages) {
  return Math.max(1, ...parallelSets(stages).map(wave => wave.length))
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
      await verifyArtifacts(entry, workspace, record, log)
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
    // A failed run still gives up the workspace: the checkpoint on disk is
    // consistent, and holding the lock would block the rerun that fixes it.
    // Releasing here as well as in `runPipeline` is deliberate — a caller that
    // reaches the runner directly must not strand a lock — and `release` is
    // idempotent.
    await workspace.release(log)
    throw error
  }
  await workspace.release(log)
  return { executed: workspace.executed, skipped: workspace.skipped }
}
