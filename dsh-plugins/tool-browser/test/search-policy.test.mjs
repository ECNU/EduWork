import assert from 'node:assert/strict'
import test from 'node:test'
import { searchWithAvailableProvider } from '../lib/search-policy.js'

function fixture(config = {}, credential) {
  const calls = []
  return { calls, options: { request: { query: 'test' }, settings: () => config,
    resolveCredential: async ref => { calls.push(['credential', ref]); return credential },
    browser: { search: async request => { calls.push(['browser', request.query]); return 'browser results' } },
    deepseek: config => ({ search: async request => { calls.push(['official', config.apiKey, request.query]); return 'official results' } }),
  } }
}

test('no DeepSeek key selects browser directly, never tries an institution key implicitly', async () => {
  const {calls, options} = fixture()
  assert.equal(await searchWithAvailableProvider(options), 'browser results')
  assert.deepEqual(calls, [['credential', 'DEEPSEEK_API_KEY'], ['browser', 'test']])
})
test('literal keys and explicit credential references select the official provider', async () => {
  for (const [config, key] of [[{apiKey:'test-only'}, undefined], [{apiKeyEnv:'SEARCH_KEY'}, 'test-only']]) {
    const {calls, options} = fixture(config, key)
    assert.equal(await searchWithAvailableProvider(options), 'official results')
    assert.deepEqual(calls.at(-1), ['official', 'test-only', 'test'])
    assert.ok(!calls.some(row => row[0] === 'browser'))
  }
})
test('settings changes take effect on the next request; configured service errors are preserved', async () => {
  let config = {}
  const {options} = fixture()
  options.settings = () => config
  assert.equal(await searchWithAvailableProvider(options), 'browser results')
  config = {apiKey:'test-only'}
  assert.equal(await searchWithAvailableProvider(options), 'official results')
  options.deepseek = () => ({search: async () => { throw Error('service unavailable') }})
  await assert.rejects(searchWithAvailableProvider(options), /service unavailable/)
  config = {}
  assert.equal(await searchWithAvailableProvider(options), 'browser results')
})
test('a request uses one settings snapshot and respects cancellation before dispatch', async () => {
  const config = {apiKeyEnv:'SEARCH_KEY',baseURL:'https://old.example'}
  const {options} = fixture(config)
  options.resolveCredential = async () => { config.baseURL = 'https://new.example'; return 'test-only' }
  options.deepseek = snapshot => ({search: async () => snapshot.baseURL})
  assert.equal(await searchWithAvailableProvider(options), 'https://old.example')
  options.signal = AbortSignal.abort()
  await assert.rejects(searchWithAvailableProvider(options), {name:'AbortError'})
})
