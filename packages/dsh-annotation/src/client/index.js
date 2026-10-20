import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { SOURCE, MAX_NOTE, decode, reference, text } from './reference.js'

export const inject = ['locale']
const h = React.createElement
const NS = 'eduwork.annotation'
const UI = 'data-eduwork-annotation-ui'
const MARKER = 'data-eduwork-annotation-marker'

const copy = {
  zh: {
    quote: '引用', notePlaceholder: '添加批注（可选）', add: '加入输入框', cancel: '取消', close: '关闭',
    notePrefix: '批注：', noted: '批注', preview: '引用内容', invalid: '引用内容已损坏。', insertFailed: '当前无法插入引用，请稍后再试。',
  },
  en: {
    quote: 'Quote', notePlaceholder: 'Add a note (optional)', add: 'Add to message', cancel: 'Cancel', close: 'Close',
    notePrefix: 'Note: ', noted: 'note', preview: 'Quoted text', invalid: 'This quote is damaged.', insertFailed: 'The quote cannot be inserted right now. Try again later.',
  },
}

const border = 'var(--dsw-alias-border-l2, #e6e6e6)'
const layer = 'var(--dsw-alias-bg-layer-3, #fff)'
const primary = 'var(--dsw-alias-label-primary, #191919)'
const secondary = 'var(--dsw-alias-label-secondary, #666)'
const accent = 'var(--dsw-alias-state-business-primary, #9f2636)'
const card = { position: 'fixed', zIndex: 1000, background: layer, color: primary, border: `1px solid ${border}`, borderRadius: 10, boxShadow: '0 6px 24px rgba(0,0,0,.12)', fontSize: 13 }
const button = filled => ({ border: `1px solid ${filled ? accent : border}`, borderRadius: 7, padding: '5px 10px', background: filled ? accent : 'transparent', color: filled ? '#fff' : primary, cursor: 'pointer', fontSize: 12 })

function createPreviews() {
  const values = new Map()
  const listeners = new Set()
  const emit = () => { for (const listener of listeners) listener() }
  return {
    get: id => values.get(id),
    open(id, annotation) { values.set(id, annotation); emit() },
    close(id) { if (values.delete(id)) emit() },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
}

// Several sessions can be mounted at once. A selection belongs to the overlay
// whose nearest ancestor containing the selection holds no other overlay.
function ownsSelection(marker, element) {
  let scope = marker?.parentElement
  while (scope && !scope.contains(element)) scope = scope.parentElement
  return scope != null && scope.querySelectorAll(`[${MARKER}]`).length === 1
}

function readSelection(marker) {
  const selection = document.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const quote = selection.toString().trim()
  if (quote === '') return null
  const range = selection.getRangeAt(0)
  const node = range.commonAncestorContainer
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
  if (!element || element.closest(`[contenteditable="true"], input, textarea, [${UI}]`)) return null
  if (!ownsSelection(marker, element)) return null
  const rects = range.getClientRects()
  const rect = rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect()
  return { quote, x: rect.right, y: rect.bottom }
}

function useSelectionTarget(marker, paused) {
  const [target, setTarget] = useState(null)
  useEffect(() => {
    if (paused) return undefined
    let frame = 0
    const settle = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setTarget(readSelection(marker.current))) }
    const clear = () => { if (document.getSelection()?.isCollapsed !== false) setTarget(null) }
    document.addEventListener('mouseup', settle)
    document.addEventListener('keyup', settle)
    document.addEventListener('selectionchange', clear)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('mouseup', settle)
      document.removeEventListener('keyup', settle)
      document.removeEventListener('selectionchange', clear)
    }
  }, [marker, paused])
  return [target, setTarget]
}

function place(x, y, width) {
  return { left: Math.max(8, Math.min(x - width, window.innerWidth - width - 8)), top: Math.min(y + 8, window.innerHeight - 48) }
}

function Editor({ draft, t, onAdd, onCancel }) {
  const [note, setNote] = useState('')
  const submit = () => onAdd(note)
  return h('div', { [UI]: '', role: 'dialog', style: { ...card, ...place(draft.x, draft.y, 320), width: 320, padding: 12 } },
    h('blockquote', { style: { margin: '0 0 8px', padding: '0 0 0 8px', borderLeft: `3px solid ${border}`, color: secondary, maxHeight: 96, overflow: 'auto', whiteSpace: 'pre-wrap' } }, draft.quote),
    h('textarea', {
      autoFocus: true, value: note, maxLength: MAX_NOTE, rows: 3, placeholder: t('notePlaceholder'),
      onChange: event => setNote(event.target.value),
      onKeyDown: (event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Escape') onCancel()
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submit() }
      },
      style: { width: '100%', boxSizing: 'border-box', resize: 'vertical', border: `1px solid ${border}`, borderRadius: 7, padding: 7, font: 'inherit', background: 'transparent', color: primary },
    }),
    h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 } },
      h('button', { type: 'button', onClick: onCancel, style: button(false) }, t('cancel')),
      h('button', { type: 'button', onClick: submit, style: button(true) }, t('add'))))
}

function Preview({ annotation, t, onClose }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return h('div', { [UI]: '', role: 'dialog', style: { ...card, left: '50%', bottom: 160, transform: 'translateX(-50%)', width: 'min(560px, calc(100vw - 32px))', padding: 14 } },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 } },
      h('strong', null, t('preview')),
      h('button', { type: 'button', onClick: onClose, style: button(false) }, t('close'))),
    h('blockquote', { style: { margin: 0, padding: '0 0 0 10px', borderLeft: `3px solid ${border}`, color: secondary, maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap' } }, annotation.quote),
    annotation.note === '' ? null : h('p', { style: { margin: '10px 0 0', whiteSpace: 'pre-wrap' } }, `${t('notePrefix')}${annotation.note}`))
}

function AnnotationOverlay({ sessionId, previews, insert, t, inputActions }) {
  const marker = useRef(null)
  const [draft, setDraft] = useState(null)
  const [target, setTarget] = useSelectionTarget(marker, draft !== null)
  const preview = useSyncExternalStore(previews.subscribe, () => previews.get(sessionId))
  const add = (note) => {
    const value = reference(draft.quote, note, t)
    setDraft(null)
    if (value !== undefined) insert(value, inputActions)
  }
  return h('span', { [MARKER]: '', ref: marker, hidden: true },
    target && !draft ? createPortal(h('button', {
      [UI]: '', type: 'button', style: { ...card, ...place(target.x, target.y, 64), padding: '5px 12px', cursor: 'pointer' },
      onMouseDown: event => event.preventDefault(),
      onClick: () => { setDraft(target); setTarget(null); document.getSelection()?.removeAllRanges() },
    }, t('quote')), document.body) : null,
    draft ? createPortal(h(Editor, { draft, t, onAdd: add, onCancel: () => setDraft(null) }), document.body) : null,
    preview ? createPortal(h(Preview, { annotation: preview, t, onClose: () => previews.close(sessionId) }), document.body) : null)
}

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, copy), 'annotation: dictionaries')
  const t = ctx.locale.bind(NS)
  const previews = createPreviews()
  ctx.inject(['inputTriggers', 'slots', 'sessions'], (scope) => {
    // Codec-only source: the official submit path serializes our chips, and
    // the empty candidate group never shows in the @ menu.
    scope.effect(() => scope.inputTriggers.registerSource({
      trigger: '@', name: SOURCE, order: 1000, showGroupTitle: false,
      candidates: async () => [],
      onPick: () => undefined,
      openReference(session, value) {
        const annotation = decode(value.ref)
        if (annotation === undefined) return false
        previews.open(session.sessionId, annotation)
        return true
      },
      codec: {
        clipboardText: (ref) => { const annotation = decode(ref); return annotation ? text(annotation, t) : '' },
        serialize: async (ref) => {
          const annotation = decode(ref)
          if (annotation === undefined) throw new Error(t('invalid'))
          return text(annotation, t)
        },
      },
    }), 'annotation: reference source')
    scope.slots.inject('conversation.input.overlay', () => scope.slots.register({
      name: 'conversation.input.overlay', id: 'eduwork-annotation', order: 10, locale: NS,
      inject: sessionId => ({
        sessionId, previews,
        insert(value, inputActions) {
          const actx = scope.sessions.scope(sessionId)
          if (actx === undefined) return
          const caret = inputActions.captureInsertion()
          const span = { start: caret.end, end: caret.end, draftRev: caret.draftRev }
          const input = scope.get('conversation')?.input?.for(actx)
          if (actx.bail(actx, 'slash/input-insert-reference', { reference: value, span }) === true) input?.focus()
          else input?.notify('error', t('insertFailed'))
        },
      }),
    }, AnnotationOverlay))
  })
}
