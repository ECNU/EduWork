import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { enterpriseProviderConfig, normalizeEnterpriseProfile, publicProfile } from '../src/host/profile.js'

const exampleURL = new URL('../examples/enterprise-profile.example.json', import.meta.url)

test('reference profile is bounded data and projects one callable Provider', async () => {
  const raw = JSON.parse(await readFile(exampleURL, 'utf8'))
  const profile = normalizeEnterpriseProfile(raw)
  assert.deepEqual(enterpriseProviderConfig(new Map([[profile.id, profile]])), { providers: {} })
  const discovered = { ...profile, provider: { ...profile.provider, baseURL: 'https://models.example.org/v1' } }
  const provider = enterpriseProviderConfig(new Map([[profile.id, discovered]])).providers['example-ai']

  assert.equal(profile.keyBinding, undefined)
  assert.equal(profile.oidc, undefined)
  assert.ok(profile.auth.experimentalOidcLlm)
  assert.equal(provider.apiKeyEnv, 'DSH_GATEWAY_EXAMPLE_UNIVERSITY_ACCESS')
  assert.deepEqual(provider.models.map(model => model.id), ['example-max', 'example-plus'])
  assert.deepEqual(provider.models[1].input, ['text', 'image'])
  assert.equal(provider.models[1].compat.supportsReasoningEffort, false)
  assert.equal(provider.models[0].defaultReasoningEffort, 'high')
  assert.equal(provider.retryPolicy.maxRetries, 2)
  assert.equal(provider.allowInsecureDevelopment, false)
  assert.equal(Object.values(provider).includes(undefined), false)
  assert.equal(Object.isFrozen(provider.models[0]), false)
  assert.equal(Object.isFrozen(provider.models[0].reasoningEfforts), false)
  assert.equal(JSON.stringify(publicProfile(profile)).includes(profile.auth.clientId), false)
  assert.equal(JSON.stringify(publicProfile(discovered)).includes(discovered.provider.baseURL), false)
})

test('Enterprise Profiles reject executable, unknown, and unsafe fields', async () => {
  const raw = JSON.parse(await readFile(exampleURL, 'utf8'))
  assert.throws(() => normalizeEnterpriseProfile({ ...raw, script: 'alert(1)' }), /profile\.script is not allowed/)
  assert.throws(() => normalizeEnterpriseProfile({ ...raw, brand: { ...raw.brand, script: 'alert(1)' } }), /brand\.script is not allowed/)
  assert.throws(() => normalizeEnterpriseProfile({ ...raw, provider: { ...raw.provider, adapter: 'remote-module' } }), /unsupported provider adapter/)
  assert.throws(() => normalizeEnterpriseProfile({ ...raw, provider: { ...raw.provider, module: 'https:\/\/evil.example\/plugin.js' } }), /profile\.provider\.module is not allowed/)
  assert.throws(() => normalizeEnterpriseProfile({ ...raw, provider: { ...raw.provider, reasoning: 'turbo' } }), /reasoning is not supported/)
  assert.throws(() => normalizeEnterpriseProfile({ ...raw, provider: { ...raw.provider, models: [{ id: 'bad', reasoningEfforts: { turbo: 'turbo' } }] } }), /reasoningEfforts level turbo is not supported/)
  assert.throws(() => normalizeEnterpriseProfile({ ...raw, provider: { ...raw.provider, models: [{ id: 'bad', reasoningEfforts: { high: null } }] } }), /may be null only for off/)
  assert.throws(() => normalizeEnterpriseProfile({ ...raw, provider: { ...raw.provider, models: [{ id: 'bad', reasoningEfforts: { low: 'low' }, defaultReasoningEffort: 'high' }] } }), /must be one of the model's declared reasoningEfforts/)
  assert.throws(() => normalizeEnterpriseProfile({ ...raw, provider: { ...raw.provider, compat: { maxTokensField: 'whatever' } } }), /maxTokensField is not supported/)
  assert.throws(() => normalizeEnterpriseProfile({ ...raw, provider: { ...raw.provider, compat: { thinkingFormat: 'whatever' } } }), /thinkingFormat is not supported/)
  assert.throws(() => normalizeEnterpriseProfile({ ...raw, brand: { ...raw.brand, logoURL: 'data:image\/svg+xml;base64,PHN2Zz4=' } }), /base64 PNG\/WebP/)
  assert.throws(() => normalizeEnterpriseProfile({ ...raw, provider: { ...raw.provider, retryPolicy: { mode: 'normal', unexpected: true } } }), /retryPolicy\.unexpected is not allowed/)
})

test('model profiles reject legacy key binding and require explicit trusted token discovery', async () => {
  const raw = JSON.parse(await readFile(exampleURL, 'utf8'))
  assert.throws(() => normalizeEnterpriseProfile({ ...raw, keyBinding: { baseURL: 'https://old.example/management' } }), /keyBinding is not allowed/)
  assert.throws(() => normalizeEnterpriseProfile({ ...raw, provider: { ...raw.provider, baseURL: 'https://old.example/v1' } }), /derives provider.baseURL/)
  const { auth, provider, ...base } = raw
  const identity = { ...base, oidc: { issuer: 'https://id.example.edu', clientId: 'public-client', scopes: ['openid', 'profile'] } }
  assert.equal(normalizeEnterpriseProfile(identity).provider, undefined)
  assert.throws(() => normalizeEnterpriseProfile({ ...identity, provider }), /Identity|identity/)
  const discovery = 'http://192.0.2.10/.well-known/openid-configuration'
  const local = { ...raw, allowInsecureDevelopment: true, insecureDevelopmentOrigin: 'http://192.0.2.10',
    auth: { ...auth, discoveryUrl: discovery, expectedIssuer: 'http://192.0.2.10' } }
  assert.equal(normalizeEnterpriseProfile(local).auth.discoveryUrl, discovery)
  assert.throws(() => normalizeEnterpriseProfile({ ...local, auth: { ...local.auth, discoveryUrl: 'http://192.0.2.11/discovery' } }), /HTTPS issuer URL/)
  assert.throws(() => normalizeEnterpriseProfile({ ...local, allowInsecureDevelopment: false }), /requires allowInsecureDevelopment=true/)
})

test('profiles reject duplicate provider routes', async () => {
  const raw = JSON.parse(await readFile(exampleURL, 'utf8'))
  const { loadEnterpriseProfiles } = await import('../src/host/profile.js')
  assert.throws(() => loadEnterpriseProfiles({ profiles: [raw, { ...raw, id: 'second' }] }), /repeats provider route/)
})

test('profilePathEnv loads only the standard Enterprise Profile document', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-oidc-profile-'))
  t.after(async () => { await rm(root, { recursive: true, force: true }) })
  const path = join(root, 'enterprise-profile.json')
  const raw = JSON.parse(await readFile(exampleURL, 'utf8'))
  await writeFile(path, JSON.stringify({ profiles: [raw] }))
  const { loadEnterpriseProfiles } = await import('../src/host/profile.js')
  const profiles = loadEnterpriseProfiles({ profilePathEnv: 'ENTERPRISE_PROFILE' }, { ENTERPRISE_PROFILE: path })
  assert.equal(profiles.size, 1)
  assert.equal(profiles.get(raw.id).provider.id, 'example-ai')
})
