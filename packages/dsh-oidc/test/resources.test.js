import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeEnterpriseProfile, enterpriseProviderConfig } from '../src/host/profile.js'
import { normalizeResourceModels } from '../src/host/resources.js'

const profile = provider => normalizeEnterpriseProfile({
  schemaVersion: 'dsh-oidc/v1alpha1', id: 'example', displayName: 'Example',
  auth: { discoveryUrl: 'https://models.example.org/discovery' }, provider,
})
const catalog = { data: ['chat', 'vision-chat', 'embedding', 'rerank', 'image', 'tts'].map(id => ({ id })) }

test('chat selection intersects authorized discovery and preserves reviewed multimodal capabilities', () => {
  const reviewed = profile({ chatModelIds: ['chat', 'vision-chat', 'not-authorized'], models: [
    { id: 'vision-chat', name: 'Vision', input: ['text', 'image'], contextWindow: 12345 },
    { id: 'not-authorized' },
  ] })
  const models = normalizeResourceModels(catalog, reviewed)
  assert.deepEqual(models.map(model => model.id), ['chat', 'vision-chat'])
  assert.deepEqual(models[1].input, ['text', 'image'])
  assert.equal(models[1].contextWindow, 12345)
  assert.equal(models[1].name, 'Vision')
  const registered = enterpriseProviderConfig(new Map([['example', {
    ...reviewed, provider: { ...reviewed.provider, baseURL: 'https://models.example.org/v1', models },
  }]]))
  assert.deepEqual(registered.providers.example.models.map(model => model.id), ['chat', 'vision-chat'])
  assert.equal(catalog.data.length, 6)
})

test('omitted selection preserves generic catalogs; model names are never used to guess endpoint type', () => {
  assert.deepEqual(normalizeResourceModels(catalog, profile({})).map(model => model.id), catalog.data.map(model => model.id))
  const reviewed = profile({ chatModelIds: ['image-understanding-chat'] })
  assert.equal(normalizeResourceModels({ data: [{ id: 'image-understanding-chat' }] }, reviewed).length, 1)
})

test('empty selection, no authorized matches and empty discovery register no chat provider', () => {
  for (const [provider, raw] of [[{ chatModelIds: [] }, catalog], [{ chatModelIds: ['private-chat'] }, catalog], [{ chatModelIds: ['chat'] }, { data: [] }]]) {
    const reviewed = profile(provider)
    const models = normalizeResourceModels(raw, reviewed)
    assert.deepEqual(models, [])
    assert.deepEqual(enterpriseProviderConfig(new Map([['example', { ...reviewed, provider: { ...reviewed.provider, baseURL: 'https://models.example.org/v1', models } }]])).providers, {})
  }
})

test('chat selection is bounded and explicit; malformed discovery is not hidden by filtering', () => {
  for (const value of [null, 'chat', [123], [''], [' chat'], ['chat '], ['chat', 'chat'], ['x'.repeat(257)], Array.from({ length: 129 }, (_, i) => `chat-${i}`)]) {
    assert.throws(() => profile({ chatModelIds: value }), /chatModelIds/)
  }
  for (const raw of [{}, { data: [{}] }, { data: [{ id: 'chat' }, { id: 'chat' }] }]) {
    assert.throws(() => normalizeResourceModels(raw, profile({ chatModelIds: [] })))
  }
  const ids = ['chat'], reviewed = profile({ chatModelIds: ids })
  ids.push('tts')
  assert.deepEqual(reviewed.provider.chatModelIds, ['chat'])
  assert.ok(Object.isFrozen(reviewed.provider.chatModelIds))
})
