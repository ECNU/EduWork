/**
 * Model-facing VeryMath tools over `ctx.verymath`: bilingual glossary query
 * and Python-bridged glossary construction, plus paper-structure validation
 * for the adaptive `math-paper-reading` skill artifacts.
 * @module @eduwork/dsh-verymath/tool
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {} from '@deepseek-ai/dsh-fs'
import { spawn } from 'node:child_process'
import { isAbsolute, resolve } from 'node:path'
import { VeryMathError, isVeryMathError } from '../core/index.ts'
import { bundledSkillsDir, checkGate, computeTopology, dependencySummary, executableSearchDirs, findExcerpt, focusClosure, loadManifest, mergeBatches, mergeStructures, parsePaperBatch, parsePaperStructure, readCorpusDocWindow, renderMermaid, resolveCorpusRoot, resolveExecutable, resolveSageExecutable, sageSearchDirs, searchSageRefs, termsFor, upsertTerms, type GateResult, type TermUpsert } from '../core/index.ts'


// Re-exported for the tool-level tests and for callers that imported these from
// the tool module before they moved into `core`. There is exactly one
// implementation now — two copies used to drift, which is how the panel ended up
// reporting SageMath missing while `verymath_sage_check` found it.
export { executableSearchDirs, resolveExecutable, resolveSageExecutable, sageSearchDirs }

export const name = 'tool-verymath'
export const inject = ['tools', 'verymath', 'fs']

/** Config for the tool layer. */
export interface Config {
  /**
   * Default glossary document path used when a call omits `glossaryPath`.
   * Relative paths resolve against the calling agent's workspace cwd.
   */
  readonly glossaryHome?: string
}

export const Config: z<Config> = z.object({
  glossaryHome: z.string(),
})

/** The `verymath_glossary_query` canonical value. */
interface GlossaryQueryJson {
  readonly query: string
  readonly glossary: string
  readonly total: number
  readonly terms: Array<{
    readonly term_id: string
    readonly en: string
    readonly cn: string
    readonly matchedBy: string
    readonly pos?: string
    readonly field?: readonly string[]
    readonly source?: string
    readonly examples?: readonly { readonly en: string; readonly cn: string }[]
  }>
}

/** The `verymath_glossary_build` canonical value. */
interface GlossaryBuildJson {
  readonly script: string
  readonly args: readonly string[]
  readonly exitCode: number
  readonly output: string
  readonly pythonExecutable: string
  readonly status: 'completed' | 'partial' | 'needs-force'
}

/** The `verymath_python_check` canonical value. */
interface PythonCheckJson {
  readonly available: boolean
  readonly executable?: string
  readonly hint?: string
}

/** One probed piece of the math-beamer TeX toolchain. */
interface BeamerToolProbe {
  readonly name: string
  /** `binary` = executable on PATH (latexmk, xelatex); `style` = LaTeX package via kpsewhich (forest, ctex). */
  readonly kind: 'binary' | 'style'
  readonly available: boolean
  readonly executable?: string
}

/** The `verymath_beamer_check` canonical value. */
interface BeamerCheckJson {
  readonly available: boolean
  readonly tools: readonly BeamerToolProbe[]
  readonly hint?: string
}

/** The `verymath_paper_validate` canonical value. */
interface PaperValidateJson {
  readonly title: string
  readonly entityCount: number
  readonly mainTheoremCount: number
  readonly sectionCount: number
  readonly roots: readonly string[]
  readonly completeness: string
  readonly valid: true
}

/** Render a glossary query result as a readable bilingual list. */
function renderGlossaryQuery(_args: unknown, value: unknown): ContentBlock[] {
  const result = value as GlossaryQueryJson
  if (result.terms.length === 0) {
    return [{ type: 'text', text: `No glossary terms matched ${JSON.stringify(result.query)}.` }]
  }
  const lines = result.terms.map((term) => {
    const extras = [
      term.pos !== undefined ? `pos: ${term.pos}` : undefined,
      term.field !== undefined && term.field.length > 0 ? `field: ${term.field.join(', ')}` : undefined,
      term.source !== undefined ? `source: ${term.source}` : undefined,
    ].filter((part): part is string => part !== undefined)
    const examples = term.examples !== undefined && term.examples.length > 0
      ? term.examples.slice(0, 2).map(example => `  ex: ${example.en} — ${example.cn}`)
      : []
    return [
      `- ${term.en} | ${term.cn} (${term.matchedBy}${extras.length > 0 ? `; ${extras.join('; ')}` : ''})`,
      ...examples,
    ].join('\n')
  })
  const note = result.total > result.terms.length ? `\n(showing ${result.terms.length} of ${result.total})` : ''
  return [{ type: 'text', text: lines.join('\n') + note }]
}

/** Render a build-script run as its command trace plus captured output. */
function renderGlossaryBuild(_args: unknown, value: unknown): ContentBlock[] {
  const result = value as GlossaryBuildJson
  const parts = [
    `python ${result.script} ${result.args.join(' ')}`,
    `exit code: ${result.exitCode} (${result.status})`,
  ]
  if (result.output.length > 0) parts.push('', result.output)
  return [{ type: 'text', text: parts.join('\n') }]
}

/** Render the Python availability check. */
function renderPythonCheck(_args: unknown, value: unknown): ContentBlock[] {
  const result = value as PythonCheckJson
  return [{
    type: 'text',
    text: result.available
      ? `Python available: ${result.executable}`
      : `Python unavailable. ${result.hint ?? 'Install Python 3 to use the math-glossary scripts.'}`,
  }]
}

/** Render a paper-structure validation as a compact structural digest. */
function renderPaperValidate(_args: unknown, value: unknown): ContentBlock[] {
  const result = value as PaperValidateJson
  return [{
    type: 'text',
    text: [
      `Valid paper structure: ${result.title}`,
      `entities: ${result.entityCount}, main theorems: ${result.mainTheoremCount}, sections: ${result.sectionCount}`,
      `dependency roots: ${result.roots.length > 0 ? result.roots.join(', ') : '(none)'}`,
      `self_containment: ${result.completeness}`,
    ].join('\n'),
  }]
}

/**
 * Resolve a model-supplied path against the calling workspace when relative.
 * @param path - model-supplied path, possibly workspace-relative.
 * @param cwd - the calling agent's session cwd, when known.
 */
function toWorkspacePath(path: string, cwd: string | undefined): string {
  return isAbsolute(path) || cwd === undefined ? path : resolve(cwd, path)
}

/** Map an unknown thrown value onto the tool error taxonomy (route on `code`). */
function toToolError(error: unknown): Error {
  if (isVeryMathError(error)) return error
  if (error instanceof Error) return error
  return new Error(String(error))
}

/** Spawn one short command and resolve to (exitCode, stdout) or undefined on timeout/launch failure. */
function probeCommand(executable: string, args: readonly string[], timeoutMs = 5_000): Promise<{ exitCode: number, stdout: string } | undefined> {
  return new Promise((resolvePromise) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(executable, [...args], { stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      resolvePromise(undefined)
      return
    }
    const stdout: Buffer[] = []
    let settled = false
    // Cleared on settle: an uncleared timer kept the event loop alive for the
    // full timeout after the probe had already answered (up to 5s of dead wait
    // per probe call in short-lived runs).
    let timer: ReturnType<typeof setTimeout> | undefined
    const settle = (value: { exitCode: number, stdout: string } | undefined) => {
      if (!settled) {
        settled = true
        if (timer !== undefined) clearTimeout(timer)
        resolvePromise(value)
      }
    }
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.on('error', () => settle(undefined))
    child.on('close', (code) => settle({ exitCode: code ?? -1, stdout: Buffer.concat(stdout).toString() }))
    timer = setTimeout(() => {
      child.kill()
      settle(undefined)
    }, timeoutMs)
  })
}

/**
/**
 * Probe the math-beamer TeX toolchain: latexmk and xelatex binaries (resolved on
 * PATH, then in the distribution's own bin directory, followed by a `--version`
 * smoke) and the forest/ctex LaTeX packages (`kpsewhich <name>.sty`, via the
 * `kpsewhich` found the same way). Nothing is installed, compiled, or
 * downloaded; each probe is independent so a partial toolchain reports per-piece
 * detail (mirrors the osqp/sage probe pattern).
 */
async function probeBeamerToolchain(): Promise<BeamerToolProbe[]> {
  const binaries = ['latexmk', 'xelatex']
  const styles = ['forest', 'ctex']

  const binaryProbes = await Promise.all(binaries.map(async (name) => {
    const executable = resolveExecutable(name)
    if (executable === undefined) return { name, kind: 'binary' as const, available: false }
    const smoke = await probeCommand(executable, ['--version']).catch(() => undefined)
    return smoke !== undefined && smoke.exitCode === 0
      ? { name, kind: 'binary' as const, available: true, executable }
      : { name, kind: 'binary' as const, available: false, executable }
  }))

  // kpsewhich ships with the distribution, so it lives in the same bin directory
  // as the binaries and needs the same fallback lookup rather than a fixed path.
  const kpsewhich = resolveExecutable('kpsewhich')
  const styleProbes = await Promise.all(styles.map(async (name) => {
    if (kpsewhich === undefined) return { name, kind: 'style' as const, available: false }
    const probe = await probeCommand(kpsewhich, [`${name}.sty`]).catch(() => undefined)
    const resolved = probe !== undefined && probe.exitCode === 0 ? probe.stdout.trim().split('\n')[0] : undefined
    return resolved !== undefined && resolved.length > 0
      ? { name, kind: 'style' as const, available: true, executable: resolved }
      : { name, kind: 'style' as const, available: false }
  }))

  return [...binaryProbes, ...styleProbes]
}

/** Register the VeryMath glossary and paper tools. */
export const apply = (ctx: Context, config: Config = {}): void => {
  const glossaryHome = config.glossaryHome ?? 'glossary/glossary.json'

  ctx.tools.register(defineTool({
    name: 'verymath_glossary_query',
    description: 'Query a VeryMath bilingual (English-Chinese) mathematical glossary JSON document for terms. Matches by exact English/Chinese term, term id, English prefix, Chinese substring, or subfield name; returns examples when entries carry them (use them to disambiguate polysemous terms per the math-glossary usage guide). Use the field parameter to restrict matches to one subdomain when a term has different translations in different fields. The glossary follows the VeryMath math-glossary contract (sorted entries, unique term_id).',
    parameters: {
      query: { type: 'string', required: true, description: 'English term, Chinese term, term_id, or subfield name' },
      glossaryPath: { type: 'string', description: 'Path of the glossary.json document; defaults to the workspace default glossary' },
      field: { type: 'string', description: 'Restrict matches to terms whose subfield list contains exactly this value, e.g. 代数拓扑' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string' },
          glossary: { type: 'string' },
          total: { type: 'number' },
          terms: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                term_id: { type: 'string' },
                en: { type: 'string' },
                cn: { type: 'string' },
                matchedBy: { type: 'string' },
                pos: { type: 'string' },
                field: { type: 'array', items: { type: 'string' } },
                source: { type: 'string' },
                examples: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      en: { type: 'string' },
                      cn: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      render: renderGlossaryQuery,
    },
    async execute(args, exec) {
      try {
        const path = toWorkspacePath(args.glossaryPath ?? glossaryHome, exec.agent?.session.header.cwd)
        const library = await ctx.verymath.loadGlossary(path, exec.signal)
        const { hits, total } = await ctx.verymath.queryGlossaryFile(path, args.query, {
          ...(args.field !== undefined ? { field: args.field } : {}),
          signal: exec.signal,
        })
        return {
          query: args.query,
          glossary: library.path,
          total,
          terms: hits.map(hit => ({
            term_id: hit.term.term_id,
            en: hit.term.en,
            cn: hit.term.cn,
            matchedBy: hit.matchedBy,
            ...(hit.term.pos !== undefined ? { pos: hit.term.pos } : {}),
            ...(hit.term.field !== undefined ? { field: [...hit.term.field] } : {}),
            ...(hit.term.source !== undefined ? { source: hit.term.source } : {}),
            ...(hit.term.examples !== undefined ? { examples: hit.term.examples.map(example => ({ ...example })) } : {}),
          })),
        }
      } catch (error) {
        throw toToolError(error)
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'verymath_glossary_build',
    description: 'Run one VeryMath math-glossary Python script (glossary_build.py, glossary_export.py, glossary_backup.py, glossary_enrich_examples.py) to construct or maintain a bilingual glossary from structured sources (CSV/TSV/JSON/YAML). Requires a local Python 3; use verymath_python_check first to verify availability. OCR, PDF, and free-text sources are handled by the math-glossary skill workflow, not this tool.',
    parameters: {
      script: { type: 'string', required: true, description: 'Script filename, e.g. glossary_build.py' },
      args: { type: 'array', items: { type: 'string' }, description: 'Arguments passed to the script, e.g. ["source.csv", "--output", "glossary/glossary.json", "--no-excel"]' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          script: { type: 'string' },
          args: { type: 'array', items: { type: 'string' } },
          exitCode: { type: 'number' },
          output: { type: 'string' },
          pythonExecutable: { type: 'string' },
          status: { type: 'string' },
        },
      },
      render: renderGlossaryBuild,
    },
    async execute(args) {
      const scriptArgs = args.args ?? []
      const result = await ctx.verymath.runGlossaryScript(args.script, scriptArgs)
      const output = [result.stderr.trim(), result.stdout.trim()].filter(part => part.length > 0).join('\n')
      // Upstream contract: exit 3 = partial success (JSON written, Excel pending because
      // openpyxl is missing — report honestly, never claim full completion); exit 2 = the
      // output already exists and --force is required. Both are structured outcomes.
      if (result.exitCode !== 0 && result.exitCode !== 2 && result.exitCode !== 3) {
        throw new VeryMathError(
          `glossary script ${args.script} exited ${result.exitCode}: ${output.slice(0, 2000) || '(no output)'}`,
          'VERYMATH_IO',
        )
      }
      // A build/export/backup script may rewrite any glossary file, and it writes
      // wherever its own arguments and cwd say. A targeted invalidation keyed on
      // the raw `--output` argument does not match the resolved absolute cache key
      // and misses duplicated/relative/`--output=x` spellings, so drop the whole
      // cache instead of trying to be clever about which file changed.
      ctx.verymath.invalidateAllGlossaries()
      return {
        script: args.script,
        args: scriptArgs,
        exitCode: result.exitCode,
        output: output.slice(0, 8000),
        pythonExecutable: (await ctx.verymath.resolvePython()) ?? '(unknown)',
        status: result.exitCode === 3 ? 'partial' : result.exitCode === 2 ? 'needs-force' : 'completed',
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'verymath_glossary_upsert',
    description: 'Add terms to or correct terms in a VeryMath bilingual glossary JSON document, preserving the contract invariants automatically: term_id follows the upstream alias convention (lowercased English term, or `<en>__N` for an additional translation of the same term), the document is re-sorted by (en, cn) with contiguous idx, and changed terms get today\'s date stamps. Use this when reading papers or translating and you encounter a term worth saving — do not hand-edit glossary.json. Two different intents are distinguished: (a) omit term_id to ADD — re-adding the same (en, cn) pair is idempotent, and a DIFFERENT Chinese translation for an existing English term becomes a separate alias row (`<en>__N`) instead of overwriting the existing translation; (b) pass term_id (from a previous query) to CORRECT that specific row\'s Chinese translation and optional fields. The English term must match the row\'s English term (case-insensitively): renaming or moving a term to another English term is not supported — add it as a new term instead. Unspecified optional fields are preserved on update.',
    parameters: {
      terms: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            en: { type: 'string', required: true },
            cn: { type: 'string', required: true },
            term_id: { type: 'string', description: 'Existing term_id to correct in place: sets that row\'s Chinese translation and any optional fields given. The English term must match the row (case-insensitive); renaming is not supported. Omit to add; a different translation for an existing English term is then stored as an alias row instead of overwriting.' },
            pos: { type: 'string' },
            field: { type: 'array', items: { type: 'string' } },
            source: { type: 'string' },
            example: {
              type: 'object',
              additionalProperties: false,
              properties: {
                en: { type: 'string' },
                cn: { type: 'string' },
              },
            },
          },
        },
        description: 'Terms to add or update',
      },
      glossaryPath: { type: 'string', description: 'Path of the glossary.json document; defaults to the workspace default glossary. Created with just the new terms when it does not exist yet.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          glossary: { type: 'string' },
          added: { type: 'array', items: { type: 'string' } },
          updated: { type: 'array', items: { type: 'string' } },
          totalTerms: { type: 'number' },
        },
      },
      render: (_args, value) => {
        const result = value as { glossary: string, added: string[], updated: string[], totalTerms: number }
        const parts = [
          `Glossary updated: ${result.glossary}`,
          `added: ${result.added.length > 0 ? result.added.join(', ') : '(none)'}`,
          `updated: ${result.updated.length > 0 ? result.updated.join(', ') : '(none)'}`,
          `total terms: ${result.totalTerms}`,
        ]
        return [{ type: 'text', text: parts.join('\n') }]
      },
    },
    async execute(args, exec) {
      const path = toWorkspacePath(args.glossaryPath ?? glossaryHome, exec.agent?.session.header.cwd)
      const fs = ctx.fs
      if (fs === undefined) {
        throw new VeryMathError('verymath_glossary_upsert requires the fs service', 'VERYMATH_IO')
      }
      const target = await fs.resolve(path, { signal: exec.signal })
      // The lock key and the read path must both be the document's canonical
      // identity, not the model-supplied spelling: a relative path, a symlink and
      // `..` segments all name the same file, and locking on the raw string let two
      // concurrent upserts of one document run in parallel. `fs.processPath`
      // returns the host path derived from the resolved target (realpath-based),
      // which is exactly the identity the write below uses.
      const canonicalPath = fs.processPath(target)
      const requests: TermUpsert[] = (args.terms ?? []).map((request) => {
        const example = request.example
        const validExample = example !== undefined && typeof example.en === 'string' && typeof example.cn === 'string'
          ? { en: example.en, cn: example.cn }
          : undefined
        return {
          en: request.en ?? '',
          cn: request.cn ?? '',
          ...(request.term_id !== undefined ? { term_id: request.term_id } : {}),
          ...(request.pos !== undefined ? { pos: request.pos } : {}),
          ...(request.field !== undefined ? { field: request.field } : {}),
          ...(request.source !== undefined ? { source: request.source } : {}),
          ...(validExample !== undefined ? { example: validExample } : {}),
        }
      })
      // Whole read-modify-write inside one per-document lock: concurrent upserts on
      // the same file would otherwise both start from the same snapshot and the
      // later write would drop the earlier one. Scope: this runtime only — an
      // external editor, a Python script or another DSH process does not take it.
      return ctx.verymath.withGlossaryWrite(canonicalPath, async () => {
        // Read the document from disk, not from the query cache: the cache is
        // only invalidated by this package's own writes, so a document edited by
        // the user (or by the bundled glossary_web.py) would be overwritten from
        // a stale snapshot. Only a genuinely absent file starts a new glossary —
        // a permission, I/O or cancellation failure must surface instead of
        // turning this write into "replace the file with just these terms".
        let current: Awaited<ReturnType<typeof ctx.verymath.reloadGlossary>> | undefined
        try {
          current = await ctx.verymath.reloadGlossary(canonicalPath, exec.signal)
        } catch (error) {
          if (!(isVeryMathError(error) && error.code === 'VERYMATH_GLOSSARY_UNAVAILABLE')) throw error
        }
        const result = upsertTerms(current?.terms ?? [], requests)
        // Write through ctx.fs so the session sandbox policy governs the write.
        const sandboxPolicy = ctx.get('sandboxPolicy')?.resolve(exec.agent !== undefined ? { session: exec.agent.session } : {})
        await fs.writeText(target, JSON.stringify(result.document, null, 2) + '\n', undefined, exec.signal, sandboxPolicy)
        // Queries cache by the path string they were given, and one document can be
        // reached through several strings (relative, absolute, symlink alias).
        // Dropping only the keys this call happens to know about leaves an earlier
        // alias entry serving the old document indefinitely, so clear the lot — the
        // cache holds a handful of documents and an upsert is a deliberate write.
        ctx.verymath.invalidateAllGlossaries()
        return {
          glossary: path,
          added: [...result.added],
          updated: [...result.updated],
          totalTerms: result.document.length,
        }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'verymath_python_check',
    description: 'Check whether a Python 3 interpreter is available for the VeryMath math-glossary scripts, and report which executable would be used. Call this before verymath_glossary_build and surface a concrete installation hint when it reports unavailable.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          available: { type: 'boolean' },
          executable: { type: 'string' },
          hint: { type: 'string' },
        },
      },
      render: renderPythonCheck,
    },
    async execute() {
      const python = await ctx.verymath.resolvePython()
      if (python === undefined) {
        return {
          available: false,
          hint: 'Install Python 3 (macOS: xcode-select --install or brew install python3; Windows: python.org installer) and set verymath.pythonExecutable or DSH_OFFICE_PYTHON if it is not on PATH.',
        }
      }
      return { available: true, executable: python }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'verymath_osqp_check',
    description: 'Probe the Python environment for the OSQP solver stack (osqp with major-version gate >=1,<2, numpy, scipy) without installing anything. Returns per-package availability plus an install hint. Call before verymath_osqp_solve.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ready: { type: 'boolean' },
          packages: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string' },
                available: { type: 'boolean' },
                version: { type: 'string' },
              },
            },
          },
          hint: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const result = value as { ready: boolean, packages: Array<{ name: string, available: boolean, version?: string }>, hint?: string }
        const lines = result.packages.map(pkg => `- ${pkg.name}: ${pkg.available ? `ok${pkg.version !== undefined ? ` ${pkg.version}` : ''}` : 'missing'}`)
        const status = result.ready ? 'OSQP stack ready' : 'OSQP stack NOT ready'
        return [{ type: 'text', text: [status, ...lines, result.hint !== undefined ? `hint: ${result.hint}` : ''].filter(Boolean).join('\n') }]
      },
    },
    async execute() {
      const python = await ctx.verymath.resolvePython()
      if (python === undefined) {
        return {
          ready: false,
          packages: [{ name: 'python3', available: false }],
          hint: 'Install Python 3 first (see verymath_python_check), then: python3 -m pip install \'osqp>=1,<2\'',
        }
      }
      const scriptPath = bundledSkillsDir() + '/osqp-solver/scripts/check_osqp_environment.py'
      const result = await ctx.verymath.runPythonCommand(python, [scriptPath, '--json'], 30_000)
      let parsed: { ready?: boolean, packages?: Array<{ name?: string, available?: boolean, version?: string }>, install_hint?: string, hint?: string }
      try {
        parsed = JSON.parse(result.stdout)
      } catch (error) {
        throw new VeryMathError(`osqp check produced invalid JSON: ${error instanceof Error ? error.message : String(error)}`, 'VERYMATH_IO', { cause: error })
      }
      // Upstream shape: packages is an OBJECT keyed by package name.
      const packagesRaw = parsed.packages ?? {}
      return {
        ready: parsed.ready === true,
        packages: Object.entries(packagesRaw).map(([name, info]) => {
          const detail = (typeof info === 'object' && info !== null ? info : {}) as { available?: boolean, version?: string }
          return {
            name,
            available: detail.available === true,
            ...(detail.version !== undefined ? { version: detail.version } : {}),
          }
        }),
        ...(parsed.install_hint !== undefined || parsed.hint !== undefined
          ? { hint: parsed.install_hint ?? parsed.hint }
          : {}),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'verymath_osqp_solve',
    description: 'Solve a continuous convex quadratic program (minimize 0.5 x^T P x + q^T x subject to l <= Ax <= u, P symmetric PSD) from a JSON problem document with independent verification: 11-state solver-status gates, primal/dual residual and KKT complementarity checks, and infeasibility certificates. Input JSON: {P, q, A, l, u} dense arrays (optionally {name, settings}). Deterministic; atomic output; exit-code contract (0 solved/verified, 2 input error, 3 numerical rejection). Requires the OSQP Python stack (verymath_osqp_check first). Not for mixed-integer, nonconvex, or general conic problems.',
    parameters: {
      problem: { type: 'string', required: true, description: 'Workspace path of the JSON QP problem document' },
      output: { type: 'string', description: 'Workspace path for the result JSON (atomic write); omit to return the result inline' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string' },
          solution: {
            type: 'object',
            additionalProperties: false,
            properties: {
              x: { type: 'array', items: { type: 'number' } },
              y: { type: 'array', items: { type: 'number' } },
            },
          },
          verification: { type: 'json' },
          problem: { type: 'json' },
          outputPath: { type: 'string' },
          raw: { type: 'json' },
        },
      },
      render: (_args, value) => {
        const result = value as {
          status: string,
          solution?: { x?: number[] },
          verification?: { kind?: string },
          outputPath?: string,
          raw?: { status?: { accepted?: boolean, reported?: string } },
        }
        const accepted = result.raw?.status?.accepted
        const parts = [
          `status: ${result.status} (accepted: ${String(accepted ?? false)})`,
        ]
        if (result.solution?.x !== undefined) parts.push(`x = [${result.solution.x.map(entry => entry.toFixed(4)).join(', ')}]`)
        if (result.verification?.kind !== undefined) parts.push(`verification: ${result.verification.kind}`)
        if (result.outputPath !== undefined) parts.push(`result written to: ${result.outputPath}`)
        return [{ type: 'text', text: parts.join('\n') }]
      },
    },
    async execute(args, exec) {
      const python = await ctx.verymath.resolvePython()
      if (python === undefined) {
        throw new VeryMathError('verymath_osqp_solve requires Python 3; run verymath_python_check for install hints', 'VERYMATH_PYTHON_UNAVAILABLE')
      }
      const fs = ctx.fs
      if (fs === undefined) {
        throw new VeryMathError('verymath_osqp_solve requires the fs service', 'VERYMATH_IO')
      }
      const problemPath = toWorkspacePath(args.problem, exec.agent?.session.header.cwd)
      const scriptPath = bundledSkillsDir() + '/osqp-solver/scripts/solve_qp.py'
      const scriptArgs = [scriptPath, fs.processPath(await fs.resolve(problemPath, { signal: exec.signal }))]
      let outputPath: string | undefined
      if (args.output !== undefined) {
        outputPath = toWorkspacePath(args.output, exec.agent?.session.header.cwd)
        scriptArgs.push('--output', fs.processPath(await fs.resolve(outputPath, { signal: exec.signal })))
      }
      const result = await ctx.verymath.runPythonCommand(python, scriptArgs, 120_000)
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(result.stdout)
      } catch (error) {
        throw new VeryMathError(
          `osqp solve produced invalid JSON (exit ${result.exitCode}): ${(result.stderr || result.stdout).slice(0, 500)}`,
          'VERYMATH_IO',
          { cause: error },
        )
      }
      const status = parsed.status as { classification?: string, reported?: string, accepted?: boolean } | undefined
      const solution = parsed.solution as { x?: number[], y?: number[] } | undefined
      // JSON-normalize passthrough blocks so they satisfy the JsonValue output contract.
      const normalize = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value ?? null)) as JsonValue
      return {
        status: status?.classification ?? status?.reported ?? 'unknown',
        ...(solution !== undefined && solution.x !== undefined
          ? { solution: { x: solution.x, ...(solution.y !== undefined ? { y: solution.y } : {}) } }
          : {}),
        ...(parsed.verification !== undefined ? { verification: normalize(parsed.verification) } : {}),
        ...(parsed.problem !== undefined ? { problem: normalize(parsed.problem) } : {}),
        ...(outputPath !== undefined ? { outputPath } : {}),
        raw: normalize(parsed),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'verymath_lean_detect_sorry',
    description: 'Scan a Lean 4 file for forbidden proof placeholders: sorry, admit, and axiom declarations (plain-text analysis; does NOT require a Lean toolchain). Part of the lean-formalization safety contract: final patches must not hide unfinished proofs. Use on any .lean file before accepting a proof patch, and on delivery candidates.',
    parameters: {
      path: { type: 'string', required: true, description: 'Workspace path of the .lean file' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string' },
          clean: { type: 'boolean' },
          findings: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string' },
                line: { type: 'number' },
                text: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const result = value as { path: string, clean: boolean, findings: Array<{ kind: string, line: number, text?: string }> }
        if (result.clean) {
          return [{ type: 'text', text: `${result.path}: clean (no sorry/admit/axiom found).` }]
        }
        const lines = result.findings.slice(0, 20).map(finding => `- line ${finding.line} [${finding.kind}]: ${(finding.text ?? '').slice(0, 80)}`)
        const note = result.findings.length > 20 ? `\n(showing 20 of ${result.findings.length})` : ''
        return [{ type: 'text', text: `${result.path}: ${result.findings.length} forbidden token(s)\n${lines.join('\n')}${note}` }]
      },
    },
    async execute(args, exec) {
      const python = await ctx.verymath.resolvePython()
      if (python === undefined) {
        throw new VeryMathError('verymath_lean_detect_sorry requires Python 3; run verymath_python_check for install hints', 'VERYMATH_PYTHON_UNAVAILABLE')
      }
      const fs = ctx.fs
      if (fs === undefined) {
        throw new VeryMathError('verymath_lean_detect_sorry requires the fs service', 'VERYMATH_IO')
      }
      const absolute = toWorkspacePath(args.path, exec.agent?.session.header.cwd)
      const scriptPath = bundledSkillsDir() + '/lean-formalization/lean-runtime/scripts/ai4m_lean.py'
      const result = await ctx.verymath.runPythonCommand(
        python,
        [scriptPath, 'detect-sorry', '--file', fs.processPath(await fs.resolve(absolute, { signal: exec.signal }))],
        30_000,
      )
      let parsed: { ok?: boolean, status?: string, findings?: Array<{ kind?: string, line?: number, text?: string }> }
      try {
        parsed = JSON.parse(result.stdout)
      } catch (error) {
        throw new VeryMathError(`lean detect-sorry produced invalid JSON: ${error instanceof Error ? error.message : String(error)}`, 'VERYMATH_IO', { cause: error })
      }
      const findings = parsed.findings ?? []
      return {
        path: args.path,
        clean: findings.length === 0,
        findings: findings.slice(0, 100).map(finding => ({
          kind: finding.kind ?? 'unknown',
          line: finding.line ?? 0,
          ...(finding.text !== undefined ? { text: String(finding.text).slice(0, 200) } : {}),
        })),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'verymath_sage_check',
    description: 'Check SageMath availability (the `sage` binary, resolved from `VERYMATH_SAGE` when set, then PATH, then the supported conda roots including named environments such as the `~/.verymath/miniforge/envs/<name>/bin` layout this package documents) AND the local SageMath documentation corpus (default ~/.verymath/sagemath-corpus, set VERYMATH_SAGE_CORPUS to override). SageMath itself must be installed by the user (conda-forge sage=10.9 recommended; Windows requires WSL). The corpus is SageMath official documentation (CC BY-SA 3.0), distributed separately from this MIT package.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          corpusAvailable: { type: 'boolean' },
          corpusRoot: { type: 'string' },
          manifestRows: { type: 'number' },
          sageBinaryAvailable: { type: 'boolean' },
          hint: { type: 'string' },
        },

      },
      render: (_args, value) => {
        const result = value as { corpusAvailable: boolean, corpusRoot?: string, manifestRows?: number, sageBinaryAvailable?: boolean, hint?: string }
        const parts = [
          `corpus: ${result.corpusAvailable ? `available at ${result.corpusRoot} (${result.manifestRows} docs)` : 'MISSING'}`,
          `sage binary: ${result.sageBinaryAvailable ? 'found' : 'not found'}`,
        ]
        if (result.hint !== undefined) parts.push(result.hint)
        return [{ type: 'text', text: parts.join('\n') }]
      },
    },
    async execute() {
      // Resolved through the same in-process PATH scan as the TeX probe: a bare
      // `spawn('sage')` missed conda installs whenever the host app did not
      // inherit the login shell PATH, and reported SageMath missing on a machine
      // that has it.
      const sageExecutable = resolveSageExecutable()
      const smoke = sageExecutable === undefined
        ? undefined
        : await probeCommand(sageExecutable, ['--version'], 10_000).catch(() => undefined)
      const sageBinaryAvailable = smoke !== undefined && smoke.exitCode === 0
      try {
        const root = await resolveCorpusRoot()
        const rows = await loadManifest(root)
        const hints: string[] = []
        if (!sageBinaryAvailable) {
          hints.push('SageMath not found: install via miniforge (conda-forge sage=10.9; macOS arm64/x86_64 supported; Windows requires WSL). Search still works without the binary; only execution needs it.')
        }
        return {
          corpusAvailable: true,
          corpusRoot: root,
          manifestRows: rows.length,
          sageBinaryAvailable,
          ...(hints.length > 0 ? { hint: hints.join(' ') } : {}),
        }
      } catch (error) {
        if (isVeryMathError(error) && error.code === 'VERYMATH_SAGE_CORPUS_MISSING') {
          return {
            corpusAvailable: false,
            sageBinaryAvailable,
            hint: error.message,
          }
        }
        throw error
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'verymath_sage_search',
    description: 'Search the local SageMath documentation corpus (3196 docs) for constructors, methods, and examples before writing Sage code — the anti-hallucination lookup step of the sagemath-skill contract: never invent SageMath APIs from memory. Returns ranked documents with titles, symbol/method lists, and excerpts. Requires the docs corpus (verymath_sage_check); execution of Sage code requires the sage binary.',
    parameters: {
      query: { type: 'string', required: true, description: 'English query, e.g. "elliptic curve rank" or "solve ODE numerically"' },
      limit: { type: 'number', description: 'Max documents (default 8)' },
      show: { type: 'string', description: 'Document path (from a previous result) to read a wider window from instead of searching' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string' },
          results: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                title: { type: 'string' },
                domain: { type: 'string' },
                path: { type: 'string' },
                score: { type: 'number' },
                symbols: { type: 'array', items: { type: 'string' } },
                methods: { type: 'array', items: { type: 'string' } },
                excerpt: { type: 'string' },
              },
            },
          },
        },

      },
      render: (_args, value) => {
        const result = value as { query: string, results: Array<{ title: string, domain?: string, path?: string, score?: number, excerpt?: string }> }
        if (result.results.length === 0) {
          return [{ type: 'text', text: `No corpus documents matched ${JSON.stringify(result.query)}. Try different terms.` }]
        }
        const parts = result.results.map((item, index) => {
          const head = `${index + 1}. [${item.score}] ${item.title} (${item.domain})`
          const body = item.excerpt !== undefined && item.excerpt.length > 0 ? `\n${item.excerpt}` : ''
          return head + body
        })
        return [{ type: 'text', text: parts.join('\n\n') }]
      },
    },
    async execute(args) {
      try {
        const root = await resolveCorpusRoot()
        const rows = await loadManifest(root)
        if (args.show !== undefined) {
          const target = rows.find(row => row.path === args.show || row.api_path === args.show)
          if (target === undefined) {
            throw new VeryMathError(`document not in manifest: ${args.show}`, 'VERYMATH_SAGE_CORPUS_MISSING')
          }
          const terms = termsFor(args.query)
          const lines = await readCorpusDocWindow(root, target, 1).catch(() => [] as string[])
          const excerpt = findExcerpt(lines, args.query, terms)
          return {
            query: args.query,
            results: [{
              title: target.title,
              ...(target.domain !== undefined ? { domain: target.domain } : {}),
              ...(target.path !== undefined ? { path: target.path } : {}),
              score: 0,
              excerpt,
            }],
          }
        }
        const hits = await searchSageRefs(rows, args.query, { limit: args.limit ?? 8, withExcerpts: 3, corpusRoot: root })
        return {
          query: args.query,
          results: hits.map(hit => ({
            title: hit.row.title,
            ...(hit.row.domain !== undefined ? { domain: hit.row.domain } : {}),
            ...(hit.row.path !== undefined ? { path: hit.row.path } : {}),
            score: hit.score,
            excerpt: hit.excerpt,
          })),
        }
      } catch (error) {
        if (isVeryMathError(error) && error.code === 'VERYMATH_SAGE_CORPUS_MISSING') {
          throw new VeryMathError(error.message, 'VERYMATH_SAGE_CORPUS_MISSING')
        }
        throw toToolError(error)
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'verymath_research_gate',
    description: 'Check a Co-Mathematician-style research workspace against its three completion gates: goal_approval (project/GOALS.yaml has an approved goal), workstream_completion (each workstream has report.md with Provenance/Uncertainty/Failed Explorations sections, an independent reviewer approval, and no unresolved blocking reviews), and final_render (which workstreams are render-ready). Pure file-contract validation; use before declaring a research workstream complete or assembling a final report.',
    parameters: {
      workspace: { type: 'string', required: true, description: 'Workspace root containing project/ and workstreams/' },
      gate: { type: 'string', required: true, description: 'One of goal_approval, workstream_completion, final_render' },
      goalId: { type: 'string', description: 'Specific goal id for goal_approval' },
      workstreamId: { type: 'string', description: 'Specific workstream directory name for workstream_completion' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          gate: { type: 'string' },
          passed: { type: 'boolean' },
          issues: { type: 'array', items: { type: 'string' } },
          details: { type: 'json' },
        },
      },
      render: (_args, value) => {
        const result = value as GateResult
        const head = `${result.gate}: ${result.passed ? 'PASSED' : 'NOT PASSED'}`
        if (result.issues.length === 0) return [{ type: 'text', text: head }]
        return [{ type: 'text', text: [head, ...result.issues.map(issue => `- ${issue}`)].join('\n') }]
      },
    },
    async execute(args) {
      const result = await checkGate(args.workspace, args.gate as 'goal_approval' | 'workstream_completion' | 'final_render', {
        ...(args.goalId !== undefined ? { goalId: args.goalId } : {}),
        ...(args.workstreamId !== undefined ? { workstreamId: args.workstreamId } : {}),
      })
      return {
        gate: result.gate,
        passed: result.passed,
        issues: [...result.issues],
        details: structuredClone(result.details) as JsonValue,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'verymath_ocr_scan',
    description: 'Scan an OCR-produced Markdown file (formula-dense academic scans) for likely recognition errors: glued operators, misread fonts (\\mathbb{D} etc.), epsilon-as-index digits, odd dollar counts, unclosed LaTeX environments, environment mismatches. Deterministic candidate locator only — the after-ocr skill\'s line-by-line review discipline is still required after scanning; never treat findings as confirmed errors. Requires Python 3 (check verymath_python_check first).',
    parameters: {
      path: { type: 'string', required: true, description: 'Workspace path of the OCR Markdown file' },
      startLine: { type: 'number', description: 'First line to scan (1-based, inclusive)' },
      endLine: { type: 'number', description: 'Last line to scan (inclusive)' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string' },
          totalLines: { type: 'number' },
          findingCount: { type: 'number' },
          findings: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                rule: { type: 'string' },
                line: { type: 'number' },
                snippet: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const result = value as { path: string, findingCount: number, findings: Array<{ rule: string, line: number, snippet?: string }> }
        if (result.findingCount === 0) {
          return [{ type: 'text', text: `No OCR error candidates found in ${result.path}. Proceed with the after-ocr line-by-line review protocol.` }]
        }
        const lines = result.findings.slice(0, 30).map(finding => `- line ${finding.line}: ${finding.rule}`)
        const note = result.findingCount > 30 ? `\n(showing 30 of ${result.findingCount})` : ''
        return [{ type: 'text', text: `${result.findingCount} candidate finding(s) in ${result.path}:\n${lines.join('\n')}${note}\nThese are candidates only — verify each against the source per the after-ocr protocol.` }]
      },
    },
    async execute(args, exec) {
      const python = await ctx.verymath.resolvePython()
      if (python === undefined) {
        throw new VeryMathError('verymath_ocr_scan requires Python 3; run verymath_python_check for install hints', 'VERYMATH_PYTHON_UNAVAILABLE')
      }
      const fs = ctx.fs
      if (fs === undefined) {
        throw new VeryMathError('verymath_ocr_scan requires the fs service', 'VERYMATH_IO')
      }
      const absolute = toWorkspacePath(args.path, exec.agent?.session.header.cwd)
      // The scan script reads host paths: map the workspace path into the fs execution world.
      const processPath = fs.processPath(await fs.resolve(absolute, { signal: exec.signal }))
      const scriptPath = bundledSkillsDir() + '/after-ocr/scripts/scan_markdown_ocr.py'
      const scriptArgs = [scriptPath, '--format', 'json', processPath]
      if (args.startLine !== undefined) scriptArgs.push('--start-line', String(args.startLine))
      if (args.endLine !== undefined) scriptArgs.push('--end-line', String(args.endLine))
      const result = await ctx.verymath.runPythonCommand(python, scriptArgs, 60_000)
      if (result.exitCode !== 0) {
        throw new VeryMathError(`ocr scan exited ${result.exitCode}: ${(result.stderr || result.stdout).slice(0, 1000)}`, 'VERYMATH_IO')
      }
      let parsed: { findings?: Array<{ rule?: string, line?: number, snippet?: string }>, summary?: { total_lines?: number }, total_lines?: number }
      try {
        parsed = JSON.parse(result.stdout)
      } catch (error) {
        throw new VeryMathError(`ocr scan produced invalid JSON: ${error instanceof Error ? error.message : String(error)}`, 'VERYMATH_IO', { cause: error })
      }
      const findings = parsed.findings ?? []
      return {
        path: args.path,
        totalLines: parsed.summary?.total_lines ?? parsed.total_lines ?? 0,
        findingCount: findings.length,
        findings: findings.slice(0, 200).map(finding => ({
          rule: finding.rule ?? 'unknown',
          line: finding.line ?? 0,
          ...(finding.snippet !== undefined ? { snippet: String(finding.snippet).slice(0, 120) } : {}),
        })),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'verymath_paper_validate',
    description: 'Validate a VeryMath math-paper-reading structure artifact (<slug>_structure.json): checks required metadata, recognized entity kinds, and dependency-label integrity, then returns a compact digest (entity counts, dependency roots, self-containment). Use after generating or editing a structure artifact.',
    parameters: {
      path: { type: 'string', required: true, description: 'Workspace path of the <slug>_structure.json artifact' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          entityCount: { type: 'number' },
          mainTheoremCount: { type: 'number' },
          sectionCount: { type: 'number' },
          roots: { type: 'array', items: { type: 'string' } },
          completeness: { type: 'string' },
          valid: { type: 'boolean' },
        },
      },
      render: renderPaperValidate,
    },
    async execute(args, exec) {
      const absolute = toWorkspacePath(args.path, exec.agent?.session.header.cwd)
      const fs = ctx.fs
      if (fs === undefined) {
        throw new VeryMathError('verymath_paper_validate requires the fs service', 'VERYMATH_IO')
      }
      const raw = await fs.readText(await fs.resolve(absolute, { signal: exec.signal }), exec.signal)
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (error) {
        throw new VeryMathError(
          `paper structure at ${absolute} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
          'VERYMATH_PAPER_INVALID',
          { cause: error },
        )
      }
      const structure = parsePaperStructure(parsed)
      const { roots } = dependencySummary(structure)
      return {
        title: structure.paper.title,
        entityCount: structure.entities?.length ?? 0,
        mainTheoremCount: structure.main_theorems?.length ?? 0,
        sectionCount: structure.section_map?.length ?? 0,
        roots: [...roots],
        completeness: structure.completeness_check?.self_containment ?? 'unknown',
        valid: true,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'verymath_paper_graph',
    description: 'Compute the dependency graph of a VeryMath math-paper-reading structure artifact (<slug>_structure.json): merges batch files, rebuilds the cited_by reverse index, computes shared_node hubs, in/out degrees, cycle detection, and both reading directions (top-down from main theorems, bottom-up reproduction order). Optionally renders a Mermaid dependency graph (auto-degrades above 40 entities to THEOREM-rooted depth-2 subgraphs unless forceFull). Use this instead of manually counting dependencies — the upstream skill forbids model-side graph traversal.',
    parameters: {
      path: { type: 'string', required: true, description: 'Workspace path of the <slug>_structure.json artifact' },
      extraPaths: { type: 'array', items: { type: 'string' }, description: 'Additional batch artifact paths to merge (upstream batch merging protocol)' },
      render: { type: 'boolean', description: 'Also render the Mermaid graph (default true)' },
      forceFull: { type: 'boolean', description: 'Force full Mermaid rendering even above the 40-entity degradation threshold' },
      focus: { type: 'string', description: 'Return the transitive dependency closure and layered reading path for this entity label (e.g. a main theorem), instead of (or in addition to) the full-graph digest' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          totalEntities: { type: 'number' },
          mergedDuplicates: { type: 'number' },
          danglingEdges: { type: 'array', items: { type: 'string' } },
          sharedNodes: { type: 'array', items: { type: 'string' } },
          cycles: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
          isolated: { type: 'array', items: { type: 'string' } },
          longestChain: { type: 'array', items: { type: 'string' } },
          topDownOrder: { type: 'array', items: { type: 'string' } },
          bottomUpLevels: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
          degradedRendering: { type: 'boolean' },
          metrics: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                label: { type: 'string' },
                type: { type: 'string' },
                inDegree: { type: 'number' },
                outDegree: { type: 'number' },
                sharedNode: { type: 'boolean' },
                supportsMainTheorem: { type: 'boolean' },
              },
            },
          },
          mermaid: { type: 'string' },
          focus: {
            type: 'object',
            additionalProperties: false,
            properties: {
              label: { type: 'string' },
              found: { type: 'boolean' },
              closure: { type: 'array', items: { type: 'string' } },
              levels: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
            },
          },
        },
      },
      render: (_args, value) => {
        const result = value as {
          title: string, totalEntities: number, sharedNodes: string[], cycles: string[][],
          isolated: string[], longestChain: string[], bottomUpLevels: string[][],
          degradedRendering: boolean, metrics: Array<{ label: string, type: string, inDegree: number, outDegree: number, sharedNode: boolean }>, mermaid?: string,
          focus?: { label: string, found: boolean, closure: string[], levels: string[][] },
        }
        const parts = [
          `Dependency graph for ${result.title}: ${result.totalEntities} entities`,
          `shared nodes (hubs): ${result.sharedNodes.length > 0 ? result.sharedNodes.join(', ') : '(none)'}`,
          `cycles: ${result.cycles.length > 0 ? result.cycles.map(cycle => cycle.join(' -> ')).join('; ') : 'none'}`,
          `isolated: ${result.isolated.length > 0 ? result.isolated.join(', ') : '(none)'}`,
          `longest chain: ${result.longestChain.join(' -> ')}`,
          `bottom-up levels: ${result.bottomUpLevels.map(level => `[${level.join(', ')}]`).join(' -> ')}`,
        ]
        if (result.degradedRendering) parts.push('(rendering degraded: >40 entities)')
        const top = result.metrics
          .filter(metric => metric.sharedNode || metric.inDegree >= 3)
          .map(metric => `- ${metric.label} (${metric.type}): in ${metric.inDegree}, out ${metric.outDegree}${metric.sharedNode ? ' [shared]' : ''}`)
        if (top.length > 0) parts.push('key nodes:', ...top)
        if (result.focus !== undefined) {
          if (!result.focus.found) {
            parts.push(`focus ${JSON.stringify(result.focus.label)}: not found in the merged entities (found=false)`)
          } else {
            parts.push(
              `focus ${JSON.stringify(result.focus.label)}: found=true; reading path (bottom-up layers):`,
              ...result.focus.levels.map((level, index) => `  L${index}: ${level.join(', ')}`),
            )
          }
        }
        if (result.mermaid !== undefined) parts.push('', '```mermaid', result.mermaid, '```')
        return [{ type: 'text', text: parts.join('\n') }]
      },
    },
    async execute(args, exec) {
      const paths = [args.path, ...(args.extraPaths ?? [])]
      const fs = ctx.fs
      if (fs === undefined) {
        throw new VeryMathError('verymath_paper_graph requires the fs service', 'VERYMATH_IO')
      }
      const cwd = exec.agent?.session.header.cwd
      const parsedDocuments: unknown[] = await Promise.all(paths.map(async (path) => {
        const absolute = toWorkspacePath(path, cwd)
        const raw = await fs.readText(await fs.resolve(absolute, { signal: exec.signal }), exec.signal)
        try {
          return JSON.parse(raw) as unknown
        } catch (error) {
          throw new VeryMathError(
            `paper structure at ${absolute} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
            'VERYMATH_PAPER_INVALID',
            { cause: error },
          )
        }
      }))
      // Batch artifacts are validated as a group: a later batch may legitimately
      // depend on a label an earlier batch defined, so per-file dependency checks
      // rejected the upstream batch protocol before the merge could run.
      const documents = parsePaperBatch(parsedDocuments)
      const primary = documents[0]
      if (primary === undefined) {
        throw new VeryMathError('no structure artifact paths resolved', 'VERYMATH_PAPER_INVALID')
      }
      const input: typeof primary | typeof documents = documents.length === 1 ? primary : documents
      const { report } = mergeBatches(input)
      const topology = computeTopology(input)
      const focus = args.focus !== undefined ? focusClosure(input, args.focus) : undefined
      const shouldRender = args.render ?? true
      // Render the merged structure, not the first artifact: with batches, the
      // graph silently showed only batch one while the counts described all of them.
      const mermaid = shouldRender
        ? renderMermaid(mergeStructures(input), { ...(args.forceFull === true ? { forceFull: true } : {}) })
        : undefined
      return {
        title: primary.paper.title,
        totalEntities: report.totalEntities,
        mergedDuplicates: report.mergedDuplicates,
        danglingEdges: [...report.danglingEdges],
        sharedNodes: [...report.sharedNodes],
        cycles: topology.cycles.map(cycle => [...cycle.labels]),
        isolated: [...topology.isolated],
        longestChain: [...topology.longestChain],
        topDownOrder: [...topology.topDownOrder],
        bottomUpLevels: topology.bottomUpLevels.map(level => [...level]),
        degradedRendering: topology.degradedRendering,
        metrics: topology.metrics.map(metric => ({
          label: metric.label,
          type: metric.type,
          inDegree: metric.inDegree,
          outDegree: metric.outDegree,
          sharedNode: metric.sharedNode,
          supportsMainTheorem: metric.supportsMainTheorem,
        })),
        ...(mermaid !== undefined ? { mermaid } : {}),
        ...(focus !== undefined
          ? {
              focus: {
                label: focus.label,
                found: focus.found,
                closure: [...focus.closure],
                levels: focus.levels.map(level => [...level]),
              },
            }
          : {}),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'verymath_beamer_check',
    description: 'Probe the local TeX toolchain for the math-beamer skill before compiling Beamer decks: latexmk (build entry), xelatex (required by Chinese/bilingual ctex templates), and the forest/ctex LaTeX packages located via kpsewhich. Nothing is installed or compiled. Call before the first math-beamer compile; when it reports unavailable, deliver .tex sources only and surface the install hint instead of compiling.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          available: { type: 'boolean' },
          tools: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string' },
                kind: { type: 'string' },
                available: { type: 'boolean' },
                executable: { type: 'string' },
              },
            },
          },
          hint: { type: 'string' },
        },
      },
      render: (_args, value) => {
        const result = value as BeamerCheckJson
        const lines = result.tools.map((tool) => `- ${tool.name} (${tool.kind}): ${tool.available ? `ok${tool.executable !== undefined ? ` ${tool.executable}` : ''}` : 'missing'}`)
        const status = result.available ? 'TeX toolchain ready for math-beamer' : 'TeX toolchain NOT ready for math-beamer'
        return [{ type: 'text', text: [status, ...lines, result.hint !== undefined ? `hint: ${result.hint}` : ''].filter(Boolean).join('\n') }]
      },
    },
    async execute() {
      const tools = await probeBeamerToolchain()
      const latexmk = tools.find(tool => tool.name === 'latexmk')
      const xelatex = tools.find(tool => tool.name === 'xelatex')
      const forest = tools.find(tool => tool.name === 'forest')
      const available = latexmk?.available === true && xelatex?.available === true && forest?.available === true
      const missingBinaries = tools.filter(tool => !tool.available && tool.kind === 'binary')
      const missingStyles = tools.filter(tool => !tool.available && tool.kind === 'style')
      let hint: string | undefined
      if (!available) {
        const parts: string[] = []
        if (missingBinaries.length > 0) {
          parts.push(`Install a TeX distribution (macOS: MacTeX or brew install --cask mactex-no-gui; Linux: texlive-full) to provide ${missingBinaries.map(tool => tool.name).join(', ')}.`)
        }
        if (missingStyles.length > 0) {
          parts.push(`LaTeX package(s) ${missingStyles.map(tool => tool.name).join(', ')} not found via kpsewhich (tlmgr install ${missingStyles.map(tool => tool.name).join(' ')}).`)
        }
        parts.push('Until then, deliver .tex sources only — do not compile, per the math-beamer gate discipline.')
        hint = parts.join(' ')
      }
      return { available, tools, ...(hint !== undefined ? { hint } : {}) }
    },
  }))
}
