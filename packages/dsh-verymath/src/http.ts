/**
 * Host-side HTTP routes that back the browser panel.
 *
 * The panel runs in the renderer, so it cannot spawn processes or read files
 * directly. Everything it shows therefore comes from these routes, which run in
 * the host process and reuse the same core code the tools use — one
 * implementation, two entry points (chat tool / panel).
 *
 * Three host facts were verified against the installed client packages rather
 * than guessed:
 *   * routes come from `connection.fetch.register()`, and the service is only
 *     looked up through `ctx.inject(['connection'], …)` (at apply time it can be
 *     missing; `ctx.get('connection')` then silently yields nothing and every
 *     route 404s);
 *   * `requestBody: 'buffered'` must be explicit — without it the bridge treats
 *     the request as streaming and building a `Request` for a GET throws, which
 *     surfaces in the browser as an empty 400;
 *   * errors must be turned into structured JSON here, because a bare 500 gives
 *     the panel nothing to show.
 *
 * @module @eduwork/dsh-verymath/http
 */
import { readdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  computeTopology,
  focusClosure,
  mergeBatches,
  parseGlossary,
  parsePaperStructure,
  queryGlossary,
  deleteTerm,
  resolveExecutable,
  resolvePythonExecutable,
  resolveSageExecutable,
  upsertTerms,
  validateGlossaryInvariants,
  VeryMathError,
  type GlossaryTerm,
  type TermUpsert,
} from './core/index.ts'

/** Minimal shape of the host connection service this module needs. */
export interface ConnectionLike {
  readonly fetch?: {
    readonly register?: (route: {
      readonly path: string
      readonly methods: readonly string[]
      readonly requestBody?: 'buffered' | 'streaming'
      readonly fetch: (request: Request) => Promise<Response>
    }) => unknown
  }
}

/** What the routes need from the host context. */
export interface HttpContext {
  /** Workspace root the panel browses (the session/agent cwd). */
  readonly workspace: () => string
  /** Host logger; absent in some hosts. */
  readonly log?: (message: string) => void
  /**
   * The `ctx.verymath` write lock. Sharing it with the tool layer is the point:
   * two independent chains (panel and tool) let a concurrent read-modify-write
   * from each side drop the other's update on the same document.
   */
  readonly withWrite?: <T>(path: string, task: () => Promise<T>) => Promise<T>
  /**
   * Drop the service's glossary query cache. Without this the panel writes a
   * document and the chat tool keeps answering from the pre-write snapshot.
   */
  readonly invalidateGlossaryCache?: () => void
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' } as const

/**
 * Write a JSON document atomically.
 *
 * `writeFile` truncates before writing, so a concurrent reader (the panel polling,
 * or a chat tool call landing mid-write) can observe a half-written file and report
 * "not a valid glossary". Writing a sibling temp file and renaming it makes the
 * swap atomic on the same filesystem.
 */
async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temp = `${path}.verymath-tmp-${process.pid}-${Date.now()}`
  try {
    await writeFile(temp, JSON.stringify(value, null, 2) + '\n', 'utf8')
    await rename(temp, path)
  } catch (error) {
    // A failed rename (permissions, cross-device) must not leave the temp file
    // behind: it would show up in the workspace and in the panel's own scans.
    await unlink(temp).catch(() => undefined)
    throw error
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

/** Parse the request URL without throwing; a malformed URL is a client error, not a 500. */
function safeUrl(request: Request): URL | undefined {
  try {
    return new URL(request.url)
  } catch {
    return undefined
  }
}

/**
 * Resolve a caller-supplied relative path and refuse anything outside the workspace.
 *
 * Two details matter here:
 *   * the separator is `sep`, not `/` — on Windows the string form is
 *     `C:\ws\glossary.json`, so a `/`-suffixed prefix matched nothing and every
 *     panel write was refused;
 *   * the result is compared after `realpath`, so a symlink inside the workspace
 *     that points outside it cannot be used to read or overwrite an outside file.
 *     A path that does not exist yet (a new glossary) is compared lexically, since
 *     there is nothing to resolve.
 */
async function withinWorkspace(workspace: string, candidate: string): Promise<string | undefined> {
  const root = await realpath(resolve(workspace)).catch(() => resolve(workspace))
  const absolute = resolve(root, candidate)
  if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) return undefined

  // Resolve the deepest **existing** ancestor and re-append the missing segments.
  // Checking only the full path let `ws/linkdir/new.json` through when `linkdir` is
  // a symlink to somewhere outside: the file does not exist yet, so `realpath`
  // failed and the lexical check was all that ran.
  const missing: string[] = []
  let probe = absolute
  for (;;) {
    const resolved = await realpath(probe).catch(() => undefined)
    if (resolved !== undefined) {
      const full = missing.length === 0 ? resolved : join(resolved, ...missing.reverse())
      if (full !== root && !full.startsWith(`${root}${sep}`)) return undefined
      return full
    }
    const parent = dirname(probe)
    if (parent === probe) return undefined
    missing.push(basename(probe))
    probe = parent
  }
}

/** Run one short command; never throws. */
function run(executable: string, args: readonly string[], timeoutMs = 8_000): Promise<{ ok: boolean, stdout: string, stderr: string }> {
  return new Promise((resolvePromise) => {
    let child: ReturnType<typeof spawn>
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const settle = (value: { ok: boolean, stdout: string, stderr: string }) => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      resolvePromise(value)
    }
    try {
      child = spawn(executable, [...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch {
      settle({ ok: false, stdout: '', stderr: 'failed to spawn' })
      return
    }
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout?.on('data', (chunk: Buffer) => out.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => err.push(chunk))
    child.on('error', (error) => settle({ ok: false, stdout: '', stderr: error.message }))
    child.on('close', (code) => settle({ ok: code === 0, stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString() }))
    timer = setTimeout(() => {
      child.kill('SIGKILL')
      settle({ ok: false, stdout: Buffer.concat(out).toString(), stderr: 'timed out' })
    }, timeoutMs)
  })
}

/** One environment probe row. */
interface ProbeRow {
  readonly id: string
  readonly label: string
  /** What the capability unlocks, shown when the probe is green. */
  readonly enables: string
  readonly state: 'ready' | 'missing' | 'partial'
  readonly detail?: string
  readonly hint?: string
}

/** First non-empty line of a command's output, trimmed to a displayable width. */
function firstLine(text: string, max = 80): string {
  const line = text.trim().split('\n')[0] ?? ''
  return line.slice(0, max)
}

/**
 * Probe the local toolchain. Each check is independent and never throws: a
 * missing tool is a fact to display, not an error.
 *
 * `python3` is probed here only to answer "can the glossary build scripts run";
 * the OSQP/Sage probes reuse the same command shape as the corresponding tools.
 */
async function probeEnvironment(): Promise<ProbeRow[]> {
  // All probes run concurrently: seven sequential spawns made the panel sit on
  // "probing…" for up to twenty seconds, which reads as a hang.
  const check = (executable: string, args: readonly string[], timeoutMs = 8_000) =>
    run(executable, args, timeoutMs).catch(() => ({ ok: false, stdout: '', stderr: 'probe failed' }))

  const checkResolved = async (name: string, args: readonly string[], timeoutMs = 8_000) => {
    const executable = resolveExecutable(name)
    if (executable === undefined) return { ok: false, stdout: '', stderr: 'not found' }
    return await check(executable, args, timeoutMs)
  }

  const pythonExecutable = resolvePythonExecutable()
  const pythonProbe = pythonExecutable === undefined
    ? Promise.resolve({ ok: false, stdout: '', stderr: 'not found' })
    : check(pythonExecutable, ['--version'], 5_000)
  const binaryProbes = ['latexmk', 'xelatex'].map(async (name) => ({ name, result: await checkResolved(name, ['--version']) }))
  const [python, ...binaries] = await Promise.all([pythonProbe, ...binaryProbes])

  // The deeper checks need Python, so they start once it is known to exist.
  const [yaml, osqp, sage, lean] = await Promise.all([
    python.ok && pythonExecutable !== undefined
      ? check(pythonExecutable, ['-c', 'import yaml, sys; sys.stdout.write(yaml.__version__)'])
      : Promise.resolve(undefined),
    python.ok && pythonExecutable !== undefined
      ? check(pythonExecutable, ['-c', 'import osqp, numpy; print(osqp.__version__)'], 10_000)
      : Promise.resolve(undefined),
    // Resolve through the same helper the tool uses; a bare `sage` missed conda
    // environments and made the panel disagree with `verymath_sage_check`.
    (async () => {
      const executable = resolveSageExecutable()
      if (executable === undefined) return undefined
      return await check(executable, ['--version'], 10_000)
    })(),
    checkResolved('lean', ['--version']),
  ])

  const rows: ProbeRow[] = []
  rows.push({
    id: 'python',
    label: 'Python 3',
    enables: '术语库构建 / OCR 扫描 / OSQP / Lean 禁用词检测',
    state: python.ok ? 'ready' : 'missing',
    ...(python.ok ? { detail: firstLine(python.stdout || python.stderr) } : {}),
    ...(python.ok ? {} : { hint: 'macOS: xcode-select --install 或 brew install python3；Windows: python.org 安装包' }),
  })
  if (yaml !== undefined) {
    rows.push({
      id: 'pyyaml',
      label: 'PyYAML',
      enables: 'verymath_glossary_build（CSV/YAML → glossary.json）',
      state: yaml.ok ? 'ready' : 'missing',
      ...(yaml.ok ? { detail: yaml.stdout.trim() } : {}),
      ...(yaml.ok ? {} : { hint: 'python3 -m pip install PyYAML' }),
    })
  }
  for (const [index, binary] of binaries.entries()) {
    const enables = index === 0 ? '数学 Beamer 幻灯片编译' : '中文 / 双语 Beamer 模板'
    rows.push({
      id: binary.name,
      label: binary.name,
      enables,
      state: binary.result.ok ? 'ready' : 'missing',
      ...(binary.result.ok ? { detail: firstLine(binary.result.stdout || binary.result.stderr) } : {}),
      ...(binary.result.ok ? {} : { hint: 'macOS: brew install --cask mactex-no-gui；Linux: texlive-full' }),
    })
  }
  if (osqp !== undefined) {
    rows.push({
      id: 'osqp',
      label: 'OSQP 求解栈',
      enables: 'verymath_osqp_solve（凸二次规划 + 独立 KKT 验证）',
      state: osqp.ok ? 'ready' : 'missing',
      ...(osqp.ok ? { detail: `osqp ${osqp.stdout.trim()}` } : {}),
      ...(osqp.ok ? {} : { hint: "python3 -m pip install 'osqp>=1,<2' numpy scipy" }),
    })
  }
  rows.push({
    id: 'sage',
    label: 'SageMath',
    enables: '本机 Sage 执行（文档查询不需要它）',
    state: sage !== undefined && sage.ok ? 'ready' : 'missing',
    ...(sage !== undefined && sage.ok ? { detail: firstLine(sage.stdout, 60) } : {}),
    ...(sage !== undefined && sage.ok ? {} : { hint: 'conda create -n sage sage=10.9，或设置 VERYMATH_SAGE 指向 sage 可执行文件' }),
  })
  rows.push({
    id: 'lean',
    label: 'Lean 4',
    enables: '补丁验收中的工具链校验（禁用词扫描不需要 Lean）',
    state: lean.ok ? 'ready' : 'missing',
    ...(lean.ok ? { detail: firstLine(lean.stdout, 60) } : {}),
    ...(lean.ok ? {} : { hint: 'lean-setup 技能会给出 elan / lake / mathlib 的安装步骤' }),
  })
  return rows
}

/**
 * The stats shape both the read route and the write routes return.
 *
 * Gaps are what makes the numbers actionable: "3 without examples" is trivia, the
 * ids are a to-do list the panel can show.
 */
function glossaryStats(terms: readonly GlossaryTerm[]): {
  total: number
  withExamples: number
  aliases: number
  fields: string[]
  missingExamples: string[]
  missingField: string[]
  missingExampleCount: number
  missingFieldCount: number
} {
  const missingExamples = terms.filter(term => (term.examples?.length ?? 0) === 0).map(term => term.term_id)
  const missingField = terms.filter(term => (term.field?.length ?? 0) === 0).map(term => term.term_id)
  return {
    total: terms.length,
    withExamples: terms.filter(term => (term.examples?.length ?? 0) > 0).length,
    aliases: terms.filter(term => term.term_id.includes('__')).length,
    fields: [...new Set(terms.flatMap(term => term.field ?? []))].sort((left, right) => left.localeCompare(right)),
    missingExamples: missingExamples.slice(0, 40),
    missingField: missingField.slice(0, 40),
    missingExampleCount: missingExamples.length,
    missingFieldCount: missingField.length,
  }
}

/** Find glossary documents under the workspace (bounded depth, bounded count). */
async function findGlossaries(workspace: string): Promise<Array<{ path: string, terms: number, updatedAt: string }>> {
  const found: Array<{ path: string, terms: number, updatedAt: string }> = []
  const skip = new Set(['node_modules', '.git', 'lib', 'dist', 'build', '.next'])

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 3 || found.length >= 50) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (found.length >= 50) return
      if (entry.name.startsWith('.') || skip.has(entry.name)) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(path, depth + 1)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      if (!/glossary/i.test(entry.name) && !/术语/.test(entry.name)) continue
      try {
        const raw = await readFile(path, 'utf8')
        const terms = parseGlossary(JSON.parse(raw))
        validateGlossaryInvariants(terms)
        const info = await stat(path)
        found.push({ path: path.slice(workspace.length + 1), terms: terms.length, updatedAt: new Date(info.mtimeMs).toISOString().slice(0, 10) })
      } catch {
        // A file named *glossary* that does not parse is not a glossary; skip it.
      }
    }
  }

  await walk(workspace, 0)
  return found.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

/** Find math-paper-reading structure artifacts under the workspace. */
async function findStructures(workspace: string): Promise<Array<{ path: string, title: string, entities: number }>> {
  const found: Array<{ path: string, title: string, entities: number }> = []
  const skip = new Set(['node_modules', '.git', 'lib', 'dist', 'build'])

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 3 || found.length >= 50) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (found.length >= 50) return
      if (entry.name.startsWith('.') || skip.has(entry.name)) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(path, depth + 1)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      if (!/_structure/i.test(entry.name)) continue
      try {
        const structure = parsePaperStructure(JSON.parse(await readFile(path, 'utf8')))
        found.push({
          path: path.slice(workspace.length + 1),
          title: structure.paper.title,
          entities: structure.entities?.length ?? 0,
        })
      } catch {
        // Same reasoning as glossaries: unreadable artifacts are not listed.
      }
    }
  }

  await walk(workspace, 0)
  return found
}

/**
 * Lay out the dependency graph for the panel.
 *
 * Coordinates are returned instead of a rendered SVG string so the client can
 * draw it with real elements: a node then reacts to clicks (show its statement,
 * its dependents, its reading position) and the panel never needs
 * `dangerouslySetInnerHTML` for untrusted labels.
 */
function graphLayout(structure: Parameters<typeof computeTopology>[0]): {
  nodes: Array<{ id: string, label: string, type: string, x: number, y: number, width: number, height: number, shared: boolean, inDegree: number, outDegree: number, supportsMainTheorem: boolean, statement: string }>,
  edges: Array<{ from: string, to: string, uncertain: boolean, external: boolean }>,
  width: number,
  height: number,
} {
  const { entities } = mergeBatches(structure)
  const topology = computeTopology(structure)
  const levels = topology.bottomUpLevels.length > 0 ? topology.bottomUpLevels : [entities.map(entity => entity.label)]
  const nodeW = 176
  const nodeH = 38
  const gapX = 26
  const gapY = 40
  const widest = Math.max(...levels.map(level => level.length), 1)
  const width = Math.max(380, widest * (nodeW + gapX) + gapX)
  const nodes: ReturnType<typeof graphLayout>['nodes'] = []
  let y = 18
  const position = new Map<string, { x: number, y: number }>()
  for (const level of levels) {
    const totalW = level.length * (nodeW + gapX) - gapX
    let x = Math.max(gapX, (width - totalW) / 2)
    for (const label of level) {
      position.set(label, { x, y })
      x += nodeW + gapX
    }
    y += nodeH + gapY
  }
  for (const entity of entities) {
    const at = position.get(entity.label)
    if (at === undefined) continue
    const metric = topology.metrics.find(item => item.label === entity.label)
    nodes.push({
      id: entity.label,
      label: entity.label,
      type: entity.type,
      x: at.x,
      y: at.y,
      width: nodeW,
      height: nodeH,
      shared: entity.shared_node === true,
      inDegree: metric?.inDegree ?? 0,
      outDegree: metric?.outDegree ?? 0,
      supportsMainTheorem: metric?.supportsMainTheorem ?? false,
      statement: entity.statement,
    })
  }
  const edges: ReturnType<typeof graphLayout>['edges'] = []
  for (const entity of entities) {
    if (!position.has(entity.label)) continue
    for (const dependency of entity.dependencies ?? []) {
      if (!position.has(dependency)) continue
      edges.push({ from: entity.label, to: dependency, uncertain: false, external: false })
    }
    for (const dependency of entity.uncertain_dependencies ?? []) {
      const target = dependency.split(' [')[0]?.trim() ?? ''
      if (!position.has(target)) continue
      edges.push({ from: entity.label, to: target, uncertain: true, external: false })
    }
    for (const ref of entity.external_refs ?? []) {
      edges.push({ from: entity.label, to: `EXT:${ref}`, uncertain: false, external: true })
    }
  }
  return { nodes, edges, width, height: Math.max(180, y + 10) }
}

/**
 * Register the panel's routes. Returns false when the host exposes no exact-fetch
 * table (headless / CLI), so the panel half degrades away instead of making the
 * plugin unloadable.
 */
export function registerHttp(ctx: HttpContext, connection: ConnectionLike | undefined): boolean {
  const register = connection?.fetch?.register
  if (typeof register !== 'function') return false

  /**
   * Serialize read-modify-write cycles per document. Without this two panel
   * actions fired quickly (edit two rows) both read the same snapshot and the
   * second write drops the first.
   */
  const writeChains = new Map<string, Promise<unknown>>()
  /** Prefer the service's chain so panel and tool writes cannot interleave. */
  const writeLock = <T>(key: string, task: () => Promise<T>): Promise<T> =>
    ctx.withWrite !== undefined ? ctx.withWrite(key, task) : withWrite(key, task)

  const withWrite = async <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const previous = writeChains.get(key) ?? Promise.resolve()
    const run = previous.then(task, task)
    const chained = run.then(() => undefined, () => undefined)
    writeChains.set(key, chained)
    try {
      return await run
    } finally {
      if (writeChains.get(key) === chained) writeChains.delete(key)
    }
  }

  const guard = (handler: (request: Request) => Promise<Response>) => async (request: Request): Promise<Response> => {
    try {
      return await handler(request)
    } catch (error) {
      const message = error instanceof VeryMathError
        ? `${error.code}: ${error.message}`
        : error instanceof Error ? error.message : String(error)
      ctx.log?.(`verymath panel route failed: ${message}`)
      return json({ error: message }, 500)
    }
  }

  // Environment readiness: what works right now, and what to install otherwise.
  register({
    path: '/api/verymath/env',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: guard(async () => {
      const rows = await probeEnvironment()
      const ready = rows.filter(row => row.state === 'ready').length
      return json({ rows, ready, total: rows.length, workspace: ctx.workspace() })
    }),
  })

  // Available glossary documents, so the panel can offer a picker instead of
  // asking the user to type a path.
  register({
    path: '/api/verymath/glossaries',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: guard(async () => json({ glossaries: await findGlossaries(ctx.workspace()) })),
  })

  // Query one glossary. `path` is workspace-relative and confined to it.
  register({
    path: '/api/verymath/glossary',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: guard(async (request) => {
      const url = safeUrl(request)
      if (url === undefined) return json({ error: 'invalid request url' }, 400)
      const relative = url.searchParams.get('path') ?? ''
      const query = (url.searchParams.get('q') ?? '').trim()
      const absolute = await withinWorkspace(ctx.workspace(), relative)
      if (absolute === undefined) return json({ error: 'path escapes the workspace' }, 400)

      let terms: GlossaryTerm[]
      try {
        terms = parseGlossary(JSON.parse(await readFile(absolute, 'utf8')))
        validateGlossaryInvariants(terms)
      } catch (error) {
        return json({ error: `not a valid glossary: ${error instanceof Error ? error.message : String(error)}` }, 400)
      }

      const stats = glossaryStats(terms)

      if (query.length === 0) return json({ stats, terms: [], matched: 0, truncated: false })
      const { hits, total } = queryGlossary(terms, query, { limit: 60 })
      return json({
        stats,
        matched: total,
        truncated: total > hits.length,
        terms: hits.map(hit => ({
          term_id: hit.term.term_id,
          en: hit.term.en,
          cn: hit.term.cn,
          matchedBy: hit.matchedBy,
          ...(hit.term.pos !== undefined ? { pos: hit.term.pos } : {}),
          ...(hit.term.field !== undefined ? { field: hit.term.field } : {}),
          ...(hit.term.source !== undefined ? { source: hit.term.source } : {}),
          ...(hit.term.examples !== undefined ? { examples: hit.term.examples.slice(0, 2) } : {}),
          updatedAt: hit.term.updated_at,
        })),
      })
    }),
  })

  const listStructures = guard(async () => json({ structures: await findStructures(ctx.workspace()) }))
  register({ path: '/api/verymath/structures', methods: ['GET'], requestBody: 'buffered', fetch: listStructures })

  // Dependency graph of one structure artifact: topology digest + inline SVG.
  register({
    path: '/api/verymath/paper',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: guard(async (request) => {
      const url = safeUrl(request)
      if (url === undefined) return json({ error: 'invalid request url' }, 400)
      const relative = url.searchParams.get('path') ?? ''
      const focus = (url.searchParams.get('focus') ?? '').trim()
      const absolute = await withinWorkspace(ctx.workspace(), relative)
      if (absolute === undefined) return json({ error: 'path escapes the workspace' }, 400)

      let structure
      try {
        structure = parsePaperStructure(JSON.parse(await readFile(absolute, 'utf8')))
      } catch (error) {
        return json({ error: `not a valid structure artifact: ${error instanceof Error ? error.message : String(error)}` }, 400)
      }

      const { entities, report } = mergeBatches(structure)
      const topology = computeTopology(structure)
      const layout = graphLayout(structure)
      return json({
        title: structure.paper.title,
        entities: entities.length,
        sharedNodes: [...report.sharedNodes],
        cycles: topology.cycles.map(cycle => [...cycle.labels]),
        isolated: [...topology.isolated],
        longestChain: [...topology.longestChain],
        topDownOrder: [...topology.topDownOrder],
        bottomUpLevels: topology.bottomUpLevels.map(level => [...level]),
        metrics: entities.map(entity => ({
          label: entity.label,
          type: entity.type,
          inDegree: topology.metrics.find(metric => metric.label === entity.label)?.inDegree ?? 0,
          outDegree: topology.metrics.find(metric => metric.label === entity.label)?.outDegree ?? 0,
          sharedNode: entity.shared_node === true,
          supportsMainTheorem: topology.metrics.find(metric => metric.label === entity.label)?.supportsMainTheorem ?? false,
        })),
        ...(focus.length > 0 ? { focus: focusClosure(structure, focus) } : {}),
        graph: layout,
      })
    }),
  })

  // Bundled skills, read from the package the same way the host skill registry
  // does, so the panel shows exactly what a session can invoke.
  register({
    path: '/api/verymath/skills',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: guard(async () => {
      // `fileURLToPath`, not `URL.pathname`: a pathname is percent-encoded, so an
      // install directory containing a space (`Application Support`, or any user
      // name with one) would resolve to a directory that does not exist.
      const moduleDir = fileURLToPath(new URL('.', import.meta.url))
      // One level up from both `lib/` (published) and `src/` (tests).
      const skillsDir = resolve(moduleDir, '..', 'skills')
      const result: Array<{ name: string, description: string, files: number }> = []
      let entries
      try {
        entries = await readdir(skillsDir, { withFileTypes: true })
      } catch {
        return json({ skills: [], error: 'skills directory not found in the package' })
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue
        try {
          const raw = await readFile(join(skillsDir, entry.name, 'SKILL.md'), 'utf8')
          const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)
          const front = match?.[1] ?? ''
          const name = /^name:\s*(.+)$/m.exec(front)?.[1]?.trim().replace(/^["']|["']$/g, '') ?? entry.name
          const description = /^description:\s*(.+)$/m.exec(front)?.[1]?.trim().replace(/^["']|["']$/g, '') ?? ''
          const files = (await readdir(join(skillsDir, entry.name), { withFileTypes: true })).length
          result.push({ name, description, files })
        } catch {
          // A directory without SKILL.md is not a skill.
        }
      }
      result.sort((left, right) => left.name.localeCompare(right.name))
      return json({ skills: result })
    }),
  })

  /** Read and validate a glossary document from disk, or explain why not. */
  const loadForWrite = async (absolute: string): Promise<{ terms: GlossaryTerm[] } | { error: string }> => {
    try {
      const terms = parseGlossary(JSON.parse(await readFile(absolute, 'utf8')))
      validateGlossaryInvariants(terms)
      return { terms }
    } catch (error) {
      return { error: `not a valid glossary: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  const readBody = async (request: Request): Promise<{ body: Record<string, unknown> } | { error: string }> => {
    try {
      const parsed: unknown = await request.json()
      if (typeof parsed !== 'object' || parsed === null) return { error: 'request body must be a JSON object' }
      return { body: parsed as Record<string, unknown> }
    } catch (error) {
      return { error: `request body is not valid JSON: ${error instanceof Error ? error.message : String(error)}` }
    }
  }


  // Add a term, or correct/remove one. The same core functions the chat tool uses
  // run here, so the panel and the agent cannot drift apart in behaviour.
  register({
    path: '/api/verymath/glossary/upsert',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: guard(async (request) => {
      const body = await readBody(request)
      if ('error' in body) return json({ error: body.error }, 400)
      const relative = typeof body.body.path === 'string' ? body.body.path : ''
      const absolute = await withinWorkspace(ctx.workspace(), relative)
      if (absolute === undefined) return json({ error: 'path escapes the workspace' }, 400)
      const requests = Array.isArray(body.body.terms) ? body.body.terms : []
      if (requests.length === 0) return json({ error: 'terms must be a non-empty array' }, 400)

      return await writeLock(absolute, async () => {
        const loaded = await loadForWrite(absolute)
        if ('error' in loaded) return json({ error: loaded.error }, 400)
        let result
        try {
          result = upsertTerms(loaded.terms, requests as TermUpsert[])
        } catch (error) {
          // Ambiguous matches, unknown term_id, duplicate pairs — all are the
          // caller's input, so they are 400 with the core's own message.
          return json({ error: error instanceof Error ? error.message : String(error) }, 400)
        }
        await writeJsonAtomic(absolute, result.document)
        // The chat tool reads through this cache; leaving it means the panel edit is
        // invisible to the agent until something else touches the file.
        ctx.invalidateGlossaryCache?.()
        return json({
          added: [...result.added],
          updated: [...result.updated],
          stats: glossaryStats(result.document),
          document: result.document,
        })
      })
    }),
  })

  register({
    path: '/api/verymath/glossary/delete',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: guard(async (request) => {
      const body = await readBody(request)
      if ('error' in body) return json({ error: body.error }, 400)
      const relative = typeof body.body.path === 'string' ? body.body.path : ''
      const termId = typeof body.body.term_id === 'string' ? body.body.term_id : ''
      const absolute = await withinWorkspace(ctx.workspace(), relative)
      if (absolute === undefined) return json({ error: 'path escapes the workspace' }, 400)
      if (termId.length === 0) return json({ error: 'term_id is required' }, 400)

      return await writeLock(absolute, async () => {
        const loaded = await loadForWrite(absolute)
        if ('error' in loaded) return json({ error: loaded.error }, 400)
        const result = deleteTerm(loaded.terms, termId)
        if (!result.removed) return json({ error: `no term with term_id ${JSON.stringify(termId)}` }, 404)
        await writeJsonAtomic(absolute, result.document)
        // The chat tool reads through this cache; leaving it means the panel edit is
        // invisible to the agent until something else touches the file.
        ctx.invalidateGlossaryCache?.()
        return json({ removed: termId, stats: glossaryStats(result.document), document: result.document })
      })
    }),
  })

  return true
}

/** Exported for tests: the workspace-confinement rule the routes rely on. */
export { withinWorkspace, basename as _basename }
