import React, { useEffect, useState, useSyncExternalStore } from 'react'
import remote from '../lib/typert.remote-client.js'

export const inject = ['slots', 'locale', 'remote', 'configForms']
const h = React.createElement
const NS = 'settings.desktopPet'
// The Loader entry inserted by the desktop product profile.
const ENTRY = 'eduwork-desktop-pet'
const zh = {
  locale: 'zh-CN', nav: '桌面宠物', title: '桌面宠物',
  intro: '桌宠显示在桌面上，随会话状态变化：工作中会思考，完成或需要你处理时头上出现标记，点击它打开对应会话。授权和回答仍在应用内完成。',
  unsupported: '当前客户端不支持桌面宠物。', loading: '正在读取桌宠设置…',
  enabled: '显示桌面宠物', reset: '重置位置', resetDone: '已移回默认位置。',
  skins: '形象', author: '作者：{author}',
  size: '大小', bubbles: '状态变化时显示简短气泡', sleep: '长时间空闲时打盹',
  notes: '托盘菜单和桌宠右键菜单里的“隐藏桌宠”与上面的开关相同；隐藏后可从托盘选择“显示桌宠”。气泡里是否显示会话标题，跟随“通用 → 桌面通知”里的“显示会话与成果标题”。',
  saveFailed: '设置未保存，请重试。',
}
const en = {
  locale: 'en', nav: 'Desktop pet', title: 'Desktop pet',
  intro: 'The pet stays on your desktop and follows your conversations: it thinks while work runs and shows a mark when something is done or needs you. Click it to open that conversation. Approvals and answers still happen in the app.',
  unsupported: 'This client does not support the desktop pet.', loading: 'Loading pet settings…',
  enabled: 'Show desktop pet', reset: 'Reset position', resetDone: 'Moved back to the default position.',
  skins: 'Character', author: 'By {author}',
  size: 'Size', bubbles: 'Show short bubbles when the status changes', sleep: 'Nap after a long idle time',
  notes: '"Hide pet" in the tray menu and the pet\'s context menu is the same as the switch above; choose "Show pet" in the tray to bring it back. Conversation titles appear in bubbles only when "Show conversation and result titles" is on under General → Desktop notifications.',
  saveFailed: 'The setting was not saved. Please try again.',
}
const primary = 'var(--dsw-alias-label-primary, #221b18)'
const secondary = 'var(--dsw-alias-label-secondary, #746762)'
const border = 'var(--dsw-alias-border-l2, #e7dfda)'
const layer = 'var(--dsw-alias-bg-layer-1, #fffdfb)'
const accent = 'var(--chatecnu-logo-accent, var(--dsw-alias-state-business-primary, #9f2636))'
const note = { margin: '4px 0 0', color: secondary, fontSize: 12, lineHeight: 1.6 }
const row = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '14px 0', borderBottom: `1px solid ${border}` }
const button = { border: `1px solid ${border}`, borderRadius: 8, padding: '6px 12px', background: layer, color: primary, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }
const box = { accentColor: accent }
const oneLine = { maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

async function unwrap(operation) {
  const result = await operation
  if (result?.ok === true) return result.value
  throw new Error(result?.error?.message || result?.error?.code || 'desktop pet unavailable')
}
const fill = (template, values) => template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '')
const pickText = (value, locale) => value?.[locale] ?? value?.['zh-CN'] ?? value?.en ?? ''

function Preview({ preview }) {
  const size = 64
  if (!preview.crop) return h('img', { src: preview.src, alt: '', draggable: false, style: { width: size, height: size, objectFit: 'contain' } })
  const scale = size / Math.max(preview.crop.width, preview.crop.height)
  return h('div', { style: { position: 'relative', width: preview.crop.width * scale, height: preview.crop.height * scale, overflow: 'hidden' } },
    h('img', { src: preview.src, alt: '', draggable: false, style: { position: 'absolute', left: 0, top: 0, transformOrigin: '0 0',
      transform: `scale(${scale}) translate(${-preview.crop.x}px, ${-preview.crop.y}px)` } }))
}

function SkinCard({ skin, selected, disabled, onSelect, t }) {
  const author = skin.author && fill(t('author'), skin)
  return h('button', { type: 'button', 'aria-pressed': selected, disabled, onClick: onSelect, style: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0, padding: '10px 8px', borderRadius: 12, cursor: disabled ? 'default' : 'pointer',
    border: `${selected ? 2 : 1}px solid ${selected ? accent : border}`, background: layer, color: primary, textAlign: 'center', font: 'inherit' } },
  h(Preview, { preview: skin.preview }),
  h('strong', { style: { ...oneLine, fontSize: 13, fontWeight: 600 } }, pickText(skin.name, t('locale'))),
  author && h('span', { title: author, style: { ...oneLine, color: secondary, fontSize: 11 } }, author))
}

function PetSettings({ scope, service, t }) {
  const snapshot = useSyncExternalStore(listener => scope.subscribe(listener), () => scope.getSnapshot(), () => scope.getSnapshot())
  const [state, setState] = useState(null), [pending, setPending] = useState({}), [message, setMessage] = useState(''), [error, setError] = useState('')
  useEffect(() => { service.status().then(setState, cause => setError(cause.message)) }, [])
  const saved = snapshot.value ?? {}, locked = snapshot.status !== 'ready' || snapshot.writable !== true
  // Show a choice at once and keep it until the saved settings catch up, so
  // controls neither jump back nor gray out while a write is on its way.
  // The form queues writes in order; `set` reports whether the Host accepted one.
  const value = { ...saved, ...pending }
  useEffect(() => setPending(current => {
    const left = Object.fromEntries(Object.entries(current).filter(([key, next]) => saved[key] !== next))
    return Object.keys(left).length === Object.keys(current).length ? current : left
  }), [snapshot])
  const save = async (key, next) => {
    setPending(current => ({ ...current, [key]: next })); setError(''); setMessage('')
    let accepted = false
    try { accepted = await scope.set(key, next) } catch { /* reported below */ }
    if (!accepted) {
      setPending(({ [key]: _, ...rest }) => rest)
      setError(t('saveFailed'))
    }
  }
  // Dragging only moves the slider; releasing it saves the size once.
  const commitSize = () => { if (pending.size !== undefined && pending.size !== saved.size) void save('size', pending.size) }
  const reset = async () => {
    setError(''); setMessage('')
    try { await service.reset(); setMessage(t('resetDone')) } catch (cause) { setError(cause.message) }
  }
  const check = (key, label) => h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, minHeight: 30, fontSize: 13 } },
    h('input', { type: 'checkbox', style: box, checked: value[key] === true, disabled: locked, onChange: event => { void save(key, event.target.checked) } }), label)
  const header = h('div', null, h('h3', { style: { margin: 0, fontSize: 16, fontWeight: 650, color: primary } }, t('title')), h('p', { style: note }, t('intro')))
  if (!state) return h('div', null, header, h('p', { role: error ? 'alert' : 'status', style: note }, error || t('loading')))
  if (!state.supported) return h('div', null, header, h('p', { role: 'status', style: note }, t('unsupported')))
  return h('div', { 'data-eduwork-desktop-pet': true, style: { color: primary } }, header,
    h('div', { style: row },
      h('label', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 } },
        h('input', { type: 'checkbox', role: 'switch', style: box, checked: value.enabled === true, disabled: locked, onChange: event => { void save('enabled', event.target.checked) } }), t('enabled')),
      h('button', { type: 'button', style: { ...button, ...(value.enabled === true ? {} : { opacity: 0.5, cursor: 'default' }) }, disabled: value.enabled !== true, onClick: () => { void reset() } }, t('reset'))),
    h('section', { style: { padding: '14px 0', borderBottom: `1px solid ${border}` } },
      h('div', { style: { fontSize: 14, marginBottom: 10 } }, t('skins')),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 } },
        ...state.skins.map(skin => h(SkinCard, { key: skin.id, skin, t, selected: value.skin === skin.id, disabled: locked, onSelect: () => { if (value.skin !== skin.id) void save('skin', skin.id) } })))),
    h('section', { style: { padding: '14px 0', borderBottom: `1px solid ${border}` } },
      h('label', { style: { display: 'flex', alignItems: 'center', gap: 12, fontSize: 14 } }, t('size'),
        h('input', { type: 'range', min: 50, max: 200, step: 10, value: value.size ?? 100, disabled: locked, style: { flex: 1, maxWidth: 280, accentColor: accent },
          onChange: event => { const next = Number(event.target.value); setPending(current => ({ ...current, size: next })) }, onPointerUp: commitSize, onKeyUp: commitSize }),
        h('span', { style: { minWidth: 44, textAlign: 'right', color: secondary, fontSize: 13 } }, `${value.size ?? 100}%`)),
      h('div', { style: { marginTop: 10 } }, check('bubbles', t('bubbles')), check('sleep', t('sleep')))),
    h('p', { style: { ...note, marginTop: 12 } }, t('notes')),
    message && h('p', { role: 'status', style: note }, message),
    error && h('p', { role: 'alert', style: { ...note, color: 'var(--dsw-alias-state-error-primary, #a82332)' } }, error))
}

export async function apply(ctx) {
  const unmount = await ctx.remote.$mount(remote)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'desktop-pet: dictionaries')
  ctx.inject(['remote.desktopPet'], surface => {
    const t = surface.locale.bind(NS)
    const service = { status: () => unwrap(surface.remote.desktopPet.status()), reset: () => unwrap(surface.remote.desktopPet.resetPosition()) }
    const scope = surface.configForms.get(ENTRY)
    surface.slots.inject('settings.section', () => surface.slots.register({
      name: 'settings.section', id: 'desktop-pet', order: 15, label: () => t('nav'), locale: NS, inject: () => ({ scope, service, t }),
    }, PetSettings))
    // The desktop shell queues fixed actions from the pet's menus: open this
    // page through the settings shell's own store, or hide and show the pet by
    // saving the same setting as the switch above.
    const run = () => {
      for (const action of (window.__eduworkPetActions ?? []).splice(0)) {
        if (action === 'settings') surface.slots.entries('sidebar.settings')[0]?.store?.create().actions.openSection('desktop-pet')
        if (action === 'show' || action === 'hide') void scope.set('enabled', action === 'show')
      }
    }
    window.addEventListener('eduwork:pet-action', run)
    surface.effect(() => () => window.removeEventListener('eduwork:pet-action', run))
    run()
  })
  return async () => { await unmount() }
}
