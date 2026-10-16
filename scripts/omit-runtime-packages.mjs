import { lstat, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'

// Packages the qualified Runtime or the product dependencies install but the
// desktop product never loads. Packages only they reach are omitted with them.
export const omittedRoots = Object.freeze([
  // Build and test tooling: DSH packages ship generated Typert metadata.
  '@deepseek-ai/dsh-typert-generator', '@deepseek-ai/dsh-client-test-runtime', '@deepseek-ai/dsh-loader-smoke',
  '@deepseek-ai/dsh-llm-mock-server', '@deepseek-ai/dsh-llm-replay', '@deepseek-ai/dsh-session-snapshot',
  // The product does not compose the experimental voice input bundle, the only user of SenseVoice.
  '@deepseek-ai/dsh-experimental-voice-input-bundle', '@deepseek-ai/dsh-experimental-speech-to-text-sensevoice',
])
// Declared dependencies of retained packages that the product never reaches.
export const omittedEdges = Object.freeze({
  // The CLI package lists the voice input bundle for CLI compositions.
  '@deepseek-ai/dsh': ['@deepseek-ai/dsh-experimental-voice-input-bundle'],
  // Literature only extracts text; pdf.js skips its canvas polyfills when absent.
  'pdfjs-dist': ['@napi-rs/canvas'],
  // Studio bundles with webpack; the bundler patch loads rspack only for rspack: true.
  '@remotion/bundler': ['@rspack/core', '@rspack/plugin-react-refresh'],
})
// Undeclared optional use: Remotion reads a video project's tsconfig.json with
// TypeScript when it is installed, so it stays although only Typert depends on it.
const undeclared = ['typescript']

async function installedPackages(modules) {
  const packages = new Map()
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const path = join(directory, entry.name)
      if (entry.name.startsWith('@')) { await visit(path); continue }
      packages.set(path, JSON.parse(await readFile(join(path, 'package.json'), 'utf8')))
      await visit(join(path, 'node_modules'))
    }
  }
  await visit(modules)
  return packages
}

// Command names a package links into node_modules/.bin.
const commands = manifest => typeof manifest.bin === 'string' ? [manifest.name.split('/').at(-1)] : Object.keys(manifest.bin ?? {})
// The .bin directory beside a package directory, also for scoped packages.
const binDirectory = (path, name) => join(name.startsWith('@') ? dirname(dirname(path)) : dirname(path), '.bin')

async function treeSize(path) {
  let bytes = 0
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    bytes += entry.isDirectory() ? await treeSize(child) : (await lstat(child)).size
  }
  return bytes
}

/**
 * Remove the omitted packages and what only they reach. Root dependencies of the
 * Runtime manifest and `roots` stay with everything they declare.
 */
export async function omitRuntimePackages(runtime, roots = []) {
  const manifestPath = join(runtime, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const packages = await installedPackages(join(runtime, 'node_modules'))
  const marker = `${sep}node_modules${sep}`
  // Node resolution: the nearest node_modules on the way up to the Runtime root.
  const resolve = (from, name) => {
    for (let base = from; ;) {
      const path = join(base, 'node_modules', name)
      if (packages.has(path)) return path
      if (base === runtime) return undefined
      base = base.slice(0, base.lastIndexOf(marker))
    }
  }
  const dependencies = path => {
    const item = packages.get(path)
    const cut = omittedEdges[item.name] ?? []
    const peers = Object.keys(item.peerDependencies ?? {}).filter(name => !item.peerDependenciesMeta?.[name]?.optional)
    return [...Object.keys({ ...item.dependencies, ...item.optionalDependencies }), ...peers]
      .filter(name => !cut.includes(name)).map(name => resolve(path, name)).filter(Boolean)
  }
  const closure = seeds => {
    const seen = new Set(), pending = [...seeds]
    while (pending.length) {
      const path = pending.pop()
      if (seen.has(path)) continue
      seen.add(path)
      pending.push(...dependencies(path))
    }
    return seen
  }
  const seeds = omittedRoots.map(name => {
    const path = resolve(runtime, name)
    if (!path) throw new Error(`Omitted Runtime package is not installed: ${name}`)
    return path
  })
  for (const [path, item] of packages) for (const name of omittedEdges[item.name] ?? []) {
    const target = resolve(path, name)
    if (target) seeds.push(target)
  }
  const candidates = closure(seeds)
  for (const name of undeclared) candidates.delete(resolve(runtime, name))
  const declared = [...Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies }), ...roots]
    .filter(name => !omittedRoots.includes(name)).map(name => resolve(runtime, name)).filter(Boolean)
  const needed = closure([...declared, ...[...packages.keys()].filter(path => !candidates.has(path))])
  const omitted = [...candidates].filter(path => !needed.has(path)).sort()
  let bytes = 0
  for (const path of omitted) {
    // A nested package leaves with its parent's directory.
    if (omitted.some(parent => path.startsWith(parent + sep))) continue
    bytes += await treeSize(path)
    await rm(path, { recursive: true })
  }
  // Drop the omitted packages' command links and shims unless a retained package provides the same command.
  const retainedCommands = new Set([...packages].filter(([path]) => !omitted.includes(path))
    .flatMap(([path, item]) => commands(item).map(name => join(binDirectory(path, item.name), name))))
  for (const path of omitted) {
    const item = packages.get(path)
    for (const name of commands(item)) {
      const link = join(binDirectory(path, item.name), name)
      if (retainedCommands.has(link)) continue
      for (const suffix of ['', '.cmd', '.ps1']) await rm(link + suffix, { force: true })
    }
  }
  for (const field of ['dependencies', 'optionalDependencies']) for (const name of omittedRoots) delete manifest[field]?.[name]
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  return { packages: omitted.map(path => `${packages.get(path).name}@${packages.get(path).version}`), bytes }
}
