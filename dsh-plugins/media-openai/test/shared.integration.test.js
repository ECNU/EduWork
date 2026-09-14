import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { apply } from '../lib/index.js'

// Explicit local integration: use the locked npm artifact package, a synthetic
// HTTP provider and real managed Python. This does not claim live vendor login.
if (!process.env.EDUWORK_TEST_RUNTIME || !process.env.DSH_OFFICE_PYTHON) throw new Error('Set EDUWORK_TEST_RUNTIME and DSH_OFFICE_PYTHON for shared media integration')
const lib = join(process.env.EDUWORK_TEST_RUNTIME, 'node_modules/@eduwork/dsh-artifact-services/lib')
const { ImageService } = await import(pathToFileURL(join(lib, 'images.js')))
const { SpeechService, createSystemSpeechProvider } = await import(pathToFileURL(join(lib, 'speech.js')))
const original = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64')
function wave() {
  const buffer = Buffer.alloc(44 + 1600)
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(8000, 24); buffer.writeUInt32LE(16000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36); buffer.writeUInt32LE(1600, 40)
  return buffer
}

test('dialogue and Studio produce the same image/audio contracts through the locked shared services', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-media-shared-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const calls = [], network = [], disposers = [], image = new ImageService(), speech = new SpeechService()
  const agent = { session: { id: 'synthetic', header: { cwd: root } } }, signal = new AbortController().signal
  const server = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk
    network.push({ url: request.url, auth: request.headers.authorization, body: JSON.parse(body) })
    if (request.url === '/v1/images/generations') response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ b64_json: original.toString('base64') }] }))
    else if (request.url === '/v1/audio/speech') response.writeHead(200, { 'content-type': 'audio/wav' }).end(wave())
    else response.writeHead(404).end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  let configured = true
  const ctx = { effect: factory => disposers.push(factory()), on() {}, emit() {}, agents: { get: () => agent },
    credentials: { describe: async () => ({ configured }), resolve: async () => configured ? { value: 'synthetic-key' } : undefined },
    fs: { resolve: async () => root, stat: async () => ({ type: 'directory' }), processPath: path => path },
    artifactServices: { registerImageProvider: p => image.register(p), registerSpeechProvider: p => speech.register(p) },
    tools: { execute: async request => {
      calls.push(request.name)
      // Simulate an approved Tool execution; the actual Tool implementations
      // continue to own DSH approval and context propagation (unit-tested).
      const exec = { ...request, agent, signal }
      const common = { ...request.arguments, execution: exec, sessionId: 'synthetic', signal }
      const result = request.name === 'image_generate' ? await image.generate({ ...common, projectPath: root }) : await speech.synthesize(common)
      return { value: { reportJSON: JSON.stringify(result) } }
    } } }
  apply(ctx, { providers: [{ id: 'example', protocol: 'openai-compatible', title: 'Test service',
    baseURL: `http://127.0.0.1:${server.address().port}/v1`, credentialRef: 'EDUWORK_API_KEY',
    images: { enabled: true, model: 'configured-image', nativeSizes: ['512x512'], responseFormat: 'b64_json' },
    speech: { enabled: true, model: 'configured-tts', voices: [{ id: 'Voice_A', title: 'Sample', language: 'zh-CN' }] },
  }] })
  t.after(() => disposers.forEach(dispose => dispose()))
  const images = [], audios = []
  for (const studio of [false, true]) {
    images.push(await image.generate({ prompt: 'synthetic', size: '64x80', fit: 'pad', projectPath: root, sessionId: 'synthetic', signal,
      execution: studio ? { name: 'knowledge_studio_create_artifact', agent } : { name: 'image_generate', agent } }))
    audios.push(await speech.synthesize({ provider: 'example', text: '测试', sessionId: 'synthetic', signal,
      execution: studio ? { name: 'knowledge_studio_create_artifact', agent } : { name: 'speech_synthesize', agent } }))
  }
  assert.deepEqual(calls, ['image_generate', 'speech_synthesize'])
  for (const result of images) {
    assert.equal(result.provider, 'example'); assert.equal(result.size, '64x80'); assert.equal(result.resized, true)
    assert.equal(result.mime, 'image/png'); assert.match(result.relativePath, /^\.eduwork\/generated\/images\//u)
    assert.notEqual(result.path, result.sourceRelativePath)
  }
  assert.deepEqual(await readFile(images[0].path), await readFile(images[1].path))
  for (const result of audios) { assert.equal(result.format, 'wav'); assert.equal(result.duration, 0.1); assert.equal(result.voice, 'Voice_A') }
  assert.deepEqual(await readFile(audios[0].path), await readFile(audios[1].path))
  assert.equal(network.length, 4)
  for (const item of network) {
    assert.equal(item.auth, 'Bearer synthetic-key')
    if (item.url.endsWith('generations')) { assert.equal(item.body.model, 'configured-image'); assert.equal(item.body.size, '512x512') }
    else { assert.equal(item.body.model, 'configured-tts'); assert.equal(item.body.response_format, 'wav'); assert.equal(item.body.voice, 'Voice_A') }
  }
  configured = false
  assert.equal((await image.list())[0].available, false)
  assert.equal((await speech.list())[0].available, false)
  await assert.rejects(image.generate({ prompt: 'x', projectPath: root }), /No image provider/)
  const cancelled = new AbortController(); cancelled.abort()
  await assert.rejects(image.generate({ prompt: 'x', projectPath: root, signal: cancelled.signal }), /abort/i)
  assert.equal(network.length, 4)
})

test('Windows local speech remains discoverable without cloud configuration', async () => {
  if (process.platform !== 'win32') return
  const service = new SpeechService()
  service.register(createSystemSpeechProvider())
  const [provider] = await service.list()
  assert.equal(provider.id, 'system')
  assert.equal(provider.local, true)
  assert.equal(provider.available, provider.voices.length > 0)
})
