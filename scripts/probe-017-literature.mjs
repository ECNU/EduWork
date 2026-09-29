// Exercise the maintained package through the assembled candidate's dependencies.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { parseArgs } from 'node:util'
import { probeLiterature } from '../packages/dsh-literature/scripts/probe-runtime.mjs'
const { values } = parseArgs({ options: { product: { type: 'string' }, output: { type: 'string' } } })
if (!values.product || !values.output) throw new Error('Use --product <assembled candidate> --output <synthetic directory>')
const product = resolve(values.product), output = resolve(values.output)
const identity = JSON.parse(await readFile(join(product, 'assembly.json'), 'utf8'))
assert.equal(identity.pluginMode, 'source-qualification')
assert.equal(identity.dshVersion, '0.2.0-rc.1')
const published = JSON.parse(await readFile(new URL('../third_party/dsh/candidate-v0.2.0-rc.1/literature.json', import.meta.url), 'utf8'))
assert.ok(!identity.sourcePackages.includes(published.name))
assert.deepEqual(identity.externalPackages.filter(item => item.name === published.name), [published])
const manifest = JSON.parse(await readFile(join(product, 'd/package.json'), 'utf8'))
assert.equal(manifest.dependencies[published.name], published.version)
const require = createRequire(join(product, 'd/package.json'))
const load = name => import(pathToFileURL(require.resolve(name)).href)
console.log(JSON.stringify(await probeLiterature({ load, output }), null, 2))
