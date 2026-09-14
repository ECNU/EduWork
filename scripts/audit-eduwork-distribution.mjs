import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const unix = path => path.split(sep).join('/')
const textExtensions = new Set(['', '.cjs', '.css', '.go', '.html', '.js', '.json', '.jsonc', '.jsx', '.map', '.md', '.mjs', '.mod', '.sum', '.ps1', '.py', '.svg', '.ts', '.tsx', '.txt', '.yaml', '.yml', '.lock', '.toml'])
const privatePath = /(^|\/)(?:node_modules|dist|\.research|private-config|\.local|\.cache|logs|tmp|\.tmp|\.source-tarballs)(\/|$)/
const institutionPlugin = /(?:^|\/)(?:institution-ecnu|oidc-ecnu-web|studio-media-ecnu|tool-ecnu-(?:media|campus-search|vision)|provider-vision-fallback|chatecnu-active-heartbeat|skill-pack-ecnu)(?:\/|$)/
const institutionPackages = /(?:@[^\s"']+\/)?dsh-(?:bundle-institution-ecnu|bundle-oidc-ecnu-web|studio-media-ecnu|tool-ecnu-(?:media|campus-search|vision)|provider-vision-fallback|chatecnu-active-heartbeat|skill-pack-ecnu)(?:["'\s/@]|$)/

function inspectText(file, text, edition, errors, reviewKind = '') {
  // Public client identifiers are deployment data even though they are not
  // OAuth secrets. Examples may teach the field, never ship a live identifier.
  if (/\.jsonc?$/i.test(file)) {
    for (const match of text.matchAll(/"client(?:Id|ID|_id)"\s*:\s*"([^"]+)"/g)) {
      if (!/^replace-with-[a-z0-9-]+$/.test(match[1])) errors.push(`${file}: live OIDC client identifier must remain in private deployment configuration`)
    }
  }
  // Legitimate old package names, migration field names and ECNU copyrights are not secrets.
  const secretRules = [
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key'],
    [/\bAKIA[0-9A-Z]{16}\b/, 'cloud credential'],
    [/\bsk-[A-Za-z0-9_-]{24,}\b/, 'API credential'],
    [/\bclient[_-]?secret\b\s*[:=]\s*["'][A-Za-z0-9._~-]{12,}["']/i, 'client secret'],
    [/\bauthorization\s*:\s*bearer\s+[A-Za-z0-9._~-]{16,}/i, 'bearer credential'],
    [/(?:[A-Za-z]:[\\/](?:Users|ECNUDev)[\\/]|\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/)/, 'developer-specific absolute path'],
    [/https?:\/\/(?:10(?:\.\d{1,3}){3}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|192\.168(?:\.\d{1,3}){2})(?=[:/\s"']|$)/i, 'private network endpoint'],
  ]
  for (const [pattern, label] of secretRules) {
    if (label === 'private network endpoint' && reviewKind === 'synthetic-network-classification-test' && /(?:^|\/)(?:test|tests)\//.test(file)) continue
    // This known public upstream CI prefix is not a developer checkout. It is
    // also used by the normalizer's match pattern. Other absolute paths fail.
    const inspected = label === 'developer-specific absolute path'
      ? text.replaceAll('/home/runner/work/deepseek-harness/deepseek-harness/', '<upstream-ci>/') : text
    if (pattern.test(inspected)) errors.push(`${file}: ${label} requires removal or a synthetic example`)
  }
  if (edition === 'generic' && !/(?:^|\/)(?:LICENSE|NOTICE|UPSTREAM\.md|THIRD_PARTY_NOTICES\.md)$/.test(file)) {
    if (/https?:\/\/(?:chat\.ecnu\.edu\.cn|[^/\s]*ecnunic-data[^/\s]*|chat-demo\.aicernet\.cn)(?:[/:]|$)/i.test(text)) errors.push(`${file}: institution service/distribution endpoint in public core`)
    if (reviewKind !== 'inactive-legacy-institution-references' && file !== 'scripts/audit-eduwork-distribution.mjs' && institutionPackages.test(text)) errors.push(`${file}: institution package dependency or registration in public core`)
  }
}

function inspectArchive(root, file, artifact, edition, errors) {
  const archive = resolve(root, file)
  const tar = args => execFileSync('tar', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true })
  try {
    const entries = tar(['-tzf', archive]).split(/\r?\n/).filter(Boolean)
    if (entries.length > 10000 || entries.some(path => !path.startsWith('package/') || path.includes('\\') || path.split('/').includes('..'))) throw new Error('npm package archive has an invalid or excessive path list')
    if (tar(['-tvzf', archive]).split(/\r?\n/).some(line => /^[lh]/.test(line))) throw new Error('npm package archive contains filesystem links')
    if (!entries.includes('package/package.json')) throw new Error('npm package manifest is missing')
    const manifest = JSON.parse(tar(['-xOzf', archive, 'package/package.json']))
    if (manifest.name !== artifact.name || manifest.version !== artifact.version) throw new Error('npm package identity differs from its lock')
    for (const path of entries) {
      if (path.endsWith('/') || !textExtensions.has(extname(path).toLowerCase())) continue
      inspectText(`${file}!${path}`, tar(['-xOzf', archive, path]), edition, errors)
    }
  } catch (error) { errors.push(`${file}: archive inspection failed (${error.message})`) }
}

function collect(root, directory = root, errors = []) {
  const result = []
  for (const name of readdirSync(directory).sort()) {
    const file = resolve(directory, name)
    const path = unix(relative(root, file))
    if (path === '.git') continue
    const item = lstatSync(file)
    if (item.isSymbolicLink()) { errors.push(`${path}: filesystem link is not a portable source input`); continue }
    if (item.isDirectory()) result.push(...collect(root, file, errors))
    else if (item.isFile()) result.push(path)
    else errors.push(`${path}: unsupported filesystem input`)
  }
  return result
}

/** Audit actual source input, not just the edition flag. Copyright/provenance is preserved. */
export function auditDistribution({ root, edition = 'generic', verifyReceipt = false }) {
  root = resolve(root)
  const errors = [], warnings = []
  if (!['generic', 'ecnu'].includes(edition)) throw new Error(`Unknown distribution: ${edition}`)
  const files = collect(root, root, errors)
  const json = path => {
    try { return JSON.parse(readFileSync(resolve(root, path), 'utf8').replace(/^\uFEFF/, '')) }
    catch (error) { errors.push(`${path}: invalid JSON (${error.message})`); return null }
  }
  const receipt = files.includes('source-receipt.json') ? json('source-receipt.json') : null
  const reviewedCompatibility = new Map()
  for (const review of receipt?.reviewedCompatibility ?? []) {
    if (!['inactive-legacy-institution-references', 'synthetic-network-classification-test'].includes(review.kind) || !review.reason || !files.includes(review.path) || sha256(readFileSync(resolve(root, review.path))) !== review.sha256 || (review.kind === 'synthetic-network-classification-test' && !/(?:^|\/)(?:test|tests)\//.test(review.path))) errors.push(`${review.path}: compatibility review is missing or stale`)
    else reviewedCompatibility.set(review.path, review)
  }
  const artifacts = new Map((receipt?.artifacts ?? []).filter(item => item.path).map(item => [item.path, item]))
  for (const file of files) {
    if (privatePath.test(file) || /(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.env.example') || /(?:\.exe|\.log|\.p12|\.pfx|\.pem|\.zip)$/i.test(file)) errors.push(`${file}: private or generated content is outside the source snapshot`)
    if (/\.tgz$/i.test(file)) {
      const artifact = artifacts.get(file)
      if (!artifact || sha256(readFileSync(resolve(root, file))) !== artifact.sha256) errors.push(`${file}: archive is not an exact frozen package in the receipt`)
      else inspectArchive(root, file, artifact, edition, errors)
    }
    if (edition === 'generic' && institutionPlugin.test(file)) errors.push(`${file}: institution plugin must not be a public-core input`)
    if (!textExtensions.has(extname(file).toLowerCase())) continue
    const text = readFileSync(resolve(root, file), 'utf8')
    inspectText(file, text, edition, errors, reviewedCompatibility.get(file)?.kind)
    if (/^config\/distributions\/.*\.json$/.test(file) && edition === 'generic') {
      const config = json(file)
      const brandName = config?.brand?.product?.name ?? config?.brand?.name
      if (brandName && brandName !== 'EduWork') errors.push(`${file}: public default brand must be EduWork`)
      if (config?.plugins?.some(plugin => plugin.id === 'eduwork-media-openai' && plugin.config?.providers?.length)) errors.push(`${file}: public distribution must not preconfigure a remote media provider`)
      if (config?.capabilities?.institution === true || [...(config?.plugins ?? []), ...(config?.resources ?? []), ...(config?.skills ?? [])].some(entry => entry.root === 'edition')) errors.push(`${file}: public distribution requires institution-owned inputs`)
    }
    if (/(?:^|\/)package(?:-lock)?\.json$/.test(file) || /(?:^|\/)LOCK\.json$/.test(file)) {
      if (/"(?:resolved|[^"\r\n]+)"\s*:\s*"(?:file:\/|file:[A-Za-z]:|file:\.\.\/|link:|workspace:)/.test(text)) errors.push(`${file}: dependency requires a developer or sibling source tree`)
    }
  }
  if (edition === 'ecnu') {
    if (files.some(file => /^(?:scripts|dsh-desktop|dsh-plugins|dsh-bundles|runtime-resources)\//.test(file))) errors.push('Institution repository duplicates core layout; put institution-owned inputs under edition/')
    const lock = files.includes('core.lock.json') ? json('core.lock.json') : null
    if (!lock || lock.repository !== 'https://github.com/ecnu/EduWork.git' || !/^[a-f0-9]{64}$/.test(lock.sourceFileSetSHA256 ?? '')) errors.push('core.lock.json must identify the public core and its source file set')
    if (lock && lock.commit === null && lock.readiness === 'review-only-no-core-commit') warnings.push('Review-only snapshot cannot be used by clean CI until a core commit is recorded')
    else if (lock && !/^[a-f0-9]{40}$/.test(lock.commit ?? '')) errors.push('core.lock.json must pin an exact public core commit')
  }
  for (const artifact of receipt?.artifacts ?? []) {
    if (!files.includes(artifact.lock)) { errors.push(`${artifact.lock}: package lock is missing`); continue }
    const locked = json(artifact.lock)
    if (!locked || locked.name !== artifact.name || locked.version !== artifact.version || locked.commit !== artifact.commit || locked.tarballSHA256 !== artifact.sha256) errors.push(`${artifact.lock}: package identity differs from snapshot receipt`)
    if (artifact.path && !files.includes(artifact.path)) errors.push(`${artifact.path}: frozen tarball is missing`)
  }
  if (verifyReceipt) {
    if (!receipt || receipt.schemaVersion !== 1 || receipt.edition !== edition || !Array.isArray(receipt.files)) errors.push('A matching source-receipt.json is required')
    else {
      const actual = files.filter(file => file !== 'source-receipt.json').map(path => ({ path, sha256: sha256(readFileSync(resolve(root, path))) })).sort((a, b) => a.path.localeCompare(b.path, 'en'))
      if (JSON.stringify(actual) !== JSON.stringify(receipt.files) || sha256(JSON.stringify(actual)) !== receipt.fileSetSHA256) errors.push('Source file set differs from the frozen receipt; export a new reviewed snapshot')
    }
  }
  return { edition, files: files.length, errors: [...new Set(errors)], warnings }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const value = name => args[args.indexOf(name) + 1]
  const root = args.includes('--root') ? value('--root') : dirname(dirname(fileURLToPath(import.meta.url)))
  const report = auditDistribution({ root, edition: args.includes('--edition') ? value('--edition') : 'generic', verifyReceipt: args.includes('--verify-receipt') })
  console.log(JSON.stringify(report, null, 2))
  if (report.errors.length) process.exitCode = 1
}
