import { readFile } from 'node:fs/promises'

const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'))
const allowed = new Set(['MIT', 'Apache-2.0', 'BSD-3-Clause', 'ISC', 'Python-2.0', '0BSD', 'BSD-2-Clause', '(MIT OR CC0-1.0)'])
// Reviewed from the distributed LICENSE: public-domain dedication and permission
// to copy/modify/distribute. Scope the exception to this exact locked package.
const reviewedExceptions = new Map([['node_modules/fast-sha256', { version: '1.3.0', license: 'Unlicense' }]])
// These are the official DSH test Host's separately installed native components,
// not code or binaries included in the OIDC npm archive.
const reviewedHostDependency = (path, entry) => entry.dev === true && (
  (/^node_modules\/@deepseek-ai\/libreoffice-kit(?:-(?:darwin|win32)-(?:arm64|x64)|-wasm)?$/.test(path) && entry.version === '0.1.5' && entry.license === 'MPL-2.0') ||
  (/^node_modules\/@img\/sharp-libvips-/.test(path) && entry.version === '1.3.4' && entry.license === 'LGPL-3.0-or-later') ||
  (/^node_modules\/@img\/sharp-(?:win32-|wasm32$)/.test(path) && entry.version === '0.35.5' && ['Apache-2.0 AND LGPL-3.0-or-later','Apache-2.0 AND LGPL-3.0-or-later AND MIT'].includes(entry.license)) ||
  (path === 'node_modules/fast-sha256' && entry.version === '1.3.0' && entry.license === 'Unlicense')
)
const counts = new Map()
const failures = []

for (const [path, metadata] of Object.entries(lock.packages ?? {})) {
  if (path === '') continue
  if (typeof metadata.license !== 'string' || metadata.license === '') failures.push(`${path}: missing license metadata`)
  else if (!allowed.has(metadata.license) && !reviewedHostDependency(path, metadata) && !(reviewedExceptions.get(path)?.version === metadata.version && reviewedExceptions.get(path)?.license === metadata.license)) failures.push(`${path}: unreviewed license ${metadata.license}`)
  else counts.set(metadata.license, (counts.get(metadata.license) ?? 0) + 1)
}

if (failures.length > 0) throw new Error(`Dependency license review required:\n${failures.join('\n')}`)
console.log(`Lockfile license allowlist passed: ${[...counts].map(([license, count]) => `${license}=${count}`).join(', ')}`)
