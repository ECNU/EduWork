import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { bundledConfigurationPlugins, pluginConfigurationFields } from '../dsh-host/configuration-plugin-options.mjs'
import { pluginConfigurationDefaults } from '../dsh-host/configuration-documentation.mjs'

// Inspect the assembled npm bundle manifests, including inserts that do not
// appear in composition.json. No YAML JavaScript tags are evaluated.
const product = resolve(process.argv[2])
const identity = JSON.parse(await readFile(join(product, 'assembly.json'), 'utf8'))
const runtime = join(product, 'd'), require = createRequire(join(runtime, 'package.json'))
const { parse } = require('yaml')
const wiringBundles = new Set(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@eduwork/web-composition'])
// Database locations are assigned by the runtime, never exposed as a competing
// editable plugin setting; local-memory owns the user-facing memory options.
const wiringRows = new Set(['local-memory-sqlite'])
const installed = new Map()
let bundleCount = 0, schemaFields = 0
for (const bundle of identity.bundles) {
  if (wiringBundles.has(bundle)) continue
  assert.ok(Object.values(bundledConfigurationPlugins).includes(bundle), `Unreviewed configurable bundle: ${bundle}`)
  const text = await readFile(join(runtime, 'node_modules', bundle, 'cordis.patch.yml'), 'utf8')
  const rows = parse(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => value }] })
  for (const row of rows.flatMap(row => row.insert ?? [])) {
    if (wiringRows.has(row.id)) continue
    assert.equal(bundledConfigurationPlugins[row.id], bundle, `Undocumented bundle plugin: ${row.id}`)
    assert.ok(Object.keys(pluginConfigurationFields).some(key => key.startsWith(`plugins.${row.id}.`)), `Missing help: ${row.id}`)
    installed.set(row.id, row.name)
  }
  bundleCount++
}
const defaults = pluginConfigurationDefaults([], pluginConfigurationFields, identity.bundles)
for (const [id, name] of installed) {
  assert.ok(defaults[id], `No editable defaults for ${id}`)
  if (!name.startsWith('@shlv/')) continue
  const module = await import(pathToFileURL(require.resolve(name)))
  const schema = module.Config ?? module.default?.Config
  assert.ok(schema?.dict, `Missing installed configuration schema: ${name}`)
  for (const [key, field] of Object.entries(schema.dict)) {
    const entry = pluginConfigurationFields[`plugins.${id}.${key}`]
    assert.ok(entry, `Missing installed option: ${id}.${key}`)
    if (field.meta.default !== undefined) assert.deepEqual(entry[1], field.meta.default, `Default drift: ${id}.${key}`)
    schemaFields++
  }
}
console.log(JSON.stringify({ bundles: bundleCount, plugins: installed.size, schemaFields }))
