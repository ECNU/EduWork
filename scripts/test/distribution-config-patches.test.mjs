import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { loadDistributionBundleLayers, mergeDistributionConfigPatches } from '../distribution-config-patches.mjs'
import { prepareProductProfile } from '../../dsh-host/product-profile.mjs'

const runtime = process.env.EDUWORK_TEST_RUNTIME
const composeEntries = runtime && (await import(pathToFileURL(createRequire(join(runtime, 'package.json')).resolve('@deepseek-ai/dsh-app-boot')).href)).composeEntries
const initial = () => [{ insert: [{ id: 'account', name: 'synthetic-account', config: {
  backend: 'desktop', allowEmptyProfiles: true, profilePathEnv: 'SYNTHETIC_PROFILE',
  profiles: [{ id: 'example' }], nested: { retained: true, changed: false },
} }] }]
const compose = (composition, patches, warnings = []) => composeEntries([
  mergeDistributionConfigPatches(composition, patches, composeEntries),
], message => warnings.push(message))

test('edition config updates retain other product fields and preserve disabled', { skip: !runtime }, () => {
  const composition = initial(), patches = [{ id: 'account', config: { backend: 'web' }, disabled: true }]
  const before = structuredClone({ composition, patches })
  const [entry] = compose(composition, patches)
  assert.deepEqual(entry, { ...before.composition[0].insert[0], disabled: true, config: {
    ...before.composition[0].insert[0].config, backend: 'web',
  } })
  assert.deepEqual({ composition, patches }, before, 'assembly inputs are not mutated')
})

test('patches target entries in groups and entries inserted by earlier patches', { skip: !runtime }, () => {
  const composition = [{ insert: [{ id: 'group', name: 'group', group: true, config: initial()[0].insert }] }]
  const entries = compose(composition, [
    { id: 'account', config: { backend: 'web' } },
    { id: 'group', insert: [{ id: 'extra', name: 'synthetic-extra', config: { keep: true, limit: 1 } }] },
    { id: 'extra', config: { limit: 2 }, disabled: true },
    { id: 'account', config: { profiles: [] } },
  ])
  assert.equal(entries[0].config[0].config.allowEmptyProfiles, true)
  assert.equal(entries[0].config[0].config.backend, 'web')
  assert.deepEqual(entries[0].config[0].config.profiles, [])
  assert.deepEqual(entries[0].config[1], { id: 'extra', name: 'synthetic-extra', config: { keep: true, limit: 2 }, disabled: true })
})

test('name guards and unmatched patches retain official Runtime behavior', { skip: !runtime }, () => {
  const warnings = []
  const [entry] = compose(initial(), [
    { id: 'account', name: 'wrong-package', config: { backend: 'wrong' }, disabled: true },
    { id: 'missing', config: { keep: true } },
    { id: 'account', name: 'synthetic-account', config: { backend: 'web' }, inject: ['synthetic-service'] },
  ], warnings)
  assert.equal(entry.config.backend, 'web')
  assert.equal(entry.config.allowEmptyProfiles, true)
  assert.equal(entry.disabled, undefined)
  assert.deepEqual(entry.inject, ['synthetic-service'])
  assert.equal(warnings.length, 2)
  assert.match(warnings[0], /name mismatch/)
  assert.match(warnings[1], /not found/)
})

test('array, null and nested field values keep replacement semantics', { skip: !runtime }, () => {
  const [entry] = compose(initial(), [{ id: 'account', config: { profiles: [], nested: { changed: true }, profilePathEnv: null } }])
  assert.deepEqual(entry.config.profiles, [])
  assert.deepEqual(entry.config.nested, { changed: true })
  assert.equal(entry.config.profilePathEnv, null)
  assert.equal(entry.config.allowEmptyProfiles, true)
  for (const config of [null, ['replacement'], false]) {
    assert.deepEqual(compose(initial(), [{ id: 'account', config, disabled: true }])[0].config, config)
  }
})

test('group config replacement and late entry replacement are not intercepted', { skip: !runtime }, () => {
  const composition = [{ insert: [{ id: 'group', group: true, config: initial()[0].insert }] }]
  const replacement = [{ id: 'replacement', name: 'synthetic-replacement', config: {} }]
  assert.deepEqual(compose(composition, [{ id: 'group', config: replacement, disabled: true }])[0], {
    id: 'group', group: true, config: replacement, disabled: true,
  })
  const [old, current] = compose(initial(), [
    { insert: [{ id: 'account', name: 'new-account', config: { only: 'new' } }] },
    { id: 'account', name: 'new-account', config: { changed: true }, disabled: true },
  ])
  assert.equal(old.config.backend, 'desktop')
  assert.deepEqual(current.config, { only: 'new', changed: true })
  assert.equal(current.disabled, true)
})

test('runtime user configuration survives edition defaults and nonconfig options', { skip: !runtime }, () => {
  const composition = mergeDistributionConfigPatches(initial(), [{ id: 'account', config: { backend: 'web' }, disabled: true }], composeEntries)
  // prepareProductProfile applies user configuration to the inserted entry
  // before the Runtime mounts this composition.
  const entry = composition.find(row => row.insert)?.insert[0]
  entry.config = { ...entry.config, profiles: [{ id: 'user-organization' }], userPreference: 'saved' }
  const [effective] = composeEntries([composition])
  assert.deepEqual(effective.config.profiles, [{ id: 'user-organization' }])
  assert.equal(effective.config.userPreference, 'saved')
  assert.equal(effective.config.backend, 'web')
  assert.equal(effective.disabled, true)
  assert.equal(JSON.stringify(composition).includes('__eduworkAssemblyOrigin_'), false)
})

test('whole-config replacement keeps precedence after subsequent object patches', { skip: !runtime }, () => {
  const composition = mergeDistributionConfigPatches(initial(), [
    { id: 'account', config: null },
    { id: 'account', config: { first: true } },
    { id: 'account', config: { second: true } },
  ], composeEntries)
  composition[0].insert[0].config.userPreference = 'saved'
  assert.deepEqual(composeEntries([composition])[0].config, { first: true, second: true })
})

test('group replacement retains the official stale-target skip behavior', { skip: !runtime }, () => {
  const composition = [{ insert: [{ id: 'group', group: true, config: initial()[0].insert }] }]
  const patches = [
    { id: 'group', config: [{ id: 'new-child', name: 'synthetic-new', config: { keep: true } }] },
    { id: 'new-child', config: { changed: true }, disabled: true },
    { id: 'account', config: { backend: 'web' } },
  ]
  const expectedWarnings = [], actualWarnings = []
  const expected = composeEntries([composition, patches], message => expectedWarnings.push(message))
  assert.deepEqual(compose(composition, patches, actualWarnings), expected)
  assert.deepEqual(actualWarnings, expectedWarnings)
  const lowerWarnings = []
  const output = mergeDistributionConfigPatches([], patches, composeEntries, [composition])
  assert.deepEqual(composeEntries([composition, output], message => lowerWarnings.push(message)), expected)
  assert.deepEqual(lowerWarnings, expectedWarnings, 'bundle-layer targets retain the same stale-index behavior')
  assert.equal(expected[0].config[0].disabled, undefined)
})

test('installed bundle defaults are retained without copying or mutating bundle entries', { skip: !runtime }, async () => {
  const boot = await import(pathToFileURL(createRequire(join(runtime, 'package.json')).resolve('@deepseek-ai/dsh-app-boot')).href)
  const layers = await loadDistributionBundleLayers(runtime, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'], boot)
  const before = structuredClone(layers)
  const defaults = composeEntries(layers), warnings = []
  const patches = mergeDistributionConfigPatches([], [
    { id: 'agent-default-model', config: { provider: 'synthetic-provider' }, disabled: true },
    { id: 'agent-default-model', name: 'wrong-package', config: { model: 'wrong-model' }, disabled: false },
    { id: 'agent-default-model', config: { model: 'synthetic-model' } },
    { id: 'session-title-llm', config: { maxOutputTokens: 2048 } },
    { id: 'session-title-llm', config: { timeoutMs: 1000 } },
  ], composeEntries, layers)
  const entries = composeEntries([...layers, patches], message => warnings.push(message))
  assert.deepEqual(entries.find(row => row.id === 'agent-default-model').config,
    { ...defaults.find(row => row.id === 'agent-default-model').config, provider: 'synthetic-provider', model: 'synthetic-model' })
  assert.equal(entries.find(row => row.id === 'agent-default-model').disabled, true)
  assert.deepEqual(entries.find(row => row.id === 'session-title-llm').config,
    { ...defaults.find(row => row.id === 'session-title-llm').config, maxOutputTokens: 2048, timeoutMs: 1000 })
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /name mismatch/)
  assert.equal(patches.some(row => row.insert), false, 'bundle entries are not copied into the product composition')
  assert.deepEqual(layers, before, 'lower bundle layers remain read-only')
})

test('real edition preparation preserves user organizations through product profile generation', { skip: !process.env.EDUWORK_TEST_PRODUCT }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-edition-config-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const product = join(root, 'product'), edition = join(root, 'edition'), config = join(root, 'eduwork.jsonc')
  await cp(process.env.EDUWORK_TEST_PRODUCT, product, { recursive: true })
  const identity = JSON.parse(await readFile(join(product, 'assembly.json'), 'utf8'))
  await mkdir(join(edition, 'edition'), { recursive: true })
  await writeFile(join(edition, 'edition/distribution.json'), JSON.stringify({
    id: identity.distribution, brand: identity.brand, capabilities: identity.capabilities,
    plugins: [], skills: [], resources: [],
    patches: [
      { id: 'enterprise-oidc', config: { backend: 'desktop' }, disabled: true },
      { id: 'agent-default-model', config: { provider: 'synthetic-provider' } },
      { id: 'session-title-llm', config: { maxOutputTokens: 2048 }, disabled: true },
    ],
  }))
  const git = args => execFileSync('git', ['-C', edition, ...args], { stdio: 'pipe', windowsHide: true })
  git(['init'])
  git(['add', 'edition/distribution.json'])
  git(['-c', 'user.name=Synthetic Fixture', '-c', 'user.email=synthetic@example.invalid', 'commit', '-m', 'Synthetic edition configuration'])
  execFileSync(process.execPath, [fileURLToPath(new URL('../prepare-017-alpha-product.mjs', import.meta.url)),
    '--product', product, '--edition', edition, '--version', '0.0.0-alpha.1'], { stdio: 'pipe', windowsHide: true })
  await writeFile(config, JSON.stringify({ schemaVersion: 1, product: { name: 'Synthetic user product' },
    organizations: [{ schemaVersion: 'dsh-oidc/v1alpha1', id: 'synthetic-org', displayName: 'Synthetic organization',
      oidc: { issuer: 'https://identity.example.invalid', clientId: 'synthetic-test-client', scopes: ['openid', 'profile'] } }],
    plugins: { 'enterprise-oidc': { uiMode: 'external' } },
  }))
  const prepared = await prepareProductProfile({ product, home: join(root, 'home'), shell: 'electron', userConfig: config })
  const boot = await import(pathToFileURL(createRequire(join(product, 'd/package.json')).resolve('@deepseek-ai/dsh-app-boot')).href)
  const profile = boot.loadProfileDirectory('dsh', prepared.profile, join(product, 'd/package.json'))
  assert.deepEqual(profile.skippedBundles, [])
  const entries = boot.composeEntries([...profile.layers.map(layer => layer.patches), profile.patches])
  const account = entries.find(entry => entry.id === 'enterprise-oidc')
  assert.equal(account.config.profiles[0].id, 'synthetic-org')
  assert.equal(account.config.allowEmptyProfiles, true)
  assert.equal(account.config.profilePathEnv, 'EDUWORK_NO_IMPLICIT_ENTERPRISE_PROFILE')
  assert.equal(account.config.configFile.path, config)
  assert.equal(account.config.manageProductBrand, false)
  assert.equal(account.config.uiMode, 'external')
  assert.equal(account.disabled, true)
  assert.equal(entries.find(entry => entry.id === 'chatecnu-brand').config.product.name, 'Synthetic user product')
  const defaults = boot.composeEntries(profile.layers.map(layer => layer.patches))
  assert.deepEqual(entries.find(entry => entry.id === 'agent-default-model').config,
    { ...defaults.find(entry => entry.id === 'agent-default-model').config, provider: 'synthetic-provider' })
  assert.deepEqual(entries.find(entry => entry.id === 'session-title-llm').config,
    { ...defaults.find(entry => entry.id === 'session-title-llm').config, maxOutputTokens: 2048 })
  assert.equal(entries.find(entry => entry.id === 'session-title-llm').disabled, true)
})

test('real source assembly retains installed bundle defaults and disabled instructions', {
  skip: !runtime || !process.env.EDUWORK_TEST_SOURCE || !process.env.EDUWORK_TEST_DEPENDENCIES || !process.env.EDUWORK_TEST_HOST,
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-assembly-config-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'), product = join(root, 'product')
  await cp(process.env.EDUWORK_TEST_SOURCE, source, { recursive: true })
  const distributionPath = join(source, 'config/distributions/generic.json')
  const distribution = JSON.parse(await readFile(distributionPath, 'utf8'))
  distribution.patches.push(
    { id: 'agent-default-model', config: { provider: 'synthetic-provider' } },
    { id: 'session-title-llm', config: { maxOutputTokens: 2048 }, disabled: true },
  )
  await writeFile(distributionPath, JSON.stringify(distribution))
  execFileSync(process.execPath, [fileURLToPath(new URL('../assemble-017-source-product.mjs', import.meta.url)),
    '--runtime', runtime, '--source', source, '--dependencies', process.env.EDUWORK_TEST_DEPENDENCIES,
    '--host', process.env.EDUWORK_TEST_HOST, '--output', product], { stdio: 'pipe', windowsHide: true })
  const boot = await import(pathToFileURL(createRequire(join(product, 'd/package.json')).resolve('@deepseek-ai/dsh-app-boot')).href)
  const identity = JSON.parse(await readFile(join(product, 'assembly.json'), 'utf8'))
  const layers = await loadDistributionBundleLayers(join(product, 'd'), identity.bundles, boot)
  const defaults = boot.composeEntries(layers)
  const composition = JSON.parse(await readFile(join(product, 'composition.json'), 'utf8'))
  const entries = boot.composeEntries([...layers, composition])
  assert.deepEqual(entries.find(entry => entry.id === 'agent-default-model').config,
    { ...defaults.find(entry => entry.id === 'agent-default-model').config, provider: 'synthetic-provider' })
  assert.deepEqual(entries.find(entry => entry.id === 'session-title-llm').config,
    { ...defaults.find(entry => entry.id === 'session-title-llm').config, maxOutputTokens: 2048 })
  assert.equal(entries.find(entry => entry.id === 'session-title-llm').disabled, true)
  assert.equal(entries.find(entry => entry.id === 'deepseek-account').disabled, true)
  assert.equal(composition.some(row => row.insert?.some(entry => entry.id === 'agent-default-model')), false)
})
