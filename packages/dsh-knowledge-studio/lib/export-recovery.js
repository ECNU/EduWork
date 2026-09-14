// Shared by the UI and host. This is eligibility only; the host revalidates the
// full saved content/citation set and its checkpoint hash before any file work.
export const officeFormatFor = kind => ({report:'docx',slides:'pptx',table:'xlsx'})[kind]
export function isLegacyOfficeExportFailure(artifact) {
  if(artifact.exportState)return false
  if(artifact.generation?.finishKind!=='stop'||artifact.status!=='failed')return false
  if(!String(artifact.message||'').startsWith('office operation failed: '))return false
  try {
    const failure=JSON.parse(artifact.message.slice('office operation failed: '.length))
    return failure.ok===false&&failure.operation==='create'&&['text_too_long','invalid_metric','metric_value_unreadable'].includes(failure.error?.code)
  }catch{return false}
}
export function canRetryOfficeExport(artifact) {
  return Boolean(artifact&&!artifact.deletedAt&&officeFormatFor(artifact.kind)&&['failed','interrupted','cancelled'].includes(artifact.status)&&artifact.content&&
    ((artifact.exportState?.version===1&&artifact.exportState.validatedContentHash&&artifact.exportState.phase!=='complete'&&!artifact.exportState.blocked&&artifact.exportState.provider!=='office-tools')||isLegacyOfficeExportFailure(artifact)))
}
