// Reviewed build-only normalization for a verified upstream source archive.
// Runtime functionality and conditional export resolution remain upstream-owned.
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const patchId = 'dsh-015-alpha1-reproducible-client-and-pack-v1'
export const reviewedCommit = '5dda764ed3aa172535a7967b06ff95d9cbfe536a'
const archiveSHA256 = 'b191f0aa10836ed6db59d8f196416892b7e40e03a09cae4bed3625c1efd32e84'
// rc.1 and rc.2 retain exactly the same two upstream build inputs (hashes below).
const reviewedReleases = new Map([
  [reviewedCommit, { archiveSHA256, id: patchId }],
  ['fb2c4b9e698e30edb738bca4cf0618587db7d203', { archiveSHA256: '60038295d9ea8849dc50a9d77dfcbed6c14397f0d54fadb035f768841415a3bd', id: 'dsh-015-rc2-reproducible-client-and-pack-v1' }],
  ['183f08e9c6dde7e36cd2318eaee70b0da08fb35e', { archiveSHA256: '23af26a7f422f3d3ba7ce148492e2937af3fe5cc39e8f05dd109e12dadd8262c', id: 'dsh-015-rc1-reproducible-client-and-pack-v1' }],
])
const repository = 'https://github.com/deepseek-ai/deepseek-harness.git'
const sha256 = value => createHash('sha256').update(value).digest('hex')

// pnpm resolves workspace ranges concurrently. Run after that conversion, only
// during packing, so frozen install lockfiles retain their original checksum.
export const packingHook = `// EduWork build normalization: stable dependency order after pnpm conversion.
module.exports = { hooks: { beforePacking(manifest) {
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta']) {
    const dependencies = manifest[field];
    if (dependencies && typeof dependencies === 'object' && !Array.isArray(dependencies)) {
      manifest[field] = Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
    }
  }
  return manifest;
} } };
`

function replaceExactly(source, before, after, count = 1) {
  if (source.split(before).length !== count + 1) throw new Error('Reviewed source normalization context changed')
  return source.replaceAll(before, after)
}

export function normalizeClientPreset(source) {
  let result = replaceExactly(source,
    "const REPOSITORY_ROOT = fileURLToPath(new URL('../..', import.meta.url))",
    `const REPOSITORY_ROOT = fileURLToPath(new URL('../..', import.meta.url))

/** Stable CSS identity; physical reads and watch dependencies keep their real paths. */
function stableStylesheetPath(file: string): string {
  const path = relative(REPOSITORY_ROOT, file).split(sep).join('/')
  if (path === '..' || path.startsWith('../') || isAbsolute(path)) {
    throw new Error('Stylesheet is outside the verified build source')
  }
  return path
}`)
  for (const prefix of ['CSS_VIRTUAL_PREFIX', 'INLINE_CSS_VIRTUAL_PREFIX', 'GLOBAL_CSS_VIRTUAL_PREFIX']) {
    result = replaceExactly(result,
      `return ${prefix} + abs + CSS_VIRTUAL_SUFFIX`,
      `return ${prefix} + stableStylesheetPath(abs) + CSS_VIRTUAL_SUFFIX`)
    result = replaceExactly(result,
      `const fileId = virtualId.slice(${prefix}.length, -CSS_VIRTUAL_SUFFIX.length)`,
      `const fileId = resolvePath(REPOSITORY_ROOT, virtualId.slice(${prefix}.length, -CSS_VIRTUAL_SUFFIX.length))`)
  }
  return replaceExactly(result, 'filename: fileId,', 'filename: stableStylesheetPath(fileId),', 3)
}

export function normalizeReleasePacker(source) {
  return replaceExactly(source,
    "const invocation = pnpmInvocation(['--dir', member.directory, 'pack', '--pack-destination', destination])",
    "const invocation = pnpmInvocation([`--config.pnpmfile=${resolve('.eduwork-build/pnpmfile.cjs')}`, '--dir', member.directory, 'pack', '--pack-destination', destination])")
}

export const reviewedFiles = [
  { path: 'packages/client/tsdown.client.ts', beforeSHA256: '8af1b4924e553ae0837a0f6382320051c0a41a07e3dc216a1f41d0c4edea1f08', afterSHA256: '918de3d7b13bb2e866c540cb60738b4208d05d7e0bd275fab2c89920b5443216', transform: normalizeClientPreset },
  { path: 'scripts/release/pack.ts', beforeSHA256: 'feddff24b912c7a929431ab0837617d5f41bb51464c5c04add41a16f6d57d2ad', afterSHA256: '1e10598b331a137c401dd551123e22c6ee38ad57b6430662140e73fe45c80fd4', transform: normalizeReleasePacker },
  { path: '.eduwork-build/pnpmfile.cjs', beforeSHA256: null, afterSHA256: sha256(packingHook), contents: packingHook },
]

export function normalizationContract(commit = reviewedCommit) {
  const release = reviewedReleases.get(commit)
  if (!release) throw new Error('Unreviewed source build commit')
  return { id: release.id, commit, files: reviewedFiles.map(({ path, beforeSHA256, afterSHA256 }) => ({ path, beforeSHA256, afterSHA256 })) }
}

async function assertUnlinked(path, message) {
  // realpath also expands legitimate Windows 8.3 names. Check each original
  // path component for links instead of treating every spelling change as one.
  for (let current = resolve(path); ; current = dirname(current)) {
    const entry = await lstat(current).catch(error => { if (error.code === 'ENOENT') return undefined; throw error })
    if (entry?.isSymbolicLink()) throw new Error(message)
    if (dirname(current) === current) break
  }
}

export async function patchEduworkSourceReproducibility({ upstream, lockPath }) {
  upstream = resolve(upstream)
  const lock = JSON.parse(await readFile(lockPath, 'utf8'))
  const declaration = lock.runtime?.source?.buildNormalization
  if (declaration === undefined) return undefined
  const release = reviewedReleases.get(lock.commit)
  if (!release || lock.sourceArchiveSHA256 !== release.archiveSHA256 || lock.repository !== repository
    || JSON.stringify(declaration) !== JSON.stringify(normalizationContract(lock.commit))) {
    throw new Error('Unreviewed source build normalization contract')
  }
  const marker = JSON.parse(await readFile(join(upstream, '.dsh-source-lock.json'), 'utf8'))
  if (marker.commit !== lock.commit || marker.sourceArchiveSHA256 !== lock.sourceArchiveSHA256 || marker.repository !== lock.repository) {
    throw new Error('Build normalization requires the matching verified source archive')
  }
  if (await lstat(join(upstream, '.git')).catch(() => undefined)) throw new Error('Build normalization does not modify a developer Git checkout')
  await assertUnlinked(upstream, 'Linked source build directory')
  upstream = await realpath(upstream)
  const planned = []
  // Validate every input before writing any file; no partial patch on mismatch.
  for (const file of reviewedFiles) {
    const path = join(upstream, file.path)
    await assertUnlinked(dirname(path), 'Linked build patch parent')
    await assertUnlinked(path, 'Linked build patch target')
    const bytes = await readFile(path).catch(error => { if (error.code === 'ENOENT') return undefined; throw error })
    if (bytes !== undefined && sha256(bytes) === file.afterSHA256) continue
    if ((bytes === undefined ? null : sha256(bytes)) !== file.beforeSHA256) throw new Error(`Unreviewed build patch input: ${file.path}`)
    const contents = file.contents ?? file.transform(bytes.toString('utf8'))
    if (sha256(contents) !== file.afterSHA256) throw new Error(`Build patch output hash mismatch: ${file.path}`)
    planned.push({ path, contents })
  }
  for (const { path, contents } of planned) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, contents)
  }
  const receipt = { schemaVersion: 1, sourceArchiveSHA256: release.archiveSHA256, ...normalizationContract(lock.commit) }
  await mkdir(join(upstream, '.eduwork-build'), { recursive: true })
  await writeFile(join(upstream, '.eduwork-build/normalization.json'), JSON.stringify(receipt, null, 2) + '\n')
  return receipt
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const arguments_ = process.argv.slice(2)
  const upstream = arguments_[arguments_.indexOf('--upstream') + 1]
  const lockPath = arguments_[arguments_.indexOf('--lock') + 1]
  if (!arguments_.includes('--upstream') || !arguments_.includes('--lock') || !upstream || !lockPath) throw new Error('Usage: --upstream <verified archive> --lock <LOCK.json>')
  console.log(JSON.stringify(await patchEduworkSourceReproducibility({ upstream, lockPath }), null, 2))
}
