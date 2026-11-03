import { lookup as dnsLookup } from 'node:dns/promises'
import fs from 'node:fs'
import path from 'node:path'

const allowedProtocols = new Set(['http:', 'https:'])
// Names that only resolve inside a LAN, VPN or this machine. Single-label hosts
// (http://router/) are included because they come from local search domains.
const privateNameSuffixes = ['localhost', 'local', 'internal', 'intranet', 'lan', 'home', 'corp', 'localdomain', 'home.arpa']

// Address ranges that are not public unicast destinations (RFC 6890 special-purpose
// registries). IPv6 outside 2000::/3 is never public; IPv4 embedded in mapped,
// NAT64 and 6to4 addresses is classified by its IPv4 part.
const privateIPv4Ranges = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([address, bits]) => [ipv4Bytes(address), bits])
const privateIPv6Ranges = [
  ['2001::', 23], ['2001:db8::', 32], ['3fff::', 20],
].map(([address, bits]) => [ipv6Bytes(address), bits])

function ipv4Bytes(value) {
  const parts = value.split('.')
  if (parts.length !== 4 || !parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return undefined
  return parts.map(Number)
}

function ipv6Bytes(value) {
  let text = value
  let tail = []
  const dotted = text.match(/:(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) {
    tail = ipv4Bytes(dotted[1])
    if (!tail) return undefined
    text = `${text.slice(0, dotted.index)}:0:0`
  }
  const halves = text.split('::')
  if (halves.length > 2) return undefined
  const groups = halves.map(half => half === '' ? [] : half.split(':'))
  const missing = 8 - groups.reduce((sum, list) => sum + list.length, 0)
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined
  const all = halves.length === 1 ? groups[0] : [...groups[0], ...Array(missing).fill('0'), ...groups[1]]
  if (!all.every(group => /^[0-9a-f]{1,4}$/i.test(group))) return undefined
  const bytes = all.flatMap(group => { const n = parseInt(group, 16); return [n >> 8, n & 255] })
  if (tail.length) bytes.splice(12, 4, ...tail)
  return bytes
}

function inRange(bytes, [base, bits]) {
  for (let i = 0; i < bits; i += 8) {
    const mask = bits - i >= 8 ? 255 : (255 << (8 - (bits - i))) & 255
    if ((bytes[i / 8] & mask) !== (base[i / 8] & mask)) return false
  }
  return true
}

function isPrivateIPv4(bytes) {
  return privateIPv4Ranges.some(range => inRange(bytes, range))
}

/** Whether a textual IPv4/IPv6 address (brackets allowed) is not a public unicast destination. */
export function isPrivateAddress(raw) {
  const value = String(raw ?? '').replace(/^\[|\]$/g, '').replace(/%.*$/, '')
  const v4 = ipv4Bytes(value)
  if (v4) return isPrivateIPv4(v4)
  const v6 = ipv6Bytes(value)
  if (!v6) return true
  if ((v6[0] & 0xe0) !== 0x20) return !isZeroPrefixedIPv4(v6) || isPrivateIPv4(v6.slice(12))
  if (v6[0] === 0x20 && v6[1] === 0x02) return isPrivateIPv4(v6.slice(2, 6))
  return privateIPv6Ranges.some(range => inRange(v6, range))
}

// ::ffff:a.b.c.d (mapped) and 64:ff9b::a.b.c.d (well-known NAT64) carry an IPv4
// destination; every other address outside 2000::/3 is private on its own.
function isZeroPrefixedIPv4(v6) {
  const mapped = v6.slice(0, 10).every(b => b === 0) && v6[10] === 255 && v6[11] === 255
  const nat64 = v6[0] === 0 && v6[1] === 0x64 && v6[2] === 0xff && v6[3] === 0x9b && v6.slice(4, 12).every(b => b === 0)
  return mapped || nat64
}

function isIPLiteral(hostname) {
  return ipv4Bytes(hostname) !== undefined || hostname.startsWith('[')
}

function hostnameOf(raw) {
  return new URL(normalizeURL(raw)).hostname.toLowerCase().replace(/\.+$/, '')
}

export function normalizeURL(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) throw new Error('url is required')
  const value = raw.trim()
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`
  const parsed = new URL(candidate)
  if (!allowedProtocols.has(parsed.protocol)) throw new Error('only HTTP(S) browser targets are supported')
  if (parsed.username || parsed.password) throw new Error('credentials embedded in URLs are not allowed')
  return parsed.toString()
}

/**
 * Whether the URL names this machine or a private network without resolving it:
 * private IP literals, localhost and LAN-only suffixes, and single-label hosts.
 */
export function isPrivateTarget(raw) {
  const hostname = hostnameOf(raw)
  if (isIPLiteral(hostname)) return isPrivateAddress(hostname)
  if (!hostname.includes('.')) return true
  return privateNameSuffixes.some(suffix => hostname === suffix || hostname.endsWith(`.${suffix}`))
}

/**
 * Like isPrivateTarget, and also resolves the hostname: any private address in
 * the answer makes the target private. A lookup that fails or exceeds timeoutMs
 * counts as private, so the caller asks instead of allowing silently.
 */
export async function resolvesToPrivateTarget(raw, { lookup = dnsLookup, timeoutMs = 3000 } = {}) {
  if (isPrivateTarget(raw)) return true
  const hostname = hostnameOf(raw)
  if (isIPLiteral(hostname)) return false
  let timer
  try {
    const answers = await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('DNS lookup timed out')), timeoutMs) }),
    ])
    return !Array.isArray(answers) || answers.length === 0 || answers.some(answer => isPrivateAddress(answer.address))
  } catch {
    // Unresolvable or slow names are treated as private; see the doc comment.
    return true
  } finally {
    clearTimeout(timer)
  }
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
