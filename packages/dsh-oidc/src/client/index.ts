import React, { useEffect, useState } from 'react'
import oidcRemote from './remote.js'
import { accountOrganization, accountStatusLine, accountUserName } from './presentation.js'
import { ManagedProviderCard } from './managed-provider.js'
import { useSignIn } from './use-sign-in.js'
import { useAccountStatus } from './use-account-status.js'
import { createAccountState, selectConnectedModel } from './account-state.js'
import { AccountMenu } from './account-menu.js'

export const inject = ['slots', 'remote', 'theme']

const h = React.createElement
const enterpriseBrandPriority = -100
const border = 'var(--dsw-alias-border-l2, #e5d4cc)'
const button = Object.freeze({
  border: `1px solid ${border}`, borderRadius: 9, padding: '8px 12px', cursor: 'pointer',
  background: 'var(--dsw-alias-bg-layer-1, #fff)', color: 'var(--dsw-alias-label-primary, #241a18)',
})
const isChinese = typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh')
const messages = isChinese ? {
  waiting: '请在浏览器中完成登录…', cancelLogin: '取消登录',
  identityDescription: '使用组织账号登录。模型服务可在设置中单独配置。', identityConnected: '组织身份已登录',
  unavailable: '企业模型服务暂时不可用', connected: '已连接',
  disconnected: '尚未连接', description: '使用组织统一身份认证连接企业模型。密码不会进入 DSH；模型请求使用登录授权。',
  connecting: '正在连接…', login: '使用企业账号登录',
  checking: '正在检查…', check: '检查连接', logout: '退出登录', help: '帮助', dialog: '连接企业模型',
  shortDescription: '通过组织统一身份认证连接企业模型；密码不会进入 DSH。', other: '使用其他模型',
  enabled: '完成后将启用', footerConnected: '企业模型已连接', footerSetup: '点击设置完成登录',
} : {
  waiting: 'Complete sign-in in your browser…', cancelLogin: 'Cancel sign-in',
  identityDescription: 'Sign in with your organization account. Configure model services separately in settings.', identityConnected: 'Organization identity connected',
  unavailable: 'Enterprise model service is temporarily unavailable', connected: 'Connected',
  disconnected: 'Not connected',
  description: 'Connect with your organization account. Your password never enters DSH; model requests use your sign-in authorization.',
  connecting: 'Connecting…', login: 'Sign in with organization',
  checking: 'Checking…', check: 'Check connection', logout: 'Sign out', help: 'Help', dialog: 'Connect enterprise models',
  shortDescription: 'Connect enterprise models through your organization identity provider. Your password never enters DSH.',
  other: 'Use another model', enabled: 'This enables', footerConnected: 'Enterprise models connected',
  footerSetup: 'Open settings to connect',
}

async function unwrap(operation: Promise<any>) {
  const result = await operation
  if (result?.ok === true) return result.value
  throw new Error(result?.error?.message || result?.error?.code || messages.unavailable)
}

function ProductMark({ profile, size = 24 }: any) {
  const brand = profile.brand ?? {}
  if (brand.logoURL) return h('img', { src: brand.logoURL, width: size, height: size, alt: '', referrerPolicy: 'no-referrer', style: { display: 'block', objectFit: 'contain', borderRadius: 5 } })
  return h('span', {
    'aria-hidden': 'true',
    style: {
      display: 'grid', placeItems: 'center', width: size, height: size, borderRadius: Math.max(5, Math.round(size * .18)),
      background: brand.primaryColor || 'var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4d6bfe)', color: 'white', fontSize: Math.max(11, Math.round(size * .52)), fontWeight: 750,
    },
  }, brand.mark || accountOrganization(profile).slice(0, 1))
}

function ProductName({ profile }: any) {
  return h('span', { style: { fontWeight: 650, fontSize: 15, whiteSpace: 'nowrap' } }, profile.brand?.productName || profile.displayName)
}

function installBrand(ctx: any, profile: any) {
  const brand = profile.brand ?? {}
  if (Object.keys(brand).length === 0) return () => {}
  const productName = brand.productName || profile.displayName
  const previousTitle = document.title
  document.title = productName
  let clearTokens = () => {}
  if (brand.primaryColor) {
    const pair = (light: string, dark: string) => ({ light, dark })
    clearTokens = ctx.theme.overrideTokens('dsh-oidc', {
      '--dsw-alias-brand-primary': pair(brand.primaryColor, brand.primaryColor),
      '--dsw-alias-brand-primary-new-colorprimary-new-color': pair(brand.primaryColor, brand.primaryColor),
      '--dsw-alias-button-primary-fill': pair(brand.primaryColor, brand.primaryColor),
      '--dsw-alias-state-business-primary': pair(brand.primaryColor, brand.primaryColor),
      '--dsw-alias-label-primary-bluish': pair(brand.primaryColor, brand.primaryColor),
    })
  }
  const effects = [
    ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({ name: 'sidebar.brand.mark', priority: enterpriseBrandPriority, inject: () => ({ profile }) }, ProductMark)),
    ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({ name: 'sidebar.brand.name', priority: enterpriseBrandPriority, inject: () => ({ profile }) }, ProductName)),
    ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({ name: 'conversation.hero.brand.mark', priority: enterpriseBrandPriority, inject: () => ({ profile }) }, ProductMark)),
  ]
  return () => {
    for (const dispose of effects.reverse()) dispose?.()
    clearTokens()
    if (document.title === productName) document.title = previousTitle
  }
}

function useAccount(service: any, profileID: string) {
  const status = useAccountStatus(service, profileID)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { let active = true; service.status(profileID).catch((cause: any) => { if (active) setError(cause?.message || String(cause)) }); return () => { active = false } }, [service, profileID])
  const run = async (name: string, operation: () => Promise<any>) => {
    setBusy(name); setError('')
    try { await operation() }
    catch (cause: any) { setError(cause?.message || String(cause)) }
    finally { setBusy('') }
  }
  return { status, busy, error, run }
}

function EnterpriseAccountCard({ service, configuration }: any) {
  const [profileID, setProfileID] = useState(configuration.profiles[0]?.id || '')
  const profile = configuration.profiles.find((candidate: any) => candidate.id === profileID) || configuration.profiles[0]
  const account = useAccount(service, profile.id)
  const primary = { ...button, background: profile.brand?.primaryColor || 'var(--dsw-alias-brand-primary, #5157af)', color: 'white', borderColor: 'transparent' }
  const login = useSignIn(service)
  const begin = () => account.run('login', () => login.begin(profile.id))
  const stateLabel = account.status?.state === 'connected' ? messages.connected : messages.disconnected
  const userName = accountUserName(account.status)
  return h('section', { style: { padding: '16px 0', borderBottom: `1px solid ${border}` } },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' } },
      h('div', { style: { display: 'flex', gap: 10, minWidth: 0 } },
        h(ProductMark, { profile, size: 36 }),
        h('div', null,
          h('strong', { style: { display: 'block', fontSize: 14 } }, userName || profile.displayName),
          h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12 } }, accountStatusLine(profile, stateLabel, userName)))),
      configuration.profiles.length > 1 && h('select', { value: profile.id, onChange: (event: any) => setProfileID(event.currentTarget.value), style: button },
        ...configuration.profiles.map((candidate: any) => h('option', { key: candidate.id, value: candidate.id }, candidate.displayName)))),
    h('p', { style: { margin: '12px 0 0', color: 'var(--dsw-alias-label-secondary)', fontSize: 12, lineHeight: 1.6 } },
      profile.brand?.loginDescription || (profile.provider ? messages.description : messages.identityDescription)),
    h('div', { style: { marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' } },
      account.status?.state !== 'connected' && h('button', { type: 'button', disabled: Boolean(account.busy), style: primary, onClick: begin }, account.busy ? messages.connecting : profile.brand?.loginButtonLabel || messages.login),
      account.status?.state === 'connected' && h('button', {
        type: 'button', disabled: Boolean(account.busy), style: button,
        onClick: () => account.run('reconcile', () => service.reconcile(profile.id, {})),
      }, account.busy ? messages.checking : messages.check),
      account.status?.state !== 'signed_out' && h('button', {
        type: 'button', disabled: Boolean(account.busy), style: button,
        onClick: () => account.run('logout', () => service.logout(profile.id)),
      }, messages.logout),
      profile.brand?.supportURL && h('a', { href: profile.brand.supportURL, target: '_blank', rel: 'noopener noreferrer', style: { ...button, textDecoration: 'none' } }, messages.help)),
    login.pending && h('p', { role: 'status' }, messages.waiting, ' ', h('button', { type: 'button', style: button, onClick: login.cancel }, messages.cancelLogin)),
    account.error && h('p', { role: 'alert', style: { margin: '10px 0 0', color: '#a82332', fontSize: 12 } }, account.error),
    h('p', { style: { margin: '10px 0 0', color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 } },
      profile.provider ? `${profile.provider.displayName} · ${profile.provider.models.map((model: any) => model.name).join('、')}` : messages.other))
}

function EnterpriseOnboarding({ service, configuration, complete }: any) {
  const profile = configuration.profiles[0]
  const account = useAccount(service, profile.id)
  useEffect(() => { if (account.status?.state === 'connected' && !account.busy && !account.error) complete() }, [account.status?.state, account.busy, account.error, complete])
  const login = useSignIn(service)
  if (account.status === null || (account.status?.state === 'connected' && !account.busy && !account.error)) return null
  const primary = { ...button, background: profile.brand?.primaryColor || 'var(--dsw-alias-brand-primary, #5157af)', color: 'white', borderColor: 'transparent' }
  const begin = () => account.run('login', () => login.begin(profile.id))
  return h('div', {
    style: { position: 'fixed', inset: 0, zIndex: 10000, display: 'grid', placeItems: 'center', padding: 24, background: 'rgba(28, 24, 23, .32)', backdropFilter: 'blur(4px)', boxSizing: 'border-box' },
  }, h('section', {
    role: 'dialog', 'aria-modal': 'true', 'aria-label': profile.brand?.loginTitle || messages.dialog,
    style: { boxSizing: 'border-box', width: 'min(540px, 100%)', maxHeight: 'calc(100vh - 48px)', overflow: 'auto', border: `1px solid ${border}`, borderRadius: 16, padding: 26, background: 'var(--dsw-alias-bg-layer-1, #fff)', color: 'var(--dsw-alias-label-primary, #241a18)', boxShadow: '0 24px 80px rgba(42, 28, 24, .22)' },
  },
  h('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
    h(ProductMark, { profile, size: 40 }),
    h('div', null,
      h('h2', { style: { margin: 0, fontSize: 20, fontWeight: 650 } }, profile.brand?.loginTitle || messages.dialog),
      h('div', { style: { marginTop: 3, color: 'var(--dsw-alias-label-secondary)', fontSize: 12 } }, accountOrganization(profile)))),
  h('p', { style: { margin: '18px 0 0', color: 'var(--dsw-alias-label-secondary)', fontSize: 13, lineHeight: 1.7 } },
    profile.brand?.loginDescription || (profile.provider ? messages.shortDescription : messages.identityDescription)),
  h('div', { style: { marginTop: 20, display: 'flex', gap: 9, flexWrap: 'wrap' } },
    h('button', { type: 'button', disabled: Boolean(account.busy), style: primary, onClick: account.status?.state === 'connected' ? () => account.run('select', () => service.useModels(profile.id)) : begin }, account.busy ? messages.connecting : account.status?.state === 'connected' ? (isChinese ? '使用企业模型' : 'Use organization model') : profile.brand?.loginButtonLabel || messages.login),
    h('button', { type: 'button', disabled: Boolean(account.busy), style: button, onClick: complete }, messages.other)),
  login.pending && h('p', { role: 'status' }, messages.waiting, ' ', h('button', { type: 'button', style: button, onClick: login.cancel }, messages.cancelLogin)),
  account.error && h('p', { role: 'alert', style: { margin: '12px 0 0', color: '#a82332', fontSize: 12 } }, account.error),
  h('p', { style: { margin: '16px 0 0', color: 'var(--dsw-alias-label-tertiary)', fontSize: 11, lineHeight: 1.55 } },
    profile.provider ? `${messages.enabled} ${profile.provider.displayName}: ${profile.provider.models.map((model: any) => model.name).join('、')}` : messages.other)))
}

function FooterAccount({ service, configuration, renderSlot, wide = true }: any) {
  const profile = configuration.profiles[0]
  const status = useAccountStatus(service, profile.id)
  const userName = accountUserName(status)
  const statusLabel = status?.state === 'connected' ? (profile.provider ? messages.footerConnected : messages.identityConnected) : messages.footerSetup
  return h(AccountMenu, { service, profile, renderSlot, wide }, h('div', { style: { display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 } },
    h(ProductMark, { profile, size: 28 }),
    wide && h('div', { style: { minWidth: 0 } },
      h('div', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 600 } }, userName || accountOrganization(profile)),
      h('div', { style: { fontSize: 10, color: 'var(--dsw-alias-label-tertiary)' } }, accountStatusLine(profile, statusLabel, userName)))))
}

export async function apply(ctx: any) {
  const disposeRemote = await ctx.remote.$mount(oidcRemote)
  ctx.inject(['remote.oidcAccounts'], (surfaceCtx: any) => {
    let cancelled = false
    let disposeBrand = () => {}
    const disposers: Array<() => void> = []
    const base = {
      configuration: () => unwrap(surfaceCtx.remote.oidcAccounts.configuration()),
      openConfiguration: (target: 'config' | 'examples') => unwrap(surfaceCtx.remote.oidcAccounts.openConfiguration(target)),
      status: (profileID: string) => unwrap(surfaceCtx.remote.oidcAccounts.status(profileID)),
      resources: (profileID: string) => unwrap(surfaceCtx.remote.oidcAccounts.resources(profileID)),
      begin: (profileID: string) => unwrap(surfaceCtx.remote.oidcAccounts.begin(profileID)),
      loginStatus: (loginID: string) => unwrap(surfaceCtx.remote.oidcAccounts.loginStatus(loginID)),
      cancelLogin: (loginID: string) => unwrap(surfaceCtx.remote.oidcAccounts.cancelLogin(loginID)),
      reconcile: (profileID: string, options: any) => unwrap(surfaceCtx.remote.oidcAccounts.reconcile(profileID, options)),
      selectEnterpriseModel: (profileID: string, options: any) => unwrap(surfaceCtx.remote.oidcAccounts.selectEnterpriseModel(profileID, options)),
      logout: (profileID: string) => unwrap(surfaceCtx.remote.oidcAccounts.logout(profileID)),
      management: () => unwrap(surfaceCtx.remote.oidcAccounts.management()),
      activate: (profileID: string) => unwrap(surfaceCtx.remote.oidcAccounts.activate(profileID)),
      configure: (profileID: string) => unwrap(surfaceCtx.remote.oidcAccounts.configure(profileID)),
      addCustom: (baseURL: string) => unwrap(surfaceCtx.remote.oidcAccounts.addCustom(baseURL)),
      updateCustom: (profileID: string, baseURL: string) => unwrap(surfaceCtx.remote.oidcAccounts.updateCustom(profileID, baseURL)),
      removeProfile: (profileID: string) => unwrap(surfaceCtx.remote.oidcAccounts.removeProfile(profileID)),
      configureModels: (profileID: string, modelMode: string, models: any[]) => unwrap(surfaceCtx.remote.oidcAccounts.configureModels(profileID, modelMode, models)),
      restart: () => unwrap(surfaceCtx.remote.oidcAccounts.restart()),
    }
    const accounts = createAccountState(base, { connected: (profileID: string) => selectConnectedModel(surfaceCtx, base, profileID) })
    const service = accounts.service
    service.configuration().then((configuration: any) => {
      if (cancelled || configuration.uiMode === 'external') return
      const ids = configuration.profiles.map((profile: any) => profile.id)
      const refreshAccounts = () => service.refreshAccounts(ids)
      if (typeof surfaceCtx.remote.$on === 'function') disposers.push(surfaceCtx.remote.$on('credentials/reference-updated', refreshAccounts))
      if (typeof surfaceCtx.on === 'function') disposers.push(surfaceCtx.on('connection/reset', refreshAccounts))
      // Upgrade recovery is conditional and runs once. Routine events never
      // select a model or override a later personal-model choice.
      void refreshAccounts().then(async () => {
        if (cancelled) return
        const connected = configuration.profiles.find((profile: any) => profile.provider && service.accountSnapshot(profile.id)?.credentialReady)
        if (connected) await selectConnectedModel(surfaceCtx, base, connected.id, true)
      }).catch(() => {})
      disposers.push(surfaceCtx.slots.inject('settings.models.footer', () => surfaceCtx.slots.register({
        name: 'settings.models.footer', id: 'dsh-oidc-enterprise', order: -100,
        inject: () => ({ service, configuration }),
      }, ManagedProviderCard)))
      if (configuration.uiMode === 'models-only' || configuration.profiles.length === 0) return
      if (configuration.manageProductBrand !== false) disposeBrand = installBrand(surfaceCtx, configuration.profiles[0])
      disposers.push(surfaceCtx.slots.inject('settings.onboarding', () => surfaceCtx.slots.register({
        name: 'settings.onboarding', id: 'dsh-oidc-enterprise', order: -10,
        inject: () => ({ service, configuration }),
      }, EnterpriseOnboarding)))
      disposers.push(surfaceCtx.slots.inject('sidebar.footer.action', () => surfaceCtx.slots.register({
        name: 'sidebar.footer.action', id: 'dsh-oidc-account', order: -90,
        children: { 'oidc.account.menu.details': { kind: 'single', scope: 'root' } },
        inject: () => ({ service, configuration }),
      }, FooterAccount)))
      disposers.push(surfaceCtx.slots.inject('settings.general.item', () => surfaceCtx.slots.register({
        name: 'settings.general.item', id: 'dsh-oidc-account', order: 10,
        inject: () => ({ service, configuration }),
      }, EnterpriseAccountCard)))
    }).catch((cause: any) => { console.error('dsh-oidc client initialization failed', cause) })
    surfaceCtx.effect(() => () => {
      cancelled = true
      accounts.dispose()
      for (const dispose of disposers.reverse()) dispose?.()
      disposeBrand()
    }, 'dsh-oidc: client surfaces')
  })
  return async () => { await disposeRemote() }
}
