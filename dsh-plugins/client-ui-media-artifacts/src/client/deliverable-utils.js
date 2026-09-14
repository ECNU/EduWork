const renderedPreviews = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'gif',
  'mp3', 'wav', 'ogg', 'opus', 'm4a', 'aac', 'flac',
  'mp4', 'webm', 'mov',
  'pdf', 'md', 'html', 'docx', 'xlsx', 'pptx',
])

const textViews = new Set(['txt', 'json', 'csv'])

const sourceViews = new Set([
  'js', 'ts', 'tsx', 'jsx', 'css', 'py', 'go', 'java', 'xml', 'yml', 'yaml',
])

const visuals = Object.freeze({
  docx: { glyph: 'W', tone: '#3569b8', label: 'Word 文档', kind: 'office' },
  xlsx: { glyph: 'X', tone: '#287a4b', label: 'Excel 工作簿', kind: 'office' },
  pptx: { glyph: 'P', tone: '#bd5a31', label: 'PowerPoint 演示文稿', kind: 'office' },
  pdf: { glyph: 'PDF', tone: '#c14444', label: 'PDF 文档', kind: 'office' },
  png: { glyph: '图', tone: '#7a58aa', label: '图片', kind: 'image' },
  jpg: { glyph: '图', tone: '#7a58aa', label: '图片', kind: 'image' },
  jpeg: { glyph: '图', tone: '#7a58aa', label: '图片', kind: 'image' },
  webp: { glyph: '图', tone: '#7a58aa', label: '图片', kind: 'image' },
  gif: { glyph: '图', tone: '#7a58aa', label: '图片', kind: 'image' },
  mp3: { glyph: '声', tone: '#9a5c24', label: '音频', kind: 'audio' },
  wav: { glyph: '声', tone: '#9a5c24', label: '音频', kind: 'audio' },
  ogg: { glyph: '声', tone: '#9a5c24', label: '音频', kind: 'audio' },
  opus: { glyph: '声', tone: '#9a5c24', label: '音频', kind: 'audio' },
  m4a: { glyph: '声', tone: '#9a5c24', label: '音频', kind: 'audio' },
  aac: { glyph: '声', tone: '#9a5c24', label: '音频', kind: 'audio' },
  flac: { glyph: '声', tone: '#9a5c24', label: '音频', kind: 'audio' },
  mp4: { glyph: '影', tone: '#5b5aaa', label: '视频', kind: 'video' },
  mov: { glyph: '影', tone: '#5b5aaa', label: '视频', kind: 'video' },
  webm: { glyph: '影', tone: '#5b5aaa', label: '视频', kind: 'video' },
  md: { glyph: 'M', tone: '#59616c', label: 'Markdown', kind: 'file' },
  txt: { glyph: 'T', tone: '#59616c', label: '文本文件', kind: 'file' },
  json: { glyph: '{}', tone: '#59616c', label: 'JSON 文件', kind: 'file' },
  csv: { glyph: 'CSV', tone: '#287a4b', label: 'CSV 文件', kind: 'file' },
})

const mimeVisuals = Object.freeze({
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
})

export function basename(path) {
  const value = String(path ?? '')
  const at = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'))
  return at === -1 ? value : value.slice(at + 1)
}

export function extension(path) {
  const name = basename(path)
  const at = name.lastIndexOf('.')
  return at <= 0 ? '' : name.slice(at + 1).toLowerCase()
}

export function parentPath(path) {
  const value = String(path ?? '')
  const at = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'))
  return at <= 0 ? '.' : value.slice(0, at)
}

export function normalizedPath(path) {
  return String(path ?? '').replaceAll('\\', '/')
}

export function pathSegments(path) {
  return normalizedPath(path).split('/').filter(Boolean)
}

export function shortestUniqueLabels(paths) {
  const segments = paths.map(pathSegments)
  return paths.map((path, index) => {
    const own = segments[index]
    for (let depth = 1; depth <= own.length; depth += 1) {
      const candidate = own.slice(-depth).join('/')
      const unique = segments.every((other, otherIndex) => otherIndex === index || other.slice(-depth).join('/') !== candidate)
      if (unique) return candidate
    }
    return normalizedPath(path)
  })
}

export function isPreviewable(path) {
  return previewSupport(path) !== 'unsupported'
}

export function previewSupport(path) {
  const ext = extension(path)
  if (renderedPreviews.has(ext)) return 'rendered'
  if (textViews.has(ext)) return 'text'
  if (sourceViews.has(ext)) return 'source'
  return 'unsupported'
}

export function previewActionLabel(path) {
  const support = previewSupport(path)
  if (support === 'rendered') return '预览'
  if (support === 'source') return '查看源码'
  if (support === 'text') return '查看文本'
  return '查看详情'
}

export function previewModeLabel(path) {
  const support = previewSupport(path)
  if (support === 'source') return '源码查看'
  if (support === 'text') return '文本查看'
  if (support === 'unsupported') return '暂不支持预览'
  return '文件预览'
}

function resolvedVisual(path, mime = '') {
  const ext = extension(path)
  if (visuals[ext] !== undefined) return visuals[ext]
  const normalizedMime = String(mime ?? '').trim().toLowerCase()
  const mimeExtension = mimeVisuals[normalizedMime]
  if (mimeExtension !== undefined) return visuals[mimeExtension]
  if (normalizedMime.startsWith('image/')) return visuals.png
  if (normalizedMime.startsWith('audio/')) return visuals.mp3
  if (normalizedMime.startsWith('video/')) return visuals.mp4
  return {
    glyph: ext.length > 0 && ext.length <= 4 ? ext.toUpperCase() : '文',
    tone: '#657080',
    label: ext.length > 0 ? `${ext.toUpperCase()} 文件` : '文件',
    kind: 'file',
  }
}

export function fileVisual(path, mime = '') {
  const { glyph, tone, label } = resolvedVisual(path, mime)
  return { glyph, tone, label }
}

export function artifactCardProfile(path, mime = '') {
  const visual = resolvedVisual(path, mime)
  const generatedTitle = visual.kind === 'image' || visual.kind === 'audio' || visual.kind === 'video'
    ? `生成的${visual.label}`
    : visual.label
  return { title: generatedTitle, activity: visual.label, icon: visual.glyph, kind: visual.kind }
}

export function artifactPathFromBlock(block) {
  const argsRaw = typeof block?.argsRaw === 'string' ? block.argsRaw : block?.call?.argsRaw
  if (typeof argsRaw !== 'string') return ''
  try {
    const args = JSON.parse(argsRaw)
    return typeof args?.relative_path === 'string' ? args.relative_path.trim() : ''
  } catch {
    return ''
  }
}
