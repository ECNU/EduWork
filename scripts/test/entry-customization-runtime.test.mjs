import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { creatorAvailability, patchEntryCustomizationSource, patchEntryCustomizationRuntime, entryCustomizationPatch as patch } from '../patch-entry-customization-runtime.mjs'

test('Creator gate follows the official roster and never changes preferences', async () => {
  let tools = false, rows = [], calls = 0, failed = false, deferred
  const ctx = { configForms: { developerTools: { enabled: { getSnapshot: () => tools } } },
    remote: { agentPresets: { async list() { calls++; await deferred; return failed ? { ok: false, error: { message: 'disconnected' } } : { ok: true, value: { presets: rows } } } } } }
  assert.equal(await creatorAvailability(ctx), 'toolsDisabled'); assert.equal(calls, 0)
  tools = true
  assert.equal(await creatorAvailability(ctx), 'disabled')
  rows = [{ id: 'cordis', broken: { reason: 'not loadable' } }]
  assert.equal(await creatorAvailability(ctx), 'disabled')
  rows = [{ id: 'cordis' }]
  assert.equal(await creatorAvailability(ctx), 'ready')
  failed = true
  await assert.rejects(creatorAvailability(ctx), /disconnected/)
  failed = false
  let release
  deferred = new Promise(resolve => { release = resolve })
  const pending = creatorAvailability(ctx)
  tools = false; release()
  assert.equal(await pending, 'toolsDisabled')
})

test('unreviewed menu input is rejected', () => {
  assert.throws(() => patchEntryCustomizationSource(Buffer.from('unknown')), /input changed/)
})

const runtime = process.env.EDUWORK_TEST_RUNTIME
test('adapted npm menu keeps all three native slots, plugin navigation and append-only Creator prompts', { skip: !runtime }, async t => {
  const originalRoot = join(runtime, 'node_modules', patch.package)
  const original = await readFile(join(originalRoot, patch.file))
  const modules = await mkdtemp(join(tmpdir(), 'eduwork-creator-'))
  t.after(() => rm(modules, { recursive: true, force: true }))
  const copy = join(modules, patch.package)
  await mkdir(join(copy, 'lib'), { recursive: true })
  await writeFile(join(copy, 'package.json'), await readFile(join(originalRoot, 'package.json')))
  await writeFile(join(copy, patch.file), original)
  await patchEntryCustomizationRuntime(modules)
  const output = await readFile(join(copy, patch.file), 'utf8')
  assert.deepEqual(await readFile(join(originalRoot, patch.file)), original)
  await assert.rejects(patchEntryCustomizationRuntime(modules), /input changed/)
  await writeFile(join(copy, 'package.json'), JSON.stringify({ name: patch.package, version: '0.2.2' }))
  await assert.rejects(patchEntryCustomizationRuntime(modules), /newly qualified/)
  let plugin
  runInNewContext(output, { window: { __ModuleLoader__: { load({ factory }) { plugin = factory(() => ({})) } } } })
  // Cordis requires the parent service as well as the remote namespace.
  assert.ok(plugin.inject.includes('remote') && plugin.inject.includes('remote.agentPresets'))
  const slots = [], calls = []
  const ctx = {
    effect: fn => fn(), locale: { register() {}, bind: () => key => key }, get: () => undefined,
    slots: { inject: (name, fn) => fn(), register: options => slots.push(options) },
    pluginNavigation: { openList: () => calls.push('browse') },
    uiWorkspace: { startSession: (id, options) => calls.push({ id, options }) },
    configForms: { developerTools: { enabled: { getSnapshot: () => true } } },
    remote: { agentPresets: { list: async () => ({ ok: true, value: { presets: [{ id: 'cordis' }] } }) } },
  }
  plugin.apply(ctx)
  assert.deepEqual(slots.map(row => row.name), ['sidebar.panellist.actions', 'conversation.session.header.views.actions', 'sidebar.right.tab.guide.actions'])
  for (const [index, slot] of slots.entries()) {
    const actions = slot.inject()
    assert.equal(await actions.checkCreator(), 'ready')
    actions.browsePlugins(); actions.createPlugin()
    assert.equal(calls[index * 2], 'browse')
    const { id, options } = calls[index * 2 + 1]
    assert.equal(id, undefined)
    assert.deepEqual(JSON.parse(JSON.stringify(options)), { agentPreset: 'cordis', prompt: 'createPrompt.' + ['sidebar', 'conversation', 'rightbar'][index], whenDraftExists: 'append' })
  }
})
