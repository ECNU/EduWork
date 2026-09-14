import { extname, posix } from 'node:path'

const TEXT_EXTENSIONS = new Set([
  '.md', '.markdown', '.mdx', '.txt', '.html', '.htm',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.yaml', '.yml', '.toml',
  '.py', '.r', '.java', '.kt', '.kts', '.go', '.rs', '.c', '.h', '.cpp', '.hpp',
  '.cs', '.php', '.rb', '.swift', '.sql', '.sh', '.bash', '.zsh', '.ps1',
  '.tex', '.bib', '.csv', '.tsv', '.xml', '.css', '.scss', '.less', '.vue', '.svelte',
])

export function isSupportedTextPath(path) {
  return TEXT_EXTENSIONS.has(extname(path).toLowerCase())
}

export function isSupportedPdfPath(path) {
  return extname(path).toLowerCase() === '.pdf'
}

export function isSupportedDocumentPath(path) {
  return isSupportedTextPath(path) || isSupportedPdfPath(path)
}

function extractLocalLinks(text) {
  const targets = new Set()
  const candidates = []
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) candidates.push(match[1])
  for (const match of text.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)) candidates.push(match[1])
  for (const raw of candidates) {
    const value = raw.trim().replace(/^<|>$/g, '')
    if (!value || value.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(value)) continue
    const withoutFragment = value.split('#', 1)[0].split('?', 1)[0]
    if (withoutFragment) targets.add(withoutFragment.replaceAll('\\', '/'))
  }
  return [...targets]
}

function markdownSections(lines) {
  const sections = []
  let current = { title: '开头', level: 0, lineStart: 1, lines: [] }
  for (let index = 0; index < lines.length; index += 1) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[index])
    if (heading) {
      if (current.lines.some(line => line.trim()) || current.level > 0) {
        sections.push({ ...current, lineEnd: Math.max(current.lineStart, index) })
      }
      current = {
        title: heading[2].replace(/\s+#+\s*$/, '').trim(),
        level: heading[1].length,
        lineStart: index + 1,
        lines: [],
      }
    } else {
      current.lines.push(lines[index])
    }
  }
  if (current.lines.some(line => line.trim()) || current.level > 0 || sections.length === 0) {
    sections.push({ ...current, lineEnd: Math.max(current.lineStart, lines.length) })
  }
  return sections
}

function htmlToText(text) {
  return text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level, body) => `\n${'#'.repeat(Number(level))} ${body.replace(/<[^>]+>/g, ' ')}\n`)
    .replace(/<(br|\/p|\/div|\/li|\/tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

function chunkSection(section, maxChars) {
  const chunks = []
  let buffer = []
  let bufferStart = section.lineStart + (section.level > 0 ? 1 : 0)
  let length = 0

  const flush = endLine => {
    const content = buffer.join('\n').trim()
    if (content) chunks.push({ content, lineStart: bufferStart, lineEnd: Math.max(bufferStart, endLine) })
    buffer = []
    length = 0
  }

  for (let index = 0; index < section.lines.length; index += 1) {
    const line = section.lines[index]
    const lineNumber = section.lineStart + (section.level > 0 ? 1 : 0) + index
    if (buffer.length > 0 && length + line.length + 1 > maxChars) {
      flush(lineNumber - 1)
      bufferStart = lineNumber
    }
    buffer.push(line)
    length += line.length + 1
  }
  flush(section.lineEnd)
  if (chunks.length === 0 && section.title) {
    chunks.push({ content: section.title, lineStart: section.lineStart, lineEnd: section.lineStart })
  }
  return chunks
}

export function resolveDocumentLink(sourcePath, target) {
  const sourceDirectory = posix.dirname(sourcePath.replaceAll('\\', '/'))
  const resolved = posix.normalize(posix.join(sourceDirectory, target))
  if (resolved === '..' || resolved.startsWith('../') || posix.isAbsolute(resolved)) return null
  return resolved.replace(/^\.\//, '')
}

export function parseDocument({ path, text, maxChunkChars = 1200 }) {
  const extension = extname(path).toLowerCase()
  const source = extension === '.html' || extension === '.htm' ? htmlToText(text) : String(text)
  const lines = source.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')
  const structural = ['.md', '.markdown', '.mdx', '.html', '.htm'].includes(extension)
  const sections = structural
    ? markdownSections(lines)
    : [{ title: posix.basename(path), level: 0, lineStart: 1, lineEnd: Math.max(1, lines.length), lines }]

  return {
    path: path.replaceAll('\\', '/'),
    kind: extension.slice(1) || 'text',
    links: extractLocalLinks(String(text)).map(target => resolveDocumentLink(path, target)).filter(Boolean),
    sections: sections.map((section, sectionIndex) => ({
      title: section.title,
      level: section.level,
      ordinal: sectionIndex,
      locator: 'line',
      pageStart: null,
      pageEnd: null,
      lineStart: section.lineStart,
      lineEnd: section.lineEnd,
      chunks: chunkSection(section, maxChunkChars).map((chunk, chunkIndex) => ({
        ...chunk,
        ordinal: chunkIndex,
        locator: 'line',
        pageStart: null,
        pageEnd: null,
      })),
    })),
  }
}

export function parsePdfDocument({ path, pages, maxChunkChars = 1200 }) {
  const sections = []
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const pageNumber = pageIndex + 1
    const lines = String(pages[pageIndex] ?? '').replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')
    if (!lines.some(line => line.trim())) continue
    const base = {
      title: `第 ${pageNumber} 页`,
      level: 1,
      ordinal: pageIndex,
      locator: 'page',
      pageStart: pageNumber,
      pageEnd: pageNumber,
      lineStart: 1,
      lineEnd: Math.max(1, lines.length),
      lines,
    }
    sections.push({
      ...base,
      chunks: chunkSection(base, maxChunkChars).map((chunk, chunkIndex) => ({
        ...chunk,
        ordinal: chunkIndex,
        locator: 'page',
        pageStart: pageNumber,
        pageEnd: pageNumber,
      })),
    })
  }
  return { path: path.replaceAll('\\', '/'), kind: 'pdf', links: [], sections }
}
