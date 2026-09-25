import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeEnterpriseProfile, enterpriseProviderConfig, publicProfile } from '../src/host/profile.js'
import { normalizeResourceModels } from '../src/host/resources.js'
import { resourcesResult, runtimeModelsSchema } from '../src/host/typert-schemas.js'

const profile = provider => normalizeEnterpriseProfile({
  schemaVersion: 'dsh-oidc/v1alpha1', id: 'example', displayName: 'Example',
  auth: { discoveryUrl: 'https://models.example.org/discovery' }, provider,
})
const types = ['llm', 'llm', 'embedding', 'rerank', 'image', 'tts']
const ids = ['chat', 'vision-chat', 'embedding', 'rerank', 'image', 'tts']
const catalog = { data: ids.map((id, i) => ({ id, object: 'model', type: types[i] })) }
const discovered = (reviewed, raw) => ({
  ...reviewed, provider: { ...reviewed.provider, baseURL: 'https://models.example.org/v1', models: normalizeResourceModels(raw, reviewed) },
})
const registered = value => enterpriseProviderConfig(new Map([[value.id, value]])).providers

test('typed catalog preserves all authorized purposes while only LLMs register with DSH and the chat UI', () => {
  const reviewed = profile({ models: [
    { id: 'vision-chat', type: 'llm', name: 'Vision', input: ['text', 'image'], contextWindow: 12345 },
    { id: 'not-authorized', type: 'llm' },
  ] })
  const value = discovered(reviewed, catalog), models = value.provider.models
  assert.deepEqual(models.map(model => model.type), types)
  assert.deepEqual(models.map(model => model.id), ids)
  assert.deepEqual(models[1].input, ['text', 'image'])
  assert.equal(models[1].contextWindow, 12345)
  assert.equal(models[1].name, 'Vision')
  const provider = registered(value).example
  assert.deepEqual(provider.models.map(model => model.id), ['chat', 'vision-chat'])
  assert.deepEqual(publicProfile(value).provider.models.map(model => model.id), ['chat', 'vision-chat'])
  assert.ok(provider.models.every(model => !('type' in model)), 'DSH only receives its supported model fields')
  runtimeModelsSchema.parse(provider.models)
  resourcesResult.schema.parse({ profileID: 'example', modelSource: 'discovery', models, issues: [] })
  assert.ok(Object.isFrozen(models) && models.every(Object.isFrozen))
})

test('local purpose metadata supports ID-only gateways without granting undiscovered models', () => {
  const reviewed = profile({ models: [...catalog.data.map(({ id, type }) => ({ id, type })), { id: 'not-authorized', type: 'llm' }] })
  const value = discovered(reviewed, { data: ids.map(id => ({ id, object: 'model' })) })
  assert.deepEqual(value.provider.models.map(model => model.type), types)
  assert.deepEqual(registered(value).example.models.map(model => model.id), ['chat', 'vision-chat'])
})

test('server purposes supersede local metadata; invalid or future types cannot fall back to local LLM', () => {
  for (const serverType of ['tts', 'unknown', 'video', null, false, {}, ['llm'], 'LLM']) {
    const value = discovered(profile({ models: [{ id: 'chat', type: 'llm' }] }), { data: [{ id: 'chat', type: serverType }] })
    assert.equal(value.provider.models[0].type, serverType === 'tts' ? 'tts' : 'unknown')
    assert.deepEqual(registered(value), {})
  }
  const value = discovered(profile({ models: [{ id: 'chat', type: 'tts' }] }), { data: [{ id: 'chat', type: 'llm' }] })
  assert.equal(registered(value).example.models[0].id, 'chat')
})

test('untyped names and input modalities never imply LLM purpose', () => {
  const value = discovered(profile({ models: [{ id: 'image-chat', input: ['text', 'image'] }] }), {
    data: [{ id: 'text-chat' }, { id: 'image-chat' }, { id: 'llm', object: 'model' }],
  })
  assert.deepEqual(value.provider.models.map(model => model.type), ['unknown', 'unknown', 'unknown'])
  assert.deepEqual(registered(value), {})
  assert.deepEqual(publicProfile(value).provider.models, [])
})

test('specialist-only and empty catalogs have no chat provider', () => {
  for (const data of [catalog.data.slice(2), []]) {
    const value = discovered(profile({}), { data })
    assert.equal(value.provider.models.length, data.length)
    assert.deepEqual(registered(value), {})
  }
})

test('invalid local types and malformed authorized rows are rejected before registration', () => {
  for (const type of [null, '', 'chat', ' LLM ', 123, {}, ['llm']]) {
    assert.throws(() => profile({ models: [{ id: 'chat', type }] }), /\.type/)
  }
  for (const raw of [{}, { data: [{}] }, { data: [null] }, { data: [{ id: 'tts', type: 'tts' }, { id: 'tts', type: 'tts' }] }]) {
    assert.throws(() => normalizeResourceModels(raw, profile({})))
  }
})
