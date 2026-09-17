import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { normalizeMediaConfig, loadMediaProviders } from '../lib/config.js'
import { apply } from '../lib/index.js'
import { generateImage, selectImageGenerationSize, prepareManagedOutput } from '../lib/core.js'
import { resolveMediaCredential, mediaAuthorization } from '../lib/actions.js'

const tinyPNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64')
const config = () => ({ providers: [{ id: 'example', title: '示例媒体', protocol: 'openai-compatible',
  baseURL: 'https://media.example.test/v1', credentialRef: 'EDUWORK_API_KEY',
  images: { enabled: true, model: 'sample-image', nativeSizes: ['512x512', '768x768', '720x1280', '1280x720', '1024x1024'], responseFormat: 'b64_json' },
  speech: { enabled: true, model: 'sample-tts', voices: [{ id: 'Voice_A', title: '中文', language: 'zh-CN' }], defaultVoice: 'Voice_A' },
}] })
async function temporary(t) { const root = await mkdtemp(join(tmpdir(), 'eduwork-media-')); t.after(() => rm(root, { recursive: true, force: true })); return root }

test('configuration keeps services optional and requires explicit models, capabilities and safe URLs', () => {
  assert.deepEqual(normalizeMediaConfig(), { providers: [] })
  const data = config(), provider = normalizeMediaConfig(data).providers[0]
  assert.equal(provider.images.defaultSize, '512x512')
  assert.equal(provider.speech.defaultVoice, 'Voice_A')
  assert.equal(provider.speech.voices[0].id, 'Voice_A')
  for (const mutate of [
    p => { p.apiKey = 'do-not-store-keys' }, p => { p.images.model = '' },
    p => { p.images.nativeSizes = [] }, p => { p.images.defaultSize = '900x800' },
    p => { p.speech.defaultVoice = 'missing' }, p => { p.baseURL = 'https://user:password@example.test' },
    p => { p.baseURL = 'http://remote.example.test' }, p => { p.protocol = 'guess' },
  ]) { const changed = config(); mutate(changed.providers[0]); assert.throws(() => normalizeMediaConfig(changed)) }
  assert.throws(() => normalizeMediaConfig({ providers: [data.providers[0], data.providers[0]] }), /唯一/)
  data.providers[0].images = { enabled: false }
  data.providers[0].speech = { enabled: false }
  assert.equal(normalizeMediaConfig(data).providers[0].images, undefined)
})

test('edition defaults preserve old configuration while explicit user settings override and can disable', async t => {
  const root = await temporary(t)
  assert.deepEqual(await loadMediaProviders(root), { providers: [] })
  await mkdir(join(root, 'resources/desktop'), { recursive: true })
  const media = config(); media.providers[0].oidcProfileId = 'school'
  await writeFile(join(root, 'resources/desktop/media-defaults.json'), JSON.stringify(media))
  const user = { organizations: [{ id: 'school' }] }
  assert.equal((await loadMediaProviders(root, user)).providers[0].id, 'example')
  assert.deepEqual(await loadMediaProviders(root, { organizations: [] }), { providers: [] })
  assert.deepEqual(await loadMediaProviders(root, { ...user, media: { providers: [] } }), { providers: [] })
  await assert.rejects(loadMediaProviders(root, { organizations: [], media }), /oidcProfileId/)
  const before = JSON.stringify(media)
  await loadMediaProviders(root, user)
  assert.equal(await readFile(join(root, 'resources/desktop/media-defaults.json'), 'utf8'), before)
})

test('account-bound media never falls back to an unrelated shared key', async () => {
  let fallback = 0, expected
  const ctx = { credentials: { resolve: () => { fallback++; return { value: 'unrelated' } } },
    get: () => ({ modelAuthorization: async (id, baseURL) => { expected = { id, baseURL }; return false } }) }
  const provider = { ...config().providers[0], oidcProfileId: 'school' }
  assert.equal(await resolveMediaCredential(ctx, provider), undefined)
  await assert.rejects(mediaAuthorization(ctx, provider), /Sign in/)
  assert.equal(fallback, 0)
  assert.deepEqual(expected, { id: 'school', baseURL: provider.baseURL })
})

test('account media uses shared authorization only for generation, never signed image downloads', async () => {
  const calls = []
  const provider = { ...config().providers[0], oidcProfileId: 'school' }
  const ctx = { credentials: { resolve() { throw new Error('must not read a model key') } }, get: () => ({
    modelAuthorization: async (id, baseURL) => id === 'school' && baseURL === provider.baseURL,
    authorizedFetch: async (id, url, init) => {
      calls.push(url)
      assert.equal(id, 'school')
      assert.equal(url, provider.baseURL + '/images/generations')
      assert.equal(init.headers.Authorization, undefined)
      return Response.json({ data: [{ url: 'https://cdn.example.test/image.png' }] })
    },
  }) }
  const result = await generateImage({ baseURL: provider.baseURL, ...await mediaAuthorization(ctx, provider),
    model: 'synthetic-image', prompt: 'test', size: '512x512', nativeSizes: ['512x512'],
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://cdn.example.test/image.png')
      assert.equal(init.headers, undefined)
      return new Response(tinyPNG)
    },
  })
  assert.equal(result.dimensions.size, '1x1')
  assert.equal(calls.length, 1)
})

test('unconfigured adapter registers nothing; readiness changes on login and Studio retains the shared tool permission path', async () => {
  const providers = {}, events = [], requests = []; let configured = false, secrets = 0
  const agent = { session: { header: { cwd: 'unused' } } }, signal = new AbortController().signal, parent = {}
  const ctx = { effect() {}, on() {}, emit: name => events.push(name), agents: { get: () => agent },
    artifactServices: { registerSpeechProvider: p => { providers.speech = p; return () => {} }, registerImageProvider: p => { providers.image = p; return () => {} } },
    credentials: { describe: async () => ({ configured }), resolve: async () => { secrets++; throw new Error('must not resolve before permission') } },
    tools: { execute: async request => { requests.push(request); return { isError: true, error: { message: 'Denied by policy' } } } } }
  apply(ctx)
  assert.deepEqual(providers, {})
  apply(ctx, config())
  assert.equal(await providers.image.available(), false)
  configured = true
  assert.equal(await providers.image.available(), true)
  assert.equal((await providers.speech.voices())[0].id, 'Voice_A')
  for (const [name, method, args] of [['image_generate', 'generate', { prompt: 'test', size: '1200x800' }], ['speech_synthesize', 'synthesize', { text: 'test' }]]) {
    const provider = name === 'image_generate' ? providers.image : providers.speech
    await assert.rejects(provider[method]({ ...args, signal, execution: { agent, name: 'knowledge_studio_create_artifact', token: parent, callId: 'root' } }), /Denied by policy/)
    assert.equal(requests.at(-1).name, name)
    assert.equal(requests.at(-1).parent, parent)
    assert.equal(requests.at(-1).signal, signal)
    assert.equal(requests.at(-1).arguments.provider, 'example')
  }
  assert.equal(secrets, 0)
})

test('arbitrary requested ratios select only the configured provider sizes', () => {
  const sizes = config().providers[0].images.nativeSizes
  for (const [target, source] of Object.entries({ '1200x800': '1280x720', '1080x1920': '720x1280', '600x600': '768x768', '256x256': '512x512' })) assert.equal(selectImageGenerationSize(target, sizes), source)
  assert.equal(selectImageGenerationSize('1200x800', ['1024x1024']), '1024x1024')
})

test('OpenAI image request supports base64, server-selected format and URL results without forwarding credentials', async () => {
  const options = { baseURL: 'https://api.example.test/v1', apiKey: 'synthetic-key', model: 'model-from-config', prompt: 'test', size: '1200x800', nativeSizes: ['1280x720'] }
  const requests = []
  const result = await generateImage({ ...options, responseFormat: 'b64_json', fetchImpl: async (url, init) => {
    requests.push({ url, init }); return Response.json({ data: [{ b64_json: tinyPNG.toString('base64') }] })
  } })
  assert.deepEqual(JSON.parse(requests[0].init.body), { model: options.model, prompt: 'test', size: '1280x720', response_format: 'b64_json' })
  assert.equal(result.dimensions.size, '1x1')
  await generateImage({ ...options, fetchImpl: async (url, init) => {
    if (url.includes('/images/generations')) {
      assert.equal(JSON.parse(init.body).response_format, undefined)
      return Response.json({ data: [{ url: 'https://cdn.example.test/image.png?signature=synthetic' }] })
    }
    assert.equal(init.headers, undefined)
    assert.equal(init.redirect, 'error')
    return new Response(tinyPNG)
  } })
  await assert.rejects(generateImage({ ...options, fetchImpl: async () => new Response('synthetic-key should never be reported', { status: 401 }) }), error => /HTTP 401/u.test(error.message) && !error.message.includes('synthetic-key'))
  await assert.rejects(generateImage({ ...options, fetchImpl: async () => Response.json({ data: [{ b64_json: '%%%%' }] }) }), /base64/)
  await assert.rejects(generateImage({ ...options, fetchImpl: async () => Response.json({ data: [{ url: 'http://localhost/private' }] }) }), /HTTPS/)
})

test('managed output refuses workspace symlink escapes', async t => {
  const root = await temporary(t), outside = await temporary(t)
  await symlink(outside, join(root, '.eduwork'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(prepareManagedOutput(root, 'images'), /trusted directory/)
})
