import React, { useSyncExternalStore } from 'react'
import { normalizeVisualStyle, tokensForVisualStyle } from '../theme.js'
import { genericMarkSVG, productIdentity } from '../identity.js'
import { bindDesktopAction, DesktopSettingsTrigger } from './desktop-actions.js'

export const inject = ['slots', 'theme', 'connection', 'remote', 'settingsScope']

const h = React.createElement
const SETTINGS_NAMESPACE = 'chatecnu-brand'
const TOKEN_SOURCE = '@chatecnu-work/dsh-client-ui-branding'
const choices = Object.freeze([
  { id: 'dsh', description: '清爽的蓝灰视觉。', colors: ['#f6f8fb', '#4d6bfe'] },
  { id: 'ecnu-liwa', description: '白底、枣红与暖灰视觉。', colors: ['#fffaf7', '#9f2636'] },
])

function ProductMark({ size = 22, className, service }) {
  const snapshot = useBrandSnapshot(service)
  const { logoUrl } = productIdentity(snapshot)
  const color = normalizeVisualStyle(snapshot.value?.visualStyle) === 'ecnu-liwa' ? '#9f2636' : '#2575ff'
  return h('img', {
    width: size, height: size, className, alt: '', 'aria-hidden': true,
    src: logoUrl || `data:image/svg+xml,${encodeURIComponent(genericMarkSVG(color))}`,
    style: { objectFit: 'contain', flexShrink: 0 },
  })
}

function useBrandSnapshot(service) {
  return useSyncExternalStore(
    listener => service.subscribe(listener),
    () => service.getSnapshot(),
    () => service.getSnapshot(),
  )
}

function VisualStyleRow({ service }) {
  const snapshot = useSyncExternalStore(
    listener => service.subscribe(listener),
    () => service.getSnapshot(),
    () => service.getSnapshot(),
  )
  const selected = normalizeVisualStyle(snapshot.value?.visualStyle)
  const { styleLabels } = productIdentity(snapshot)
  return h('section', { style: { padding: '16px 0', borderBottom: '1px solid var(--dsw-alias-border-l2)' } },
    h('div', { style: { marginBottom: 8, color: 'var(--dsw-alias-label-primary)', fontSize: 14 } }, '配色'),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(180px, 1fr))', gap: 8 } },
      ...choices.map(choice => h('button', {
        key: choice.id,
        type: 'button',
        'aria-pressed': selected === choice.id,
        disabled: snapshot.writable !== true,
        onClick: () => { void service.set('visualStyle', choice.id) },
        style: {
          display: 'grid', gridTemplateColumns: '42px 1fr', alignItems: 'center', gap: 12,
          minHeight: 78, padding: '13px 15px', borderRadius: 14, textAlign: 'left', cursor: 'pointer',
          border: `1px solid ${selected === choice.id ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)'}`,
          background: selected === choice.id ? 'var(--dsw-alias-bg-module-platform)' : 'transparent',
          color: 'var(--dsw-alias-label-primary)',
        },
      },
      h('span', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', overflow: 'hidden', width: 40, height: 40, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 10 } },
        ...choice.colors.map(color => h('span', { key: color, style: { background: color } })),
      ),
      h('span', null,
        h('strong', { style: { display: 'block', fontSize: 14, lineHeight: 1.5 } }, styleLabels[choice.id]),
        h('span', { style: { display: 'block', marginTop: 2, color: 'var(--dsw-alias-label-secondary)', fontSize: 12, lineHeight: 1.45 } }, choice.description),
      ))),
    ),
  )
}

function ProductBrandName({ service }) {
  const identity = productIdentity(useBrandSnapshot(service))
  return h('span', {
    style: {
      color: 'var(--dsw-alias-label-primary)', fontSize: 15, fontWeight: 650,
      letterSpacing: '-0.01em', whiteSpace: 'nowrap',
    },
  }, identity.name)
}

function installProductIdentity(scope) {
  const previousTitle = document.title
  const icon = document.createElement('link')
  icon.rel = 'icon'
  icon.type = 'image/svg+xml'
  icon.dataset.eduworkProductIcon = 'true'
  document.head.append(icon)
  let appliedTitle = ''
  const adopt = () => {
    const snapshot = scope.getSnapshot()
    const identity = productIdentity(snapshot)
    const color = normalizeVisualStyle(snapshot.value?.visualStyle) === 'ecnu-liwa' ? '#9f2636' : '#2575ff'
    appliedTitle = identity.name
    document.title = appliedTitle
    icon.href = identity.logoUrl || `data:image/svg+xml,${encodeURIComponent(genericMarkSVG(color))}`
    // Let the browser infer the type for institution PNG or other images.
    if (identity.logoUrl) icon.removeAttribute('type')
    else icon.type = 'image/svg+xml'
  }
  adopt()
  const unsubscribe = scope.subscribe(adopt)
  // The official workspace changes the title again after navigation. Preserve
  // its session title while replacing only the upstream product suffix.
  const observer = new MutationObserver(() => {
    if (!document.title.endsWith(' — DeepSeek Harness')) return
    const name = productIdentity(scope.getSnapshot()).name
    appliedTitle = document.title.slice(0, -'DeepSeek Harness'.length) + name
    if (document.title !== appliedTitle) document.title = appliedTitle
  })
  observer.observe(document.head, { childList: true, subtree: true, characterData: true })
  return () => {
    observer.disconnect()
    unsubscribe()
    if (document.title === appliedTitle) document.title = previousTitle
    icon.remove()
  }
}

export function apply(ctx) {
  ctx.inject(['uiWorkspace'], context => context.effect(() =>
    bindDesktopAction('new-session', () => context.uiWorkspace.startSession()), 'eduwork: tray new session'))
  ctx.slots.inject('settings.trigger', () => ctx.slots.register({ name: 'settings.trigger', priority: -100 }, DesktopSettingsTrigger))
  const scope = ctx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE })
  let clearTokens = () => {}
  const adopt = () => {
    clearTokens()
    clearTokens = () => {}
    const visualStyle = normalizeVisualStyle(scope.getSnapshot().value?.visualStyle)
    document.documentElement.dataset.chatecnuVisualStyle = visualStyle
    const logoAccent = visualStyle === 'ecnu-liwa' ? '#9f2636' : '#2575ff'
    document.documentElement.style.setProperty('--chatecnu-logo-accent', logoAccent)
    const tokens = tokensForVisualStyle(visualStyle)
    if (tokens !== null) clearTokens = ctx.theme.overrideTokens(TOKEN_SOURCE, tokens)
  }
  adopt()
  ctx.effect(() => scope.subscribe(adopt), 'chatecnu-work: visual-style adoption')
  ctx.effect(() => () => {
    clearTokens()
    delete document.documentElement.dataset.chatecnuVisualStyle
    document.documentElement.style.removeProperty('--chatecnu-logo-accent')
  }, 'chatecnu-work: visual-style tokens')
  ctx.effect(() => installProductIdentity(scope), 'eduwork: document identity')

  ctx.slots.inject('settings.about.brand', () => ctx.slots.register({
    name: 'settings.about.brand', inject: () => ({ service: scope }),
  }, ProductMark))

  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark', inject: () => ({ service: scope }) }, ProductMark)
        yield ctx.slots.register({ name: 'sidebar.brand.name', inject: () => ({ service: scope }) }, ProductBrandName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark', inject: () => ({ service: scope }) }, ProductMark)
      })))

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: 'chatecnu-visual-style', order: 15,
    inject: () => ({ service: scope }),
  }, VisualStyleRow))
}

export { ProductBrandName, ProductMark }
