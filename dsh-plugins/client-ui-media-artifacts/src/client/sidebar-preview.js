import React, { useEffect, useState } from 'react'
import { parseFileAddress, sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { PreviewContent } from './deliverables.js'
import { basename, extension } from './deliverable-utils.js'

const h = React.createElement
const id = '@eduwork/workspace-artifact-preview'
// rc.1 owns Markdown/code/HTML/PDF/image/text document previews. Extend only
// Office and audio/video, using the exact same renderer as Studio.
const renderedExtensions = ['docx', 'xlsx', 'pptx', 'mp3', 'wav', 'ogg', 'opus', 'm4a', 'aac', 'flac', 'mp4', 'webm', 'mov']
const button = { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 7, padding: '5px 9px', background: 'var(--dsw-alias-bg-base)', color: 'inherit', cursor: 'pointer', fontSize: 12 }

// DSH owns tabs, navigation, splitting and fullscreen. This extension only
// supplies the same file renderer used by Studio for formats beyond plain text.
export const artifactTabDefinition = {
  id, kind: 'eduwork-artifact', priority: 'extension',
  patterns: renderedExtensions.map(value => `*.${value}`),
  canOpen: address => {
    const file = parseFileAddress(address)
    return file !== undefined && renderedExtensions.includes(extension(file.path))
  },
  title: address => basename(parseFileAddress(address)?.path || address),
}

function ArtifactTab({ useTabInfo, sessionId, previewFile, revealFile }) {
  const { tab } = useTabInfo()
  const file = parseFileAddress(tab.contentId)
  const ownerSession = file?.scope === 'session' ? file.sessionId : sessionId
  const path = file?.path
  const [read, setRead] = useState({ busy: true })
  const [retry, setRetry] = useState(0)
  const [sourceMode, setSourceMode] = useState(false)
  const [actionError, setActionError] = useState('')
  useEffect(() => {
    let disposed = false
    setRead({ busy: true }); setSourceMode(false); setActionError('')
    if (!path) { setRead({ error: '文件地址不可用' }); return }
    previewFile(ownerSession, path).then(
      preview => { if (!disposed && !tab.signal.aborted) setRead({ preview }) },
      error => { if (!disposed && !tab.signal.aborted) setRead({ error: error.message || String(error) }) },
    )
    return () => { disposed = true }
  }, [ownerSession, path, tab.navigation.revision, tab.signal, retry])
  const reveal = async () => {
    setActionError('')
    try { await revealFile(ownerSession, path) }
    catch (error) { setActionError(error.message || String(error)) }
  }
  return h('section', { 'data-eduwork-artifact-tab': '', 'aria-label': `预览 ${path || ''}`, style: { height: '100%', minHeight: 0, display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)', color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-base)' } },
    h('header', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: 10, borderBottom: '1px solid var(--dsw-alias-border-l2)' } },
      h('span', { title: path, style: { flex: 1, minWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 } }, path),
      read.preview?.encoding === 'utf8' && ['md', 'html'].includes(extension(path)) && h('button', { type: 'button', style: button, onClick: () => setSourceMode(value => !value) }, sourceMode ? '预览' : '源码'),
      h('button', { type: 'button', style: button, onClick: reveal }, '定位'),
      read.preview?.downloadUrl && h('a', { href: read.preview.downloadUrl, download: basename(path), style: { ...button, textDecoration: 'none' } }, '下载'),
      h('button', { type: 'button', style: button, onClick: () => setRetry(value => value + 1), 'aria-label': '刷新文件预览' }, '刷新'),
      actionError && h('p', { role: 'alert', style: { width: '100%', margin: 0 } }, actionError)),
    h('div', { style: { height: '100%', minHeight: 0, overflow: 'hidden' } },
      read.busy ? h('p', { role: 'status', style: { padding: 20 } }, '正在读取预览…')
        : read.error ? h('div', { style: { padding: 20 } }, h('p', { role: 'alert' }, read.error), h('button', { type: 'button', style: button, onClick: () => setRetry(value => value + 1) }, '重试'))
          : h(PreviewContent, { preview: read.preview, path, sourceMode })))
}

export function installSidebarPreview(ctx, { previewFile, revealFile }) {
  const sidebar = ctx.get('sidebarRight')
  const tabs = ctx.get('sidebarRightTabs')
  if (!sidebar || !tabs) return undefined
  ctx.effect(() => tabs.register(artifactTabDefinition), 'eduwork: rendered file type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: id, inject: () => ({ previewFile, revealFile }),
  }, ArtifactTab)), 'eduwork: shared file renderer')
  return (path, sessionId) => {
    sidebar.openResource(sessionFileAddress(sessionId, path))
    return true
  }
}
