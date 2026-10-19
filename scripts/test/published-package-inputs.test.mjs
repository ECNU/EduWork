import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { verifyPublishedPackageInputs, publishedPackageFiles, verifyPublishedPackageFiles, verifyDependencyOverlay } from '../published-package-inputs.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-published-inputs-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dependencies = join(root, 'dependencies'), runtime = join(root, 'runtime')
  const lock = { name: '@eduwork/dsh-desktop-pet', version: '0.1.0', publicationStatus: 'published', npm: { integrity: 'sha512-fixture', tarball: 'https://registry.npmjs.org/synthetic.tgz' } }
  const packageRoot = join(dependencies, 'node_modules', lock.name)
  await mkdir(packageRoot, { recursive: true })
  await mkdir(runtime)
  await writeFile(join(runtime, '.chatecnu-dsh-npm-install-lock.json'), JSON.stringify({ packages: {} }))
  const manifestPath = join(packageRoot, 'package.json')
  await writeFile(manifestPath, JSON.stringify({ name: lock.name, version: lock.version }))
  const dependencyLockPath = join(dependencies, 'package-lock.json')
  const dependencyLock = { packages: { '': { dependencies: { [lock.name]: lock.version } }, ['node_modules/' + lock.name]: { version: lock.version, resolved: lock.npm.tarball, integrity: lock.npm.integrity } } }
  await writeFile(dependencyLockPath, JSON.stringify(dependencyLock))
  return { locks: [lock], dependencies, runtime, lock, manifestPath, dependencyLockPath, dependencyLock, packageRoot }
}

test('accepts the pinned published dependency with a clean Runtime', async t => {
  await verifyPublishedPackageInputs(await fixture(t))
})

test('rejects an old Runtime package before the supplement pass can silently keep it', async t => {
  const input = await fixture(t)
  const oldPackage = join(input.runtime, 'node_modules', input.lock.name)
  await mkdir(oldPackage, { recursive: true })
  await writeFile(join(oldPackage, 'package.json'), JSON.stringify({ name: input.lock.name, version: '0.0.9' }))
  await assert.rejects(verifyPublishedPackageInputs(input), /Published package already exists in Runtime/)
})

test('rejects a dependency whose installed version differs from the component lock', async t => {
  const input = await fixture(t)
  await writeFile(input.manifestPath, JSON.stringify({ name: input.lock.name, version: '0.0.9' }))
  await assert.rejects(verifyPublishedPackageInputs(input), { code: 'ERR_ASSERTION' })
})

test('rejects a dependency whose registry integrity differs from the component lock', async t => {
  const input = await fixture(t)
  input.dependencyLock.packages['node_modules/' + input.lock.name].integrity = 'sha512-other'
  await writeFile(input.dependencyLockPath, JSON.stringify(input.dependencyLock))
  await assert.rejects(verifyPublishedPackageInputs(input), { code: 'ERR_ASSERTION' })
})

for (const field of ['version', 'resolved']) test(`rejects a stale or non-registry ${field}`, async t => {
  const input = await fixture(t)
  input.dependencyLock.packages['node_modules/' + input.lock.name][field] = 'synthetic-other'
  await writeFile(input.dependencyLockPath, JSON.stringify(input.dependencyLock))
  await assert.rejects(verifyPublishedPackageInputs(input), { code: 'ERR_ASSERTION' })
})

test('rejects a floating product dependency', async t => {
  const input = await fixture(t)
  input.dependencyLock.packages[''].dependencies[input.lock.name] = '^0.1.0'
  await writeFile(input.dependencyLockPath, JSON.stringify(input.dependencyLock))
  await assert.rejects(verifyPublishedPackageInputs(input), /exact root dependency/)
})

test('rejects workspace links even when their manifest matches the published version', async t => {
  const input = await fixture(t)
  const linked = join(input.dependencies, 'workspace')
  await mkdir(linked)
  await writeFile(join(linked, 'package.json'), JSON.stringify({ name: input.lock.name, version: input.lock.version }))
  await rm(input.packageRoot, { recursive: true, force: true })
  await symlink(linked, input.packageRoot, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(verifyPublishedPackageInputs(input), /workspace link/)
})

test('detects assembly-time rewrites and added files while excluding separately locked nested dependencies', async t => {
  const input = await fixture(t), modules = join(input.dependencies, 'node_modules')
  const expected = await publishedPackageFiles(input.locks, modules)
  await mkdir(join(input.packageRoot, 'node_modules/synthetic'), { recursive: true })
  await writeFile(join(input.packageRoot, 'node_modules/synthetic/index.js'), 'separately resolved dependency')
  await verifyPublishedPackageFiles(expected, modules)
  await writeFile(join(input.packageRoot, 'extra.js'), 'unpublished overwrite')
  await assert.rejects(verifyPublishedPackageFiles(expected, modules), /changed published npm package files/)
  await rm(join(input.packageRoot, 'extra.js'))
  await writeFile(input.manifestPath, JSON.stringify({ name: input.lock.name, version: input.lock.version, private: true }))
  await assert.rejects(verifyPublishedPackageFiles(expected, modules), /changed published npm package files/)
})

test('rejects a hoisted dependency that the Runtime would silently replace with another major', () => {
  assert.throws(() => verifyDependencyOverlay({ packages: {
    'node_modules/execa': { version: '5.1.1', integrity: 'sha512-old' },
  } }, { packages: {
    'node_modules/execa': { version: '10.0.1', integrity: 'sha512-new' },
  } }), /Conflicting Runtime dependency/)
})

test('accepts npm-resolved nested versions while sharing identical Runtime packages', () => {
  const runtime = { packages: { 'node_modules/execa': { version: '10.0.1', integrity: 'sha512-new' } } }
  verifyDependencyOverlay({ packages: { ...runtime.packages,
    'node_modules/synthetic/node_modules/execa': { version: '5.1.1', integrity: 'sha512-old' },
  } }, runtime)
  assert.throws(() => verifyDependencyOverlay({ packages: {
    'node_modules/execa': { version: '10.0.1', integrity: 'sha512-different' },
  } }, runtime), /Conflicting Runtime dependency integrity/)
})
