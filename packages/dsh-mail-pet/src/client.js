// Read-only mail preview. The Host reads the message and passes a bounded
// payload back through the notification protocol; this plugin only renders it,
// so nothing here touches IMAP, credentials or the message store.

import React, { useEffect, useRef, useSyncExternalStore } from 'react'

export const inject = ['slots', 'notificationActions']

/** The source id registered by the Host package. */
const SOURCE = 'mail'
const h = React.createElement
const zh = typeof navigator === 'undefined' || !/^en/i.test(navigator.language ?? '')
const text = zh
  ? { close: '关闭', to: '发件人', at: '时间', more: '正文较长，已截断', files: '附件', read: '只读预览' }
  : { close: 'Close', to: 'From', at: 'Date', more: 'The message is longer than the preview', files: 'Attachments', read: 'Read-only preview' }

let current = null
const listeners = new Set()
const snapshot = () => current
const subscribe = listener => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const show = value => {
  current = value && typeof value === 'object' ? value : null
  for (const listener of listeners) listener()
}
const close = () => show(null)

const primary = 'var(--dsw-alias-label-primary, #221b18)'
const secondary = 'var(--dsw-alias-label-secondary, #746762)'
const border = 'var(--dsw-alias-border-l2, #e7dfda)'
const layer = 'var(--dsw-alias-bg-layer-1, #fffdfb)'
const mono = 'var(--dsw-alias-font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace)'

function Row({ label, value }) {
  if (!value) return null
  return h('div', { style: { display: 'flex', gap: 8, fontSize: 12, color: secondary, lineHeight: 1.6 } },
    h('span', { style: { minWidth: 48 } }, label),
    h('span', { style: { color: primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, value))
}

function Reader() {
  const value = useSyncExternalStore(subscribe, snapshot, snapshot)
  const panel = useRef(null)
  const open = value !== null

  useEffect(() => {
    if (!open) return undefined
    const escape = event => { if (event.key === 'Escape') { event.stopPropagation(); close() } }
    window.addEventListener('keydown', escape)
    // The overlay steals focus while it is open so Escape and Tab stay inside it.
    const previous = document.activeElement
    panel.current?.focus()
    return () => {
      window.removeEventListener('keydown', escape)
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [open])

  if (!open) return null
  const files = Array.isArray(value.attachments) ? value.attachments : []
  return h('div', {
    role: 'presentation',
    onClick: event => { if (event.target === event.currentTarget) close() },
    style: {
      position: 'fixed', inset: 0, zIndex: 90, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, background: 'rgba(20, 16, 14, 0.32)',
    },
  }, h('section', {
    ref: panel,
    tabIndex: -1,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': value.subject || text.read,
    style: {
      display: 'flex', flexDirection: 'column', width: 'min(720px, 100%)', maxHeight: '80vh',
      background: layer, color: primary, borderRadius: 14, border: `1px solid ${border}`,
      boxShadow: '0 18px 48px rgba(20, 16, 14, 0.24)', outline: 'none',
    },
  },
  h('header', { style: { padding: '16px 20px 12px', borderBottom: `1px solid ${border}` } },
    h('h2', { style: { margin: 0, fontSize: 16, fontWeight: 600, lineHeight: 1.4, wordBreak: 'break-word' } }, value.subject || (zh ? '（无主题）' : '(no subject)')),
    h(Row, { label: text.to, value: value.from }),
    h(Row, { label: text.at, value: value.date }),
    h(Row, { label: '#', value: `${value.folder || 'INBOX'} · UID ${value.uid ?? '?'}` })),
  h('div', { style: { flex: 1, overflow: 'auto', padding: '14px 20px' } },
    h('pre', {
      style: { margin: 0, fontFamily: mono, fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
    }, value.text || (zh ? '（没有可预览的正文）' : '(nothing to preview)')),
    value.truncated ? h('p', { style: { margin: '10px 0 0', fontSize: 12, color: secondary } }, text.more) : null,
    files.length > 0
      ? h('div', { style: { marginTop: 14, paddingTop: 12, borderTop: `1px solid ${border}` } },
        h('p', { style: { margin: '0 0 6px', fontSize: 12, color: secondary } }, `${text.files} · ${files.length}`),
        h('ul', { style: { margin: 0, paddingLeft: 18, fontSize: 12, color: primary, lineHeight: 1.8 } },
          files.map((name, index) => h('li', { key: `${index}:${name}`, style: { wordBreak: 'break-all' } }, name))))
      : null),
  h('footer', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      padding: '12px 20px', borderTop: `1px solid ${border}`, background: layer },
  },
  h('span', { style: { fontSize: 12, color: secondary } }, text.read),
  h('button', {
    type: 'button',
    onClick: close,
    style: { border: `1px solid ${border}`, borderRadius: 8, padding: '6px 14px', background: layer,
      color: primary, fontSize: 13, cursor: 'pointer' },
  }, text.close))))
}

export function apply(ctx) {
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'mail-pet.reader', order: 90,
  }, Reader))

  // A click carries whatever the Host `onAction` returned, so the panel gets the
  // excerpt already clipped to the protocol target budget.
  const dispose = ctx.notificationActions.register(SOURCE, action => {
    if (!action?.target) return true
    show(action.target)
    return true
  })
  ctx.effect(() => () => { dispose(); close() })
}
