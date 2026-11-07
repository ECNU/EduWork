// Synthetic Agent/LLM against the real DSH plugin API surface: mounts the
// verymath service, tools, and skill registry, then executes every
// model-facing tool with synthetic data. No remote model is called.
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
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
  const execute = (name, args) => ctx.tools.execute({
    callId: name, name, arguments: args, signal: new AbortController().signal,
  })

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
  const validate = await ctx.tools.execute({
    callId: 'verymath_paper_validate', name: 'verymath_paper_validate',
    arguments: { path: 'demo_structure.json' }, agent: parent, signal: new AbortController().signal,
  })
  assert.equal(validate.isError, false, JSON.stringify(validate))
  assert.equal(validate.value.valid, true)
  assert.equal(validate.value.entityCount, 2)
  assert.equal(validate.value.mainTheoremCount, 1)
  report.checks.push('verymath_paper_validate validates a v4.2 artifact from the workspace')

  // Error contract: an invalid artifact surfaces the structured error code.
  const badPath = join(output, 'bad_structure.json')
  await writeFile(badPath, JSON.stringify({ paper: { title: 'Bad' }, entities: [{ type: 'CONJECTURE', label: 'C1', statement: 'x' }] }))
  const bad = await ctx.tools.execute({
    callId: 'verymath_paper_validate', name: 'verymath_paper_validate',
    arguments: { path: 'bad_structure.json' }, agent: parent, signal: new AbortController().signal,
  })
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
