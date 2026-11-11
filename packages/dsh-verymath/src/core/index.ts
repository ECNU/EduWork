/**
 * Service Definition for the VeryMath capability seam (`ctx.verymath`):
 * glossary library resolution and querying, Python interpreter discovery for
 * the upstream `math-glossary` scripts, and registration of the bundled
 * VeryMath skills into the DSH skill registry.
 * @module @eduwork/dsh-verymath/core
 */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { normalize } from 'node:path'
import { isErrnoCode, VeryMathError } from './error.ts'
import { parseGlossary, queryGlossary, validateGlossaryInvariants, type GlossaryHit, type GlossaryQueryOptions, type GlossaryTerm } from './glossary.ts'
import { bundledSkillsDir } from './paths.ts'
import { VeryMathSkillProvider } from './skills.ts'

export { VeryMathError, isVeryMathError, isErrnoCode } from './error.ts'
export { bundledSkillsDir } from './paths.ts'
export { VeryMathSkillProvider } from './skills.ts'
export { parseGlossary, queryGlossary, sortGlossary, upsertTerms, deleteTerm, validateGlossaryInvariants } from './glossary.ts'
export type { GlossaryHit, GlossaryQueryOptions, GlossaryTerm, TermUpsert, UpsertResult, DeleteResult } from './glossary.ts'
export { parsePaperStructure, parsePaperBatch, dependencySummary } from './paper.ts'
export {
  checkGate, checkGoalApproval, checkWorkstreamCompletion, checkFinalRender,
  loadGoals, listWorkstreams, hasSection,
} from './gates.ts'
export type { GateResult } from './gates.ts'
export {
  loadManifest, searchSageRefs, scoreRow, termsFor, findExcerpt,
  readCorpusDoc, readCorpusDocWindow, resolveCorpusRoot, defaultCorpusRoot, docPath,
} from './sage.ts'
export type { SageRefRow, SageRefHit } from './sage.ts'
export {
  mergeBatches, mergeStructures, collectEntities, collectMainTheorems, computeTopology, renderMermaid, focusClosure,
  mermaidDisplayText, stripUncertain, isSingleStructure, requireStructure,
} from './graph.ts'
export type {
  StructureInput, MergeReport, EntityTopology, DependencyCycle, GraphTopology, FocusResult,
} from './graph.ts'
export type {
  PaperStructure, PaperMeta, PaperSection, PaperEntity, PaperTable,
  MainTheorem, ProofMethod, ProofFramework, CompletenessCheck, RelatedWorkEntry,
} from './paper.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    verymath: VeryMathRuntime
  }
}

/** Where one glossary lives and what it contains. */
export interface GlossaryLibrary {
  /** Absolute path of the glossary JSON document. */
  readonly path: string
  /** Parsed terms in stored order. */
  readonly terms: GlossaryTerm[]
}

/** Result of running one upstream Python script. */
export interface PythonRunResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

/** Config for the VeryMath seam. */
export interface VeryMathRuntimeConfig {
  /**
   * Explicit Python executable used for the upstream `math-glossary` scripts.
   * Omitted resolves `DSH_OFFICE_PYTHON`, then `python3`, then `python`.
   */
  readonly pythonExecutable?: string
  /** Default hit cap for glossary queries. */
  readonly queryMaxHits?: number
}

/**
 * The VeryMath access service, registered as `ctx.verymath`. Owns glossary
 * parsing/querying, Python discovery, and bundled-skill registration.
 */
export class VeryMathRuntime extends Service {
  /** The bundled-skill provider needs the host skill registry. */
  static inject = ['skills']
  static Config: z<VeryMathRuntimeConfig> = z.object({
    pythonExecutable: z.string(),
    queryMaxHits: z.number(),
  })

  /** Resolved service config with every default applied. */
  readonly config: Required<VeryMathRuntimeConfig>

  private readonly glossaryCache = new Map<string, GlossaryTerm[]>()
  private readonly glossaryWrites = new Map<string, Promise<unknown>>()
  private pythonProbe: Promise<string | undefined> | undefined

  constructor(ctx: Context, config: VeryMathRuntimeConfig = {}) {
    super(ctx, 'verymath')
    this.config = {
      pythonExecutable: config.pythonExecutable ?? process.env.DSH_OFFICE_PYTHON ?? 'python3',
      queryMaxHits: config.queryMaxHits ?? 20,
    }
    this.registerBundledSkills(ctx)
  }

  /**
   * Register the bundled-skill provider on the DSH skill registry when the
   * host provides one. Registration is global-layer (unscoped context); the
   * returned disposer is folded into this service's lifecycle so plugin
   * unload removes the provider and invalidates skill catalogs.
   */
  private registerBundledSkills(ctx: Context): void {
    const skills = ctx.get('skills')
    if (skills === undefined) {
      this.ctx.logger?.warn?.('verymath: skills service unavailable; bundled skills not registered')
      return
    }
    const dispose = skills.registerProvider(() => new VeryMathSkillProvider())
    this.ctx.effect(() => dispose, 'verymath bundled skills')
  }

  /**
   * Load and validate a glossary JSON document from disk. Valid documents are
   * cached by absolute path; invalid ones raise `VERYMATH_GLOSSARY_*`.
   * @param path - absolute or workspace-relative path of `glossary.json`.
   * @param signal - cancels the read.
   */
  async loadGlossary(path: string, signal?: AbortSignal): Promise<GlossaryLibrary> {
    const key = normalize(path)
    const cached = this.glossaryCache.get(key)
    if (cached !== undefined) return { path: key, terms: cached }
    let raw: string
    try {
      raw = await readFile(key, { encoding: 'utf8', ...(signal !== undefined ? { signal } : {}) })
    } catch (error) {
      // Only a genuinely absent file means "there is no glossary yet". Treating
      // every read failure that way let an EACCES/EIO/abort turn into "start from
      // an empty glossary", and the next write then replaced the real document.
      if (isErrnoCode(error, 'ENOENT')) {
        throw new VeryMathError(
          `cannot read glossary at ${key}: ${error instanceof Error ? error.message : String(error)}`,
          'VERYMATH_GLOSSARY_UNAVAILABLE',
          { cause: error },
        )
      }
      if (error instanceof Error && error.name === 'AbortError') throw error
      throw new VeryMathError(
        `cannot read glossary at ${key}: ${error instanceof Error ? error.message : String(error)}`,
        'VERYMATH_IO',
        { cause: error },
      )
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      throw new VeryMathError(`glossary at ${key} is not valid JSON`, 'VERYMATH_GLOSSARY_INVALID', { cause: error })
    }
    const terms = parseGlossary(parsed)
    validateGlossaryInvariants(terms)
    this.glossaryCache.set(key, terms)
    return { path: key, terms }
  }

  /** Forget any cached glossary for `path` so a later load re-reads from disk. */
  invalidateGlossary(path: string): void {
    this.glossaryCache.delete(normalize(path))
  }

  /**
   * Re-read a glossary from disk, discarding any cached snapshot. Callers that
   * are about to rewrite the document must use this rather than
   * {@link loadGlossary}: the query cache is only invalidated by this package's
   * own writes, so a document edited by the user (or by the bundled
   * `glossary_web.py`) would otherwise be overwritten from a stale snapshot.
   * @param path - absolute or workspace-relative path of `glossary.json`.
   * @param signal - cancels the read.
   */
  reloadGlossary(path: string, signal?: AbortSignal): Promise<GlossaryLibrary> {
    this.invalidateGlossary(path)
    return this.loadGlossary(path, signal)
  }

  /**
   * Serialize read-modify-write cycles on one glossary document. Two concurrent
   * upserts on the same file would otherwise both read one snapshot and the
   * later write would silently drop the earlier update.
   * @param path - glossary document path; the lock key is the normalized path.
   * @param task - the whole read-modify-write, run after any in-flight task.
   */
  async withGlossaryWrite<T>(path: string, task: () => Promise<T>): Promise<T> {
    const key = normalize(path)
    const previous = this.glossaryWrites.get(key) ?? Promise.resolve()
    // `then(task, task)` so one failed writer does not wedge the queue.
    const run = previous.then(task, task)
    const chained = run.then(() => undefined, () => undefined)
    this.glossaryWrites.set(key, chained)
    try {
      return await run
    } finally {
      if (this.glossaryWrites.get(key) === chained) this.glossaryWrites.delete(key)
    }
  }

  /** Forget every cached glossary (used when a build script's output path is unknown). */
  invalidateAllGlossaries(): void {
    this.glossaryCache.clear()
  }

  /**
   * Query a glossary document for terms matching a bilingual query.
   * @param path - glossary document path.
   * @param query - English term, Chinese term, term_id, or subfield name.
   * @param signal - cancels the load.
   */
  async queryGlossaryFile(path: string, query: string, options: GlossaryQueryOptions & { signal?: AbortSignal } = {}): Promise<{ hits: GlossaryHit[], total: number }> {
    const { signal, ...queryOptions } = options
    const { terms } = await this.loadGlossary(path, signal)
    return queryGlossary(terms, query, { limit: this.config.queryMaxHits, ...queryOptions })
  }

  /**
   * Locate a Python interpreter able to run the upstream `math-glossary`
   * scripts: the configured executable, then `python3`, then `python`.
   * Resolution runs once and is cached; missing interpreters map to
   * `VERYMATH_PYTHON_UNAVAILABLE` at call sites.
   * @returns the resolved executable, or undefined when none was found.
   */
  async resolvePython(): Promise<string | undefined> {
    this.pythonProbe ??= this.probePython()
    return this.pythonProbe
  }

  private async probePython(): Promise<string | undefined> {
    const candidates = [...new Set([this.config.pythonExecutable, 'python3', 'python'])]
    for (const candidate of candidates) {
      const probe = await this.runPython(candidate, ['--version'], 5_000).catch(() => undefined)
      if (probe !== undefined && probe.exitCode === 0) return candidate
    }
    return undefined
  }

  /**
   * Run one upstream `math-glossary` script with the resolved interpreter.
   * @param script - script filename inside the upstream `scripts/` directory.
   * @param args - argument list passed to the script.
   * @param timeoutMs - hard kill timeout (default 120s).
   */
  async runGlossaryScript(script: string, args: readonly string[], timeoutMs = 120_000): Promise<PythonRunResult> {
    const python = await this.resolvePython()
    if (python === undefined) {
      throw new VeryMathError(
        'no Python interpreter found; install Python 3 and either set the verymath.pythonExecutable config or DSH_OFFICE_PYTHON',
        'VERYMATH_PYTHON_UNAVAILABLE',
      )
    }
    if (!/^[\w.-]+\.py$/.test(script)) {
      throw new VeryMathError(`invalid glossary script name ${JSON.stringify(script)}`, 'VERYMATH_IO')
    }
    const scriptPath = bundledSkillsDir() + '/math-glossary/scripts/' + script
    return this.runPython(python, [scriptPath, ...args], timeoutMs)
  }

  /**
   * Run a Python executable directly with an explicit argument list. Public on
   * purpose for skill-script bridges (e.g. the after-ocr scanner) whose files
   * are bundled inside the plugin package; call sites must keep the script
   * path inside the package and the argument list fully constructed.
   */
  runPythonCommand(executable: string, args: readonly string[], timeoutMs?: number): Promise<PythonRunResult> {
    return this.runPython(executable, args, timeoutMs ?? 60_000)
  }

  private runPython(executable: string, args: readonly string[], timeoutMs: number): Promise<PythonRunResult> {
    return new Promise((resolvePromise, rejectPromise) => {
      let child: ReturnType<typeof spawn>
      try {
        child = spawn(executable, [...args], { stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (error) {
        rejectPromise(error)
        return
      }
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      const out = child.stdout
      const err = child.stderr
      if (out === null || err === null) {
        rejectPromise(new VeryMathError('python subprocess streams unavailable', 'VERYMATH_IO'))
        return
      }
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        rejectPromise(new VeryMathError(`python run exceeded ${timeoutMs}ms`, 'VERYMATH_IO'))
      }, timeoutMs)
      out.on('data', (chunk: Buffer) => stdout.push(chunk))
      err.on('data', (chunk: Buffer) => stderr.push(chunk))
      child.on('error', (error) => {
        clearTimeout(timer)
        rejectPromise(error)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolvePromise({
          exitCode: code ?? -1,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        })
      })
    })
  }
}

export default VeryMathRuntime
