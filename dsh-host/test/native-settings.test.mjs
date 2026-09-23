import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, access, symlink, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeNativeProfile, rebaseNativeConfig, legacyPresetPatches, nativeEntryIds } from '../native-profile.mjs'
import { stageLegacySettings, importLegacySettings } from '../settings-migration.mjs'

test('legacy preset identities, ordering and activation survive without rewriting source', async () => {
  const home = await mkdtemp(join(tmpdir(), 'eduwork-legacy-presets-'))
  const directory = join(home, '.agent-presets', 'synthetic')
  await mkdir(directory, { recursive: true })
  const source = '[{"name":"./local.js","config":{"keep":true}},{"group":true,"config":[{"name":"./nested.js","disabled":true}]}]'
  await writeFile(join(directory, 'agent.cordis.yml'), source)
  await writeFile(join(directory, 'preset.yml'), '{"name":"测试模式","order":9}')
  await writeFile(join(home, 'settings.yaml'), '{"chatecnu-brand":{"enabledOptionalPresets":["minimal"]}}')
  const rows = await legacyPresetPatches(home, JSON.parse)
  assert.deepEqual(rows.slice(0, 2), [{ id: 'preset-minimal', disabled: false }, { id: 'preset-cordis', disabled: true }])
  const custom = rows[2].insert[0]
  assert.equal(custom.config.id, 'synthetic'); assert.equal(custom.config.order, 9)
  assert.equal(custom.config.name, '测试模式'); assert.match(custom.config.plugins[0].name, /^file:.*local.js$/)
  assert.match(custom.config.plugins[1].config[0].name, /^file:.*nested.js$/)
  assert.equal(custom.config.plugins[1].config[0].disabled, true)
  assert.equal(await readFile(join(directory, 'agent.cordis.yml'), 'utf8'), source)
  assert.equal((await legacyPresetPatches(home, JSON.parse))[2].insert[0].id, custom.id)
})

test('native product onboarding and optional presets use defaults below user choices', () => {
  const rows = nativeEntryIds([{ insert: [{ id: 'eduwork-brand-settings', config: { manageOptionalPresets: true, upstreamWelcomeNoticeVersion: 'reviewed' } }] }])
  assert.deepEqual(rows.slice(0, 3), [
    { id: 'ui-settings-general', config: { welcomeNoticeVersion: 'reviewed' } },
    { id: 'preset-minimal', disabled: true }, { id: 'preset-cordis', disabled: true },
  ])
})

test('regenerating deployment defaults never replaces saved native preferences', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'eduwork-native-profile-'))
  const options = { profile, bundles: ['@deepseek-ai/dsh-base'], patches: [{ insert: [
    { id: 'eduwork-brand-settings', name: 'synthetic', config: { visualStyle: 'dsh' } },
  ] }] }
  await writeNativeProfile(options)
  const manifestPath = join(profile, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.dependencies = { 'synthetic-addon': '1.2.3' }
  manifest.dsh.profile.bundles.push('synthetic-addon')
  await writeFile(manifestPath, JSON.stringify(manifest))
  const preferences = JSON.stringify([{ id: 'chatecnu-brand', config: { visualStyle: 'ecnu-liwa' } }])
  await writeFile(join(profile, 'cordis.patch.yml'), preferences)
  options.patches[0].insert[0].config.product = { name: 'Updated product name' }
  await writeNativeProfile(options)
  const saved = JSON.parse(await readFile(join(profile, 'cordis.patch.yml'), 'utf8'))
  assert.equal(saved[0].config.visualStyle, 'ecnu-liwa')
  assert.equal(saved[0].config.product.name, 'Updated product name')
  const updatedManifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.deepEqual(updatedManifest.dependencies, manifest.dependencies)
  assert.deepEqual(updatedManifest.dsh.profile.bundles, ['@deepseek-ai/dsh-base', 'synthetic-addon', '@eduwork/generated-profile'])
  const bundle = JSON.parse(await readFile(join(profile, 'node_modules/@eduwork/generated-profile/cordis.patch.yml'), 'utf8'))
  assert.equal(bundle[0].insert[0].id, 'chatecnu-brand')
  assert.equal(bundle[0].insert[0].config.product.name, 'Updated product name')
})

test('copied deployment paths follow a move while personal preferences survive', () => {
  const previous = { path: '/old/skills', policy: { enabled: true, retired: 1 }, limit: 3 }
  const next = { path: '/new/skills', policy: { enabled: false }, limit: 4 }
  const saved = { ...structuredClone(previous), limit: 7, theme: 'red' }
  assert.deepEqual(rebaseNativeConfig(previous, next, saved), { ...next, limit: 7, theme: 'red' })
})

test('interrupted default rebases finish before a second move without losing preferences', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'eduwork-native-interrupted-'))
  const patches = path => [{ insert: [{ id: 'synthetic', name: 'synthetic', config: { path } }] }]
  await writeNativeProfile({ profile, bundles: [], patches: patches('/first') })
  const bundlePath = join(profile, 'node_modules/@eduwork/generated-profile/cordis.patch.yml')
  const saved = path => JSON.stringify([{ id: 'synthetic', config: { path, personal: 7 } }])
  const pending = { schemaVersion: 1, beforeBundle: await readFile(bundlePath, 'utf8'), afterBundle: JSON.stringify(patches('/second')),
    beforePreferences: saved('/first'), afterPreferences: saved('/second') }
  await writeFile(join(profile, 'cordis.patch.yml'), pending.afterPreferences)
  await writeFile(join(profile, '.eduwork-profile-update.json'), JSON.stringify(pending))
  await writeNativeProfile({ profile, bundles: [], patches: patches('/third') })
  assert.deepEqual(JSON.parse(await readFile(join(profile, 'cordis.patch.yml'), 'utf8'))[0].config, { path: '/third', personal: 7 })
  await assert.rejects(access(join(profile, '.eduwork-profile-update.json')))
})

test('a generated bundle cannot escape through an unmanaged module junction', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'eduwork-native-link-'))
  const foreign = await mkdtemp(join(tmpdir(), 'eduwork-native-foreign-'))
  await symlink(foreign, join(profile, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(writeNativeProfile({ profile, bundles: [], patches: [] }), /unmanaged link/)
  await assert.rejects(access(join(foreign, '@eduwork')))
})

test('a damaged migration receipt cannot silently suppress recovery', async () => {
  const home = await mkdtemp(join(tmpdir(), 'eduwork-settings-receipt-'))
  await writeFile(join(home, '.eduwork-settings-migration.json'), '{}')
  await assert.rejects(stageLegacySettings(home), /Invalid settings migration receipt/)
})

test('an interrupted migration retries, preserves newer edits and keeps original settings', async () => {
  const home = await mkdtemp(join(tmpdir(), 'eduwork-settings-recovery-'))
  const original = JSON.stringify({ 'chatecnu-brand': { visualStyle: 'dsh' },
    'eduwork-concurrency': { maxParallelSubagents: 4 }, other: { preserved: true } })
  await writeFile(join(home, 'settings.yaml'), original)
  const migration = await stageLegacySettings(home)
  await assert.rejects(access(join(home, 'settings.yaml')))
  let fail = true
  const state = { 'chatecnu-brand': {}, 'eduwork-concurrency': {} }
  const ctx = { settings: {
    describe: () => Object.entries(state).map(([ns, user]) => ({ ns, user, revision: 0 })),
    update: async (ns, value) => { if (fail && ns === 'eduwork-concurrency') throw new Error('synthetic disk failure'); state[ns] = value },
  } }
  await assert.rejects(importLegacySettings(ctx, migration, JSON.parse), /disk failure/)
  await assert.rejects(access(migration.receipt))
  assert.equal(await readFile(migration.source, 'utf8'), original)
  state['chatecnu-brand'].visualStyle = 'ecnu-liwa'
  fail = false
  assert.deepEqual(await stageLegacySettings(home), migration)
  const result = await importLegacySettings(ctx, migration, JSON.parse)
  assert.equal(state['chatecnu-brand'].visualStyle, 'ecnu-liwa')
  assert.deepEqual(state['eduwork-concurrency'], { maxConcurrentRequests: 5 })
  assert.deepEqual(result.retained, ['other'])
  assert.equal(await stageLegacySettings(home), null)
  assert.equal(await readFile(migration.source, 'utf8'), original)
})

test('a failed product plugin cannot silently consume its legacy settings', async () => {
  const home = await mkdtemp(join(tmpdir(), 'eduwork-settings-unavailable-'))
  await writeFile(join(home, 'settings.yaml'), JSON.stringify({ 'dsh-knowledge-studio': { maxFiles: 200 } }))
  const migration = await stageLegacySettings(home)
  await assert.rejects(importLegacySettings({ settings: { describe: () => [] } }, migration, JSON.parse), /did not activate/)
  await assert.rejects(access(migration.receipt))
  assert.equal(JSON.parse(await readFile(migration.source, 'utf8'))['dsh-knowledge-studio'].maxFiles, 200)
})

test('previous upstream partial imports are recoverable without rewriting the backup', async () => {
  const home = await mkdtemp(join(tmpdir(), 'eduwork-settings-upstream-'))
  const original = '{"chatecnu-skills":{"disabled":["synthetic"]}}'
  await writeFile(join(home, 'settings.yaml.imported'), original)
  const migration = await stageLegacySettings(home)
  let received
  await importLegacySettings({ settings: { describe: () => [{ ns: 'chatecnu-skills', user: {} }], update: async (_ns, value) => { received = value } } }, migration, JSON.parse)
  assert.deepEqual(received, { disabled: ['synthetic'] })
  assert.equal(await readFile(migration.source, 'utf8'), original)
})
