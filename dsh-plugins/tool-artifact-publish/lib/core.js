import path from 'node:path'

const TYPES = Object.freeze({
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac',
  '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
})

export function normalizeArtifactRelativePath(value) {
  const raw = String(value ?? '').trim().replaceAll('\\', '/')
  if (raw.length === 0) throw new Error('relative_path must not be empty')
  if (raw.startsWith('/') || raw.startsWith('//') || /^[a-z]:\//iu.test(raw)) throw new Error('relative_path must be project-relative')
  const normalized = path.posix.normalize(raw)
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) throw new Error('artifact must stay inside the current workspace')
  return normalized
}

export function artifactMediaType(filePath) {
  const mime = TYPES[path.extname(filePath).toLowerCase()]
  if (mime === undefined) throw new Error('artifact_publish does not support this file type')
  return mime
}

export function presentArtifactCall(args) {
  const raw = String(args?.relative_path ?? '').trim().replaceAll('\\', '/')
  let relativePath = ''
  try {
    relativePath = normalizeArtifactRelativePath(raw)
  } catch {
    // The execute path reports the validation error. Do not publish an
    // untrusted raw location into DSH's produced-file tracker.
  }
  return {
    card: 'generic', title: `Publish artifact · ${raw}`, kind: 'edit',
    ...(relativePath === '' ? {} : { locations: [{ path: relativePath }] }),
  }
}
