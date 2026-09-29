import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { apply as officeTools } from '../packages/artifact-services/lib/office-tools.js'
import { installMediaTools } from '../packages/artifact-services/lib/media-tools.js'
import { installTranscriptionTools } from '../packages/artifact-services/lib/transcription-tools.js'
import { installImageTools } from '../packages/artifact-services/lib/image-tools.js'
import { SpeechService } from '../packages/artifact-services/lib/speech.js'
import { TranscriptionService } from '../packages/artifact-services/lib/transcription.js'
import { ImageService } from '../packages/artifact-services/lib/images.js'

// Default to the package lock; the same tests also run against a pinned product
// Runtime via EDUWORK_TEST_RUNTIME, without replacing the package's dependencies.
const require = createRequire(process.env.EDUWORK_TEST_RUNTIME
  ? join(process.env.EDUWORK_TEST_RUNTIME, 'package.json') : import.meta.url)
const load = name => import(pathToFileURL(require.resolve(name)).href)
const [{ Context }, prompt, tools, fs, sessions] = await Promise.all([
  load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-system-prompt'),
  load('@deepseek-ai/dsh-tools'), load('@deepseek-ai/dsh-fs-local'), load('@deepseek-ai/dsh-session'),
])

async function harness(t, { mode = 'workspace-write', outcome = 'rejected', policy = true } = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'artifact-permissions-')))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const root = join(directory, 'workspace')
  await mkdir(root)
  const ctx = new Context()
  await ctx.plugin(prompt.default)
  await ctx.plugin(tools.default)
  await ctx.plugin(fs.default, { cwd: directory })
  let approvals = 0
  ctx.provide('permissionPresets', { current: () => policy ? 'custom' : mode })
  const state = { mode, workspaceRoot: root }
  if (policy) ctx.provide('sandboxPolicy', { resolve: ({ session }) => {
    assert.equal(session.header.cwd, root)
    return { ...state }
  } })
  ctx.provide('approval', { request: async () => { approvals++; return outcome } })
  officeTools(ctx)
  const id = sessions.SessionId('permission-test')
  const session = sessions.Session.create(id, [], {
    version: sessions.SESSION_FORMAT_VERSION, id, createdAt: Date.now(), cwd: root, isSeeded: false,
  })
  const agent = { session }
  let call = 0
  const execute = (name, args, extra = {}) => ctx.tools.execute({
    agent, signal: new AbortController().signal, callId: 'permissions-' + (++call),
    name, arguments: args, ...extra,
  })
  return { ctx, directory, root, state, agent, execute, approvals: () => approvals }
}

const create = output_path => ({
  action: 'create', output_path, spec: { blocks: [{ type: 'paragraph', text: 'Permission regression' }] },
})

test('Office creates, edits and reads actual workspace files without repeated approval', async t => {
  const h = await harness(t)
  for (const [name, args] of [
    ['office_document', create('one.docx')],
    ['office_document', { action: 'edit', input_path: 'one.docx', output_path: 'two.docx',
      spec: { operations: [{ op: 'replace_text', find: 'regression', replace: 'verified' }] } }],
    ['office_document', { action: 'inspect', input_path: 'two.docx' }],
    ['office_spreadsheet', { action: 'create', output_path: 'sheet.xlsx',
      spec: { sheets: [{ name: 'Data', rows: [['Value'], [1]] }] } }],
    ['office_presentation', { action: 'create', output_path: 'deck.pptx',
      spec: { slides: [{ layout: 'summary', title: 'Test', bullets: ['Permission'] }] } }],
    ['office_pdf', { action: 'create', output_path: 'page.pdf',
      spec: { blocks: [{ type: 'paragraph', text: 'Test' }] } }],
    ['office_pdf', { action: 'extract', input_path: 'page.pdf', output_path: 'extract.pdf', pages: '1' }],
    ['office_pdf', { action: 'merge', input_paths_json: '["page.pdf","extract.pdf"]', output_path: 'merged.pdf' }],
  ]) {
    const result = await h.execute(name, args)
    assert.equal(result.isError, false, JSON.stringify(result))
  }
  assert.equal(h.approvals(), 0)
  assert.equal((await h.execute('office_document', create('one.docx'))).isError, true, 'never overwrite')
})

test('read-only approval is one call, rejection is final, and later hooks still apply', async t => {
  const rejected = await harness(t, { mode: 'read-only' })
  assert.equal((await rejected.execute('office_document', create('denied.docx'))).isError, true)
  assert.equal(rejected.approvals(), 1)
  assert.deepEqual(await readdir(rejected.root), [])
  const once = await harness(t, { mode: 'read-only', outcome: 'allowed-once' })
  for (const path of ['one.docx', 'two.docx'])
    assert.equal((await once.execute('office_document', create(path))).isError, false)
  assert.equal(once.approvals(), 2)
  assert.equal(once.state.mode, 'read-only')
  assert.equal((await once.execute('office_document', { action: 'inspect', input_path: 'one.docx' })).isError, false)
  assert.equal(once.approvals(), 2, 'reads do not prompt')
  const governed = await harness(t)
  governed.ctx.on('tools/pre-execute', () => ({ kind: 'deny', reason: 'another host guard' }))
  assert.equal((await governed.execute('office_document', create('guarded.docx'))).isError, true)
  assert.deepEqual(await readdir(governed.root), [])
})

test('standing grants retain workspace fences, agent requirement and cancellation', async t => {
  const h = await harness(t)
  const outside = join(h.directory, 'outside')
  await mkdir(outside)
  await symlink(outside, join(h.root, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
  for (const path of ['../outside/escape.docx', join(outside, 'absolute.docx'), 'link/escape.docx'])
    assert.equal((await h.execute('office_document', create(path))).isError, true, path)
  assert.deepEqual(await readdir(outside), [])
  assert.equal((await h.execute('office_document', create('agentless.docx'), { agent: undefined })).isError, true)
  const controller = new AbortController()
  controller.abort()
  assert.equal((await h.execute('office_document', create('cancelled.docx'), { signal: controller.signal })).isError, true)
  h.state.workspaceRoot = outside
  assert.equal((await h.execute('office_document', create('wrong-root.docx'))).isError, true)
  assert.equal(h.approvals(), 0)
})

test('old hosts retain canonical workspace grants; unknown presets ask', async t => {
  const h = await harness(t, { policy: false })
  assert.equal((await h.execute('office_document', create('legacy.docx'))).isError, false)
  assert.equal(h.approvals(), 0)
  const unknown = await harness(t, { policy: false, mode: 'custom' })
  assert.equal((await unknown.execute('office_document', create('unknown.docx'))).isError, true)
  assert.equal(unknown.approvals(), 1)
})

test('configured media reuse the write grant without querying providers; editable code still asks', async t => {
  const h = await harness(t), speech = new SpeechService(), transcription = new TranscriptionService()
  const noProviderCall = () => { throw new Error('permission checks must not call providers') }
  for (const [id, local] of [['local', true], ['remote', false]]) {
    speech.register({ id, local, voices: noProviderCall, synthesize: noProviderCall })
    transcription.register({ id, local, available: noProviderCall, transcribe: noProviderCall })
  }
  const hooks = []
  const ctx = { on: (_, fn) => hooks.push(fn), tools: { register() {} },
    get: name => h.ctx.get(name), permissionPresets: h.ctx.permissionPresets, fs: h.ctx.fs }
  installMediaTools(ctx, { speech })
  installTranscriptionTools(ctx, { transcription })
  installImageTools(ctx, { images: {} })
  const decision = async (name, args) => {
    const exec = { name, arguments: args, agent: h.agent }
    const run = i => i === hooks.length ? { kind: 'allow' } : hooks[i](exec, () => run(i + 1))
    return (await run(0)).kind
  }
  for (const name of ['speech_synthesize', 'speech_transcribe', 'image_generate']) {
    assert.equal(await decision(name, { provider: 'local' }), 'allow')
    assert.equal(await decision(name, { provider: 'remote' }), 'allow')
  }
  assert.equal(await decision('media_render', { spec: { kind: 'audio', options: { provider: 'local' } } }), 'allow')
  assert.equal(await decision('media_render', { spec: { kind: 'audio', options: { provider: 'remote' } } }), 'allow')
  assert.equal(await decision('media_render', { spec: { kind: 'video', options: { narration: false } } }), 'allow')
  assert.equal(await decision('video_project', { action: 'init' }), 'allow')
  assert.equal(await decision('video_project', { action: 'render' }), 'ask')
  h.state.mode = 'read-only'
  for (const name of ['speech_synthesize', 'speech_transcribe', 'image_generate', 'media_render'])
    assert.equal(await decision(name, { provider: 'remote' }), 'ask')
  h.state.mode = 'danger-full-access'
  assert.equal(await decision('speech_synthesize', { provider: 'remote' }), 'allow')
})

test('local and remote image/speech tools execute under workspace access while refusals stop providers', async t => {
  const h = await harness(t)
  const speech = new SpeechService(), transcription = new TranscriptionService(), images = new ImageService()
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL6WQAAAABJRU5ErkJggg==', 'base64')
  const wav = Buffer.alloc(44 + 1600)
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36); wav.writeUInt32LE(1600, 40)
  await writeFile(join(h.root, 'input.wav'), wav)
  const calls = []
  let available = true
  for (const [id, local] of [['local', true], ['remote', false]]) {
    const record = (kind, request) => {
      assert.equal(request.execution.agent, h.agent)
      assert.equal(request.sessionId, h.agent.session.id)
      calls.push(kind + ':' + id)
    }
    // Synthetic adapters write real files without using paid or private services.
    images.register({ id, local, available: () => available, async generate(request) {
      record('image', request)
      const path = join(request.projectPath, id + '.png')
      await writeFile(path, png)
      return { path }
    } })
    speech.register({ id, local, voices: async () => available ? [{ id: 'voice', title: 'Test' }] : [],
      async synthesize(request) {
        record('speech', request)
        const path = join(request.directory, request.name + '.wav')
        await writeFile(path, wav)
        return { path }
      } })
    transcription.register({ id, local, available: () => available, async transcribe(request) {
      record('transcription', request)
      return { text: 'Synthetic transcript' }
    } })
  }
  installImageTools(h.ctx, { images })
  installMediaTools(h.ctx, { speech })
  installTranscriptionTools(h.ctx, { transcription })
  const requests = provider => [
    ['image_generate', { provider, prompt: 'Synthetic image' }],
    ['speech_synthesize', { provider, text: 'Synthetic speech' }],
    ['speech_transcribe', { provider, input_path: 'input.wav' }],
  ]
  for (const provider of ['local', 'remote'])
    for (const [name, args] of requests(provider)) {
      const result = await h.execute(name, args)
      assert.equal(result.isError, false, JSON.stringify(result))
    }
  assert.equal(h.approvals(), 0)
  assert.equal(calls.length, 6)

  h.state.mode = 'read-only'
  for (const [name, args] of requests('remote'))
    assert.equal((await h.execute(name, args)).isError, true)
  assert.equal(h.approvals(), 3)
  assert.equal(calls.length, 6, 'rejected approval must not reach providers')

  h.state.mode = 'workspace-write'
  for (const [name, args] of requests('remote'))
    assert.equal((await h.execute(name, args, { signal: AbortSignal.abort() })).isError, true)
  h.state.workspaceRoot = join(h.directory, 'different-workspace')
  await mkdir(h.state.workspaceRoot)
  for (const [name, args] of requests('remote'))
    assert.equal((await h.execute(name, args)).isError, true)
  h.state.workspaceRoot = h.root
  available = false
  for (const provider of ['remote', 'unconfigured'])
    for (const [name, args] of requests(provider))
      assert.equal((await h.execute(name, args)).isError, true)
  assert.equal(calls.length, 6, 'cancelled, out-of-scope or unavailable calls must not generate')
  assert.equal(h.approvals(), 3)
})
