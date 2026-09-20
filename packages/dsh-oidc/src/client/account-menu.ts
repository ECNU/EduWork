import React, { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { accountOrganization, accountUserName } from './presentation.js'
import { useAccountStatus } from './use-account-status.js'
import { useSignIn } from './use-sign-in.js'

const h = React.createElement
const zh = typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh')
const words = zh ? { menu: '账户菜单', check: '刷新账户', logout: '退出登录', login: '登录账户', waiting: '请在浏览器中完成登录…', cancel: '取消登录', processing: '正在处理…' }
  : { menu: 'Account menu', check: 'Refresh account', logout: 'Sign out', login: 'Sign in', waiting: 'Complete sign-in in your browser…', cancel: 'Cancel sign-in', processing: 'Working…' }
const action = { width: '100%', textAlign: 'left' as const, border: 0, borderRadius: 7, padding: '9px 10px', font: 'inherit', cursor: 'pointer', background: 'var(--dsw-alias-bg-layer-2, #f5f6f8)', color: 'inherit' }
const secondary = 'var(--dsw-alias-label-secondary, #69717f)'

export function AccountMenu({ service, profile, children, renderSlot, wide = true }: any) {
  const status = useAccountStatus(service, profile.id)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 12, bottom: 60 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null)
  const initialFocus = useRef<'first' | 'last'>('first')
  const id = useId(), login = useSignIn(service)
  const connected = status?.state === 'connected', signedIn = connected || status?.state === 'authenticated'
  const close = (restore = false) => { setOpen(false); if (restore) trigger.current?.focus() }
  useEffect(() => {
    if (!open) return
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect()
      if (rect) setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 304)), bottom: Math.max(8, window.innerHeight - rect.top + 8) })
    }
    const inside = (target: EventTarget | null) => target instanceof Node && (trigger.current?.contains(target) || panel.current?.contains(target))
    const outside = (event: Event) => { if (!inside(event.target)) close() }
    place()
    const items = panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')
    const first = initialFocus.current === 'last' ? items?.[items.length - 1] : items?.[0]
    initialFocus.current = 'first'
    if (first) first.focus(); else panel.current?.focus()
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('focusin', outside, true)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('focusin', outside, true)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])
  const run = async (operation: () => Promise<any>, exit = false) => {
    setBusy(true); setError('')
    try { await operation(); if (exit) close(true) }
    catch (cause: any) { setError(cause?.message || String(cause)) }
    finally { setBusy(false) }
  }
  const keydown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])
    const index = items.indexOf(document.activeElement as HTMLElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }
  const button = (label: string, onClick: () => void) => h('button', { type: 'button', role: 'menuitem', disabled: busy, style: action, onClick }, label)
  const refreshAccount = () => service.reconcile(profile.id, {})
  const defaultContent = signedIn && button(busy ? words.processing : words.check, () => void run(refreshAccount))
  const content = open && h('div', { ref: panel, id, role: 'menu', tabIndex: -1, 'aria-label': words.menu, onKeyDown: keydown,
    style: { position: 'fixed', zIndex: 11000, ...position, width: 'min(296px, calc(100vw - 16px))', maxHeight: 'min(540px, calc(100vh - 80px))', overflowY: 'auto', boxSizing: 'border-box', padding: 14, border: '1px solid var(--dsw-alias-border-l2, #e1e4eb)', borderRadius: 13, background: 'var(--dsw-alias-bg-layer-1, #fff)', color: 'var(--dsw-alias-label-primary, #20232c)', boxShadow: '0 12px 38px #17264d20', fontSize: 12 } },
    h('div', { role: 'presentation', style: { padding: '2px 3px 12px' } }, h('strong', null, accountUserName(status) || accountOrganization(profile)), h('div', { style: { marginTop: 4, color: secondary } }, accountOrganization(profile))),
    typeof renderSlot === 'function' ? renderSlot('oidc.account.menu.details', { profile, status, busy, run, refreshAccount, defaultContent }, { fallback: defaultContent }) : defaultContent,
    h('div', { style: { display: 'grid', gap: 6 } },
      !signedIn && button(busy ? words.processing : words.login, () => void run(() => login.begin(profile.id))),
      signedIn && button(words.logout, () => void run(() => service.logout(profile.id), true))),
    login.pending && h('p', { role: 'status' }, words.waiting, ' ', h('button', { type: 'button', role: 'menuitem', style: action, onClick: login.cancel }, words.cancel)),
    error && h('p', { role: 'alert', style: { color: 'var(--dsw-alias-state-error-primary, #a14d3b)', marginBottom: 0 } }, error))
  return h(React.Fragment, null,
    h('button', { ref: trigger, type: 'button', 'aria-label': `${accountUserName(status) || accountOrganization(profile)} · ${words.menu}`, 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': open ? id : undefined,
      title: words.menu, onClick: () => setOpen(value => !value), onKeyDown: (event: React.KeyboardEvent) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); initialFocus.current = event.key === 'ArrowUp' ? 'last' : 'first'; setOpen(true) } else if (event.key === 'Escape') close(true) },
      style: { display: 'block', width: wide ? '100%' : 36, border: 0, borderRadius: 9, padding: wide ? '7px 4px' : 4, cursor: 'pointer', background: 'transparent', color: 'inherit', textAlign: 'left' } }, children),
    content && typeof document !== 'undefined' ? createPortal(content, document.body) : null)
}
