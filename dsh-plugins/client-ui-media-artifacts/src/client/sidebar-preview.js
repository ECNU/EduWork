import React, { useEffect, useState } from 'react'
import { parseFileAddress, sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { basename, extension } from './deliverable-utils.js'

const h = React.createElement
const id = '@eduwork/workspace-artifact-preview'
// The pinned official document preview owns Office as well as PDF, images,
// HTML and text. Only register the audio/video formats it does not render.
const renderedExtensions = ['mp3', 'wav', 'ogg', 'opus', 'm4a', 'aac', 'flac', 'mp4', 'webm', 'mov']
const button = { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 7, padding: '5px 9px', background: 'var(--dsw-alias-bg-base)', color: 'inherit', cursor: 'pointer', fontSize: 12 }

// DSH owns tabs, navigation, splitting and fullscreen. This extension only
// supplies playback for formats the official document viewer does not render.
export const artifactTabDefinition = {
  id, kind: 'eduwork-artifact', priority: 'extension',
  patterns: renderedExtensions.map(value => `*.${value}`),
  canOpen: address => {
    const file = parseFileAddress(address)
    return file?.scope === 'session' && renderedExtensions.includes(extension(file.path))
  },
  title: address => basename(parseFileAddress(address)?.path || address),
}

export function MediaPreviewContent({ preview }) {
  const [error, setError] = useState('')
  useEffect(() => setError(''), [preview])
  const video = preview.mime?.startsWith('video/')
  if (preview.encoding !== 'url' || (!video && !preview.mime?.startsWith('audio/')))
    return h('p', { role: 'alert' }, '此文件不是可播放的音视频，请使用文件预览。')
  return h('div', { style: { display: 'grid', placeItems: 'center', height: '100%', padding: 16 } },
    error && h('p', { role: 'alert' }, error),
    h(video ? 'video' : 'audio', {
      key: preview.data, src: preview.data, controls: true, preload: 'metadata',
      'aria-label': preview.name,
      onError: () => setError('无法播放此文件，请刷新预览或下载后查看。'),
      style: { display: 'block', width: '100%', maxHeight: '100%', objectFit: 'contain' },
    }))
}

function ArtifactTab({ useTabInfo, previewFile, revealFile }) {
  const { tab } = useTabInfo()
  const file = parseFileAddress(tab.contentId)
  const ownerSession = file?.scope === 'session' ? file.sessionId : undefined
  const path = file?.path
  const [read, setRead] = useState({ busy: true })
  const [retry, setRetry] = useState(0)
  const [actionError, setActionError] = useState('')
  useEffect(() => {
    let disposed = false
    setRead({ busy: true }); setActionError('')
    if (!path || !ownerSession) { setRead({ error: '文件地址不可用' }); return }
    // Tabs persisted by older versions can still carry this type's identity.
    // Reopen their original address through the current official resolver.
    if (!renderedExtensions.includes(extension(path))) {
      tab.actions.openResource(tab.contentId, { replaceTab: true })
      return
    }
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
      h('button', { type: 'button', style: button, onClick: reveal }, '定位'),
      read.preview?.downloadUrl && h('a', { href: read.preview.downloadUrl, download: basename(path), style: { ...button, textDecoration: 'none' } }, '下载'),
      h('button', { type: 'button', style: button, onClick: () => setRetry(value => value + 1), 'aria-label': '刷新文件预览' }, '刷新'),
      actionError && h('p', { role: 'alert', style: { width: '100%', margin: 0 } }, actionError)),
    h('div', { style: { height: '100%', minHeight: 0, overflow: 'hidden' } },
      read.busy ? h('p', { role: 'status', style: { padding: 20 } }, '正在读取预览…')
        : read.error ? h('div', { style: { padding: 20 } }, h('p', { role: 'alert' }, read.error), h('button', { type: 'button', style: button, onClick: () => setRetry(value => value + 1) }, '重试'))
          : h(MediaPreviewContent, { preview: read.preview })))
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
