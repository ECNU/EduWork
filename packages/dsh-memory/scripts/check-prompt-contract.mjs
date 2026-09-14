import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

// Load only the caller-selected prepared runtime; never install or mutate it.
assert.ok(process.argv[2], 'Pass the isolated runtime directory containing node_modules')
const require = createRequire(path.join(path.resolve(process.argv[2]), 'package.json'))
const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')))
const { default: SystemPrompt, renderPrompt } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-system-prompt')))
const source = await readFile(new URL('../src/host/index.js', import.meta.url), 'utf8')
const registration = source.match(/ctx\.systemPrompt\.section\(\{[\s\S]*?\n    \}\)/)?.[0]
assert.ok(registration, 'Find the actual Memory section registration in owned source')
const ctx = new Context()
await ctx.plugin(SystemPrompt, { personaPrefix: 'synthetic-prefix', personaSuffix: 'synthetic-suffix', includeHarnessIdentity: false })
let enabled = true
// Evaluate only the registration extracted from this repository, with synthetic settings/text.
new Function('ctx', 'PROMPT', registration).call({ settings: { get: () => ({ enabled }) } }, ctx, 'synthetic-memory-guidance')
const assembly = await ctx.systemPrompt.assemble()
const names = assembly.sections.map(section => section.name)
assert.equal(names.filter(name => name === 'eduwork:local-memory').length, 1)
assert.ok(names.indexOf('deployment:persona-prefix') < names.indexOf('eduwork:local-memory'))
assert.ok(names.indexOf('eduwork:local-memory') < names.indexOf('deployment:persona-suffix'))
const rendered = renderPrompt(assembly)
for (const text of ['synthetic-prefix', 'synthetic-memory-guidance', 'synthetic-suffix']) assert.ok(rendered.includes(text))
enabled = false
assert.ok(!renderPrompt(await ctx.systemPrompt.assemble()).includes('synthetic-memory-guidance'))
console.log(JSON.stringify({ passed: true, dshVersion: require('@deepseek-ai/dsh-system-prompt/package.json').version, memorySectionUnique: true, personaOrdering: true, disabledMemoryOmitted: true }))
