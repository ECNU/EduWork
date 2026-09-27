import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { basename, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

// Run the actual Cordis plugin scope. Calling apply(rootContext) directly skips
// scoped dependency lifetime and cannot verify consumer unload behavior.
const repository = resolve(import.meta.dirname, '../../..')
const runtime = resolve(process.env.CHATECNU_TEST_RUNTIME ?? join(repository, 'dist/dsh-cache/runtime-source-development-015-rc1'))
const runtimeParent = pathToFileURL(join(runtime, 'package.json')).href
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@deepseek-ai/')) return nextResolve(specifier, { ...context, parentURL: runtimeParent })
  if (specifier === '@chatecnu-work/dsh-skill-settings-native' || specifier.startsWith('@chatecnu-work/dsh-skill-settings-native/')) {
    const suffix = specifier.endsWith('/policy') ? 'policy.js' : 'index.js'
    return nextResolve(pathToFileURL(join(repository, 'dsh-plugins/skill-settings-native/lib', suffix)).href, context)
  }
  return nextResolve(specifier, context)
} })
const [{ Context, Service }, { SkillRegistry }, { SettingsProvider }, { CredentialProvider, credentialRef }, skillSettings, skillControl] = await Promise.all([
  import('@deepseek-ai/cordis'), import('@deepseek-ai/dsh-skill'), import('@deepseek-ai/dsh-settings'),
  import('@deepseek-ai/dsh-credentials'), import('../../skill-settings-native/lib/index.js'), import('../lib/index.js'),
])

class MemorySettings extends SettingsProvider {
  constructor(ctx) { super(ctx); this.document = {} }
  get writable() { return true }
  async load() { return structuredClone(this.document) }
  async persist(ns, section) { this.document[String(ns)] = structuredClone(section) }
}
class MemoryCredentials extends CredentialProvider {
  constructor(ctx) { super(ctx); this.refs = new Set() }
  async resolve(ref) { return this.refs.has(String(ref)) ? { value: 'synthetic', source: 'memory' } : undefined }
  async describe(ref) { return { configured: this.refs.has(String(ref)), source: 'memory', writable: true } }
  async set(ref) { this.refs.add(String(ref)); this.notifyUpdated(ref) }
  async unset(ref) { this.refs.delete(String(ref)); this.notifyUpdated(ref) }
}

async function eventually(read, expected) {
  let actual
  for (let attempt = 0; attempt < 40; attempt++) {
    actual = await read()
    if (JSON.stringify(actual) === JSON.stringify(expected)) return
    await delay(10)
  }
  assert.deepEqual(actual, expected)
}

test('real Host follows optional Shared attachment, provider/credential changes, disablement and unload', async () => {
  const marker = JSON.parse(await readFile(join(runtime, '.chatecnu-dsh-runtime.json'), 'utf8'))
  assert.equal(marker.dshVersion, process.env.CHATECNU_EXPECT_DSH ?? '0.1.5-rc.1', 'This regression must run on the declared release candidate Host')
  const root = await mkdtemp(join(tmpdir(), 'eduwork-skill-host-'))
  const previous = { home: process.env.DSH_HOME, agents: process.env.DSH_AGENTS_HOME }
  process.env.DSH_HOME = join(root, 'home')
  process.env.DSH_AGENTS_HOME = join(root, 'agents')
  const ctx = new Context()
  let imageCalls = 0
  let available = false
  let deferred
  class SharedFixture extends Service {
    constructor(scope) {
      super(scope, 'artifactServices')
      this.images = { list: async () => {
        imageCalls += 1
        if (deferred) return deferred.promise
        return [{ id: 'generic-fixture', available }]
      } }
    }
  }
  try {
    const skills = join(root, 'skills')
    for (const [name, metadata] of [
      ['artifact-documents', ''], ['knowledge-studio', ''],
      ['artifact-images', 'metadata:\n  artifact:\n    capability: image-generation\n'],
      ['institution-search', 'metadata:\n  chatecnu:\n    credentialRef: TEST_INSTITUTION_KEY\n'],
    ]) {
      const directory = join(skills, name)
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: Synthetic ${name} lifecycle fixture.\n${metadata}---\nTest fixture only.\n`)
    }
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(MemorySettings)
    await ctx.plugin(MemoryCredentials)
    await ctx.plugin(skillSettings)
    const controlled = ctx.plugin(skillControl, { skillDir: skills })
    await controlled
    const names = async () => (await ctx.skills.list({ cwd: root })).map(row => row.name).sort()
    const publicOnly = ['artifact-documents', 'knowledge-studio']
    const withImage = ['artifact-documents', 'artifact-images', 'knowledge-studio']
    const all = ['artifact-documents', 'artifact-images', 'institution-search', 'knowledge-studio']
    await eventually(names, publicOnly) // Public products need no Shared package.

    let shared = ctx.plugin(SharedFixture)
    await shared
    await eventually(names, publicOnly)
    available = true
    ctx.emit('artifact-services/images-changed')
    await eventually(names, withImage) // An already cached catalog follows live provider readiness.
    assert.ok(imageCalls > 0)

    await ctx.credentials.set(credentialRef('TEST_INSTITUTION_KEY'), 'synthetic')
    await eventually(names, all)
    await ctx.settings.update(skillSettings.SETTINGS_NAMESPACE, { disabled: ['ecnu-imagegen'] })
    await eventually(names, ['artifact-documents', 'institution-search', 'knowledge-studio'])
    await ctx.settings.update(skillSettings.SETTINGS_NAMESPACE, { disabled: [] })
    await eventually(names, all)

    available = false
    ctx.emit('artifact-services/images-changed')
    await eventually(names, ['artifact-documents', 'institution-search', 'knowledge-studio'])
    await ctx.credentials.unset(credentialRef('TEST_INSTITUTION_KEY'))
    await eventually(names, publicOnly)
    available = true
    ctx.emit('artifact-services/images-changed')
    await eventually(names, withImage)

    await shared.dispose()
    await eventually(names, publicOnly) // Detaching the optional service invalidates cached visibility.
    shared = ctx.plugin(SharedFixture)
    await shared
    await eventually(names, withImage) // Reattaching does not need a synthetic change event.

    // A pending old-provider response must not resurrect the image skill after
    // its service has disappeared, even when it completes with available:true.
    deferred = Promise.withResolvers()
    const before = imageCalls
    ctx.emit('artifact-services/images-changed')
    const inFlight = names()
    await eventually(async () => imageCalls > before, true)
    await shared.dispose()
    deferred.resolve([{ id: 'stale-fixture', available: true }])
    assert.deepEqual(await inFlight, publicOnly)
    deferred = undefined
    await eventually(names, publicOnly)
    await controlled.dispose()
    assert.deepEqual(await names(), [])
    console.log(JSON.stringify({ dshVersion: marker.dshVersion, dshCommit: marker.dshCommit,
      runtimeLockSHA256: marker.sourceInstallLockSHA256, optionalServiceLifecycle: true, imageCalls }))
  } finally {
    await ctx.fiber.dispose()
    if (previous.home === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous.home
    if (previous.agents === undefined) delete process.env.DSH_AGENTS_HOME
    else process.env.DSH_AGENTS_HOME = previous.agents
    const target = resolve(root)
    assert.ok(target.startsWith(resolve(tmpdir()) + sep) && basename(target).startsWith('eduwork-skill-host-'))
    await rm(target, { recursive: true, force: true })
  }
})

test.after(() => hooks.deregister())

for (const bindURL of [false, true]) test(`real skill registry follows ${bindURL ? 'endpoint' : 'account'} authorization and login events without requiring the old shared key`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-skill-binding-'))
  const ctx = new Context()
  let matching = false
  try {
    const skills = join(root, 'skills'), directory = join(skills, 'institution-search')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'SKILL.md'), '---\nname: institution-search\ndescription: Synthetic binding check.\nmetadata:\n  eduwork:\n    credentialRef: EDUWORK_API_KEY\n    oidcProfileId: campus-a\n' + (bindURL ? '    runtimeBaseURL: https://a.example/v1\n' : '') + '---\nSynthetic only.\n')
    await ctx.plugin(SkillRegistry); await ctx.plugin(MemorySettings); await ctx.plugin(MemoryCredentials); await ctx.plugin(skillSettings)
    ctx.provide('oidcAccounts', { modelAuthorization: async (id, expectedBaseURL) => {
      assert.equal(bindURL, true)
      assert.equal(id, 'campus-a')
      assert.equal(expectedBaseURL, 'https://a.example/v1')
      return matching
    }, status: async id => {
      assert.equal(bindURL, false)
      assert.equal(id, 'campus-a')
      return { profileID: id, state: matching ? 'connected' : 'signed_out', credentialReady: matching }
    } })
    await ctx.plugin(skillControl, { skillDir: skills })
    const names = async () => (await ctx.skills.list({ cwd: root })).filter(row => row.name === 'institution-search').map(row => row.name)
    await ctx.credentials.set(credentialRef('EDUWORK_API_KEY'), 'unrelated')
    await eventually(names, [])
    matching = true
    ctx.emit('oidc/accounts-changed', { profileID: 'campus-a', state: 'connected' })
    await eventually(names, ['institution-search'])
    matching = false
    ctx.emit('oidc/accounts-changed', { profileID: 'campus-a', state: 'signed_out' })
    await eventually(names, [])
  } finally {
    await ctx.fiber.dispose()
    const target = resolve(root)
    assert.ok(target.startsWith(resolve(tmpdir()) + sep) && basename(target).startsWith('eduwork-skill-binding-'))
    await rm(target, { recursive: true, force: true })
  }
})
