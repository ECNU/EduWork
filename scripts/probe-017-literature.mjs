// Compatibility probe for the unchanged published literature family. Retrieval
// is synthetic; the candidate's tool execution and filesystem are real.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { product: { type: 'string' }, output: { type: 'string' } } })
if (!values.product || !values.output) throw new Error('Use --product <assembled candidate> --output <new synthetic directory>')
const product = resolve(values.product), output = resolve(values.output)
const identity = JSON.parse(await readFile(join(product, 'assembly.json'), 'utf8'))
assert.equal(identity.pluginMode, 'source-qualification')
assert.equal(identity.dshVersion, '0.1.7-rc.1')
const require = createRequire(join(product, 'd/package.json'))
const load = name => import(pathToFileURL(require.resolve(name)).href)
const { Context } = await load('@deepseek-ai/cordis')
const { LiteratureRuntime } = await load('@shlv/dsh-literature-core')
const ctx = new Context()
await mkdir(output)
const report = { success: false, scope: 'published literature; synthetic retrieval; real candidate tools and filesystem', checks: [] }
try {
  for (const name of ['@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-tools']) await ctx.plugin((await load(name)).default)
  await ctx.plugin((await load('@deepseek-ai/dsh-fs-local')).default, { cwd: output })
  await ctx.plugin(LiteratureRuntime)
  for (const name of ['dblp', 'arxiv', 'tool']) await ctx.plugin(await load('@shlv/dsh-literature-' + name))
  assert.deepEqual(ctx.literature.selectedSources().map(source => source.id).sort(), ['arxiv', 'dblp'])
  assert.ok(ctx.tools)
  report.checks.push('published providers and tools mount with candidate peers')
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
  report.success = true
} finally {
  await ctx.fiber.dispose()
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
}
console.log(JSON.stringify(report, null, 2))
