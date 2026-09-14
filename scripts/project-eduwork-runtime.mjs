import { cp, mkdir, readFile, writeFile, readdir, lstat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, join, dirname, relative, posix } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

export const omittedRoots = [
  '@deepseek-ai/dsh-subagent-codex', '@deepseek-ai/dsh-subagent-claude-code',
  '@deepseek-ai/dsh-agent-loop-testkit',
]
const hash = value => createHash('sha256').update(value).digest('hex')
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const exists = async path => lstat(path).then(() => true).catch(error => { if (error.code === 'ENOENT') return false; throw error })

export function omitRuntimeFile(path) {
  return /\.(?:map|pdb|pyc)$/i.test(path) || /(?:^|\/)__pycache__(?:\/|$)/.test(path)
    || /(?:^|\/)node-pty\/prebuilds\/win32-arm64(?:\/|$)/.test(path)
}

/** Project an already verified install; no dependency download or semver resolution. */
export async function projectRuntime({ source, output }) {
  source = resolve(source); output = resolve(output)
  if (source === output || !relative(source, output).startsWith('..') || !relative(output, source).startsWith('..')) throw new Error('Runtime projection requires disjoint directories')
  if (await exists(output)) throw new Error('Runtime projection output already exists')
  const identity = await json(join(source, '.chatecnu-dsh-runtime.json'))
  const npm = identity.source === 'npm-lock'
  if (!npm && identity.source !== 'source-release-pack') throw new Error('Runtime has no supported npm/source install receipt')
  const proofFile = npm ? '.chatecnu-dsh-npm-install-lock.json' : '.chatecnu-dsh-source-install-lock.json'
  const proofBytes = await readFile(join(source, proofFile)), original = JSON.parse(proofBytes)
  const lockHashField = npm ? 'packageLockSHA256' : 'sourceInstallLockSHA256'
  if (hash(proofBytes) !== identity[lockHashField]) throw new Error('Runtime install receipt differs from its frozen lock')
  const manifest = await json(join(source, 'package.json'))
  for (const field of ['dependencies', 'optionalDependencies']) for (const name of omittedRoots) delete manifest[field]?.[name]
  // The exact same version/integrity already installed by Remotion is promoted
  // to the root; the Shared service is qualified against this version as well.
  const mediaSource = original.packages['node_modules/mediabunny']?.version === '1.55.5'
    ? 'node_modules/mediabunny' : 'node_modules/@remotion/media-utils/node_modules/mediabunny'
  const mediaLock = original.packages[mediaSource]
  if (mediaLock?.version !== '1.55.5' || mediaLock.integrity !== 'sha512-m0v6y8FGXiK+HKOc3AZqU+kJPLYsSKaLitmQNQIIHZKIGlTwQ34OF+X6Ul0K8iV4b03oPse10apwuoqbvmKeAA==') throw new Error('Unreviewed media dependency')
  manifest.dependencies.mediabunny = mediaLock.version
  const packages = new Map(), pending = []
  const locate = async (from, name, optional = false) => {
    if (name === 'mediabunny') return 'node_modules/mediabunny'
    let base = from
    while (true) {
      const path = posix.join(base, 'node_modules', name)
      if (original.packages[path] && await exists(join(source, path, 'package.json'))) return path
      if (!base) break
      base = posix.dirname(base)
      if (base === '.') base = ''
    }
    if (!optional) throw new Error(`Missing runtime dependency ${name} from ${from || '<root>'}`)
    return null
  }
  const enqueue = async (from, name, optional) => {
    const path = await locate(from, name, optional)
    if (path && !packages.has(path)) { packages.set(path, null); pending.push(path) }
  }
  for (const field of ['dependencies', 'optionalDependencies']) for (const name of Object.keys(manifest[field] ?? {})) await enqueue('', name, field === 'optionalDependencies')
  while (pending.length) {
    const path = pending.shift(), from = path === 'node_modules/mediabunny' ? mediaSource : path
    const item = await json(join(source, from, 'package.json'))
    const locked = original.packages[from]
    if (item.version !== locked?.version) throw new Error(`Installed package differs from runtime lock: ${from}`)
    packages.set(path, { from, item, locked })
    const dependencies = { ...item.dependencies, ...item.optionalDependencies, ...item.peerDependencies }
    for (const name of Object.keys(dependencies)) await enqueue(from, name, name in (item.optionalDependencies ?? {}) || item.peerDependenciesMeta?.[name]?.optional === true)
  }
  for (const name of omittedRoots) if (packages.has(`node_modules/${name}`)) throw new Error(`An enabled component still needs omitted package ${name}`)
  const lock = { name: 'eduwork-distribution-runtime', version: '0.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'eduwork-distribution-runtime', version: '0.0.0', dependencies: manifest.dependencies, optionalDependencies: manifest.optionalDependencies } } }
  await mkdir(output, { recursive: true })
  let copiedBytes = 0, omittedBytes = 0, copiedFiles = 0
  for (const [path, { from, locked }] of packages) {
    const input = join(source, from), target = join(output, path)
    await cp(input, target, { recursive: true, filter: async src => {
      const rel = relative(input, src).replaceAll('\\', '/')
      if (rel === 'node_modules' || rel.startsWith('node_modules/')) return false
      const stat = await lstat(src)
      if (stat.isSymbolicLink()) throw new Error(`Unexpected package link: ${from}/${rel}`)
      if (omitRuntimeFile(`${path}/${rel}`)) { if (stat.isFile()) omittedBytes += stat.size; return false }
      if (stat.isFile()) { copiedFiles++; copiedBytes += stat.size }
      return true
    } })
    lock.packages[path] = structuredClone(locked)
  }
  // Keep npm's executable wrappers only when the corresponding binary is still
  // installed. Normal shell/PTC/subagent tools are independent of Codex/Claude.
  const bins = new Set([...packages.values()].flatMap(({ item }) => typeof item.bin === 'string' ? [item.name.split('/').at(-1)] : Object.keys(item.bin ?? {})))
  for (const entry of await readdir(join(source, 'node_modules/.bin'), { withFileTypes: true })) {
    if (!entry.isFile() || !bins.has(entry.name.replace(/\.(cmd|ps1)$/, ''))) continue
    await mkdir(join(output, 'node_modules/.bin'), { recursive: true })
    await cp(join(source, 'node_modules/.bin', entry.name), join(output, 'node_modules/.bin', entry.name))
  }
  manifest.name = 'eduwork-distribution-runtime'
  const proofFiles = ['.chatecnu-dsh-runtime.json', proofFile, ...(!npm ? ['.chatecnu-dsh-source-pack.json'] : [])]
  for (const name of proofFiles) await cp(join(source, name), join(output, name))
  await writeFile(join(output, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  const lockBytes = JSON.stringify(lock, null, 2) + '\n'
  await writeFile(join(output, '.eduwork-distribution-lock.json'), lockBytes)
  const receipt = { schemaVersion: 2, source: identity.source, platform: identity.platform ?? process.platform, arch: identity.arch ?? process.arch, policySHA256: hash(await readFile(fileURLToPath(import.meta.url))), [lockHashField]: hash(proofBytes), distributionLockSHA256: hash(lockBytes), omittedRoots, mediabunny: mediaLock.version, packages: packages.size, copiedFiles, copiedBytes, omittedDebugBytes: omittedBytes }
  await writeFile(join(output, '.eduwork-distribution-runtime.json'), JSON.stringify(receipt, null, 2) + '\n')
  return receipt
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { source: { type: 'string' }, output: { type: 'string' } } })
  if (!values.source || !values.output) throw new Error('Use --source <verified-runtime> --output <new-runtime>')
  console.log(JSON.stringify(await projectRuntime(values)))
}
