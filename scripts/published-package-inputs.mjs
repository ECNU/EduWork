import assert from 'node:assert/strict'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const json = async path => JSON.parse(await readFile(path, 'utf8'))

export async function readPublishedPackageLocks(candidate) {
  const names = ['desktop-pet', 'literature', 'mail', 'memory', 'oidc', 'knowledge-studio', 'artifact-services']
  return Promise.all(names.map(name => json(join(candidate, name + '.json'))))
}

// Record package-owned bytes, excluding npm's separately resolved dependency tree.
// This also catches accidental assembly-time manifest or bundle rewrites.
export async function publishedPackageFiles(locks, modules) {
  const result = {}
  for (const { name } of locks) {
    const root = join(modules, name), files = {}
    assert.ok((await lstat(root)).isDirectory(), `Published package must be a real directory: ${name}`)
    const walk = async (directory, prefix = '') => {
      for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
        if (entry.name === 'node_modules') continue
        const path = join(directory, entry.name), key = prefix + entry.name
        if (entry.isDirectory()) await walk(path, key + '/')
        else {
          assert.ok(entry.isFile(), `Published package contains a non-file input: ${name}/${key}`)
          files[key] = createHash('sha256').update(await readFile(path)).digest('hex')
        }
      }
    }
    await walk(root)
    result[name] = files
  }
  return result
}

export async function verifyPublishedPackageFiles(expected, modules) {
  assert.deepEqual(await publishedPackageFiles(Object.keys(expected).map(name => ({ name })), modules), expected,
    'Assembly changed published npm package files')
}

// The product keeps the Runtime's top-level packages. npm must place any
// incompatible plugin dependencies below their consumers before we copy them.
export function verifyDependencyOverlay(dependencyLock, runtimeLock) {
  for (const [path, installed] of Object.entries(dependencyLock.packages)) {
    if (!/^node_modules\/(?:@[^/]+\/)?[^/]+$/.test(path)) continue
    const existing = runtimeLock.packages[path]
    if (!existing) continue
    assert.equal(installed.version, existing.version, `Conflicting Runtime dependency: ${path}; align the npm root dependency so npm can nest incompatible versions`)
    assert.equal(installed.integrity, existing.integrity, `Conflicting Runtime dependency integrity: ${path}`)
  }
}

export async function verifyPublishedPackageInputs({ locks, dependencies, runtime }) {
  const dependencyLock = await json(join(dependencies, 'package-lock.json'))
  const runtimeLock = await json(join(runtime, '.chatecnu-dsh-npm-install-lock.json'))
  verifyDependencyOverlay(dependencyLock, runtimeLock)
  for (const lock of locks) {
    assert.equal(lock.publicationStatus, 'published')
    assert.match(lock.npm.integrity, /^sha512-\S+$/)
    assert.ok((await lstat(join(dependencies, 'node_modules', lock.name))).isDirectory(), `Published package must not be a workspace link: ${lock.name}`)
    const manifest = await json(join(dependencies, 'node_modules', lock.name, 'package.json'))
    assert.equal(manifest.name, lock.name)
    assert.equal(manifest.version, lock.version)
    const installed = dependencyLock.packages['node_modules/' + lock.name]
    assert.equal(installed?.version, lock.version, `Package lock version differs: ${lock.name}`)
    assert.equal(installed?.resolved, lock.npm.tarball, `Package lock source differs: ${lock.name}`)
    assert.equal(installed?.integrity, lock.npm.integrity)
    assert.equal(dependencyLock.packages['']?.dependencies?.[lock.name], lock.version, `Published package must be an exact root dependency: ${lock.name}`)
    // The supplement pass skips existing Runtime packages. Refuse an ambiguous
    // source rather than silently retaining another version under a new receipt.
    const existing = await lstat(join(runtime, 'node_modules', lock.name)).then(() => true, error => {
      if (error.code === 'ENOENT') return false
      throw error
    })
    if (existing) throw new Error(`Published package already exists in Runtime: ${lock.name}`)
  }
}
