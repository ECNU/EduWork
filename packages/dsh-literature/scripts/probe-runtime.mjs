// Synthetic retrieval/Agent; real official tools, job registry and filesystem.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'

export async function probeLiterature({ load, output }) {
const { Context } = await load('@deepseek-ai/cordis')
const { LiteratureRuntime, LiteratureError } = await load('@eduwork/dsh-literature/core')
const ctx = new Context()
await mkdir(output, { recursive: true })
const report = { success: false, scope: 'EduWork literature fork; synthetic retrieval/Agent; real tools, job registry and filesystem', checks: [] }
try {
  for (const name of ['@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-tools']) await ctx.plugin((await load(name)).default)
  await ctx.plugin((await load('@deepseek-ai/dsh-fs-local')).default, { cwd: output })
  await ctx.plugin(LiteratureRuntime)
  for (const name of ['dblp', 'arxiv', 'tool']) await ctx.plugin(await load('@eduwork/dsh-literature/' + name))
  assert.deepEqual(ctx.literature.selectedSources().map(source => source.id).sort(), ['arxiv', 'dblp'])
  assert.ok(ctx.tools)
  report.checks.push('built providers and tools mount with candidate peers')
  const record = { id: 'synthetic', title: 'Synthetic paper', authors: ['Test'], published: true, sources: ['dblp'], year: 2026 }
  ctx.literature.search = async () => ({ records: [record], total: 1, truncated: false })
  ctx.literature.bibtex = async () => ({ bibtex: '@article{synthetic,title={Synthetic paper}}', source: 'dblp', published: true })
  ctx.literature.fulltext = async () => ({ id: 'synthetic', source: 'dblp', files: [{ path: 'paper.md', content: 'Synthetic full text', kind: 'markdown' }], summary: 'Synthetic full text' })
  for (const [name, args] of [['literature_search', { query: 'synthetic' }], ['literature_bibtex', { query: 'synthetic' }], ['literature_fulltext', { query: 'synthetic', run_in_background: false }]]) {
    const result = await ctx.tools.execute({ callId: name, name, arguments: args, signal: new AbortController().signal })
    assert.equal(result.isError, false, JSON.stringify(result))
    if (name === 'literature_search') assert.equal(result.value.papers[0].title, record.title)
    if (name === 'literature_bibtex') assert.match(result.value.bibtex, /Synthetic paper/)
    report.checks.push(name + ' executes with a validated output contract')
  }
  assert.equal(await readFile(join(output, 'literature/synthetic/paper.md'), 'utf8'), 'Synthetic full text')
  // Real official job registry and model-facing job tools. Retrieval and the
  // calling Agent/child completion are synthetic; no remote model is called.
  const ownerCtx = new Context()
  const workspace = join(output, 'calling-workspace')
  await mkdir(workspace)
  const parent = { id: 'literature-session', ctx: ownerCtx, status: 'running',
    session: { header: { cwd: workspace } }, inject() {} }
  ctx.provide('agents')
  ctx.set('agents', { get: id => id === parent.id ? parent : undefined })
  await ctx.plugin((await load('@deepseek-ai/dsh-jobs-local')).default)
  await ctx.plugin(await load('@deepseek-ai/dsh-tool-jobs'))
  const execute = (name, args) => ctx.tools.execute({ callId: name, name, arguments: args, agent: parent, signal: new AbortController().signal })
  let sandboxCalls = 0
  ctx.provide('sandboxPolicy')
  ctx.set('sandboxPolicy', { resolve: ({ session }) => { assert.equal(session, parent.session); sandboxCalls++; return { mode: 'workspace-write', writableRoots: [workspace] } } })
  const background = await execute('literature_fulltext', { query: 'synthetic' })
  assert.equal(background.isError, false, JSON.stringify(background))
  assert.equal(background.value.kind, 'background')
  const collected = await execute('job_output', { job_id: background.value.jobId, wait: true, timeout_ms: 1000 })
  assert.equal(collected.isError, false, JSON.stringify(collected))
  assert.equal(collected.value.job.status, 'completed', JSON.stringify(collected))
  assert.match(collected.value.text, /Synthetic full text/)
  assert.equal(await readFile(join(workspace, 'literature/synthetic/paper.md'), 'utf8'), 'Synthetic full text')
  assert.ok(sandboxCalls > 0)
  report.checks.push('default background fulltext preserves session ownership, workspace policy and job_output result')
  let abortSeen = false
  ctx.literature.fulltext = (_input, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => { abortSeen = true; reject(signal.reason) }, { once: true }))
  const cancellable = await execute('literature_fulltext', { query: 'cancelled' })
  assert.equal(cancellable.isError, false, JSON.stringify(cancellable))
  const killed = await execute('job_kill', { job_id: cancellable.value.jobId, reason: 'synthetic cancellation' })
  assert.equal(killed.isError, false, JSON.stringify(killed))
  await ctx.jobs.wait(cancellable.value.jobId, 1000, parent.id)
  assert.equal(abortSeen, true)
  assert.equal(ctx.jobs.get(cancellable.value.jobId, parent.id).status, 'killed')
  report.checks.push('official job_kill propagates cancellation and settles the producer')
  const unavailability = () => new LiteratureError('synthetic retrieval unavailable', 'LITERATURE_FULLTEXT_UNAVAILABLE')
  ctx.literature.landingPage = async () => '<a href="https://example.test/paper.pdf">PDF</a>'
  ctx.provide('subagents')
  for (const mode of ['completed', 'refusal', 'aborted']) {
    let disposed = 0, started
    ctx.set('subagents', { getProvider: () => ({}), start: async (_name, options) => {
      assert.equal(options.parent, parent); assert.deepEqual(options.toolFilter, { allow: [] })
      assert.equal(options.outputSchema.required[0], 'pdfUrl')
      started = options
      return { result: mode === 'aborted'
        ? new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))
        : Promise.resolve({ stopReason: mode, structured: { pdfUrl: 'https://example.test/paper.pdf' } }), dispose: async () => { disposed++ } }
    } })
    ctx.literature.fulltext = async input => {
      if (input !== 'https://example.test/paper.pdf') throw unavailability()
      return { id: 'fallback', source: 'dblp', files: [{ path: 'paper.md', content: 'PDF fallback', kind: 'markdown' }], summary: 'PDF fallback' }
    }
    const job = await execute('literature_fulltext', { query: 'https://example.test/landing' })
    assert.equal(job.isError, false, JSON.stringify(job))
    // The returned job has started; allow its resolved landing-page continuation.
    await new Promise(resolve => setImmediate(resolve))
    assert.ok(started)
    if (mode === 'aborted') await execute('job_kill', { job_id: job.value.jobId })
    await ctx.jobs.wait(job.value.jobId, 1000, parent.id)
    assert.equal(disposed, 1)
    assert.equal(ctx.jobs.get(job.value.jobId, parent.id).status, mode === 'completed' ? 'completed' : mode === 'aborted' ? 'killed' : 'failed')
    report.checks.push(`publisher PDF Subagent ${mode}: output/terminal state and disposal verified`)
  }
  abortSeen = false
  ctx.literature.fulltext = (_input, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => { abortSeen = true; reject(signal.reason) }, { once: true }))
  const owned = await execute('literature_fulltext', { query: 'owner-dispose' })
  assert.equal(owned.isError, false, JSON.stringify(owned))
  await ownerCtx.fiber.dispose()
  assert.equal(abortSeen, true)
  assert.equal(ctx.jobs.list(parent.id).length, 0)
  report.checks.push('disposing the owning scope cancels and removes its jobs')
  report.success = true
} finally {
  await ctx.fiber.dispose()
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
}
return report
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const require = createRequire(new URL('../package.json', import.meta.url))
  const load = name => import(pathToFileURL(require.resolve(name)).href)
  const output = await mkdtemp(join(tmpdir(), 'eduwork-literature-'))
  try { console.log(JSON.stringify(await probeLiterature({ load, output }), null, 2)) }
  finally { await rm(output, { recursive: true, force: true }) }
}
