import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { SOURCE, MAX_NOTE, decode, reference, text } from './reference.js'
import { place } from './position.js'
import { annotations, occurrenceSpan, messageOrigin, closingMessage } from './draft.js'
import { fragment } from '../protocol.js'
import { AnnotatedContent } from './history.js'
import { SENT_ANNOTATION, sentAnnotationRule } from './sent.js'

export const inject = ['locale']
const h = React.createElement
const NS = 'eduwork.annotation'
const UI = 'data-eduwork-annotation-ui'
const MARKER = 'data-eduwork-annotation-marker'

const copy = {
  zh: {
    selectedText: '所选文本：', expandQuote: '展开原文', collapseQuote: '收起原文',
    quote: '批注', notePlaceholder: '添加批注（可选）', add: '加入输入框', cancel: '取消', close: '关闭',
    notePrefix: '批注：', noted: '批注', preview: '引用内容', invalid: '引用内容已损坏。', insertFailed: '当前无法插入引用，请稍后再试。',
    count: '条批注', number: '批注', edit: '编辑', remove: '删除', save: '保存', empty: '暂无待发送批注',
    editFailed: '引用已变化或输入框暂不可编辑。内容已保留，请取消后重新打开，或稍后重试。',
    noteLabel: '批注内容', list: '待发送批注', readonly: '这条引用已不在当前草稿中，仅供查看。',
    finishEdit: '请先保存或取消正在编辑的批注。',
  },
  en: {
    selectedText: 'Selected text:', expandQuote: 'Expand quote', collapseQuote: 'Collapse quote',
    quote: 'Annotate', notePlaceholder: 'Add a note (optional)', add: 'Add to message', cancel: 'Cancel', close: 'Close',
    notePrefix: 'Note: ', noted: 'note', preview: 'Quoted text', invalid: 'This quote is damaged.', insertFailed: 'The quote cannot be inserted right now. Try again later.',
    count: 'annotations', number: 'Annotation', edit: 'Edit', remove: 'Delete', save: 'Save', empty: 'No pending annotations',
    editFailed: 'The reference changed or the composer is not editable. Your note is preserved. Cancel and reopen it, or retry later.',
    noteLabel: 'Annotation text', list: 'Pending annotations', readonly: 'This reference is no longer in the current draft and is read-only.',
    finishEdit: 'Save or cancel the current edit before opening another annotation.',
  },
}

const border = 'var(--dsw-alias-border-l2, #e6e6e6)'
const layer = 'var(--dsw-alias-bg-layer-3, #fff)'
const primary = 'var(--dsw-alias-label-primary, #191919)'
const secondary = 'var(--dsw-alias-label-secondary, #666)'
const accent = 'var(--dsw-alias-state-business-primary, #9f2636)'
const card = { position: 'fixed', zIndex: 1000, background: layer, color: primary, border: `1px solid ${border}`, borderRadius: 10, boxShadow: '0 6px 24px rgba(0,0,0,.12)', fontSize: 13 }
const button = filled => ({ border: `1px solid ${filled ? accent : border}`, borderRadius: 7, padding: '5px 10px', background: filled ? accent : 'transparent', color: filled ? '#fff' : primary, cursor: 'pointer', fontSize: 12 })

// Preserve display of messages already sent by the earlier test client.
// Render only a display projection via DSH's public user-text node slot. React
// escapes quote/note strings; no Markdown/HTML parsing or transcript mutation.
// Inline-only elements also fit the official Queue and compact text surfaces.
function SentAnnotation({ node, interactive, t }) {
  const { index, quote, note } = node.data
  const [expanded, setExpanded] = useState(false)
  const collapsible = interactive && (quote.length > 240 || quote.split('\n').length > 4)
  const collapsed = collapsible && !expanded
  return h('span', {
    'data-eduwork-sent-annotation': index,
    style: { display: 'inline-block', verticalAlign: 'top', boxSizing: 'border-box', width: '100%', minWidth: 0,
      margin: '4px 0', padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 10,
      background: layer, color: primary, whiteSpace: 'normal', lineHeight: 1.55, overflowWrap: 'anywhere' },
  },
  h('span', { style: { display: 'block', marginBottom: 6, fontSize: 12, color: secondary, fontWeight: 600 } }, `${t('number')} ${index}`),
  h('span', { 'data-annotation-quote': '', style: {
    display: collapsed ? '-webkit-box' : 'block', paddingLeft: 10, borderLeft: `2px solid ${border}`,
    color: secondary, whiteSpace: 'pre-wrap', ...(collapsed ? { WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : {}),
  } }, quote),
  collapsible ? h('button', { type: 'button', 'aria-expanded': expanded, onClick: () => setExpanded(value => !value),
    style: { ...button(false), marginTop: 6 },
  }, t(expanded ? 'collapseQuote' : 'expandQuote')) : null,
  note === '' ? null : h('span', { 'data-annotation-note': '', style: { display: 'block', marginTop: 8, whiteSpace: 'pre-wrap' } }, note))
}

function SentAnnotations(props) {
  const items = props.node.data.items
  return items ? h(React.Fragment, null, ...items.map(item => h(SentAnnotation, {
    ...props, key: item.index, node: { ...props.node, data: item },
  }))) : h(SentAnnotation, props)
}

function createPreviews() {
  const values = new Map()
  const locked = new Set()
  const listeners = new Set()
  const emit = () => { for (const listener of listeners) listener() }
  return {
    get: id => values.get(id),
    isLocked: id => locked.has(id),
    open(id, annotation) {
      if (locked.has(id)) {
        const current = values.get(id)
        if (current) { values.set(id, { ...current, blocked: true }); emit() }
        return false
      }
      values.set(id, annotation); emit(); return true
    },
    lock(id) { locked.add(id); return () => { locked.delete(id) } },
    close(id) { locked.delete(id); if (values.delete(id)) emit() },
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

function readSelection(marker, resolveOrigin) {
  const selection = document.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const quote = selection.toString().trim()
  if (quote === '') return null
  const range = selection.getRangeAt(0)
  const node = range.commonAncestorContainer
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
  if (!element || element.closest(`[contenteditable="true"], input, textarea, [${UI}]`)) return null
  if (!ownsSelection(marker, element)) return null
  // The one DOM adapter: read the official Chat row identity. All message data
  // comes from the public snapshot. Context is bounded to this selected row.
  const row = element.closest('[data-chat-node-key]')
  if (!row || !row.contains(range.startContainer) || !row.contains(range.endContainer)) return null
  const origin = resolveOrigin(row.getAttribute('data-chat-node-key'))
  if (!origin) return null
  const before = range.cloneRange(), after = range.cloneRange()
  before.selectNodeContents(row); before.setEnd(range.startContainer, range.startOffset)
  after.selectNodeContents(row); after.setStart(range.endContainer, range.endOffset)
  const context = { before: before.toString().slice(-320), after: after.toString().slice(0, 320) }
  const rects = range.getClientRects()
  const rect = rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect()
  return { quote, origin, context, x: rect.right, y: rect.bottom, range: range.cloneRange() }
}

function useSelectionTarget(marker, paused, resolveOrigin) {
  const [target, setTarget] = useState(null)
  useEffect(() => {
    if (paused) return undefined
    let frame = 0
    const settle = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setTarget(readSelection(marker.current, resolveOrigin))) }
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
  }, [marker, paused, resolveOrigin])
  return [target, setTarget]
}

function useFloating(target) {
  const ref = useRef(null)
  const [position, setPosition] = useState({ left: 8, top: 8 })
  useLayoutEffect(() => {
    const panel = ref.current
    const update = () => {
      const rects = target.range?.getClientRects()
      const anchor = rects?.length ? rects[rects.length - 1] : null
      const size = panel.getBoundingClientRect()
      const next = place(anchor?.right ?? target.x, anchor?.bottom ?? target.y,
        size.width, size.height, window.innerWidth, window.innerHeight, anchor?.top ?? target.y)
      setPosition(previous => previous.left === next.left && previous.top === next.top ? previous : next)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(panel)
    // A range can move without a scroll or a panel resize (streamed text,
    // an image loading above it, or a font change). Sample only while this
    // floating UI is mounted; do not keep a frame loop running per session.
    const movement = window.setInterval(update, 100)
    document.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.clearInterval(movement)
      document.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [target])
  return [ref, position]
}

function QuoteButton({ target, t, onClick }) {
  const [ref, position] = useFloating(target)
  return h('button', {
    ref, [UI]: '', type: 'button', style: { ...card, ...position, display: 'flex', alignItems: 'center', gap: 4, padding: '5px 12px', cursor: 'pointer' },
    onMouseDown: event => event.preventDefault(), onClick,
  }, h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true },
    h('path', { d: 'M8 3v10M3 8h10' })), t('quote'))
}

function Editor({ draft, t, onAdd, onCancel }) {
  const [note, setNote] = useState('')
  const [ref, position] = useFloating(draft)
  const submit = () => onAdd(note)
  return h('div', { ref, [UI]: '', role: 'dialog', style: { ...card, ...position, width: 320, maxWidth: 'calc(100vw - 16px)', maxHeight: 'calc(100vh - 16px)', boxSizing: 'border-box', overflowY: 'auto', padding: 12 } },
    h('div', { style: { marginBottom: 8, color: secondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, draft.quote),
    h('textarea', {
      autoFocus: true, value: note, maxLength: MAX_NOTE, rows: 3, placeholder: t('notePlaceholder'), 'aria-label': t('noteLabel'),
      onChange: event => setNote(event.target.value),
      onKeyDown: (event) => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
        if (event.key === 'Escape') onCancel()
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() }
      },
      style: { width: '100%', boxSizing: 'border-box', resize: 'vertical', border: `1px solid ${border}`, borderRadius: 7, padding: 7, font: 'inherit', background: 'transparent', color: primary },
    }),
    h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 } },
      h('button', { type: 'button', onClick: onCancel, style: button(false) }, t('cancel')),
      h('button', { type: 'button', onClick: submit, style: button(true) }, t('add'))))
}

function Preview({ panel, items, sessionId, previews, t, onClose, onOpen, onSave, onRemove }) {
  const ref = useRef(null)
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState(panel.annotation?.note ?? '')
  const [failed, setFailed] = useState(false)
  useLayoutEffect(() => editing ? previews.lock(sessionId) : undefined, [editing, previews, sessionId])
  const entry = panel.occurrenceId === undefined ? undefined : items.find(item =>
    item.occurrenceId === panel.occurrenceId && item.ref === panel.ref)
  const annotation = panel.annotation
  const save = () => { if (!onSave(panel, note)) setFailed(true) }
  const remove = () => { if (!onRemove(panel)) setFailed(true) }
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    const onOutside = (event) => { if (!ref.current?.contains(event.target)) onClose() }
    // Do not discard an unfinished edit when focus moves to the composer/window.
    // Closing while editing is an explicit Cancel action below.
    if (editing) return undefined
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onOutside, true)
    document.addEventListener('focusin', onOutside)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onOutside, true)
      document.removeEventListener('focusin', onOutside)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose, editing])
  // Bound the whole preview, not only the quote: long notes must remain
  // readable and the dialog must fit even when the window is short.
  return h('div', { ref, [UI]: '', role: 'dialog', 'aria-label': t(panel.kind === 'list' ? 'list' : 'preview'), style: { ...card, left: '50%', bottom: 'min(160px, 20vh)', transform: 'translateX(-50%)', width: 'min(560px, calc(100vw - 32px))', maxHeight: 'calc(100vh - min(160px, 20vh) - 16px)', boxSizing: 'border-box', overflowY: 'auto', padding: 14 } },
    h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 } },
      h('strong', null, entry ? `${t('number')} ${entry.number}` : t(panel.kind === 'list' ? 'list' : 'preview')),
      h('button', { type: 'button', onClick: onClose, style: button(false) }, t(editing ? 'cancel' : 'close'))),
    panel.kind === 'list'
      ? items.length === 0 ? h('p', null, t('empty')) : h('ol', { style: { paddingLeft: 24, marginBottom: 0 } }, items.map(item =>
        h('li', { key: item.occurrenceId, style: { paddingBottom: 6 } }, h('button', {
          type: 'button', onClick: () => onOpen(item), style: { ...button(false), width: '100%', textAlign: 'left', whiteSpace: 'normal', overflowWrap: 'anywhere' },
        }, item.annotation.quote.length > 100 ? `${item.annotation.quote.slice(0, 100)}…` : item.annotation.quote))))
      : h(React.Fragment, null,
        h('blockquote', { style: { margin: 0, padding: '0 0 0 10px', borderLeft: `3px solid ${border}`, color: secondary, maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, annotation.quote),
        editing ? h('textarea', {
          autoFocus: true, value: note, maxLength: MAX_NOTE, rows: 4, 'aria-label': t('noteLabel'),
          onChange: event => setNote(event.target.value),
          onKeyDown: event => {
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
            if (event.key === 'Escape') { event.preventDefault(); onClose() }
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); save() }
          },
          style: { width: '100%', boxSizing: 'border-box', marginTop: 10, padding: 8, border: `1px solid ${border}`, borderRadius: 7, font: 'inherit', background: 'transparent', color: primary },
        }) : annotation.note === '' ? null : h('p', { style: { margin: '10px 0 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, `${t('notePrefix')}${annotation.note}`),
        !entry && !editing ? h('p', { style: { color: secondary } }, t('readonly')) : null,
        failed ? h('p', { role: 'alert' }, t('editFailed')) : null,
        panel.blocked ? h('p', { role: 'status' }, t('finishEdit')) : null,
        entry || editing ? h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 } },
          h('button', { type: 'button', onClick: remove, style: button(false) }, t('remove')),
          h('button', { type: 'button', onClick: editing ? save : () => setEditing(true), style: button(true) }, t(editing ? 'save' : 'edit'))) : null))
}

function entryPanel(item) {
  return { kind: 'entry', occurrenceId: item.occurrenceId, ref: item.ref, annotation: item.annotation }
}

function AnnotationCount({ sessionId, previews, useInput, t }) {
  const occurrences = useInput(state => state.occurrences)
  const count = annotations(occurrences).length
  return count === 0 ? null : h('button', {
    [UI]: '', type: 'button', style: button(false), onClick: () => previews.open(sessionId, { kind: 'list' }),
  }, `${count} ${t('count')}`)
}

function MessageAnnotations({ sessionId, turn, previews, useInput, useConversation, t }) {
  const messageId = useConversation(state => closingMessage(state.views.get('chat'), turn.turn))
  const occurrences = useInput(state => state.occurrences)
  const items = annotations(occurrences).filter(item => item.annotation.origin?.sessionId === sessionId && item.annotation.origin.messageId === messageId)
  return items.length === 0 ? null : h('span', { [UI]: '', 'data-eduwork-annotation-message': messageId, style: { display: 'inline-flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' } },
    h('span', { style: { fontSize: 12, color: secondary } }, t('number')),
    ...items.map(item => h('button', {
      key: item.occurrenceId, type: 'button', 'aria-label': `${t('number')} ${item.number}`, title: item.annotation.quote.slice(0, 120),
      style: { ...button(false), padding: '2px 7px', minWidth: 28, minHeight: 28, borderRadius: 20 }, onClick: () => previews.open(sessionId, entryPanel(item)),
    }, String(item.number))))
}

function AnnotationOverlay({ sessionId, previews, insert, mutate, t, inputActions, useInput, useConversation }) {
  const marker = useRef(null)
  const [draft, setDraft] = useState(null)
  const chat = useConversation(state => state.views.get('chat'))
  const chatRef = useRef(chat)
  chatRef.current = chat
  const resolver = useRef(key => messageOrigin(chatRef.current, key, sessionId))
  const [target, setTarget] = useSelectionTarget(marker, draft !== null, resolver.current)
  const occurrences = useInput(state => state.occurrences)
  const items = annotations(occurrences)
  const preview = useSyncExternalStore(previews.subscribe, () => previews.get(sessionId))
  useLayoutEffect(() => draft ? previews.lock(sessionId) : undefined, [draft, previews, sessionId])
  useEffect(() => () => previews.close(sessionId), [previews, sessionId])
  const add = (note) => {
    const value = reference(draft.quote, note, t, draft.origin, draft.context)
    // The official composer may reject an insertion while submitting or
    // after a draft revision changes. Keep the editor and note for retry.
    if (value !== undefined && insert(value, inputActions) === true) setDraft(null)
  }
  return h('span', { [MARKER]: '', ref: marker, hidden: true },
    target && !draft ? createPortal(h(QuoteButton, {
      target, t,
      onClick: () => {
        if (previews.isLocked(sessionId)) { previews.open(sessionId, { kind: 'list' }); return }
        previews.close(sessionId)
        setDraft(target); setTarget(null); document.getSelection()?.removeAllRanges()
      },
    }), document.body) : null,
    draft ? createPortal(h(Editor, { draft, t, onAdd: add, onCancel: () => setDraft(null) }), document.body) : null,
    preview ? createPortal(h(Preview, {
      key: `${preview.kind}:${preview.occurrenceId ?? preview.ref ?? ''}`, panel: preview, items, sessionId, previews, t,
      onClose: () => previews.close(sessionId), onOpen: item => previews.open(sessionId, entryPanel(item)),
      onSave: (expected, note) => {
        const value = reference(expected.annotation.quote, note, t, expected.annotation.origin, expected.annotation.context)
        if (!value || !mutate(expected, value, inputActions)) return false
        previews.close(sessionId); return true
      },
      onRemove: expected => {
        if (!mutate(expected, null, inputActions)) return false
        previews.close(sessionId); return true
      },
    }), document.body) : null)
}

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, copy), 'annotation: dictionaries')
  const t = ctx.locale.bind(NS)
  const previews = createPreviews()
  ctx.inject(['uiConversation', 'slots'], scope => {
    scope.effect(() => scope.uiConversation.userText.register(sentAnnotationRule), 'annotation: sent text projection')
    scope.slots.inject('conversation.user.text.node', () => scope.slots.register({
      name: 'conversation.user.text.node', key: SENT_ANNOTATION, priority: 100, locale: NS,
    }, SentAnnotations))
  })
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
        const actx = scope.sessions.scope(session.sessionId)
        const input = actx && scope.get('conversation')?.input?.for(actx)
        const matches = annotations(input?.state.getSnapshot().occurrences ?? []).filter(item => item.ref === value.ref)
        // A copied chip may have the same payload twice. Do not guess which
        // occurrence was clicked: let the native-order list disambiguate.
        previews.open(session.sessionId, matches.length > 1 ? { kind: 'list' } : matches.length === 1
          ? entryPanel(matches[0]) : { kind: 'entry', ref: value.ref, annotation })
        return true
      },
      codec: {
        clipboardText: (ref) => { const annotation = decode(ref); return annotation ? text(annotation, t) : '' },
        serialize: async (ref) => {
          const annotation = decode(ref)
          if (annotation === undefined) throw new Error(t('invalid'))
          return fragment(annotation)
        },
      },
    }), 'annotation: reference source')
    scope.slots.inject('conversation.chat.user.decorate', () => scope.slots.register({
      name: 'conversation.chat.user.decorate', id: 'eduwork-annotation', locale: NS,
    }, AnnotatedContent))
    scope.slots.inject('conversation.input.overlay', () => scope.slots.register({
      name: 'conversation.input.overlay', id: 'eduwork-annotation', order: 10, locale: NS,
      inject: sessionId => ({
        sessionId, previews,
        insert(value, inputActions) {
          const actx = scope.sessions.scope(sessionId)
          if (actx === undefined) return false
          const caret = inputActions.captureInsertion()
          const span = { start: caret.end, end: caret.end, draftRev: caret.draftRev }
          const input = scope.get('conversation')?.input?.for(actx)
          const accepted = actx.bail(actx, 'slash/input-insert-reference', { reference: value, span }) === true
          if (accepted) input?.focus()
          else input?.notify('error', t('insertFailed'))
          return accepted
        },
        mutate(expected, value, inputActions) {
          const actx = scope.sessions.scope(sessionId)
          const input = actx && scope.get('conversation')?.input?.for(actx)
          if (!input) return false
          const span = occurrenceSpan(input.state.getSnapshot(), expected)
          if (!span) return false
          const accepted = value === null ? inputActions.insertText('', span)
            : actx.bail(actx, 'slash/input-insert-reference', { reference: value, span }) === true
          if (accepted) input.focus()
          return accepted
        },
      }),
    }, AnnotationOverlay))
    for (const [name, component] of [
      ['conversation.input.left', AnnotationCount],
      // The official tail slot stays visible on older replies and can wrap.
      // The icon-actions row deliberately hides on hover and has fixed height.
      ['conversation.chat.turnTail', MessageAnnotations],
    ]) scope.slots.inject(name, () => scope.slots.register({
      name, id: 'eduwork-annotation', order: 10, locale: NS,
      inject: sessionId => ({ sessionId, previews }),
    }, component))
  })
}
