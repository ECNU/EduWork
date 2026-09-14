import { readdir, readFile } from 'node:fs/promises'
import { extname, relative } from 'node:path'

const root = new URL('../', import.meta.url)
const ignored = new Set(['.git', 'node_modules', 'coverage', 'lib', 'dist'])
const textExtensions = new Set(['', '.js', '.mjs', '.ts', '.json', '.md', '.yaml', '.yml', '.txt'])
const findings = []
const rules = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['generic bearer token', /\bBearer\s+[A-Za-z0-9._~-]{32,}\b/i],
  ['JSON Web Token', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/],
  ['assigned secret', /\b(?:client_secret|password|access[_-]?token|api[_-]?key)\b\s*[:=]\s*["'][A-Za-z0-9._~+\/-]{24,}["']/i],
  ['ECNU service hostname', /\b(?:[a-z0-9-]+\.)+ecnu\.edu\.cn\b/i],
  ['absolute Windows user path', /\b[A-Z]:\\Users\\[^\\\s]+/i],
  ['non-example email address', /\b[A-Z0-9._%+-]+@(?!example\.(?:com|org|edu)\b|users\.noreply\.github\.com\b)[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
]

function isDocumentationIPv4(value) {
  const parts = value.split('.').map(Number)
  return value === '0.0.0.0'
    || parts[0] === 127
    || (parts[0] === 192 && parts[1] === 0 && parts[2] === 2)
    || (parts[0] === 198 && parts[1] === 51 && parts[2] === 100)
    || (parts[0] === 203 && parts[1] === 0 && parts[2] === 113)
}

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue
    const url = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory)
    if (entry.isDirectory()) { await walk(url); continue }
    if (!textExtensions.has(extname(entry.name))) continue
    const content = await readFile(url, 'utf8')
    for (const [label, pattern] of rules) if (pattern.test(content)) findings.push(`${relative(root.pathname, url.pathname)}: ${label}`)
    for (const match of content.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
      const valid = match[0].split('.').every(part => Number(part) >= 0 && Number(part) <= 255)
      if (valid && !isDocumentationIPv4(match[0])) findings.push(`${relative(root.pathname, url.pathname)}: non-documentation IPv4 address`)
    }
  }
}

await walk(root)
if (findings.length > 0) throw new Error(`Potential secrets or production endpoints found:\n${findings.join('\n')}`)
console.log('No known secret, personal path, ECNU service hostname, or non-documentation IPv4 address found in publishable source material.')
