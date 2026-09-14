import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'

const destination = resolve('release-artifact')
await mkdir(destination, { recursive: true })
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const expectedFilename = `${manifest.name.replace(/^@/, '').replace('/', '-')}-${manifest.version}.tgz`
const existing = await readdir(destination)
const expectedOutputs = new Set([expectedFilename, 'SHA256SUMS', 'release-metadata.json'])
const unexpected = existing.filter(name => !expectedOutputs.has(name))
if (unexpected.length > 0) throw new Error(`release-artifact contains unexpected files: ${unexpected.join(', ')}`)

let npmCommand = 'npm'
let npmPrefix = []
if (process.platform === 'win32') {
  const located = spawnSync('where.exe', ['npm.cmd'], { encoding: 'utf8' }).stdout?.split(/\r?\n/).find(Boolean)
  if (!located) throw new Error('Could not locate npm.cmd')
  npmCommand = process.execPath
  npmPrefix = [join(dirname(located), 'node_modules', 'npm', 'bin', 'npm-cli.js')]
}
const packed = spawnSync(npmCommand, [...npmPrefix, 'pack', '--ignore-scripts', '--json', '--pack-destination', destination], { encoding: 'utf8' })
if (packed.status !== 0) throw new Error(packed.error?.message || packed.stderr || `npm pack failed with status ${packed.status}`)
const result = JSON.parse(packed.stdout)
if (!Array.isArray(result) || result.length !== 1 || typeof result[0]?.filename !== 'string') {
  throw new Error('npm pack did not return exactly one package')
}
const filename = result[0].filename
if (filename !== expectedFilename) throw new Error(`Expected ${expectedFilename}, got ${filename}`)
const bytes = await readFile(resolve(destination, filename))
const sha256 = createHash('sha256').update(bytes).digest('hex')
await writeFile(resolve(destination, 'SHA256SUMS'), `${sha256}  ${filename}\n`, 'utf8')
await writeFile(resolve(destination, 'release-metadata.json'), `${JSON.stringify({ filename, sha256, size: bytes.length }, null, 2)}\n`, 'utf8')
console.log(`${filename} ${sha256}`)
