// DSH owns file intake, deliverable cards and general document previews.
// Extend its public Sidebar only for audio/video playback.
import previewRemote from '@chatecnu-work/dsh-artifact-preview-native/remote'
import { installSidebarPreview } from './sidebar-preview.js'
import { installDocumentPreviewLayout } from './document-preview-layout.js'

export const inject = ['slots', 'remote', 'sidebarRight', 'sidebarRightTabs']
const unwrap = async operation => {
  const result = await operation
  if (result.ok) return result.value
  throw new Error(result.error?.message || '文件预览暂时不可用')
}
export async function apply(ctx) {
  installDocumentPreviewLayout(ctx)
  const dispose = await ctx.remote.$mount(previewRemote)
  ctx.inject(['remote.artifactPreview'], inner => {
    installSidebarPreview(inner, {
      previewFile: (sessionId, path) => unwrap(inner.remote.artifactPreview.read(sessionId, path)),
      revealFile: (sessionId, path) => unwrap(inner.remote.artifactPreview.reveal(sessionId, path)),
    })
  })
  return dispose
}
