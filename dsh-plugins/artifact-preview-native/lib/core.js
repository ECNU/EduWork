import path from 'node:path'

const types = new Map([
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'], ['.gif', 'image/gif'],
  ['.mp3', 'audio/mpeg'], ['.wav', 'audio/wav'], ['.ogg', 'audio/ogg'], ['.opus', 'audio/ogg'], ['.m4a', 'audio/mp4'], ['.aac', 'audio/aac'], ['.flac', 'audio/flac'],
  ['.mp4', 'video/mp4'], ['.webm', 'video/webm'], ['.mov', 'video/quicktime'],
  ['.pdf', 'application/pdf'], ['.txt', 'text/plain'], ['.md', 'text/markdown'], ['.json', 'application/json'], ['.csv', 'text/csv'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['.js', 'text/javascript'], ['.ts', 'text/typescript'], ['.tsx', 'text/typescript'], ['.jsx', 'text/javascript'], ['.css', 'text/css'], ['.html', 'text/html'],
  ['.py', 'text/x-python'], ['.go', 'text/x-go'], ['.java', 'text/x-java'], ['.xml', 'application/xml'], ['.yml', 'text/yaml'], ['.yaml', 'text/yaml'],
])

export function previewType(filePath) {
  return types.get(path.extname(filePath).toLowerCase())
}

export function previewLimit(mime) {
  return mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml'
    ? 2 * 1024 * 1024
    : 16 * 1024 * 1024
}

export function isTextPreview(mime) {
  return mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml'
}

export function isOfficePreview(mime) {
  return mime.startsWith('application/vnd.openxmlformats-officedocument.')
}

export function isStreamPreview(mime) {
  return mime.startsWith('video/') || mime.startsWith('audio/') || mime === 'application/pdf'
}

export function parseByteRange(value, size) {
  if (typeof value !== 'string' || !Number.isSafeInteger(size) || size <= 0) return null
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value.trim())
  if (match === null || (match[1] === '' && match[2] === '')) return null
  let start
  let end
  if (match[1] === '') {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] === '' ? size - 1 : Number(match[2])
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) return null
    end = Math.min(end, size - 1)
  }
  return { start, end }
}
