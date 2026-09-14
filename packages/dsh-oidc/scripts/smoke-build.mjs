import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'

await import('../lib/index.js')
await import('../lib/typert.host.js')
await import('../lib/provider/index.js')

const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
if (!client.includes('window.__ModuleLoader__.load') || !client.includes('id: "@eduwork/dsh-oidc"')) {
  throw new Error('lib/client.js does not contain the expected DSH module-loader wrapper')
}

// Exercise the compiled client registration and its actual service adapter. This
// catches UI buttons whose Remote descriptor exists but whose wrapper is missing.
const require = createRequire(import.meta.url)
let exports
runInNewContext(client, {
  window: { __ModuleLoader__: { load: definition => { exports = definition.factory(require) } } },
  navigator: { language: 'zh-CN' }, console,
})
const calls = []
const registrations = []
const events = new Map(), localEvents = new Map()
const profile = { id: 'example', displayName: 'Example school', organization: 'Example school', brand: {},
  provider: { id: 'example-ai', displayName: 'Example AI', models: [{ name: 'Example model' }] } }
let account = { profileID: 'example', state: 'signed_out', credentialReady: false }
const identity = { ...account, state: 'authenticated', userName: 'Synthetic user' }
const connected = { ...identity, state: 'connected', credentialReady: true }
const activations = [], sessionSelections = []
let currentSession = null
const ctx = {
  remote: {
    $mount: async () => () => {},
    $on: (event, listener) => { events.set(event, listener); return () => events.delete(event) },
    oidcAccounts: {
      configuration: async () => ({ ok: true, value: { uiMode: 'standard', profiles: [profile], manageProductBrand: false,
        configFile: { path: 'C:/EduWork/config/eduwork.jsonc', examplesPath: 'C:/EduWork/config/examples', canOpen: true } } }),
      openConfiguration: async target => { calls.push(target); return { ok: true, value: { opened: true } } },
      status: async () => ({ ok: true, value: account }),
      begin: async () => ({ ok: true, value: { mode: 'external', loginID: 'example-attempt' } }),
      loginStatus: async () => ({ ok: true, value: { state: 'completed', status: account } }),
      reconcile: async () => { account = connected; return { ok: true, value: account } },
      logout: async () => { account = { ...account, state: 'signed_out', credentialReady: false, userName: undefined }; return { ok: true, value: account } },
      selectEnterpriseModel: async (...args) => { activations.push(args); return { ok: true, value: { changed: true, selection: { provider: 'example-ai', model: 'example-model' } } } },
    },
  },
  on: (event, listener) => { localEvents.set(event, listener); return () => localEvents.delete(event) },
  get: name => name === 'sessions' ? { list: { getSnapshot: () => ({ current: currentSession }) }, subagentAddress: () => undefined }
    : name === 'modelDirectories' ? { directoryFor: id => ({ select: async selection => sessionSelections.push({ id, selection }) }) } : undefined,
  inject: (_names, callback) => callback(ctx),
  slots: { inject: (_name, callback) => callback(), register: (definition, component) => { registrations.push({ ...definition, component }); return () => {} } },
  effect: () => {},
}
await exports.apply(ctx)
await new Promise(resolve => setImmediate(resolve))
const settings = registrations.find(item => item.name === 'settings.models.footer')?.inject()
assert.ok(settings, 'compiled client did not register organization settings')
for (const target of ['config', 'examples']) assert.deepEqual(await settings.service.openConfiguration(target), { opened: true })
assert.deepEqual(calls, ['config', 'examples'])

// Render the real compiled components against their shared store. A component
// keeping a mount-only local status (the original defect) cannot pass these.
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const view = name => {
  const registration = registrations.find(item => item.name === name)
  assert.equal(registration.inject().service, settings.service)
  return renderToStaticMarkup(React.createElement(registration.component, registration.inject()))
}
assert.match(view('sidebar.footer.action'), /点击设置完成登录/)
await settings.service.begin('example')
account = identity
await settings.service.loginStatus('example-attempt')
assert.match(view('sidebar.footer.action'), /Synthetic user/)
assert.match(view('sidebar.footer.action'), /等待创建模型凭据/)
assert.match(view('settings.onboarding'), /确认创建模型凭据/)
assert.equal(activations.length, 0)
await settings.service.reconcile('example', { allowProvision: true })
assert.match(view('sidebar.footer.action'), /企业模型已连接/)
assert.match(view('settings.general.item'), /Synthetic user/)
assert.equal(view('settings.onboarding'), '')
// Seed the component's first local state (useAccount.busy) through the real
// React renderer. A connected credential can be published while selecting the
// default model is still pending; that intermediate render must stay modal.
const originalUseState = React.useState
let stateIndex = 0
try {
  React.useState = initial => originalUseState(stateIndex++ === 0 ? 'provision' : initial)
  const pendingOnboarding = view('settings.onboarding')
  assert.match(pendingOnboarding, /role="dialog"/)
  assert.match(pendingOnboarding, /正在连接/)
  assert.doesNotMatch(pendingOnboarding, /<button(?![^>]*disabled)/, 'pending model selection must disable every onboarding action')
} finally { React.useState = originalUseState }
assert.equal(view('settings.onboarding'), '', 'the dialog may disappear once the model operation completes')
assert.equal(activations.length, 1, 'a first login on the empty landing page must save a future default')
assert.equal(activations[0][1].onlyIfMissing, false)
assert.equal(sessionSelections.length, 0)
currentSession = 'session-1'
await settings.service.reconcile('example', { allowProvision: true })
assert.equal(sessionSelections[0].id, 'session-1')
const explicitActivations = activations.length
await events.get('credentials/reference-updated')('EXAMPLE_API_KEY')
await localEvents.get('connection/reset')()
assert.equal(activations.length, explicitActivations, 'passive refresh must not override a later personal model')
await settings.service.logout('example')
assert.match(view('sidebar.footer.action'), /点击设置完成登录/)

console.log('Host exports, compiled client slots, shared login state, default/current model selection, forwarded events and native configuration Remote passed.')
