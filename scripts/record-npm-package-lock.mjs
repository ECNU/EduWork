import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

// Record only a reviewed, already-published tarball. Never select latest or
// publish from this command. The expected SHA-256 comes from release review.
const args = process.argv.slice(2)
const value = name => args[args.indexOf(name) + 1]
for (const key of ['--package', '--version', '--commit', '--repository', '--sha256', '--output']) {
  if (!args.includes(key) || !value(key) || value(key).startsWith('--')) throw new Error(`Missing ${key}`)
}
const name = value('--package'), version = value('--version'), commit = value('--commit')
const expected = value('--sha256'), repository = value('--repository')
if (!/^@[a-z0-9-]+\/[a-z0-9-]+$/.test(name) || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Use an exact stable package identity')
if (!/^[a-f0-9]{40}$/.test(commit) || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('Expected reviewed commit and SHA-256')
if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?$/.test(repository)) throw new Error('Use the public source repository URL')
const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`, { headers: { 'cache-control': 'no-cache' } })
if (!response.ok) throw new Error(`Registry metadata: HTTP ${response.status}; a new publication may still be propagating`)
const meta = await response.json()
if (meta.name !== name || meta.version !== version) throw new Error('Registry identity differs')
const url = new URL(meta.dist.tarball)
if (url.origin !== 'https://registry.npmjs.org' || url.username || url.password) throw new Error('Unexpected tarball origin')
const download = await fetch(url)
if (!download.ok) throw new Error(`Registry tarball: HTTP ${download.status}`)
const bytes = Buffer.from(await download.arrayBuffer())
const digest = algorithm => createHash(algorithm).update(bytes)
const sha256 = digest('sha256').digest('hex'), shasum = digest('sha1').digest('hex')
const integrity = `sha512-${digest('sha512').digest('base64')}`
if (sha256 !== expected || shasum !== meta.dist.shasum || integrity !== meta.dist.integrity) throw new Error('Published bytes differ from the reviewed tarball or registry digests')
const lock = { schemaVersion: 1, name, version, repository, commit, publicationStatus: 'published', tarballSHA256: sha256,
  npm: { tarball: url.href, integrity, shasum }, baseline: { dshVersion: '0.1.5-rc.1', commit: '183f08e9c6dde7e36cd2318eaee70b0da08fb35e' } }
const output = resolve(value('--output'))
await mkdir(dirname(output), { recursive: true })
await writeFile(output, JSON.stringify(lock, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ name, version, bytes: bytes.length, sha256, output }))
