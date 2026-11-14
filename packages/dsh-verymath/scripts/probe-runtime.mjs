// Synthetic Agent/LLM against the real DSH plugin API surface: mounts the
// verymath service, tools, and skill registry, then executes every
// model-facing tool with synthetic data. No remote model is called.
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { Context } = await import('@deepseek-ai/cordis')
const { SkillRegistry } = await import('@deepseek-ai/dsh-skill')
const core = await import('../lib/core/index.js')
const tool = await import('../lib/tool/index.js')

const output = await mkdtemp(join(tmpdir(), 'verymath-probe-'))
const report = { success: false, scope: 'synthetic Agent; real tools, skill registry and fs; no remote model', checks: [] }
try {
  const ctx = new Context()
  // Order matters: ToolRuntime's constructor calls ctx.systemPrompt.tools(),
  // so the system-prompt service must mount before the tool registry.
  const systemPrompt = await import('@deepseek-ai/dsh-system-prompt')
  await ctx.plugin(systemPrompt.default)
  const dshTools = await import('@deepseek-ai/dsh-tools')
  await ctx.plugin(dshTools.default)
  // DSH 0.2.2 decouples tool execution from the registry: a tool executor has to
  // be mounted before `ctx.tools.execute` can dispatch. The package only exists
  // from 0.2.2 on, so keep the mount optional to stay runnable on 0.2.1.x.
  let hasExecutor = false
  try {
    const toolExecutor = await import('@deepseek-ai/dsh-tool-executor-native')
    await ctx.plugin({ apply: toolExecutor.apply, inject: toolExecutor.inject, name: toolExecutor.name })
    hasExecutor = true
  } catch {
    hasExecutor = false
  }
  const fsLocal = await import('@deepseek-ai/dsh-fs-local')
  await ctx.plugin(fsLocal.default, { cwd: output })
  new SkillRegistry(ctx)
  // Mount via objects carrying `apply` + `inject`/`Config`, the shape the
  // plugin loader derives from each module namespace (unwrapExports).
  ctx.verymath // eslint-disable-line no-unused-expressions
  await ctx.plugin(core.default)
  await ctx.plugin({ apply: tool.apply, inject: tool.inject, Config: tool.Config, name: tool.name })

  assert.ok(ctx.verymath, 'verymath service mounted')
  assert.ok(ctx.skills, 'skill registry mounted')
  report.checks.push('verymath service, tools and skill registry mount with candidate peers')

  // Skills: the bundled provider lists and loads both adapted skills.
  const skills = await ctx.skills.list()
  const names = skills.filter(skill => skill.provider === 'verymath-bundled').map(skill => skill.name).sort()
  assert.deepEqual(names, ['after-ocr', 'discover-math-problems', 'graph-theory-paper-reading', 'invariant-computation', 'lean-formalization', 'lean-setup', 'least-squares', 'math-beamer', 'math-glossary', 'math-paper-reading', 'matlab-runner', 'mixed-integer-programming', 'open-problem-research-pipeline', 'osqp-solver', 'paper-writing', 'proof-blueprint-review'], JSON.stringify(names))
  const glossarySkill = await ctx.skills.get('math-glossary')
  assert.ok(glossarySkill.content.includes('verymath_glossary_query'))
  assert.equal(glossarySkill.resourceBase.kind, 'directory')
  report.checks.push('bundled skills listed and loaded through the DSH skill registry')

  // Glossary: build a source CSV, run the real upstream build script, query.
  const csvPath = join(output, 'source.csv')
  await writeFile(csvPath, 'en,cn\nmanifold,流形\ngroup,群\ncohomology,上同调\n')
  // DSH 0.2.2 takes a batch of raw calls: `id`, `name` and a JSON-string
  // `arguments`, returning `{ results: [{ result }] }`. 0.2.1.x takes a single
  // call with `callId` and an object `arguments`. Normalise to the single-call
  // shape the assertions below use, so the probe runs on both.
  const execute = async (name, args, exec) => {
    const signal = new AbortController().signal
    if (hasExecutor) {
      const batch = await ctx.tools.execute({
        calls: [{ id: name, name, arguments: JSON.stringify(args ?? {}) }],
        signal,
        ...(exec?.agent !== undefined ? { agent: exec.agent } : {}),
      })
      const settled = batch.results?.[0]?.result
      if (settled === undefined) throw new Error(`no result for ${name}`)
      return settled
    }
    return ctx.tools.execute({
      callId: name, name, arguments: args ?? {}, signal,
      ...(exec?.agent !== undefined ? { agent: exec.agent } : {}),
    })
  }

  const check = await execute('verymath_python_check', {})
  assert.equal(check.isError, false, JSON.stringify(check))
  report.checks.push(`verymath_python_check executes (available=${check.value.available})`)

  // Beamer toolchain probe: real execution (spawns latexmk/xelatex/kpsewhich probes).
  // Shape assertions only — availability is machine-dependent, so both outcomes are valid.
  const beamer = await execute('verymath_beamer_check', {})
  assert.equal(beamer.isError, false, JSON.stringify(beamer))
  assert.equal(typeof beamer.value.available, 'boolean')
  assert.ok(Array.isArray(beamer.value.tools) && beamer.value.tools.length === 4, 'beamer probe returns 4 pieces')
  assert.deepEqual(beamer.value.tools.map(tool => tool.name), ['latexmk', 'xelatex', 'forest', 'ctex'])
  if (!beamer.value.available) {
    assert.ok(typeof beamer.value.hint === 'string' && beamer.value.hint.length > 0, 'unavailable probes carry an install hint')
  }
  report.checks.push(`verymath_beamer_check executes (available=${beamer.value.available})`)

  const build = await execute('verymath_glossary_build', {
    script: 'glossary_build.py',
    args: [csvPath, '--output', join(output, 'glossary.json'), '--no-excel', '--source-label', 'probe'],
  })
  assert.equal(build.isError, false, JSON.stringify(build))
  assert.equal(build.value.exitCode, 0)
  const built = JSON.parse(await readFile(join(output, 'glossary.json'), 'utf8'))
  assert.ok(Array.isArray(built) && built.length === 3, 'build script produced the glossary')
  report.checks.push('verymath_glossary_build runs the real upstream Python script')

  const query = await execute('verymath_glossary_query', {
    query: '流形',
    glossaryPath: join(output, 'glossary.json'),
  })
  assert.equal(query.isError, false, JSON.stringify(query))
  assert.equal(query.value.terms[0]?.cn, '流形')
  report.checks.push('verymath_glossary_query answers through the validated glossary seam')

  // Upsert through the real tool contract. The model-facing parameter schema and
  // its mapping into TermUpsert are only exercised here: a missing `term_id` in
  // the tool schema would leave every core test green while making correction
  // impossible through the tool the skill mandates.
  const glossaryPath = join(output, 'glossary.json')
  const addAlias = await execute('verymath_glossary_upsert', {
    glossaryPath,
    terms: [{ en: 'manifold', cn: '流形体', field: ['拓扑学'] }],
  })
  assert.equal(addAlias.isError, false, JSON.stringify(addAlias))
  assert.deepEqual(addAlias.value.added, ['manifold__1'], 'a second translation becomes an alias row')
  assert.deepEqual(addAlias.value.updated, [])

  const corrected = await execute('verymath_glossary_upsert', {
    glossaryPath,
    terms: [{ term_id: 'manifold__1', en: 'manifold', cn: '流形（别名）' }],
  })
  assert.equal(corrected.isError, false, JSON.stringify(corrected))
  assert.deepEqual(corrected.value.updated, ['manifold__1'], 'term_id addresses one row for correction')

  // The write reached disk, the primary translation survived, and a fresh query
  // of the same file agrees with it (no stale cache between write and read).
  const onDisk = JSON.parse(await readFile(glossaryPath, 'utf8'))
  const byTermId = new Map(onDisk.map(entry => [entry.term_id, entry.cn]))
  assert.equal(byTermId.get('manifold'), '流形')
  assert.equal(byTermId.get('manifold__1'), '流形（别名）')
  const requery = await execute('verymath_glossary_query', { query: '流形', glossaryPath })
  assert.equal(requery.isError, false, JSON.stringify(requery))
  assert.ok(requery.value.terms.some(hit => hit.term_id === 'manifold__1' && hit.cn === '流形（别名）'))
  report.checks.push('verymath_glossary_upsert adds an alias row and corrects one by term_id')

  // Error contract: an unknown term_id is rejected and leaves the file untouched.
  const beforeReject = await readFile(glossaryPath, 'utf8')
  const rejected = await execute('verymath_glossary_upsert', {
    glossaryPath,
    terms: [{ term_id: 'no-such-term', en: 'manifold', cn: '不应写入' }],
  })
  assert.equal(rejected.isError, true, 'unknown term_id must fail')
  assert.match(String(rejected.content[0]?.text ?? rejected.error ?? ''), /no term with term_id/)
  assert.equal(await readFile(glossaryPath, 'utf8'), beforeReject, 'a rejected batch must not write')
  report.checks.push('verymath_glossary_upsert rejects an unknown term_id without writing')

  // Paper structure: validate a synthetic v4.2 artifact through ctx.fs.
  const paperPath = join(output, 'demo_structure.json')
  await writeFile(paperPath, JSON.stringify({
    paper: { title: 'Probe Paper', authors: ['P. Robe'], year: 2026, analysis_date: '2026-10-14', skill_version: '4.2' },
    section_map: [{ section: '§1', title: 'Intro', section_type: '引言', skill2_action: '无需处理', appendix: false }],
    main_theorems: [{ label: 'Theorem 1.1', statement: 'All probe manifolds are compact.', location: { section: '§1' }, role: 'main' }],
    entities: [
      { type: 'DEFINITION', label: 'Definition 1.0', statement: 'A probe is a point.', location: { section: '§1' } },
      { type: 'THEOREM', label: 'Theorem 1.1', statement: 'All probe manifolds are compact.', location: { section: '§1' }, dependencies: ['Definition 1.0'] },
    ],
    completeness_check: { self_containment: 'high' },
  }))
  const parent = { id: 'probe-session', ctx: new Context(), status: 'running', session: { header: { cwd: output } } }
  const validate = await execute('verymath_paper_validate', { path: 'demo_structure.json' }, { agent: parent })
  assert.equal(validate.isError, false, JSON.stringify(validate))
  assert.equal(validate.value.valid, true)
  assert.equal(validate.value.entityCount, 2)
  assert.equal(validate.value.mainTheoremCount, 1)
  report.checks.push('verymath_paper_validate validates a v4.2 artifact from the workspace')

  // Batch artifacts through the real tool: a later batch may cite a label an
  // earlier batch defined (the upstream batch protocol), and every merged entity
  // — not just the first file's — has to reach the graph and the Mermaid render.
  await writeFile(join(output, 'batch_a.json'), JSON.stringify({
    paper: { title: 'Batch Paper', authors: ['B. Atch'] },
    entities: [{ type: 'DEFINITION', label: 'Definition 1', statement: 'A batch point.' }],
  }))
  await writeFile(join(output, 'batch_b.json'), JSON.stringify({
    paper: { title: 'Batch Paper', authors: ['B. Atch'] },
    // The theorem exists only in main_theorems, so `focus` must resolve it from
    // the merged namespace rather than from entities[].
    main_theorems: [{ label: 'Theorem 2', statement: 'Batched compactness.' }],
    entities: [
      { type: 'LEMMA', label: 'Lemma 2.1', statement: 'A batch lemma.', dependencies: ['Definition 1'] },
      { type: 'THEOREM', label: 'Theorem 2', statement: 'Batched compactness.', dependencies: ['Lemma 2.1'] },
    ],
  }))
  const graph = await execute('verymath_paper_graph', {
    path: 'batch_a.json',
    extraPaths: ['batch_b.json'],
    focus: 'Theorem 2',
  }, { agent: parent })
  assert.equal(graph.isError, false, JSON.stringify(graph))
  assert.equal(graph.value.totalEntities, 3, 'both batches contribute entities')
  assert.ok(graph.value.danglingEdges.length === 0, 'cross-batch dependency is not dangling')
  assert.deepEqual([...graph.value.topDownOrder].sort(), ['Definition 1', 'Lemma 2.1', 'Theorem 2'], 'top-down walks the batched theorem and its transitive dependencies')
  assert.ok(graph.value.metrics.every(metric => metric.supportsMainTheorem), 'every merged entity supports the merged main theorem')
  assert.equal(graph.value.focus?.found, true, 'focus resolves a theorem that exists only in main_theorems')
  for (const label of ['Definition 1', 'Lemma 2.1', 'Theorem 2']) {
    assert.ok(graph.value.mermaid.includes(label.replace(/[^A-Za-z0-9-]/g, '')), `mermaid contains ${label}`)
  }
  report.checks.push('verymath_paper_graph merges batches: cross-batch deps, batched theorem, full mermaid')

  // A main theorem that exists ONLY in main_theorems (no matching entity) must
  // still resolve for `focus`; the earlier fixture also listed it under entities,
  // so that assertion could not tell the difference.
  await writeFile(join(output, 'batch_meta.json'), JSON.stringify({
    paper: { title: 'Batch Paper', authors: ['B. Atch'] },
    main_theorems: [{ label: 'Theorem Only', statement: 'Metadata-only main theorem.' }],
    entities: [{ type: 'LEMMA', label: 'Lemma 0', statement: 'Unrelated.' }],
  }))
  const metadataFocus = await execute('verymath_paper_graph', {
    path: 'batch_meta.json',
    focus: 'Theorem Only',
  }, { agent: parent })
  assert.equal(metadataFocus.isError, false, JSON.stringify(metadataFocus))
  assert.equal(metadataFocus.value.focus?.found, true, 'a theorem present only in main_theorems resolves')
  assert.deepEqual(metadataFocus.value.focus?.closure, ['Theorem Only'])
  assert.deepEqual(metadataFocus.value.topDownOrder, ['Theorem Only'])
  report.checks.push('verymath_paper_graph focuses a main theorem that has no entity')

  // A genuinely dangling dependency is still rejected after the merge.
  await writeFile(join(output, 'batch_bad.json'), JSON.stringify({
    paper: { title: 'Batch Paper', authors: ['B. Atch'] },
    entities: [{ type: 'CLAIM', label: 'Claim 9', statement: 'Orphan.', dependencies: ['Nope 42'] }],
  }))
  const dangling = await execute('verymath_paper_graph', {
    path: 'batch_a.json',
    extraPaths: ['batch_bad.json'],
  }, { agent: parent })
  assert.equal(dangling.isError, true, 'dangling dependency must fail')
  assert.match(String(dangling.content[0]?.text ?? dangling.error ?? ''), /unknown label Nope 42/)
  report.checks.push('verymath_paper_graph still rejects a dependency missing from every batch')

  // A batch whose later request is invalid must not write the earlier one.
  const beforeMixed = await readFile(glossaryPath, 'utf8')
  const mixed = await execute('verymath_glossary_upsert', {
    glossaryPath,
    terms: [
      { en: 'cohomology ring', cn: '上同调环' },
      { term_id: 'no-such-term', en: 'cohomology ring', cn: '不应写入' },
    ],
  })
  assert.equal(mixed.isError, true, 'the invalid request must fail the whole batch')
  assert.equal(await readFile(glossaryPath, 'utf8'), beforeMixed, 'a partially valid batch must not write')
  report.checks.push('verymath_glossary_upsert writes nothing when a later request in the batch fails')

  // Cache invalidation across path aliases: a symlink names the same document, so
  // a write through the real path must not leave the earlier alias-cached text in
  // place. Dropping only the keys the writing call knows about does exactly that.
  const realPath = join(output, 'alias-target.json')
  const aliasPath = join(output, 'alias-link.json')
  await writeFile(realPath, JSON.stringify([{
    term_id: 'group', en: 'group', cn: '群', created_at: '2026-01-01', updated_at: '2026-01-01',
  }]))
  await symlink(realPath, aliasPath)
  const beforeAlias = await execute('verymath_glossary_query', { query: '群', glossaryPath: aliasPath })
  assert.equal(beforeAlias.isError, false, JSON.stringify(beforeAlias))
  assert.equal(beforeAlias.value.terms[0]?.cn, '群')
  const viaReal = await execute('verymath_glossary_upsert', {
    glossaryPath: realPath,
    terms: [{ term_id: 'group', en: 'group', cn: '群（修正）' }],
  })
  assert.equal(viaReal.isError, false, JSON.stringify(viaReal))
  const afterAlias = await execute('verymath_glossary_query', { query: '群', glossaryPath: aliasPath })
  assert.equal(afterAlias.isError, false, JSON.stringify(afterAlias))
  assert.equal(afterAlias.value.terms[0]?.cn, '群（修正）', 'a write through the real path is visible through a symlink alias')
  report.checks.push('verymath_glossary_upsert invalidates cache entries reached by another path')

  // Concurrent upserts on one document through two spellings of the same file must
  // both survive: the lock is keyed on canonical identity, not on the string the
  // model happened to send.
  const concurrentPath = join(output, 'concurrent.json')
  const concurrentAlias = join(output, 'concurrent-link.json')
  await writeFile(concurrentPath, '[]')
  await symlink(concurrentPath, concurrentAlias)
  const [viaPlain, viaAlias] = await Promise.all([
    execute('verymath_glossary_upsert', { glossaryPath: concurrentPath, terms: [{ en: 'first term', cn: '第一项' }] }),
    execute('verymath_glossary_upsert', { glossaryPath: concurrentAlias, terms: [{ en: 'second term', cn: '第二项' }] }),
  ])
  assert.equal(viaPlain.isError, false, JSON.stringify(viaPlain))
  assert.equal(viaAlias.isError, false, JSON.stringify(viaAlias))
  const concurrent = JSON.parse(await readFile(concurrentPath, 'utf8'))
  assert.deepEqual(concurrent.map(entry => entry.en).sort(), ['first term', 'second term'], 'both concurrent writes survive')
  report.checks.push('verymath_glossary_upsert serializes concurrent writes through a path alias')

  // Error contract: an invalid artifact surfaces the structured error code.
  const badPath = join(output, 'bad_structure.json')
  await writeFile(badPath, JSON.stringify({ paper: { title: 'Bad' }, entities: [{ type: 'CONJECTURE', label: 'C1', statement: 'x' }] }))
  const bad = await execute('verymath_paper_validate', { path: 'bad_structure.json' }, { agent: parent })
  assert.equal(bad.isError, true)
  assert.match(String(bad.content[0]?.text ?? bad.error ?? ''), /unknown type/)
  report.checks.push('invalid artifacts surface the structured VeryMathError taxonomy')

  report.success = true
  console.log(JSON.stringify(report, null, 1))
} catch (error) {
  report.success = false
  report.error = String(error && error.stack ? error.stack : error)
  console.error(JSON.stringify(report, null, 1))
  process.exitCode = 1
}
