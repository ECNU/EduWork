import { readdir, readFile } from 'node:fs/promises'
import { extname, relative } from 'node:path'

const root = new URL('../', import.meta.url)
const ignored = new Set(['.git', '.tmp', 'node_modules', 'coverage'])
const textExtensions = new Set(['', '.js', '.mjs', '.ts', '.tsx', '.json', '.map', '.md', '.yaml', '.yml', '.txt'])
const findings = []
const institutionSpecificPattern = new RegExp(
  `\\b${['Chat', 'ECNU'].join('')}(?:\\s+Work)?\\b|${['\u534e\u4e1c', '\u5e08\u8303\u5927\u5b66'].join('')}|${['East China', 'Normal University'].join('')}`,
  'i',
)
const rules = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['generic bearer token', /\bBearer\s+[A-Za-z0-9._~-]{32,}\b/i],
  ['JSON Web Token', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/],
  ['assigned secret', /\b(?:client_secret|password|access[_-]?token|api[_-]?key)\b\s*[:=]\s*["'][A-Za-z0-9._~+\/-]{24,}["']/i],
  ['repository placeholder', /github\.com\/OWNER\//i],
  ['ECNU service hostname', /\b(?:[a-z0-9-]+\.)+ecnu\.edu\.cn\b/i],
  ['institution-specific name', institutionSpecificPattern],
  ['absolute Windows user path', /\b[A-Z]:\\Users\\[^\\\s]+/i],
  ['non-example email address', /\b[A-Z0-9._%+-]+@(?!example\.(?:com|org|edu)\b|users\.noreply\.github\.com\b)[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
]

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue
    const url = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory)
    if (entry.isDirectory()) { await walk(url); continue }
    if (!textExtensions.has(extname(entry.name)) || entry.name === 'package-lock.json') continue
    const content = await readFile(url, 'utf8')
    const path = relative(root.pathname, url.pathname)
    for (const [label, pattern] of rules) {
      // Bundled third-party sources contain maintainer addresses. Source files,
      // docs, config, and tests still reject every non-example address.
      if (label === 'non-example email address' && /^lib[\\/]/.test(path)) continue
      if (pattern.test(content)) findings.push(`${path}: ${label}`)
    }
  }
}

await walk(root)
if (findings.length > 0) throw new Error(`Potential secrets or private identifiers found:\n${findings.join('\n')}`)
console.log('No known secret, personal path, institution-specific name or hostname, repository placeholder, or non-example email address found.')
