import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { mountOfficePreview } from '@eduwork/dsh-artifact-services/office-preview-client'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  basename, extension, fileVisual, normalizedPath, pathSegments, previewActionLabel, previewModeLabel, previewSupport, shortestUniqueLabels,
} from './deliverable-utils.js'
import { successfulArtifactPaths, trackedArtifactCall } from './produced-file-tracker.js'

const h = React.createElement
const collapsedLimit = 4
const maxPreviewTabs = 8
const artifactMarkdownLabels = Object.freeze({
  code: Object.freeze({ copyLabel: '复制代码', copiedLabel: '已复制' }),
  footnotes: '脚注',
})

function producedForClosing(data, seq = Number.POSITIVE_INFINITY) {
  if (data === undefined) return []
  const paths = []
  const seen = new Set()
  for (const produced of data.produced) {
    if (produced.seq > seq || seen.has(produced.path)) continue
    seen.add(produced.path)
    paths.push(produced.path)
  }
  return paths
}

function selectProducedFiles(owner) {
  const paths = producedForClosing(owner.turn.data.get('deliverables'), owner.seq)
  return paths.length === 0 ? null : paths
}

const deliverablesDefinition = {
  kind: 'deliverables',
  match: event => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) return { id: String(event.data.turn), role: 'update' }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('deliverables start requires turn/start')
    return { turn: match.event.data.turn, calls: new Map(), produced: [] }
  },
  update: (context, match) => {
    if (match.event.type === 'tool/call') {
      const calls = new Map(context.state.calls)
      calls.set(String(match.event.data.callId), trackedArtifactCall(match.event.data.name, match.event.data.arguments))
      return { ...context.state, calls }
    }
    if (match.event.type !== 'tool/result') return context.state
    const result = match.event.data.message.content[0]
    if (result.isError === true) return context.state
    const callId = String(match.event.data.message.source.callId)
    const additions = successfulArtifactPaths(context.state.calls.get(callId), match.event.data.meta)
      .map(path => ({ seq: match.event.seq, path }))
    return additions.length === 0 ? context.state : { ...context.state, produced: [...context.state.produced, ...additions] }
  },
  buildLocationData: (context, scope) => scope !== 'turn' || context.state === undefined
    ? null
    : { kind: 'turn', turn: context.state.turn, key: 'deliverables', value: { produced: context.state.produced } },
}

function onlyPathWithBasename(paths, value) {
  const matches = paths.filter(path => basename(path) === value)
  return matches.length === 1 ? matches[0] : undefined
}

function producedFileMentions(paths, open) {
  return {
    resolve(value) {
      const path = paths.includes(value) ? value : onlyPathWithBasename(paths, value)
      if (path === undefined) return undefined
      return { open: () => open(path), label: `打开 ${path}`, title: path }
    },
  }
}

const smallButton = { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, padding: '5px 9px', background: 'var(--dsw-alias-bg-base)', color: 'inherit', cursor: 'pointer', fontSize: 12 }
const closeButton = { border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 22, lineHeight: 1 }
const menuButton = { display: 'block', width: '100%', padding: '8px 10px', border: 0, borderRadius: 7, background: 'transparent', color: 'inherit', cursor: 'pointer', textAlign: 'left', fontSize: 12 }

export const artifactInteractiveCss = `
[data-chatecnu-artifact-action] { transition: background-color .14s ease, border-color .14s ease, color .14s ease; }
[data-chatecnu-artifact-action]:hover { background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 8%, transparent)) !important; }
[data-chatecnu-artifact-action]:focus-visible { outline: 2px solid var(--dsw-alias-interactive-focus, #5963c7); outline-offset: 2px; }
[data-chatecnu-artifact-row]:hover { border-color: var(--dsw-alias-border-l1, var(--dsw-alias-border-l2)) !important; background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 6%, transparent)) !important; }
`

function isMarkdownPreview(preview, path) {
  return preview?.mime === 'text/markdown' || extension(path) === 'md'
}

function isHtmlPreview(preview, path) {
  return preview?.mime === 'text/html' || ['html', 'docx', 'xlsx', 'pptx'].includes(extension(path))
}

function sandboxedHtml(source) {
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:">`
  if (/<head(?:\s[^>]*)?>/i.test(source)) return source.replace(/<head(?:\s[^>]*)?>/i, match => `${match}${policy}`)
  return `<!doctype html><html><head><meta charset="utf-8">${policy}</head><body>${source}</body></html>`
}

function formattedText(preview) {
  if (preview.mime !== 'application/json') return preview.data
  try { return JSON.stringify(JSON.parse(preview.data), null, 2) }
  catch { return preview.data }
}

function OfficePreviewContent({ preview, expand }) {
  const container = useRef(null)
  const controller = useRef(null)
  const [error, setError] = useState('')
  useEffect(() => {
    setError('')
    const viewer = mountOfficePreview(container.current, {
      preview: { html: preview.data, bytes: preview.bytes, description: preview.officePreview },
      title: preview.name,
      onExpand: expand,
      onError: error => setError(error.message || String(error)),
    })
    controller.current = viewer
    return () => { viewer.destroy(); controller.current = null }
  }, [preview])
  useEffect(() => { controller.current?.update({ onExpand: expand }) }, [expand])
  return h('div', { style: { height: '100%', minHeight: 0 }, 'data-conversation-office-preview': '' },
    error && h('p', { role: 'alert' }, error),
    h('div', { ref: container, style: { height: '100%', minHeight: 0 } }))
}

export function PreviewContent({ preview, path, sourceMode, expand }) {
  const source = preview.encoding === 'base64'
    ? `data:${preview.mime};base64,${preview.data}`
    : preview.encoding === 'url' ? preview.data : undefined
  if (preview.mime.startsWith('image/')) return h('img', { src: source, alt: preview.name, style: { display: 'block', width: '100%', height: '100%', objectFit: 'contain' } })
  if (preview.mime.startsWith('audio/')) return h('div', { style: { display: 'grid', placeItems: 'center', height: '100%', padding: 24 } }, h('audio', { src: source, controls: true, style: { width: 'min(100%, 560px)' } }))
  if (preview.mime.startsWith('video/')) return h('div', { style: { display: 'grid', placeItems: 'center', height: '100%', padding: 16, background: '#111' } }, h('video', { src: source, controls: true, preload: 'metadata', style: { display: 'block', width: '100%', height: '100%', objectFit: 'contain' } }))
  if (preview.mime === 'application/pdf') return h('iframe', { src: source, title: preview.name, style: { width: '100%', height: '100%', border: 0, background: '#fff' } })
  if (isMarkdownPreview(preview, path) && !sourceMode) return h('div', { style: { height: '100%', overflow: 'auto', padding: '20px 22px', background: 'var(--dsw-alias-bg-base)' } }, h(MarkdownText, { text: preview.data, labels: artifactMarkdownLabels }))
  if (['slides', 'document'].includes(preview.officePreview?.kind) && !sourceMode) return h(OfficePreviewContent, { preview, expand })
  if (isHtmlPreview(preview, path) && !sourceMode) return h('iframe', { srcDoc: sandboxedHtml(preview.data), sandbox: '', referrerPolicy: 'no-referrer', title: preview.name, style: { width: '100%', height: '100%', border: 0, background: '#fff' } })
  return h('pre', { style: { margin: 0, padding: 18, minHeight: '100%', overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', font: '12px/1.65 ui-monospace, SFMono-Regular, Consolas, monospace' } }, formattedText(preview))
}

function FileGlyph({ path, size = 28 }) {
  const visual = fileVisual(path)
  return h('span', { 'aria-hidden': 'true', title: visual.label, style: {
    display: 'inline-grid', flex: '0 0 auto', placeItems: 'center', width: size, height: size,
    borderRadius: Math.max(6, Math.round(size * .24)), background: `color-mix(in srgb, ${visual.tone} 14%, var(--dsw-alias-bg-base))`,
    border: `1px solid color-mix(in srgb, ${visual.tone} 28%, transparent)`, color: visual.tone,
    fontSize: visual.glyph.length > 2 ? Math.max(8, size * .28) : Math.max(11, size * .42), fontWeight: 760,
  } }, visual.glyph)
}

const emptyPanel = Object.freeze({ sessionId: null, tabs: [], activePath: null })
let previewPanel = emptyPanel
let previewRequest = 0
const previewListeners = new Set()
let previewDetailsActivation

function publishPreviewPanel(next) {
  previewPanel = next
  for (const listener of previewListeners) listener()
}

function subscribePreviewPanel(listener) {
  previewListeners.add(listener)
  return () => previewListeners.delete(listener)
}

function updatePreviewTab(sessionId, path, update) {
  if (previewPanel.sessionId !== sessionId) return
  const tabs = previewPanel.tabs.map(tab => tab.path === path ? update(tab) : tab)
  publishPreviewPanel({ ...previewPanel, tabs })
}

export function openArtifactPreview({ sessionId, path, previewFile, openFile, openDetails }) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) throw new Error('请先打开产生该文件的会话')
  if (openDetails(path, sessionId) === true) return
  const requestId = ++previewRequest
  const existing = previewPanel.sessionId === sessionId ? previewPanel.tabs.filter(tab => tab.path !== path) : []
  const support = previewSupport(path)
  const tab = { path, support, busy: support !== 'unsupported', error: '', preview: null, requestId, openFile }
  publishPreviewPanel({ sessionId, tabs: [...existing, tab].slice(-maxPreviewTabs), activePath: path })
  previewDetailsActivation?.activate()
  if (support === 'unsupported') return
  Promise.resolve(previewFile(sessionId, path)).then(
    preview => updatePreviewTab(sessionId, path, current => current.requestId === requestId ? { ...current, busy: false, preview, error: '' } : current),
    cause => updatePreviewTab(sessionId, path, current => current.requestId === requestId ? { ...current, busy: false, preview: null, error: cause instanceof Error ? cause.message : String(cause) } : current),
  )
}

function selectPreviewTab(sessionId, path) {
  if (previewPanel.sessionId === sessionId && previewPanel.tabs.some(tab => tab.path === path)) publishPreviewPanel({ ...previewPanel, activePath: path })
}

function closePreviewTab(sessionId, path) {
  if (previewPanel.sessionId !== sessionId) return false
  const index = previewPanel.tabs.findIndex(tab => tab.path === path)
  const tabs = previewPanel.tabs.filter(tab => tab.path !== path)
  if (tabs.length === 0) {
    publishPreviewPanel(emptyPanel)
    previewDetailsActivation?.deactivate()
    return true
  }
  const activePath = previewPanel.activePath === path ? tabs[Math.min(index, tabs.length - 1)].path : previewPanel.activePath
  publishPreviewPanel({ ...previewPanel, tabs, activePath })
  return false
}

function clearPreviewPanel(sessionId) {
  if (previewPanel.sessionId !== sessionId) return
  publishPreviewPanel(emptyPanel)
  previewDetailsActivation?.deactivate()
}

function Breadcrumbs({ path }) {
  const segments = pathSegments(path)
  return h('div', { title: normalizedPath(path), style: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden', color: 'var(--dsw-alias-label-secondary)', fontSize: 12 } },
    segments.map((segment, index) => h(React.Fragment, { key: `${segment}-${index}` },
      index > 0 && h('span', { 'aria-hidden': 'true', style: { color: 'var(--dsw-alias-label-tertiary)' } }, '›'),
      h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: index === segments.length - 1 ? '0 1 auto' : '0 10 auto', fontWeight: index === segments.length - 1 ? 650 : 400, color: index === segments.length - 1 ? 'var(--dsw-alias-label-primary)' : undefined } }, segment))))
}

export function ArtifactDetailsPanel({ sessionId, previewFile, revealFile, closeDetails }) {
  const state = useSyncExternalStore(subscribePreviewPanel, () => previewPanel, () => emptyPanel)
  const [sourceMode, setSourceMode] = useState(false)
  const [actionError, setActionError] = useState('')
  const active = state.sessionId === sessionId ? state.tabs.find(tab => tab.path === state.activePath) : undefined
  useEffect(() => {
    if (state.sessionId !== null && state.sessionId !== sessionId) clearPreviewPanel(state.sessionId)
  }, [sessionId, state.sessionId])
  useEffect(() => {
    setSourceMode(false); setActionError('')
  }, [active?.path])
  useEffect(() => {
    if (active === undefined) return undefined
    const key = event => {
      if (event.key !== 'Escape') return
      clearPreviewPanel(sessionId)
      closeDetails()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [active, closeDetails, sessionId])
  if (active === undefined) return null
  const labels = shortestUniqueLabels(state.tabs.map(tab => tab.path))
  const dismiss = () => { clearPreviewPanel(sessionId); closeDetails() }
  const retry = () => openArtifactPreview({ sessionId, path: active.path, previewFile, openFile: active.openFile, openDetails: () => {} })
  const reveal = async () => {
    setActionError('')
    try { await revealFile(sessionId, active.path) }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : String(cause)) }
  }
  return h('section', { role: 'dialog', 'aria-label': `预览 ${active.path}`, style: {
    position: 'relative', width: '100%', height: '100%', minWidth: 0, display: 'grid',
    gridTemplateRows: state.tabs.length > 1 ? 'auto auto minmax(0, 1fr)' : 'auto minmax(0, 1fr)',
    background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)',
  } },
  state.tabs.length > 1 && h('nav', { 'aria-label': '已打开的产物', style: { display: 'flex', gap: 3, padding: '7px 8px 0', overflowX: 'auto', borderBottom: '1px solid var(--dsw-alias-border-l2)' } },
    state.tabs.map((tab, index) => h('span', { key: tab.path, style: { display: 'inline-flex', alignItems: 'center', minWidth: 0, maxWidth: 210, borderRadius: '8px 8px 0 0', background: tab.path === active.path ? 'var(--dsw-alias-bg-module-platform)' : 'transparent' } },
      h('button', { type: 'button', 'data-chatecnu-artifact-action': '', title: normalizedPath(tab.path), onClick: () => selectPreviewTab(sessionId, tab.path), style: { minWidth: 0, padding: '6px 5px 6px 9px', border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 } }, labels[index]),
      h('button', { type: 'button', 'data-chatecnu-artifact-action': '', 'aria-label': `关闭 ${labels[index]}`, onClick: () => { if (closePreviewTab(sessionId, tab.path)) closeDetails() }, style: { border: 0, background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', cursor: 'pointer', padding: '4px 7px' } }, '×')))),
  h('header', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid var(--dsw-alias-border-l2)' } },
    h('span', { style: { minWidth: 0, display: 'grid', gap: 2 } },
      h(Breadcrumbs, { path: active.path }),
      h('small', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 10 } }, previewModeLabel(active.path))),
    h('span', { style: { display: 'flex', alignItems: 'center', gap: 5 } },
      active.preview && (isMarkdownPreview(active.preview, active.path) || isHtmlPreview(active.preview, active.path)) && h('button', { type: 'button', 'data-chatecnu-artifact-action': '', onClick: () => setSourceMode(value => !value), style: smallButton }, sourceMode ? '预览' : '源码'),
      h('button', { type: 'button', 'data-chatecnu-artifact-action': '', onClick: reveal, style: smallButton }, '定位'),
      h('button', { type: 'button', 'data-chatecnu-artifact-action': '', onClick: () => active.openFile(active.path), style: smallButton }, '打开'),
      h('button', { type: 'button', 'data-chatecnu-artifact-action': '', onClick: dismiss, 'aria-label': '关闭预览', style: closeButton }, '×')),
    actionError && h('p', { role: 'alert', style: { gridColumn: '1 / -1', margin: 0, color: 'var(--dsw-alias-state-error-primary)', fontSize: 11 } }, actionError)),
  h('div', { style: { minHeight: 0, display: 'grid', placeItems: active.busy || active.error || active.support === 'unsupported' ? 'center' : 'stretch', overflow: 'hidden', background: 'var(--dsw-alias-bg-module-platform)' } },
    active.busy ? h('p', { style: { color: 'var(--dsw-alias-label-secondary)' } }, '正在读取预览…')
      : active.error ? h('div', { style: { maxWidth: 360, padding: 24, textAlign: 'center' } }, h('p', { role: 'alert' }, active.error), h('span', { style: { display: 'flex', justifyContent: 'center', gap: 8 } }, h('button', { type: 'button', 'data-chatecnu-artifact-action': '', onClick: retry, style: smallButton }, '重试'), h('button', { type: 'button', 'data-chatecnu-artifact-action': '', onClick: () => active.openFile(active.path), style: smallButton }, '使用本机应用打开')))
        : active.support === 'unsupported' ? h('div', { style: { maxWidth: 380, padding: 28, textAlign: 'center' } },
          h(FileGlyph, { path: active.path, size: 42 }),
          h('h3', { style: { margin: '12px 0 6px', fontSize: 15 } }, '该文件类型暂不支持预览'),
          h('p', { style: { margin: '0 0 15px', color: 'var(--dsw-alias-label-secondary)', fontSize: 12, lineHeight: 1.6 } }, `${fileVisual(active.path).label}需要由本机应用完整呈现。`),
          h('button', { type: 'button', 'data-chatecnu-artifact-action': '', onClick: () => active.openFile(active.path), style: smallButton }, '使用本机应用打开'))
        : h(PreviewContent, { preview: active.preview, path: active.path, sourceMode })))
}

function ContextMenu({ menu, path, onPreview, onOpen, onReveal, onError, onClose }) {
  useEffect(() => {
    const close = () => onClose()
    const key = event => { if (event.key === 'Escape') onClose() }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', key) }
  }, [onClose])
  const action = callback => event => {
    event.stopPropagation()
    onClose()
    Promise.resolve().then(callback).catch(cause => onError(cause instanceof Error ? cause.message : String(cause)))
  }
  return h('div', { role: 'menu', onPointerDown: event => event.stopPropagation(), style: {
    position: 'fixed', zIndex: 11600, left: Math.min(menu.x, window.innerWidth - 210), top: Math.min(menu.y, window.innerHeight - 190),
    width: 196, padding: 6, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 10,
    background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', boxShadow: '0 12px 38px rgba(0,0,0,.2)',
  } },
  h('button', { type: 'button', role: 'menuitem', 'data-chatecnu-artifact-action': '', onClick: action(onPreview), style: menuButton }, previewActionLabel(path)),
  h('button', { type: 'button', role: 'menuitem', 'data-chatecnu-artifact-action': '', onClick: action(onOpen), style: menuButton }, '打开'),
  h('button', { type: 'button', role: 'menuitem', 'data-chatecnu-artifact-action': '', onClick: action(onReveal), style: menuButton }, '在文件夹中显示'),
  h('button', { type: 'button', role: 'menuitem', 'data-chatecnu-artifact-action': '', onClick: action(() => navigator.clipboard?.writeText(path)), style: menuButton }, '复制路径'))
}

function ProducedFiles({ matched: paths, openFile, previewFile, revealFile, openDetails, sessionId }) {
  const [menu, setMenu] = useState(null)
  const [expanded, setExpanded] = useState(false)
  const [actionError, setActionError] = useState('')
  const shown = expanded ? paths : paths.slice(0, collapsedLimit)
  const hidden = paths.length - shown.length
  const labels = shortestUniqueLabels(paths)
  const labelByPath = new Map(paths.map((path, index) => [path, labels[index]]))
  const openPreview = path => openArtifactPreview({ sessionId, path, previewFile, openFile, openDetails })
  return h(React.Fragment, null,
    h('section', { style: { display: 'grid', gap: 6, margin: '12px 0 4px', padding: 9, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 11, background: 'var(--dsw-alias-bg-module-platform)' } },
      h('header', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '0 2px 2px' } },
        h('strong', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 12, fontWeight: 650 } }, `生成的文件 · ${paths.length}`),
        paths.length > collapsedLimit && h('button', { type: 'button', 'data-chatecnu-artifact-action': '', onClick: () => setExpanded(value => !value), style: { ...smallButton, padding: '3px 7px', borderColor: 'transparent', background: 'transparent', color: 'var(--dsw-alias-label-secondary)' } }, expanded ? '收起' : `再显示 ${hidden} 个`)),
      h('div', { style: { display: 'grid', gap: 5 } }, shown.map(path => h('div', { key: path, 'data-chatecnu-artifact-row': '', style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', border: '1px solid transparent', borderRadius: 9, background: 'var(--dsw-alias-bg-base)', transition: 'background-color .14s ease, border-color .14s ease' } },
        h('button', {
          type: 'button', title: normalizedPath(path), onClick: () => openPreview(path),
          onContextMenu: event => { event.preventDefault(); setMenu({ path, x: event.clientX, y: event.clientY }) },
          style: { minWidth: 0, display: 'flex', alignItems: 'center', gap: 9, padding: '6px 7px', border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', textAlign: 'left' },
        }, h(FileGlyph, { path }), h('span', { style: { minWidth: 0 } },
          h('span', { style: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 } }, labelByPath.get(path)),
          h('span', { style: { display: 'block', marginTop: 1, color: 'var(--dsw-alias-label-tertiary)', fontSize: 10 } }, fileVisual(path).label))),
        h('button', { type: 'button', 'data-chatecnu-artifact-action': '', 'aria-label': `更多操作：${labelByPath.get(path)}`, onClick: event => { const rect = event.currentTarget.getBoundingClientRect(); setMenu({ path, x: rect.right - 190, y: rect.bottom + 4 }) }, style: { border: 0, borderRadius: 7, background: 'transparent', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', padding: '7px 10px', fontSize: 16 } }, '⋯')))),
      actionError && h('p', { role: 'alert', style: { margin: '2px 2px 0', color: 'var(--dsw-alias-state-error-primary)', fontSize: 11 } }, actionError)),
    menu && h(ContextMenu, { menu, path: menu.path, onPreview: () => openPreview(menu.path), onOpen: () => openFile(menu.path), onReveal: () => revealFile(sessionId, menu.path), onError: setActionError, onClose: () => setMenu(null) }))
}

export function installDeliverables(ctx, { previewFile, revealFile, openDetails = () => ctx.layout.openDetails(), officialSidebar = false }) {
  ctx.uiConversation.events.register(deliverablesDefinition)
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail', select: selectProducedFiles,
    inject: () => ({ previewFile, revealFile, openDetails }),
  }, ProducedFiles))
  if (!officialSidebar) ctx.slots.inject('details', () => {
    let disposeEntry
    const activation = {
      activate() {
        if (disposeEntry !== undefined) return
        disposeEntry = ctx.slots.register({
          name: 'details', priority: -100,
          inject: () => ({ previewFile, revealFile, closeDetails: () => ctx.layout.closeDetails() }),
        }, ArtifactDetailsPanel)
      },
      deactivate() {
        disposeEntry?.()
        disposeEntry = undefined
      },
    }
    previewDetailsActivation = activation
    if (previewPanel.tabs.length > 0) activation.activate()
    return () => {
      activation.deactivate()
      if (previewDetailsActivation === activation) previewDetailsActivation = undefined
    }
  })
  ctx.provide('chatFileMentions', {
    forClosing(owner) {
      const paths = selectProducedFiles(owner)
      return paths === null ? undefined : producedFileMentions(paths, owner.openFile)
    },
  })
}
