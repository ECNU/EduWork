import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { projectAnnotations } from '../protocol.js'
import { place } from './position.js'

const h = React.createElement
const secondary = 'var(--dsw-alias-label-secondary, #8b776d)'
const border = 'var(--dsw-alias-border-l2, #e4cfc6)'
const primary = 'var(--dsw-alias-label-primary, #382d28)'

function Detail({ item, number, anchor, t, onClose, onEnter, onLeave }) {
  const ref = useRef(null)
  const [position, setPosition] = useState({ left: 8, top: 8 })
  useLayoutEffect(() => {
    const update = () => {
      const rect = anchor.getBoundingClientRect(), panel = ref.current.getBoundingClientRect()
      const next = place(rect.right, rect.bottom, panel.width, panel.height, window.innerWidth, window.innerHeight, rect.top)
      if (rect.top - panel.height - 8 >= 8) next.top = rect.top - panel.height - 8
      setPosition(next)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(ref.current)
    const visibility = new IntersectionObserver(entries => { if (!entries[0]?.isIntersecting) onClose() })
    visibility.observe(anchor)
    const outside = event => { if (!ref.current?.contains(event.target) && !anchor.contains(event.target)) onClose() }
    const key = event => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }
    const scroll = event => { if (!ref.current?.contains(event.target)) update() }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('focusin', outside, true)
    document.addEventListener('keydown', key)
    document.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', update)
    window.addEventListener('blur', onClose)
    return () => {
      observer.disconnect()
      visibility.disconnect()
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('focusin', outside, true)
      document.removeEventListener('keydown', key)
      document.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', update)
      window.removeEventListener('blur', onClose)
    }
  }, [anchor, onClose])
  return createPortal(h('div', {
    ref, role: 'dialog', 'aria-label': `${t('number')} ${number}`, 'data-eduwork-annotation-ui': '',
    onMouseEnter: onEnter, onMouseLeave: onLeave,
    style: { position: 'fixed', zIndex: 1000, ...position, width: 520, maxWidth: 'calc(100vw - 24px)',
      maxHeight: 'min(420px, calc(100vh - 24px))', overflowY: 'auto', boxSizing: 'border-box',
      background: 'var(--dsw-alias-bg-layer-3, #fffdfb)', color: primary,
      border: `1px solid ${border}`, borderRadius: 16, padding: '16px 20px', boxShadow: '0 5px 20px rgba(50,30,20,.10)', fontSize: 14 },
  }, h('div', { style: { display: 'flex', gap: 16 } },
    h('span', { style: { color: secondary } }, `${number}.`),
    h('div', { style: { minWidth: 0, flex: 1 } },
      h('div', { style: { color: secondary, marginBottom: 5 } }, t('selectedText')),
      h('div', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.6 } }, item.text),
      item.comment ? h('div', { style: { marginTop: 10, paddingTop: 10, borderTop: `1px solid ${border}`, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } },
        h('span', { style: { color: secondary } }, t('notePrefix')), item.comment) : null),
    h('button', { type: 'button', onClick: onClose, 'aria-label': t('close'), style: { alignSelf: 'flex-start', background: 'none', border: 0, color: secondary, cursor: 'pointer', fontSize: 18 } }, '×'))), document.body)
}

// The owner keeps attachments, bubble, native text rendering and actions.
export function AnnotatedContent({ content, renderContent, t }) {
  const projection = useMemo(() => projectAnnotations(content.text), [content.text])
  const [active, setActive] = useState(null)
  const timer = useRef(null)
  const close = useRef(() => setActive(null)).current
  const cancel = () => { clearTimeout(timer.current) }
  const leave = () => { cancel(); timer.current = setTimeout(close, 180) }
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => { close() }, [content.text, close])
  if (!projection) return renderContent(content)
  return h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, width: '100%', minWidth: 0 } },
    h('div', { 'data-eduwork-annotation-bar': '', 'data-eduwork-annotation-ui': '',
      onMouseEnter: cancel, onMouseLeave: leave,
      style: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap', gap: 6, color: secondary, fontSize: 13 } },
    h('span', { style: { marginRight: 2 } }, t('number')),
    ...projection.items.map((item, index) => h('button', {
      key: index, type: 'button', 'aria-label': `${t('number')} ${index + 1}`, 'aria-expanded': active?.index === index, 'aria-haspopup': 'dialog',
      onMouseEnter: event => { cancel(); setActive({ index, anchor: event.currentTarget }) },
      onFocus: event => { cancel(); setActive({ index, anchor: event.currentTarget }) },
      onClick: event => { cancel(); setActive({ index, anchor: event.currentTarget }) },
      style: { minWidth: 32, height: 32, borderRadius: 12, padding: '0 10px', border: `1px solid ${border}`,
        background: active?.index === index ? 'var(--dsw-alias-bg-layer-2, #f5ece5)' : 'transparent', color: primary, font: 'inherit', cursor: 'pointer' },
    }, String(index + 1)))),
    renderContent({ ...content, text: projection.body }),
    active && projection.items[active.index] ? h(Detail, { key: active.index, item: projection.items[active.index], number: active.index + 1, anchor: active.anchor,
      t, onClose: close, onEnter: cancel, onLeave: leave }) : null)
}
