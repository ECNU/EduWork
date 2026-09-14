import { readFile } from 'node:fs/promises'

const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'))
const allowed = new Set(['MIT', 'Apache-2.0', 'BSD-3-Clause', 'ISC', 'Python-2.0', '0BSD'])
// Reviewed from the distributed LICENSE: public-domain dedication and permission
// to copy/modify/distribute. Scope the exception to this exact locked package.
const reviewedExceptions = new Map([['node_modules/fast-sha256', { version: '1.3.0', license: 'Unlicense' }]])
const counts = new Map()
const failures = []

for (const [path, metadata] of Object.entries(lock.packages ?? {})) {
  if (path === '') continue
  if (typeof metadata.license !== 'string' || metadata.license === '') failures.push(`${path}: missing license metadata`)
  else if (!allowed.has(metadata.license) && !(reviewedExceptions.get(path)?.version === metadata.version && reviewedExceptions.get(path)?.license === metadata.license)) failures.push(`${path}: unreviewed license ${metadata.license}`)
  else counts.set(metadata.license, (counts.get(metadata.license) ?? 0) + 1)
}

if (failures.length > 0) throw new Error(`Dependency license review required:\n${failures.join('\n')}`)
console.log(`Lockfile license allowlist passed: ${[...counts].map(([license, count]) => `${license}=${count}`).join(', ')}`)
