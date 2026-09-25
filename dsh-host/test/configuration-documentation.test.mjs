import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, mkdir, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { documentConfiguration, configurationDocumentationOptions, explicitConfigurationDefaults, pluginConfigurationDefaults } from '../configuration-documentation.mjs'
import { configurationFields } from '../configuration-reference.mjs'
import { ConfigurationFile, readConfiguration } from '../configuration-file.mjs'
import { parseUserConfig } from '../user-config.mjs'
import { DEFAULTS as mailDefaults } from '../../packages/dsh-mail/src/host/constants.js'
import { DEFAULT_SETTINGS as memoryDefaults } from '../../packages/dsh-memory/src/host/core.js'
import { pluginConfigurationFields, managedPluginConfiguration } from '../configuration-plugin-options.mjs'

test('mail and memory defaults are covered and equal to the packages, not invented examples', () => {
  for (const [id, expected] of [['dsh-mail-assistant', mailDefaults], ['local-memory', memoryDefaults]]) {
    for (const [key, value] of Object.entries(expected)) {
      const entry = pluginConfigurationFields[`plugins.${id}.${key}`]
      assert.ok(entry?.[0], `${id}.${key} needs Chinese help`)
      assert.deepEqual(entry[1], value, `${id}.${key} default drift`)
      assert.equal(entry[2], true)
    }
  }
})

test('every public distribution plugin option has help or one documented owning field', async () => {
  const distribution = JSON.parse(await readFile(new URL('../../config/distributions/generic.json', import.meta.url)))
  function visit(value, path) {
    if (Object.keys(managedPluginConfiguration).some(key => path === key || path.startsWith(key + '.'))) return
    if (configurationFields['plugins.' + path]) return
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) visit(child, path + '.' + key)
    } else assert.fail('Undocumented release option: plugins.' + path)
  }
  for (const row of distribution.plugins) visit(row.config ?? {}, row.id)
})

test('public parser allowlists and installed plugin readers cannot add undocumented configuration', async () => {
  for (const source of ['../user-config.mjs', '../../dsh-plugins/media-openai/lib/config.js']) {
    const text = await readFile(new URL(source, import.meta.url), 'utf8')
    let count = 0
    for (const [, list, label] of text.matchAll(/(?:allowed|object)\([^\n]*?, \[([^\]]+)\], '([^']+)'\)/g)) {
      if (label === '内容配置') continue
      const prefix = label === '配置' ? '' : label.replace(/^media\.provider\./, 'media.providers[].').replace(/^speech\./, 'media.providers[].speech.') + '.'
      for (const [, key] of list.matchAll(/'([^']+)'/g)) { count++; assert.ok(configurationFields[prefix + key], prefix + key) }
    }
    assert.ok(count > 10, 'parser coverage must actually inspect the allowlists')
  }
  for (const [id, source, variable] of [
    ['eduwork-brand-settings', '../../dsh-plugins/brand-settings-native/lib/index.js', 'raw'],
    ['eduwork-skill-settings', '../../dsh-plugins/skill-settings-native/lib/index.js', 'raw'],
    ['eduwork-activity-insights-native', '../../dsh-plugins/activity-insights-native/lib/index.js', 'config'],
    ['eduwork-knowledge-studio', '../../packages/dsh-knowledge-studio/lib/index.js', 'config'],
    ['eduwork-artifact-services', '../../packages/dsh-knowledge-studio/packages/artifact-services/lib/dsh.js', 'config'],
  ]) {
    const text = await readFile(new URL(source, import.meta.url), 'utf8')
    for (const [, key] of text.matchAll(new RegExp('\\b' + variable + '\\.([A-Za-z]\\w*)', 'g'))) {
      const path = id + '.' + key
      assert.ok(Object.keys(configurationFields).some(name => name === 'plugins.' + path || name.startsWith('plugins.' + path + '.')) || managedPluginConfiguration[path], path)
    }
  }
})

test('shipped JSONC files contain the current complete reference', async () => {
  for (const name of ['eduwork.jsonc', ...(await readdir(new URL('../../config/desktop/examples/', import.meta.url))).filter(name => name.endsWith('.jsonc')).map(name => 'examples/' + name)]) {
    const text = await readFile(new URL('../../config/desktop/' + name, import.meta.url), 'utf8')
    assert.equal(documentConfiguration(text), text, name + ' needs its inline reference refreshed')
  }
})

test('model type help preserves declared metadata without installing model IDs or inferred types', () => {
  for (const provider of [{}, { models: [] }, { models: [{ id: 'main', type: 'llm' }, { id: 'voice', type: 'tts' }] }]) {
    const value = { schemaVersion: 1, organizations: [{ schemaVersion: 'dsh-oidc/v1alpha1', id: 'example', provider }] }
    const documented = documentConfiguration(JSON.stringify(explicitConfigurationDefaults(value)))
    assert.deepEqual(JSON.parse(JSON.stringify(parseUserConfig('synthetic.jsonc', documented).organizations[0].provider)), provider)
    assert.ok(documented.includes('organizations[].provider.models[].type'))
  }
})

test('installed defaults become real JSONC values, preserve edits and survive content rollback', async t => {
  const root = await mkdtemp(join(tmpdir(), 'complete-config-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const product = join(root, 'product'), path = join(root, 'eduwork.jsonc'), data = join(root, 'data')
  await mkdir(product)
  await writeFile(join(product, 'assembly.json'), JSON.stringify({ bundles: ['@eduwork/dsh-mail', '@eduwork/dsh-memory'], brand: { product: { name: 'Synthetic' } } }))
  await writeFile(join(product, 'composition.json'), JSON.stringify([{ insert: [{ id: 'eduwork-activity-insights-native', config: { requestTimeoutMs: 45000 } }, { id: 'eduwork-artifact-services', config: { skills: false } }] }]))
  const before = '// keep my choices\n{"schemaVersion":1,"organizations":[],"features":{"maxParallelSubagents":5},"plugins":{"eduwork-activity-insights-native":{"cacheMs":90000}}}'
  await writeFile(path, before)
  const options = await configurationDocumentationOptions(product, { defaults: { updates: { provider: 'github', repository: 'example/product', defaultPolicy: 'development' } } })
  const file = await new ConfigurationFile(path, data, options).open()
  await file.document()
  const documented = await readConfiguration(path), plugin = documented.value.plugins
  assert.equal(plugin['eduwork-activity-insights-native'].cacheMs, 90000)
  assert.equal(plugin['eduwork-activity-insights-native'].requestTimeoutMs, 45000)
  assert.equal(plugin['dsh-mail-assistant'].readEnabled, false)
  assert.equal(plugin['local-memory'].max_records, 400)
  assert.equal(plugin['eduwork-artifact-services'].transcription.local.threads, 4)
  assert.equal(plugin['eduwork-artifact-services'].transcription.local.executablePath, undefined)
  assert.equal(documented.value.features.maxConcurrentRequests, 6)
  assert.equal(documented.value.updates.repository, 'example/product')
  assert.equal(await readFile(file.backup, 'utf8'), before)
  assert.ok(documented.text.includes('// keep my choices'))
  await file.document()
  assert.equal((await readConfiguration(path)).text, documented.text)
  assert.equal(await readFile(file.backup, 'utf8'), before)
  await file.apply({ scope: 'a'.repeat(64), key: '1-' + 'b'.repeat(64), revision: 1, patch: { media: { providers: [] } } })
  await file.rollback()
  assert.equal((await readConfiguration(path)).text, documented.text)
  const selected = explicitConfigurationDefaults({ schemaVersion: 1, updates: { provider: 'static', manifestURL: 'https://example.test/development/latest-windows-amd64.json' } }, options.defaults)
  assert.equal(selected.updates.repository, undefined)
  assert.equal(selected.updates.provider, 'static')
})

test('comments in the editable JSONC cover the public enterprise schema, including optional nested fields', async () => {
  const schema = JSON.parse(await readFile(new URL('../../packages/dsh-oidc/schema/enterprise-profile.v1alpha1.schema.json', import.meta.url)))
  function visit(node, path) {
    if (node?.$ref) return visit(schema.$defs[node.$ref.split('/').at(-1)], path)
    for (const [key, field] of Object.entries(node.properties ?? {})) {
      if (field.deprecated) continue
      const target = path + '.' + key
      assert.ok(configurationFields[target]?.[0], 'Missing config help: ' + target)
      visit(field, target)
    }
    if (node.items) visit(node.items, path + '[]')
  }
  visit(schema, 'organizations[]')
  const text = documentConfiguration('{"schemaVersion":1,"organizations":[]}')
  for (const path of Object.keys(configurationFields)) assert.ok(text.includes('// ' + path + '：'), path)
  assert.deepEqual(parseUserConfig('/synthetic/config.jsonc', text).organizations, [])
})

test('comment refresh is idempotent for compact JSON, CRLF, BOM and user comments', () => {
  for (const text of [
    '{"schemaVersion":1,"organizations":[]}',
    '\uFEFF// My note\r\n{\r\n  "schemaVersion": 1, // inline note\r\n  /* another note */ "organizations": [],\r\n}\r\n',
  ]) {
    const once = documentConfiguration(text)
    assert.equal(documentConfiguration(once), once)
    assert.equal(once.split('// <eduwork-configuration-reference>').length, 2)
    for (const comment of ['// My note', '// inline note', '/* another note */']) if (text.includes(comment)) assert.ok(once.includes(comment))
    assert.equal(once.startsWith('\uFEFF'), text.startsWith('\uFEFF'))
  }
})

test('downloaded config and a later upgrade retain help, local choices and exactly one rollback backup', async t => {
  const root = await mkdtemp(join(tmpdir(), 'documented-eduwork-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'config/eduwork.jsonc'), data = join(root, 'data')
  await mkdir(join(root, 'config'))
  const before = '// My UAT\n{"schemaVersion":1,"organizations":[],"features":{"maxConcurrentRequests":3}}'
  await writeFile(path, before)
  const file = await new ConfigurationFile(path, data).open()
  await file.document()
  assert.equal(await readFile(file.backup, 'utf8'), before)
  const original = await readFile(path, 'utf8')
  await file.document()
  assert.equal(await readFile(path, 'utf8'), original)
  assert.equal(await readFile(file.backup, 'utf8'), before, 'ordinary restart does not rotate the backup')
  const profile = { schemaVersion: 'dsh-oidc/v1alpha1', id: 'example', displayName: 'Example', auth: { discoveryUrl: 'https://example.test/discovery' } }
  await file.apply({ scope: 'a'.repeat(64), key: '1-' + 'b'.repeat(64), revision: 1, patch: { organizations: [profile] } })
  const applied = await readConfiguration(path)
  assert.equal(applied.value.organizations[0].allowInsecureDevelopment, false)
  assert.ok(applied.text.includes('// My UAT'))
  assert.match(applied.text, /false：仅接受 HTTPS/)
  await file.document()
  assert.equal(await readFile(file.backup, 'utf8'), original, 'documentation must not replace the pending content rollback backup')
  await file.rollback()
  assert.equal(await readFile(path, 'utf8'), original)
  assert.deepEqual((await readdir(join(data, 'configuration'))).filter(name => name.endsWith('.jsonc')), ['eduwork.previous.jsonc'])
})

test('explicit HTTP choice survives documentation and additional config fields preserve personal comments', async t => {
  const root = await mkdtemp(join(tmpdir(), 'documented-http-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'eduwork.jsonc')
  await writeFile(path, '{"schemaVersion":1,"organizations":[{/* keep this note */"schemaVersion":"dsh-oidc/v1alpha1","id":"example","allowInsecureDevelopment":true,"insecureDevelopmentOrigin":"http://old.example.test"}]}')
  const file = await new ConfigurationFile(path, join(root, 'data')).open()
  await file.document()
  const local = await readConfiguration(path)
  await file.initialize({ ...local.value, desktop: { closeAction: 'exit' } })
  const after = await readConfiguration(path)
  assert.equal(after.value.organizations[0].allowInsecureDevelopment, true)
  assert.equal(after.value.organizations[0].insecureDevelopmentOrigin, undefined)
  assert.ok(after.text.includes('/* keep this note */'))
})
