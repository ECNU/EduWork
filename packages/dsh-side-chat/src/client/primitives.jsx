import React, { useEffect, useState } from 'react'

const h = React.createElement

// The UI primitives package is bundled per client plugin rather than exposed as
// a shared client module, so this plugin carries the three pieces it uses. They
// keep the native look through the same CSS variables without pulling in the
// package's CSS-module pipeline.

export function IconWarningOutlineRegular({ size = 16 }) {
  return h('svg', {
    width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
    strokeWidth: 1, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
  },
  h('path', { d: 'M8 1.75 1.75 14h12.5L8 1.75Z' }),
  h('path', { d: 'M8 6v3.5M8 11.75v.5' }))
}

export function Tooltip({ label, side = 'top', children }) {
  return h('span', { title: label, 'data-tooltip-side': side, style: { display: 'inline-flex' } }, children)
}

export function Toast({ text, icon, holdMs = 2000, onDone, actions = [] }) {
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    const hold = setTimeout(() => setLeaving(true), holdMs)
    const done = setTimeout(() => onDone?.(), holdMs + 1000)
    return () => { clearTimeout(hold); clearTimeout(done) }
  }, [holdMs, onDone])
  return h('div', {
    role: 'status',
    style: {
      position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)',
      display: 'flex', alignItems: 'center', gap: 12, maxWidth: 420,
      padding: '10px 14px', borderRadius: 10, zIndex: 9999,
      background: 'var(--dsw-alias-bg-elevated, #2b2b2b)', color: 'var(--dsw-alias-label-primary, #fff)',
      boxShadow: '0 6px 24px rgba(0,0,0,.28)', fontSize: 13, lineHeight: 1.5,
      opacity: leaving ? 0 : 1, transition: 'opacity 1s ease',
    },
  },
  icon ? h('span', { style: { display: 'inline-flex', flex: 'none' } }, h(icon, { size: 16 })) : null,
  h('span', { style: { flex: '1 1 auto' } }, text),
  ...actions.map(action => h('button', {
    key: action.label, type: 'button', onClick: action.onClick,
    style: {
      flex: 'none', border: 0, cursor: 'pointer', borderRadius: 6, padding: '2px 8px',
      background: 'transparent', color: 'var(--dsw-alias-label-secondary, #bbb)', font: 'inherit',
    },
  }, action.label)))
}
