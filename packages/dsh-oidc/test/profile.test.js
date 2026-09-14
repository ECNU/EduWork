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
  const provider = enterpriseProviderConfig(new Map([[profile.id, profile]])).providers['example-ai']

  assert.equal(profile.oidc.issuer, 'https://id.example.edu/oidc')
  assert.deepEqual(Object.keys(raw.keyBinding), ['baseURL', 'credentialRef'])
  assert.equal(profile.keyBinding.type, 'worker-user-center-v1')
  assert.equal(profile.keyBinding.providerId, 'example-ai')
  assert.equal(profile.keyBinding.credentialRef, 'EDUWORK_API_KEY')
  assert.deepEqual(provider.models.map(model => model.id), ['example-max', 'example-plus'])
  assert.deepEqual(provider.models[1].input, ['text', 'image'])
  assert.equal(provider.models[1].compat.supportsReasoningEffort, false)
  assert.equal(provider.models[0].defaultReasoningEffort, 'high')
  assert.equal(provider.retryPolicy.maxRetries, 2)
  assert.equal(provider.allowInsecureDevelopment, false)
  assert.equal(Object.values(provider).includes(undefined), false)
  assert.equal(Object.isFrozen(provider.models[0]), false)
  assert.equal(Object.isFrozen(provider.models[0].reasoningEfforts), false)
  assert.equal(JSON.stringify(publicProfile(profile)).includes(profile.oidc.clientId), false)
  assert.equal(JSON.stringify(publicProfile(profile)).includes(profile.provider.baseURL), false)
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
  assert.throws(() => normalizeEnterpriseProfile({ ...raw, keyBinding: { ...raw.keyBinding, resolvePath: '/secret' } }), /profile\.keyBinding\.resolvePath is not allowed/)
  assert.throws(() => normalizeEnterpriseProfile({ ...raw, keyBinding: { ...raw.keyBinding, credentialRef: 'invalid-ref' } }), /valid DSH credential reference/)
  assert.throws(() => normalizeEnterpriseProfile({ ...raw, brand: { ...raw.brand, logoURL: 'data:image\/svg+xml;base64,PHN2Zz4=' } }), /base64 PNG\/WebP/)
  assert.throws(() => normalizeEnterpriseProfile({ ...raw, provider: { ...raw.provider, retryPolicy: { mode: 'normal', unexpected: true } } }), /retryPolicy\.unexpected is not allowed/)
})

test('credential references use the common default while preserving custom overrides', async () => {
  const raw = JSON.parse(await readFile(exampleURL, 'utf8'))
  assert.equal(normalizeEnterpriseProfile(raw).keyBinding.credentialRef, 'EDUWORK_API_KEY')
  const testProfile = normalizeEnterpriseProfile({
    ...raw,
    id: 'example-university-test',
    keyBinding: { ...raw.keyBinding, credentialRef: 'EXAMPLE_AI_TEST_API_KEY' },
  })
  assert.equal(testProfile.provider.id, 'example-ai')
  assert.equal(testProfile.keyBinding.credentialRef, 'EXAMPLE_AI_TEST_API_KEY')
  assert.equal(
    enterpriseProviderConfig(new Map([[testProfile.id, testProfile]])).providers['example-ai'].apiKeyEnv,
    'EXAMPLE_AI_TEST_API_KEY',
  )
})

test('insecure development endpoints require loopback or an exact explicit origin', async () => {
  const raw = JSON.parse(await readFile(exampleURL, 'utf8'))
  const unsafe = {
    ...raw,
    allowInsecureDevelopment: true,
    oidc: { ...raw.oidc, issuer: 'http://dev.example.edu/oidc' },
  }
  assert.throws(() => normalizeEnterpriseProfile(unsafe), /HTTPS issuer URL/)
  const local = normalizeEnterpriseProfile({
    ...raw,
    allowInsecureDevelopment: true,
    oidc: { ...raw.oidc, issuer: 'http://127.0.0.1:9000/oidc' },
    keyBinding: { baseURL: 'http://127.0.0.1:9001/api/worker/v1' },
    provider: { ...raw.provider, baseURL: 'http://localhost:9002/v1' },
  })
  assert.equal(local.oidc.issuer, 'http://127.0.0.1:9000/oidc')

  const network = normalizeEnterpriseProfile({
    ...raw,
    allowInsecureDevelopment: true,
    insecureDevelopmentOrigin: 'http://192.0.2.10',
    oidc: { ...raw.oidc, issuer: 'http://192.0.2.10' },
    keyBinding: { baseURL: 'http://192.0.2.10/api/worker/v1' },
    provider: { ...raw.provider, baseURL: 'http://192.0.2.10/open/api/v1' },
  })
  assert.equal(network.oidc.issuer, 'http://192.0.2.10')
  assert.throws(() => normalizeEnterpriseProfile({
    ...raw,
    allowInsecureDevelopment: true,
    insecureDevelopmentOrigin: 'http://192.0.2.10',
    oidc: { ...raw.oidc, issuer: 'http://192.0.2.10' },
    keyBinding: { baseURL: 'http://192.0.2.10/api/worker/v1' },
    provider: { ...raw.provider, baseURL: 'http://192.0.2.11/open/api/v1' },
  }), /exact allowlisted HTTP origin/)
  assert.throws(() => normalizeEnterpriseProfile({
    ...raw,
    insecureDevelopmentOrigin: 'http://192.0.2.10',
  }), /requires allowInsecureDevelopment=true/)
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
