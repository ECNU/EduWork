// Browser fixture for the actual compiled plugin, not a duplicate menu.
const profile = { id: 'example', displayName: '示例大学', organization: '示例大学', brand: { mark: 'E' },
  provider: { id: 'example-ai', displayName: 'Example AI', models: [{ name: 'Example model' }] } }
const connected = { profileID: profile.id, state: 'connected', credentialReady: true, userName: 'Synthetic user' }
const params = new URLSearchParams(location.search)
if (params.has('customLogin')) Object.assign(profile.brand, {
  loginTitle: '示例大学统一身份认证', loginButtonLabel: '统一认证登录', loginDescription: '使用学校账号连接校内服务。',
})
let onboarding = params.has('onboarding'), account = onboarding ? { profileID: profile.id, state: 'signed_out', credentialReady: false } : connected, modelReads = 0
const registrations = [], events = new Map()
const ok = value => Promise.resolve({ ok: true, value })
const ctx = {
  remote: {
    $mount: async () => () => {}, $on: (event, listener) => { events.set(event, listener); return () => events.delete(event) },
    oidcAccounts: {
      configuration: () => ok({ uiMode: 'standard', profiles: [profile], manageProductBrand: false }),
      status: () => ok(account), selectEnterpriseModel: () => ok({ changed: false }),
      reconcile: () => ok(account),
      resources: async () => { modelReads++; return ok({ profileID: profile.id, modelSource: 'profile', models: [], issues: [] }) },
      logout: () => { account = { profileID: profile.id, state: 'signed_out', credentialReady: false }; return ok(account) },
      begin: () => ok({ mode: 'external', loginID: 'test' }),
      loginStatus: () => ok({ state: 'completed', status: account }), cancelLogin: () => ok({ state: 'cancelled' }),
    },
  },
  on: () => () => {}, get: () => undefined,
  inject: (_names, callback) => callback(ctx),
  slots: { inject: (_name, callback) => callback(), register: (definition, component) => { registrations.push({ ...definition, component }); return () => {} } },
  effect: () => {},
}
window.__ModuleLoader__ = { load: definition => {
  const plugin = definition.factory(name => {
    if (name === 'react') return window.React
    if (name === 'react-dom') return window.ReactDOM
    throw new Error('Unexpected module ' + name)
  })
  void plugin.apply(ctx).then(() => setTimeout(() => {
    const footer = registrations.find(item => item.name === 'sidebar.footer.action')
    const general = registrations.find(item => item.name === 'settings.general.item')
    const welcome = registrations.find(item => item.name === 'settings.onboarding')
    const root = ReactDOM.createRoot(document.getElementById('root'))
    const render = wide => root.render(React.createElement(React.Fragment, null,
      onboarding && React.createElement(welcome.component, { ...welcome.inject(), complete: () => { onboarding = false; render(wide) } }),
      React.createElement('aside', { style: { position: 'fixed', left: 0, bottom: 0, width: wide ? 240 : 48, overflow: 'hidden', padding: 4 } }, React.createElement(footer.component, { ...footer.inject(), wide })),
      React.createElement('main', { id: 'general', style: { margin: '20px 260px' } }, React.createElement(general.component, general.inject())),
      React.createElement('button', { id: 'outside', style: { position: 'fixed', top: 20, right: 20 } }, 'Outside')))
    window.fixture = {
      render,
      modelReads: () => modelReads,
      reconnect: async () => { account = connected; await footer.inject().service.status(profile.id) },
    }
    render(true)
  }, 0))
} }
