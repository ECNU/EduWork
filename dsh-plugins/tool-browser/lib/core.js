import fs from 'node:fs'
import path from 'node:path'

const allowedProtocols = new Set(['http:', 'https:'])
const privateHostPatterns = [
  /^localhost$/i,
  /^127(?:\.\d{1,3}){3}$/,
  /^10(?:\.\d{1,3}){3}$/,
  /^192\.168(?:\.\d{1,3}){2}$/,
  /^172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/,
  /^169\.254(?:\.\d{1,3}){2}$/,
  /^\[?::1\]?$/,
  /\.local$/i,
  /\.internal$/i,
]

export function normalizeURL(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) throw new Error('url is required')
  const value = raw.trim()
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`
  const parsed = new URL(candidate)
  if (!allowedProtocols.has(parsed.protocol)) throw new Error('only HTTP(S) browser targets are supported')
  if (parsed.username || parsed.password) throw new Error('credentials embedded in URLs are not allowed')
  return parsed.toString()
}

export function isPrivateTarget(raw) {
  const hostname = new URL(normalizeURL(raw)).hostname
  return privateHostPatterns.some(pattern => pattern.test(hostname))
}

export function searchURL(engine, query) {
  if (typeof query !== 'string' || query.trim().length === 0) throw new Error('query is required')
  const encoded = encodeURIComponent(query.trim())
  return engine === 'baidu'
    ? `https://m.baidu.com/s?word=${encoded}`
    : `https://www.bing.com/search?q=${encoded}&setlang=zh-hans&cc=cn&mkt=zh-CN`
}

const searchStopWords = new Set([
  'a', 'about', 'an', 'and', 'are', 'current', 'find', 'for', 'how', 'in', 'is', 'latest', 'of', 'on', 'search', 'the', 'to', 'what', 'where', 'who', 'why', 'with',
  '一下', '什么', '信息', '内容', '如何', '帮我', '怎么', '搜索', '最新', '最近', '查询', '查找', '看看', '相关', '请问',
])

export function searchQueryTokens(query) {
  const value = String(query ?? '').normalize('NFKC').toLowerCase()
  const tokens = new Set(value.match(/[a-z0-9][a-z0-9._+-]{1,}/g) ?? [])
  for (const segment of value.match(/[\p{Script=Han}]{2,}/gu) ?? []) {
    const chars = Array.from(segment)
    for (let index = 0; index < chars.length - 1; index += 1) tokens.add(chars.slice(index, index + 2).join(''))
  }
  return [...tokens].filter(token => !searchStopWords.has(token))
}

export function isSearchResultRelevant(query, result) {
  const tokens = searchQueryTokens(query)
  if (tokens.length === 0) return true
  let decodedURL = String(result?.url ?? '')
  try { decodedURL = decodeURIComponent(decodedURL) } catch {}
  const haystack = `${result?.title ?? ''}\n${result?.snippet ?? ''}\n${decodedURL}`.normalize('NFKC').toLowerCase()
  const requiredMatches = tokens.length === 1 ? 1 : Math.min(3, Math.max(2, Math.ceil(tokens.length / 2)))
  return tokens.filter(token => haystack.includes(token)).length >= requiredMatches
}

export function isCiteableSearchResultURL(raw) {
  try {
    const url = new URL(raw)
    if (!allowedProtocols.has(url.protocol)) return false
    const hostname = url.hostname.toLowerCase()
    if (['www.bing.com', 'cn.bing.com', 'www.baidu.com', 'm.baidu.com', 'wappass.baidu.com'].includes(hostname)) return false
    return !hostname.endsWith('.recommend_list.baidu.com')
  } catch {
    return false
  }
}

export function directSearchResultURL(engine, raw) {
  if (engine !== 'bing' || typeof raw !== 'string') return raw
  try {
    const encoded = new URL(raw).searchParams.get('u')
    if (!encoded?.startsWith('a1')) return raw
    const decoded = Buffer.from(encoded.slice(2), 'base64url').toString('utf8')
    return /^https?:\/\//i.test(decoded) ? decoded : raw
  } catch {
    return raw
  }
}

export function browserExecutable(explicit, { environment = process.env, platform = process.platform } = {}) {
  const installed = (root, ...parts) => root ? path.join(root, ...parts) : undefined
  const candidates = [
    explicit,
    environment.EDUWORK_BROWSER_EXECUTABLE,
    environment.CHATECNU_WORK_BROWSER_EXECUTABLE,
    // The desktop host resolves this relocatable path from desktop-resources.json.
    // Search and interactive browsing share the Chromium shipped for media rendering.
    environment.DSH_MEDIA_BROWSER,
    environment.ECNU_AGENT_REMOTION_BROWSER,
    ...(platform === 'win32' ? [
      ...['ProgramFiles(x86)', 'ProgramFiles', 'LOCALAPPDATA'].map(key => installed(environment[key], 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
      ...['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA'].map(key => installed(environment[key], 'Google', 'Chrome', 'Application', 'chrome.exe')),
    ] : []),
    ...(platform === 'darwin' ? ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] : []),
    ...(platform === 'linux' ? ['/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium'] : []),
  ].filter(Boolean)
  const found = candidates.find(candidate => { try { return fs.statSync(candidate).isFile() } catch { return false } })
  if (!found) throw new Error('No supported browser was found. Restore the complete EduWork package, install Microsoft Edge/Chrome, or set EDUWORK_BROWSER_EXECUTABLE.')
  return found
}

export function compactText(value, limit = 18_000) {
  const text = String(value ?? '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim()
  return text.length <= limit ? text : `${text.slice(0, limit)}\n… [truncated]`
}

export function untrustedPage({ title, url, text, links = [] }) {
  return {
    title: compactText(title, 300),
    url,
    text: compactText(text),
    links: links.slice(0, 25).map(link => ({
      text: compactText(link.text, 240),
      url: link.url,
    })),
    trust: 'untrusted-web-content',
  }
}

// DSH persists presentationMeta as lossless JSON.  Object properties whose
// value is undefined are valid JavaScript but are not losslessly round-trippable
// through JSON, so omit absent browser fields instead of emitting them.
export function browserPresentationMeta(value = {}) {
  const meta = {}
  for (const key of ['action', 'url', 'title', 'path', 'engine']) {
    const item = value[key]
    if (typeof item !== 'string' || item.length === 0) continue
    meta[key === 'path' ? 'relativePath' : key] = item
  }
  if (Number.isSafeInteger(value.resultCount) && value.resultCount >= 0) {
    meta.resultCount = value.resultCount
  }
  return meta
}

export function webSearchResult(results = []) {
  const seen = new Set()
  const sources = []
  for (const result of results) {
    if (!result || typeof result.url !== 'string' || !/^https?:\/\//i.test(result.url) || seen.has(result.url)) continue
    seen.add(result.url)
    const source = { url: result.url }
    if (typeof result.title === 'string' && result.title.trim()) source.title = compactText(result.title, 300)
    if (typeof result.snippet === 'string' && result.snippet.trim()) source.snippet = compactText(result.snippet, 1_200)
    sources.push(source)
  }
  return { sources, truncated: false }
}
