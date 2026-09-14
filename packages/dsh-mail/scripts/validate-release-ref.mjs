import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
if (manifest.name !== '@eduwork/dsh-mail') throw new Error(`Unexpected package name: ${manifest.name}`)
if (/[-+]/.test(manifest.version)) throw new Error(`Publication requires a stable SemVer: ${manifest.version}`)
const expectedTag = `v${manifest.version}`
if (process.env.GITHUB_REF_TYPE !== 'tag' || process.env.GITHUB_REF_NAME !== expectedTag) {
  throw new Error(`Select tag ${expectedTag} when dispatching a publish run`)
}
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const tagged = execFileSync('git', ['rev-list', '-n', '1', expectedTag], { encoding: 'utf8' }).trim()
if (head !== tagged) throw new Error(`${expectedTag} does not point at the checked commit`)
console.log(`${manifest.name}@${manifest.version} is checked out exactly at ${expectedTag} (${head}).`)
