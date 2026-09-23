// Source-only qualification; never loads an installed user's profile or secrets.
import assert from 'node:assert/strict'
import { createRequire, registerHooks } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'
import { stageLegacySettings, importLegacySettings } from '../dsh-host/settings-migration.mjs'
import { writeNativeProfile, nativePresetPatches } from '../dsh-host/native-profile.mjs'
import { syncNativeOptionalPresets } from '../dsh-plugins/brand-settings-native/lib/preset-policy.js'

const { values } = parseArgs({ options: { runtime: { type: 'string' }, output: { type: 'string' }, source: { type: 'string' }, dependencies: { type: 'string' }, 'full-product': { type: 'boolean' }, serve: { type: 'boolean' } } })
if (!values.runtime || !values.output) throw new Error('Use --runtime <candidate Runtime> --output <new synthetic directory>')
const repository = values.source ? resolve(values.source) : fileURLToPath(new URL('../', import.meta.url))
const runtime = resolve(values.runtime), output = resolve(values.output)
const require = createRequire(join(runtime, 'package.json'))
const dependenciesRequire = values.dependencies ? createRequire(join(resolve(values.dependencies), 'package.json')) : null
let resolvingFallback = false
const artifactRoot = join(repository, 'packages/dsh-knowledge-studio/packages/artifact-services')
const artifactManifest = JSON.parse(await readFile(join(artifactRoot, 'package.json'), 'utf8'))
const distribution = JSON.parse(await readFile(join(repository, 'config/distributions/generic.json'), 'utf8'))
const localPackages = new Map()
for (const row of [...distribution.plugins, { name: '@chatecnu-work/dsh-skill-control-native', source: 'dsh-plugins/skill-control-native' }]) {
  const root = join(repository, row.source)
  localPackages.set(row.name, { root, manifest: JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) })
}
const receipt = JSON.parse(await readFile(join(runtime, '.chatecnu-dsh-runtime.json'), 'utf8'))
assert.equal(receipt.dshVersion, '0.1.7-alpha.2')
assert.equal(receipt.dshCommit, '00102833dfaee1da9f48a3a8eae9d34005a75218')
await mkdir(output)
const home = join(output, 'home'), profileDir = join(home, 'profiles', 'settings-probe')
await mkdir(profileDir, { recursive: true })
process.env.DSH_HOME = home
process.env.DSH_TELEMETRY_DISABLED = '1'
process.env.DSH_BUNDLED_SKILL_DIR = join(output, 'synthetic-skills')
for (const name of ['synthetic-skill', 'synthetic-visible']) {
  const directory = join(process.env.DSH_BUNDLED_SKILL_DIR, name)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: Synthetic qualification skill\n---\nSynthetic content.\n`)
}
process.chdir(output)
// Resolve source plugin peers against this explicitly selected candidate. No
// package manifests, installed dependencies, or production locks are changed.
registerHooks({ resolve(specifier, context, next) {
  if (resolvingFallback) return next(specifier, context)
  const runtimeContext = { ...context, parentURL: pathToFileURL(join(runtime, 'package.json')).href }
  for (const [name, { root, manifest }] of localPackages) {
    if (specifier !== name && !specifier.startsWith(name + '/')) continue
    const key = specifier === name ? '.' : '.' + specifier.slice(name.length)
    const target = manifest.exports?.[key] ?? (key === '.' ? manifest.main : key)
    if (typeof target === 'string') return { url: pathToFileURL(join(root, target)).href, shortCircuit: true }
  }
  if (specifier === '@eduwork/dsh-artifact-services' || specifier.startsWith('@eduwork/dsh-artifact-services/')) {
    const key = specifier === '@eduwork/dsh-artifact-services' ? '.' : '.' + specifier.slice('@eduwork/dsh-artifact-services'.length)
    const target = artifactManifest.exports[key]
    if (typeof target !== 'string') throw new Error(`Unsupported shared service export: ${specifier}`)
    return { url: pathToFileURL(join(artifactRoot, target)).href, shortCircuit: true }
  }
  if (specifier.startsWith('@deepseek-ai/')) return next(specifier, runtimeContext)
  try { return next(specifier, context) }
  catch (error) {
    if (!['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) throw error
    try { return next(specifier, runtimeContext) }
    catch (missing) {
      if (!values.dependencies || !['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(missing.code)) throw missing
      // CJS createRequire retains its parent object even if parentURL changes.
      // Resolve against the isolated dependency install without recursing here.
      resolvingFallback = true
      try { return { url: pathToFileURL(dependenciesRequire.resolve(specifier)).href, shortCircuit: true } }
      finally { resolvingFallback = false }
    }
  }
} })
const load = name => import(pathToFileURL(require.resolve(name)).href)
const { runProfile } = await load('@deepseek-ai/dsh/profile-boot')
const { loadProfileDirectory } = await load('@deepseek-ai/dsh-app-boot')
const { createLaunchEnvironmentSnapshot } = await load('@deepseek-ai/dsh-launch-environment')
const { parse } = await load('yaml')
const entry = (id, file, config = {}) => ({ id, name: pathToFileURL(join(repository, file)).href, config })
const rows = [
  entry('chatecnu-brand', 'dsh-plugins/brand-settings-native/lib/index.js', { product: { name: 'Synthetic edition' } }),
  entry('chatecnu-skills', 'dsh-plugins/skill-settings-native/lib/index.js'),
  entry('synthetic-skill-provider', 'dsh-plugins/skill-control-native/lib/index.js'),
  entry('eduwork-concurrency', 'dsh-plugins/request-concurrency/lib/native.js'),
  entry('dsh-mail-assistant', 'packages/dsh-mail/src/host/index.js'),
  entry('memories', 'packages/dsh-memory/src/host/index.js'),
  entry('dsh-artifact-services', 'packages/dsh-knowledge-studio/packages/artifact-services/lib/dsh.js', { skills: false }),
  entry('dsh-knowledge-studio', 'packages/dsh-knowledge-studio/lib/index.js', { skills: false }),
  entry('enterprise-oidc', 'packages/dsh-oidc/src/host/index.js', { allowEmptyProfiles: true, profilePathEnv: 'EDUWORK_SYNTHETIC_NO_PROFILE' }),
]
if (values['full-product']) {
  rows.push({ id: 'local-memory-sqlite', name: '@deepseek-ai/dsh-storage-sqlite', config: { path: join(home, 'memory.sqlite3') } })
  for (const plugin of distribution.plugins) {
    if (['eduwork-brand-settings', 'eduwork-skill-settings', 'eduwork-request-concurrency'].includes(plugin.id)) continue
    const { root, manifest } = localPackages.get(plugin.name)
    rows.push({ id: plugin.id, name: pathToFileURL(join(root, manifest.main ?? 'lib/index.js')).href, config: plugin.config ?? {} })
  }
}
const productPatches = [
  ...await nativePresetPatches(runtime, text => parse(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => ({ __jsExpr: value }) }] })),
  ...values['full-product'] ? distribution.patches : [],
  ...['session-log-deepseek', 'deepseek-account', 'account-controller', 'ui-settings-account', 'plugin-package-inventory-deepseek'].map(id => ({ id, disabled: true })),
  { insert: rows },
  { id: 'preset-minimal', disabled: true }, { id: 'preset-cordis', disabled: true },
]
const prepare = () => writeNativeProfile({ profile: profileDir, bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'], patches: productPatches,
  parse: text => parse(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => ({ __jsExpr: value }) }] }),
})
await prepare()
const legacy = { 'chatecnu-brand': { visualStyle: 'dsh', detailsPanelWidth: 480 },
  'chatecnu-skills': { disabled: ['synthetic-skill'] }, 'eduwork-concurrency': { maxParallelSubagents: 4 },
  'dsh-mail-assistant': { email: 'synthetic@example.invalid', readEnabled: false },
  memories: { enabled: false, search_prior_chats: false },
  'dsh-knowledge-studio': { maxFiles: 1234 },
  'uninstalled-synthetic-plugin': { keep: 'original' } }
await writeFile(join(home, 'settings.yaml'), JSON.stringify(legacy))
const report = { version: receipt.dshVersion, scope: 'synthetic product settings persistence', success: false }
let application
const boot = async () => {
  await prepare()
  const migration = await stageLegacySettings(home)
  const installAnchor = join(runtime, 'node_modules/@deepseek-ai/dsh/package.json')
  const profile = loadProfileDirectory('eduwork-settings-probe', profileDir, installAnchor)
  assert.equal(profile.layers.length, 3, 'Generated product bundle did not resolve')
    const environment = createLaunchEnvironmentSnapshot([{ source: 'process', values: {
    DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', DSH_BUNDLED_SKILL_DIR: process.env.DSH_BUNDLED_SKILL_DIR, PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', TEMP: process.env.TEMP ?? '',
  } }])
  application = await runProfile({ environment, profile: 'settings-probe', resolvedProfile: { profile, installAnchor }, patchFiles: [],
    args: ['--no-open', '--host', '127.0.0.1', '--port', '0'] })
  await application.ctx.loader.await()
  // File-URL source entries intentionally bypass npm package discovery. Mount
  // their declared RPC contracts explicitly and fail on invalid codecs, just
  // as the installed package Loader does in a release assembly.
  for (const row of rows) {
    if (!row.name.startsWith('file:')) continue
    let root = dirname(fileURLToPath(row.name)), manifest
    while (root.startsWith(repository.replace(/[\\/]$/, ''))) {
      try { manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')); break }
      catch (error) { if (error.code !== 'ENOENT') throw error }
      root = dirname(root)
    }
    const target = manifest?.exports?.['./typert']
    if (typeof target !== 'string') continue
    if (!application.ctx.typert.getPackage(manifest.name)) {
      const mod = await import(pathToFileURL(join(root, target)).href)
      application.ctx.typert.register(mod.TYPERT ?? mod.default)
    }
    assert.ok(application.ctx.typert.getPackage(manifest.name), `RPC contract absent: ${manifest.name}`)
  }
  report.migration ??= await importLegacySettings(application.ctx, migration, parse)
  return application.ctx
}
try {
  for (const row of rows) {
    console.log(`Importing ${row.id}`)
    await import(row.name)
  }
  console.log('Booting the synthetic product profile')
  let ctx = await boot()
  const waitForPresets = async expected => {
    const deadline = Date.now() + 15_000
    for (;;) {
      const presets = await ctx.agentPresets.list()
      if (JSON.stringify(presets.map(row => row.id).sort()) === JSON.stringify([...expected].sort())) {
        assert.ok(presets.every(row => !row.broken)); return
      }
      if (Date.now() >= deadline) throw new Error(`Preset policy did not converge: ${presets.map(row => row.id)}; expected ${expected}`)
      await new Promise(resolve => setTimeout(resolve, 25))
    }
  }
  const read = ns => ctx.settings.describe().find(row => row.ns === ns)
  for (const ns of ['chatecnu-brand', 'chatecnu-skills', 'eduwork-concurrency', 'dsh-mail-assistant', 'memories', 'dsh-knowledge-studio']) assert.ok(read(ns), `Settings missing: ${ns}`)
  for (const service of ['knowledgeStudio', 'artifactServices', 'localMemories', 'oidcAccounts']) assert.ok(ctx.get(service), `Service missing: ${service}`)
  assert.equal(read('chatecnu-brand').value.visualStyle, 'dsh')
  assert.deepEqual(read('chatecnu-skills').value.disabled, ['synthetic-skill'])
  assert.equal(read('eduwork-concurrency').value.maxConcurrentRequests, 5)
  assert.equal(read('dsh-mail-assistant').value.email, 'synthetic@example.invalid')
  assert.equal(read('memories').value.enabled, false)
  assert.equal(ctx.knowledgeStudio.settings().maxFiles, 1234)
  report.skills = (await ctx.skills.list()).map(row => row.name)
  assert.ok(report.skills.includes('synthetic-visible'), 'Bundled product skills must be discoverable')
  assert.ok(!(await ctx.skills.list()).some(row => row.name === 'synthetic-skill'), 'Disabled skills must stay hidden')
  await ctx.settings.update('chatecnu-skills', { disabled: [] })
  assert.ok((await ctx.skills.list()).some(row => row.name === 'synthetic-skill'), 'Enabling a skill must invalidate the official cache')
  await waitForPresets(['standard', 'ptc'])
  await ctx.settings.update('chatecnu-brand', { enabledOptionalPresets: ['minimal'] })
  await syncNativeOptionalPresets(ctx, ['minimal'])
  await waitForPresets(['standard', 'ptc', 'minimal'])
  await ctx.settings.update('agent-preset-registry', { selectedDefault: 'minimal' })
  await ctx.settings.update('chatecnu-brand', { enabledOptionalPresets: ['cordis'] })
  await syncNativeOptionalPresets(ctx, ['cordis'])
  await waitForPresets(['standard', 'ptc', 'cordis'])
  assert.equal(ctx.agentPresets.defaultId, 'standard')
  await assert.rejects(ctx.settings.update('dsh-knowledge-studio', { maxFiles: 0 }))
  await assert.rejects(ctx.settings.update('dsh-mail-assistant', { smtpPort: 0 }))
  await assert.rejects(ctx.settings.update('dsh-mail-assistant', { fromName: 'header\ninjection' }))
  await assert.rejects(ctx.settings.update('eduwork-concurrency', { maxConcurrentRequests: 0 }))
  assert.equal(read('eduwork-concurrency').value.maxConcurrentRequests, 5)
  // Use the real native Loader, volatile settings and LLM dispatcher. Synthetic
  // adapters keep the scheduler checks offline without bypassing its middleware.
  const { LlmAdapter } = await load('@deepseek-ai/dsh-llm')
  const consume = async iterable => { const result = []; for await (const chunk of iterable) result.push(chunk); return result }
  const waitForQueue = async predicate => {
    for (let attempt = 0; attempt < 200 && !predicate(); attempt++) await new Promise(resolve => setTimeout(resolve, 10))
    assert.ok(predicate(), 'Native request queue did not converge')
  }
  let active = 0, peak = 0
  const entered = [], gates = new Map()
  class ConcurrencyAdapter extends LlmAdapter {
    async *stream(options) {
      active++; peak = Math.max(peak, active); entered.push(options.testID)
      try {
        if (options.fail) throw new Error('synthetic-adapter-failure')
        if (!options.immediate) await new Promise(resolve => gates.set(options.testID, resolve))
        yield { type: 'text', text: 'synthetic' }
      } finally { active-- }
    }
  }
  const removeAdapter = ctx.llm.registerAdapter(['qualification-concurrency'], new ConcurrencyAdapter())
  const stream = (testID, extra = {}) => ctx.llm.stream({ provider: 'qualification-concurrency', model: 'synthetic', messages: [],
    testID, ...(testID === 'compact' ? {} : { sessionId: testID }), ...extra })
  report.nativeConcurrency = []
  for (const limit of [1, 2, 3]) {
    await ctx.settings.update('eduwork-concurrency', { maxConcurrentRequests: limit })
    entered.length = 0; gates.clear(); peak = 0
    const ids = ['root-a', 'root-b', 'child-1', 'child-2', 'background-3', 'nested-4', 'workflow-5', 'child-6', 'compact']
    const tasks = ids.map(id => consume(stream(id)))
    await waitForQueue(() => entered.length === limit)
    assert.deepEqual(entered, ids.slice(0, limit))
    for (const id of ids) { await waitForQueue(() => gates.has(id)); gates.get(id)(); await new Promise(resolve => setImmediate(resolve)) }
    await Promise.all(tasks)
    assert.deepEqual(entered, ids); assert.equal(peak, limit); assert.equal(active, 0)
    report.nativeConcurrency.push({ limit, peak, requests: ids.length, fifo: true })
  }
  await ctx.settings.update('eduwork-concurrency', { maxConcurrentRequests: 1 })
  entered.length = 0; gates.clear(); peak = 0
  const cancel = new AbortController()
  const first = consume(stream('active'))
  await waitForQueue(() => entered.length === 1)
  const queued = consume(stream('cancelled', { signal: cancel.signal })); cancel.abort(new Error('synthetic-cancel'))
  await queued.catch(error => assert.match(error.message, /synthetic-cancel/))
  assert.deepEqual(entered, ['active'])
  const second = consume(stream('second')), third = consume(stream('third'))
  await ctx.settings.update('eduwork-concurrency', { maxConcurrentRequests: 2 })
  await waitForQueue(() => entered.length === 2)
  await ctx.settings.update('eduwork-concurrency', { maxConcurrentRequests: 1 })
  gates.get('active')(); await first
  await new Promise(resolve => setImmediate(resolve)); assert.equal(entered.length, 2)
  gates.get('second')(); await second
  await waitForQueue(() => entered.length === 3); gates.get('third')(); await third
  assert.equal(active, 0)
  assert.ok((await consume(stream('failed', { fail: true }))).some(chunk => chunk.type === 'finish' && chunk.reason?.kind === 'error'))
  const early = stream('early', { immediate: true })[Symbol.asyncIterator]()
  await early.next(); await early.return()
  assert.ok((await consume(stream('after', { immediate: true }))).some(chunk => chunk.type === 'text'))
  assert.equal(active, 0)
  report.nativeConcurrency.push({ queuedCancellation: true, liveIncrease: true, liveDecrease: true, errorRelease: true, abandonedStreamRelease: true })
  removeAdapter()
  await ctx.settings.update('chatecnu-brand', { visualStyle: 'ecnu-liwa' })
  await ctx.settings.update('eduwork-concurrency', { maxConcurrentRequests: 2 })
  await ctx.fiber.dispose(); application = undefined
  rows[0].config.product.name = 'Updated synthetic edition'
  ctx = await boot()
  await waitForPresets(['standard', 'ptc', 'cordis'])
  assert.equal(read('chatecnu-brand').value.visualStyle, 'ecnu-liwa')
  assert.equal(read('chatecnu-brand').value.product.name, 'Updated synthetic edition')
  assert.equal(read('eduwork-concurrency').value.maxConcurrentRequests, 2)
  assert.deepEqual(JSON.parse(await readFile(join(home, 'settings.yaml.eduwork-migration'), 'utf8')), legacy)
  assert.equal(await stageLegacySettings(home), null)
  // Exercise the same authenticated JSON wire as the real Client. A service
  // object alone does not prove its declared input/output codecs work.
  const origin = `http://127.0.0.1:${ctx.webServer.port}`
  const login = await fetch(ctx.connection.authenticatedUrl(origin), { redirect: 'manual' })
  await login.body?.cancel()
  assert.equal(login.status, 303)
  const cookie = login.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie)
  const rpc = async (method, args = {}) => {
    const rpcId = randomUUID()
    const response = await fetch(`${origin}/api/${method}`, { method: 'POST',
      headers: { cookie, origin, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }),
    })
    assert.equal(response.status, 200, `${method}: HTTP ${response.status}`)
    const body = await response.json()
    assert.equal(body.type, 'server-response'); assert.equal(body.rpcId, rpcId)
    return body.result
  }
  report.rpc = []
  for (const method of ['oidcAccounts/configuration', 'knowledgeStudio/listCapabilities', 'localMemories/stats',
    ...values['full-product'] ? ['productComponents/list', 'skillManager/list'] : []]) {
    const result = await rpc(method)
    assert.equal(result.ok, true, `${method}: ${JSON.stringify(result.error)}`)
    report.rpc.push(method)
  }
  const invalid = await rpc('localMemories/deleteAll', { confirmation: 42 })
  assert.equal(invalid.ok, false, 'Malformed input must not reach the memory deletion handler')
  report.rpc.push('malformed-input-rejected')
  report.success = true
  report.verified = ['legacy-custom-sections', 'legacy-concurrency-conversion', 'native-validation', 'live-edit', 'restart-persistence', 'original-settings-preserved', 'native-preset-policy', 'disabled-preset-default-recovery']
  if (values.serve) {
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    await writeFile(join(output, 'launch.json'), JSON.stringify({ url: ctx.connection.authenticatedUrl(`http://127.0.0.1:${ctx.webServer.port}`), pid: process.pid }))
    console.log('Synthetic product is ready for interactive qualification; launch URL is in the private output directory.')
    await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve) })
  }
} catch (error) {
  report.error = { message: error.message, stack: error.stack }; process.exitCode = 1
} finally {
  await application?.ctx.fiber.dispose()
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
}
