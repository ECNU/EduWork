import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives'
import { createPortal } from 'react-dom'
import { projectAnnotations } from '../protocol.js'

const h = React.createElement
const secondary = 'var(--dsw-alias-label-secondary, #8b776d)'
const border = 'var(--dsw-alias-border-l2, #e4cfc6)'
const primary = 'var(--dsw-alias-label-primary, #382d28)'

function Detail({ item, number, anchor, t, onClose, onEnter, onLeave }) {
  const ref = useRef(null)
  const anchorRef = useMemo(() => ({ current: anchor }), [anchor])
  const id = useId()
  const anchorName = '--eduwork-annotation-' + id.replaceAll(':', '')
  // Follow the host's CSS-anchor placement contract. No scroll/resize loop or
  // removed useAnchoredPosition import is needed to keep the card attached.
  useLayoutEffect(() => {
    const previous = anchor.style.getPropertyValue('anchor-name')
    const priority = anchor.style.getPropertyPriority('anchor-name')
    anchor.style.setProperty('anchor-name', anchorName)
    return () => {
      if (previous) anchor.style.setProperty('anchor-name', previous, priority)
      else anchor.style.removeProperty('anchor-name')
    }
  }, [anchor, anchorName])
  useDismissOnOutsidePointer(anchorRef, true, onClose, ref)
  useEffect(() => {
    const visibility = new IntersectionObserver(entries => { if (!entries[0]?.isIntersecting) onClose() })
    visibility.observe(anchor)
    const outside = event => { if (!ref.current?.contains(event.target) && !anchor.contains(event.target)) onClose() }
    const key = event => { if (event.key === 'Escape') { event.preventDefault(); onClose() } }
    document.addEventListener('focusin', outside, true)
    document.addEventListener('keydown', key)
    window.addEventListener('blur', onClose)
    return () => {
      visibility.disconnect()
      document.removeEventListener('focusin', outside, true)
      document.removeEventListener('keydown', key)
      window.removeEventListener('blur', onClose)
    }
  }, [anchor, onClose])
  return createPortal(h('div', {
    ref, role: 'dialog', 'aria-label': `${t('number')} ${number}`, 'data-eduwork-annotation-ui': '', 'data-window-drag-exclude': '',
    onMouseEnter: onEnter, onMouseLeave: onLeave,
    style: { position: 'fixed', zIndex: 1000, positionAnchor: anchorName,
      top: 'max(12px, var(--dsh-frame-overlay-top, 12px))', left: 12,
      right: 'max(12px, anchor(right))', bottom: 'max(12px, calc(anchor(top) + 8px))',
      alignSelf: 'end', justifySelf: 'end', margin: 0, height: 'fit-content',
      positionTryFallbacks: '--eduwork-annotation-below, --eduwork-annotation-window',
      width: 520, maxWidth: 'calc(100vw - 24px)',
      maxHeight: 'min(420px, calc(100dvh - 24px))', overflowY: 'auto', boxSizing: 'border-box',
      background: 'var(--dsw-alias-bg-layer-3, #fffdfb)', color: primary,
      border: `1px solid ${border}`, borderRadius: 16, padding: '16px 20px', boxShadow: '0 5px 20px rgba(50,30,20,.10)', fontSize: 14 },
  }, h('style', null, '@position-try --eduwork-annotation-below{top:max(12px,calc(anchor(bottom) + 8px));bottom:12px;align-self:start}@position-try --eduwork-annotation-window{top:max(12px,var(--dsh-frame-overlay-top,12px));bottom:12px;left:12px;right:12px;align-self:safe end;justify-self:safe end}'),
  h('div', { style: { display: 'flex', gap: 16 } },
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
  const hoverDismissed = useRef(false)
  const close = useRef(() => setActive(null)).current
  // A viewport-fitted card can cover its trigger. Removing it must not reopen
  // it through the synthetic pointer-enter that uncovers the same trigger.
  const dismiss = useRef(() => { hoverDismissed.current = true; setActive(null) }).current
  const cancel = () => { clearTimeout(timer.current) }
  const leave = () => { hoverDismissed.current = false; cancel(); timer.current = setTimeout(close, 180) }
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
      onMouseEnter: event => { cancel(); if (!hoverDismissed.current) setActive({ index, anchor: event.currentTarget }) },
      onFocus: event => { hoverDismissed.current = false; cancel(); setActive({ index, anchor: event.currentTarget }) },
      onClick: event => { hoverDismissed.current = false; cancel(); setActive({ index, anchor: event.currentTarget }) },
      style: { minWidth: 32, height: 32, borderRadius: 12, padding: '0 10px', border: `1px solid ${border}`,
        background: active?.index === index ? 'var(--dsw-alias-bg-layer-2, #f5ece5)' : 'transparent', color: primary, font: 'inherit', cursor: 'pointer' },
    }, String(index + 1)))),
    renderContent({ ...content, text: projection.body }),
    active && projection.items[active.index] ? h(Detail, { key: active.index, item: projection.items[active.index], number: active.index + 1, anchor: active.anchor,
      t, onClose: dismiss, onEnter: cancel, onLeave: leave }) : null)
}
