import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { mergeDistributionConfigPatches } from '../distribution-config-patches.mjs'
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
    patches: [{ id: 'enterprise-oidc', config: { backend: 'desktop' }, disabled: true }],
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
})
