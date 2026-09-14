import React from 'react'
import previewRemote from '@chatecnu-work/dsh-artifact-preview-native/remote'
import { artifactInteractiveCss, installDeliverables, openArtifactPreview } from './deliverables.js'
import { artifactCardProfile, artifactPathFromBlock } from './deliverable-utils.js'
import { WorkspaceFileInput } from './input-files.js'
import { installSidebarPreview } from './sidebar-preview.js'

export const inject = ['slots', 'remote', 'uiConversation', 'layout']
const h = React.createElement

async function unwrap(operation) {
  const result = await operation
  if (result?.ok === true) return result.value
  throw new Error(result?.error?.message || result?.error?.code || '文件预览暂时不可用')
}

function metadata(block) {
  if (!('kind' in block) || block.meta === null || typeof block.meta !== 'object') return null
  const value = block.meta
  if (typeof value.relativePath !== 'string' || typeof value.mime !== 'string') return null
  return value
}

function humanBytes(value) {
  if (!Number.isFinite(value) || value < 0) return ''
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

const artifactProfiles = Object.freeze({
  image_generate: { title: '生成的图片', activity: '图片', icon: '图', kind: 'image' },
  ecnu_image_generate: { title: 'ChatECNU 图片', activity: '图片', icon: '图', kind: 'image' },
  ecnu_tts_generate: { title: 'ChatECNU 语音', activity: '语音', icon: '声', kind: 'audio' },
  speech_synthesize: { title: '语音', activity: '语音', icon: '声', kind: 'audio' },
  artifact_publish: { title: '生成的文件', activity: '文件', icon: '文', kind: 'file' },
  office_document: { title: 'Word 文档', activity: 'Word 文档', icon: 'W', kind: 'office' },
  office_spreadsheet: { title: 'Excel 工作簿', activity: 'Excel 工作簿', icon: 'X', kind: 'office' },
  office_presentation: { title: 'PowerPoint 演示文稿', activity: 'PowerPoint 演示文稿', icon: 'P', kind: 'office' },
  office_pdf: { title: 'PDF 文档', activity: 'PDF 文档', icon: 'PDF', kind: 'office' },
})

const genericArtifactProfile = Object.freeze({ title: '生成的文件', activity: '文件', icon: '文', kind: 'file' })

function profileFor(toolName, block, meta) {
  if (['artifact_publish', 'media_render', 'video_project'].includes(toolName)) {
    const path = meta?.relativePath || artifactPathFromBlock(block)
    return artifactCardProfile(path, meta?.mime)
  }
  return artifactProfiles[toolName] ?? genericArtifactProfile
}

function MediaArtifactCard({ block, toolName, openFile, inspect, previewFile, openDetails, sessionId }) {
  const settled = 'kind' in block
  const meta = metadata(block)
  const failed = settled && block.isError
  const profile = profileFor(toolName, block, meta)
  const image = profile.kind === 'image'
  const video = profile.kind === 'video'
  const title = profile.title
  const details = meta === null ? '' : [
    image ? meta.size : video ? '' : meta.voice,
    !image && Number.isFinite(meta.speed) ? `${meta.speed}×` : '',
    humanBytes(meta.bytes),
  ].filter(Boolean).join(' · ')
  const startPreview = () => {
    if (!meta) return
    openArtifactPreview({ sessionId, path: meta.relativePath, previewFile, openFile, openDetails })
  }
  return h(React.Fragment, null, h('article', {
    'data-chatecnu-media-artifact': profile.kind,
    style: {
      display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr) auto', alignItems: 'center', gap: 11,
      minHeight: 66, margin: '3px 0', padding: '10px 12px', border: '1px solid var(--dsw-alias-border-l2)',
      borderRadius: 12, background: 'var(--dsw-alias-bg-module-platform)', color: 'var(--dsw-alias-label-primary)',
    },
  },
  h('span', { style: {
    display: 'grid', placeItems: 'center', width: 42, height: 42, borderRadius: 10,
    background: 'color-mix(in srgb, var(--chatecnu-logo-accent, #5157af) 12%, transparent)',
    color: 'var(--chatecnu-logo-accent, #5157af)', fontSize: 20, fontWeight: 750,
  } }, profile.icon),
  h('span', { style: { minWidth: 0 } },
    h('strong', { style: { display: 'block', fontSize: 13, lineHeight: 1.5 } },
      failed ? `${profile.activity}生成失败` : !settled ? `正在生成${profile.activity}…` : title),
    h('span', { style: {
      display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      color: failed ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-secondary)', fontSize: 12,
    } }, meta?.relativePath || (failed ? '本次工具调用未生成文件' : '等待产物写入项目')),
    details && h('span', { style: { display: 'block', marginTop: 2, color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 } }, details),
  ),
  h('span', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
    meta && !failed && h('button', {
      type: 'button', 'data-chatecnu-artifact-action': '', onClick: startPreview,
      style: {
        border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, padding: '5px 9px',
        background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer', fontSize: 12,
      },
    }, '预览'),
    meta && !failed && h('button', {
      type: 'button', 'data-chatecnu-artifact-action': '', onClick: () => openFile(meta.relativePath),
      style: {
        border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, padding: '5px 9px',
        background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer', fontSize: 12,
      },
    }, '打开'),
    inspect && h('button', {
      type: 'button', 'data-chatecnu-artifact-action': '', onClick: inspect, title: '查看工具详情', 'aria-label': '查看工具详情',
      style: { border: 0, background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', cursor: 'pointer', fontSize: 17 },
    }, '›'),
  )))
}

export async function apply(ctx) {
  const disposePreviewRemote = await ctx.remote.$mount(previewRemote)
  const style = document.createElement('style')
  style.dataset.chatecnuArtifactUx = 'true'
  style.textContent = artifactInteractiveCss
  document.head.append(style)
  const officialSidebar = typeof ctx.layout.openDetails !== 'function'
  ctx.inject(['remote.artifactPreview', ...(officialSidebar ? ['sidebarRight', 'sidebarRightTabs'] : [])], (surfaceCtx) => {
    const previewFile = (sessionId, relativePath) => {
      return unwrap(surfaceCtx.remote.artifactPreview.read(sessionId, relativePath))
    }
    const revealFile = (sessionId, relativePath) => unwrap(surfaceCtx.remote.artifactPreview.reveal(sessionId, relativePath))
    const openSidebar = installSidebarPreview(surfaceCtx, { previewFile, revealFile })
    const openDetails = openSidebar || (() => surfaceCtx.layout.openDetails())
    const importFiles = (sessionId, files) => unwrap(surfaceCtx.remote.artifactPreview.importFiles(sessionId, files))
    const importNativeFiles = (sessionId, grantID) => unwrap(surfaceCtx.remote.artifactPreview.importNativeFiles(sessionId, grantID))
    surfaceCtx.slots.inject('conversation.input.add', () => surfaceCtx.slots.register({
      name: 'conversation.input.add', id: 'chatecnu-workspace-file-input',
      inject: () => ({ importFiles, importNativeFiles }),
    }, WorkspaceFileInput))
    for (const key of Object.keys(artifactProfiles)) {
      surfaceCtx.slots.inject('tool.call.toolview', () => surfaceCtx.slots.register({
        name: 'tool.call.toolview', key, inject: () => ({ previewFile, openDetails }),
      }, MediaArtifactCard))
    }
    // The official rc.1 ui-deliverables owns final present events, produced
    // files and inline mentions. Keep this old carrier only for legacy hosts.
    if (!openSidebar) installDeliverables(surfaceCtx, { previewFile, revealFile, openDetails })
  })
  return () => {
    style.remove()
    disposePreviewRemote()
  }
}
