import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import test from 'node:test'
import { fixture } from './helpers/desktop-fixture.js'

// Set this to the installed frozen package to exercise the same test against a reviewed Host closure.
const moduleURL = process.env.DSH_OIDC_PACKAGE_ROOT
  ? pathToFileURL(join(process.env.DSH_OIDC_PACKAGE_ROOT, 'lib/index.js')) : new URL('../src/host/index.js', import.meta.url)
const require = createRequire(moduleURL)
const { Context, Service } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')))
const { default: LlmRuntime, LlmAdapter } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')))
const { default: OidcAccountService } = await import(moduleURL)
const dshVersion = JSON.parse(await readFile(require.resolve('@deepseek-ai/dsh-llm/package.json'), 'utf8')).version
if (process.env.DSH_OIDC_EXPECT_DSH) assert.equal(dshVersion, process.env.DSH_OIDC_EXPECT_DSH)

async function host(t, records = new Map()) {
  class Credentials extends Service {
    constructor(ctx) { super(ctx, 'credentials') }
    resolve(ref) { return Promise.resolve(records.has(ref) ? { value: records.get(ref) } : undefined) }
    set(ref, value) { records.set(ref, value); this.ctx.emit('credentials/reference-updated', ref); return Promise.resolve() }
    unset(ref) { records.delete(ref); this.ctx.emit('credentials/reference-updated', ref); return Promise.resolve() }
  }
  const ctx = new Context()
  const fibers = []
  t.after(async () => { for (const fiber of fibers.reverse()) await fiber.dispose() })
  fibers.push(await ctx.plugin(Credentials), await ctx.plugin(LlmRuntime))
  return { ctx, fibers }
}

test(`DSH ${dshVersion} Host loads identity-free desktop OIDC without WebServer or browser service`, async t => {
  const { ctx, fibers } = await host(t)
  fibers.push(await ctx.plugin(OidcAccountService, { backend: 'desktop', allowEmptyProfiles: true }))
  assert.equal(ctx.get('webServer'), undefined)
  assert.deepEqual((await ctx.oidcAccounts.configuration()).profiles, [])
  assert.deepEqual((await ctx.oidcAccounts.management()).profiles, [])
  assert.deepEqual(ctx.llm.listProviders(), [])
})

test('file-managed organization settings expose a fallback and reject mutations while retaining sign-in', async t => {
  const { ctx, fibers } = await host(t)
  const configFile = { path: 'C:/EduWork/config/eduwork.jsonc', examplesPath: 'C:/EduWork/config/examples' }
  fibers.push(await ctx.plugin(OidcAccountService, { backend: 'desktop', allowEmptyProfiles: true, manageProductBrand: false, configFile }))
  const configuration = await ctx.oidcAccounts.configuration()
  assert.deepEqual(configuration.configFile, { ...configFile, canOpen: false })
  await assert.rejects(ctx.oidcAccounts.openConfiguration('config'), /不支持直接打开/)
  assert.equal(configuration.manageProductBrand, false)
  assert.equal((await ctx.oidcAccounts.management()).capabilities.manageProfiles, false)
  for (const [method, args] of [['activate', ['x']], ['addCustom', ['https://example.edu']], ['updateCustom', ['x', 'https://example.edu']], ['removeProfile', ['x']], ['configureModels', ['x', 'discovery', []]]]) {
    await assert.rejects(ctx.oidcAccounts[method](...args), /configuration file/)
  }
})

test('managed configuration opens only known native targets and follows service lifecycle', async t => {
  const { ctx, fibers } = await host(t)
  const configFile = { path: 'C:/EduWork/config/eduwork.jsonc', examplesPath: 'C:/EduWork/config/examples' }
  fibers.push(await ctx.plugin(OidcAccountService, { backend: 'desktop', allowEmptyProfiles: true, configFile }))
  const calls = []
  let fail = false
  class DesktopServices extends Service {
    constructor(ctx) { super(ctx, 'desktopServices') }
    async openConfiguration(target) { calls.push(target); if (fail) throw new Error('native command details') }
    openExternal() { return Promise.resolve() }
  }
  let native = await ctx.plugin(DesktopServices)
  assert.equal((await ctx.oidcAccounts.configuration()).configFile.canOpen, true)
  for (const target of ['config', 'examples']) assert.deepEqual(await ctx.oidcAccounts.openConfiguration(target), { opened: true })
  for (const target of ['C:/Windows/system32/cmd.exe', '../config', 'https://example.com', { target: 'config' }, undefined]) {
    await assert.rejects(ctx.oidcAccounts.openConfiguration(target), /只能打开应用配置文件/)
  }
  assert.deepEqual(calls, ['config', 'examples'])
  fail = true
  await assert.rejects(ctx.oidcAccounts.openConfiguration('config'), error => error.message.includes('未能打开') && !error.message.includes('native command'))
  await native.dispose()
  assert.equal((await ctx.oidcAccounts.configuration()).configFile.canOpen, false)
  await assert.rejects(ctx.oidcAccounts.openConfiguration('config'), /不支持直接打开/)
  fail = false
  native = await ctx.plugin(DesktopServices)
  fibers.push(native)
  assert.equal((await ctx.oidcAccounts.configuration()).configFile.canOpen, true)
})

test('unmanaged settings do not expose native configuration opening', async t => {
  const { ctx, fibers } = await host(t)
  let calls = 0
  class DesktopServices extends Service {
    constructor(ctx) { super(ctx, 'desktopServices') }
    openConfiguration() { calls++; return Promise.resolve() }
    openExternal() { return Promise.resolve() }
  }
  fibers.push(await ctx.plugin(DesktopServices), await ctx.plugin(OidcAccountService, { backend: 'desktop', allowEmptyProfiles: true }))
  assert.equal((await ctx.oidcAccounts.configuration()).configFile, undefined)
  await assert.rejects(ctx.oidcAccounts.openConfiguration('config'), /不支持直接打开/)
  assert.equal(calls, 0)
})

test(`DSH ${dshVersion} Host attaches optional browser lifecycle and performs HTTP PKCE without WebServer`, async t => {
  const f = await fixture(t)
  const { ctx, fibers } = await host(t, f.records)
  const events = []
  ctx.on('oidc/accounts-changed', value => events.push(value))
  fibers.push(await ctx.plugin(OidcAccountService, { backend: 'desktop', profile: f.profile, manageProductBrand: false,
    configFile: { path: 'C:/EduWork/config/eduwork.jsonc', examplesPath: 'C:/EduWork/config/examples' } }))
  await assert.rejects(ctx.oidcAccounts.begin(f.profile.id), { code: 'oidc_browser_unavailable' })
  class DesktopServices extends Service {
    constructor(ctx) { super(ctx, 'desktopServices') }
    openExternal(url) { f.opened.push(url); return Promise.resolve() }
  }
  let browser = await ctx.plugin(DesktopServices)
  const begin = await ctx.oidcAccounts.begin(f.profile.id)
  const auth = await fetch(f.opened.at(-1), { redirect: 'manual' })
  assert.equal((await fetch(auth.headers.get('location'))).status, 200)
  assert.equal((await ctx.oidcAccounts.loginStatus(begin.loginID)).state, 'completed')
  assert.equal((await ctx.oidcAccounts.status(f.profile.id)).state, 'connected')
  assert.equal(ctx.get('webServer'), undefined)
  await ctx.oidcAccounts.logout(f.profile.id)
  assert.deepEqual([...f.records.keys()], ['PERSONAL_API_KEY'])
  assert.deepEqual(events.map(value => value.state), ['connected', 'signed_out'])
  const pending = await ctx.oidcAccounts.begin(f.profile.id)
  const callback = new URL(f.opened.at(-1)).searchParams.get('redirect_uri')
  await browser.dispose()
  assert.equal((await ctx.oidcAccounts.loginStatus(pending.loginID)).state, 'cancelled')
  await assert.rejects(fetch(callback))
  await assert.rejects(ctx.oidcAccounts.begin(f.profile.id), { code: 'oidc_browser_unavailable' })
  browser = await ctx.plugin(DesktopServices)
  fibers.push(browser)
  const next = await ctx.oidcAccounts.begin(f.profile.id)
  assert.equal(next.mode, 'external')
  await ctx.oidcAccounts.cancelLogin(next.loginID)
})

test('DSH 0.1.5 desktop HTTP token login connects models and persists a usable default without a session', { skip: !['0.1.5-alpha.1', '0.1.5-rc.1'].includes(dshVersion) }, async t => {
  const { SettingsProvider } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-settings')))
  const { default: AgentDefaultModel } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-agent-default-model')))
  const f = await fixture(t, { resources: true })
  const { ctx, fibers } = await host(t, f.records)
  let saved = { 'personal-preferences': { keep: 'untouched' } }
  class Settings extends SettingsProvider {
    writable = true
    load() { return Promise.resolve(saved) }
    persist(ns, section) { saved = { ...saved, [ns]: structuredClone(section) }; return Promise.resolve() }
  }
  class Browser extends Service {
    constructor(ctx) { super(ctx, 'desktopServices') }
    openExternal(url) { f.opened.push(url); return Promise.resolve() }
  }
  const refs = [], changes = []
  ctx.on('credentials/reference-updated', ref => refs.push(ref))
  ctx.on('settings/updated', () => changes.push(true))
  fibers.push(await ctx.plugin(Settings), await ctx.plugin(AgentDefaultModel, { provider: 'missing-provider', model: 'old-model' }),
    await ctx.plugin(Browser), await ctx.plugin(OidcAccountService, { backend: 'desktop', profile: f.rawProfile, manageProductBrand: false }))
  await assert.rejects(ctx.oidcAccounts.selectEnterpriseModel(f.profile.id), /请先完成企业登录/)
  const begin = await ctx.oidcAccounts.begin(f.profile.id)
  const auth = await fetch(f.opened.at(-1), { redirect: 'manual' })
  assert.equal((await fetch(auth.headers.get('location'))).status, 200)
  assert.equal((await ctx.oidcAccounts.loginStatus(begin.loginID)).status.state, 'connected')
  assert.equal((await ctx.oidcAccounts.status(f.profile.id)).credentialReady, true)
  assert.ok(!f.requests.some(request => /bootstrap|runtime-credential/.test(request.path)))
  const selection = await ctx.oidcAccounts.selectEnterpriseModel(f.profile.id, { onlyIfMissing: true })
  assert.equal(selection.changed, true)
  assert.equal(selection.selection.provider, 'fixture-ai')
  assert.equal(selection.selection.model, 'fixture-model')
  assert.deepEqual(ctx.agentDefaultModel.currentSelection(), selection.selection)
  assert.deepEqual(saved['agent-default-model'], selection.selection)
  assert.deepEqual(saved['personal-preferences'], { keep: 'untouched' })
  assert.equal(f.records.get('PERSONAL_API_KEY'), '<PERSONAL_KEY>')
  assert.ok(refs.includes('DSH_OIDC_DESKTOP_TEST_SESSION'))
  assert.ok(!f.records.has('EDUWORK_API_KEY'))
  assert.ok(changes.length > 0)
  assert.deepEqual(await ctx.oidcAccounts.selectEnterpriseModel(f.profile.id, { onlyIfMissing: true }), { changed: false })

  // An already-signed-in upgrade repairs an unavailable default; it does not
  // require another browser callback, model-key creation, or session.
  await ctx.agentDefaultModel.saveSelection({ provider: 'removed-provider', model: 'old-model' })
  const tokenCalls = f.tokenCalls()
  assert.equal((await ctx.oidcAccounts.selectEnterpriseModel(f.profile.id, { onlyIfMissing: true })).changed, true)
  assert.equal(f.tokenCalls(), tokenCalls)

  const personal = { provider: 'personal', model: 'own-model' }
  class Personal extends LlmAdapter {
    listModels() { return Promise.resolve([{ provider: 'personal', id: 'own-model', name: 'Personal' }]) }
    resolveModel() { return Promise.resolve({ provider: 'personal', id: 'own-model', name: 'Personal' }) }
  }
  const unregister = ctx.llm.registerAdapter(['personal'], new Personal())
  t.after(unregister)
  await ctx.agentDefaultModel.saveSelection(personal)
  assert.deepEqual(await ctx.oidcAccounts.selectEnterpriseModel(f.profile.id, { onlyIfMissing: true }), { changed: false })
  assert.deepEqual(ctx.agentDefaultModel.currentSelection(), personal)
  // Explicit model selection is the user's request to use the enterprise.
  assert.equal((await ctx.oidcAccounts.selectEnterpriseModel(f.profile.id)).changed, true)
  assert.equal(ctx.agentDefaultModel.currentSelection().provider, 'fixture-ai')
})
