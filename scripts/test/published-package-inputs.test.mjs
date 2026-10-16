import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { verifyPublishedPackageInputs } from '../published-package-inputs.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-published-inputs-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dependencies = join(root, 'dependencies'), runtime = join(root, 'runtime')
  const lock = { name: '@eduwork/dsh-desktop-pet', version: '0.1.0', publicationStatus: 'published', npm: { integrity: 'sha512-fixture' } }
  const packageRoot = join(dependencies, 'node_modules', lock.name)
  await mkdir(packageRoot, { recursive: true })
  await mkdir(runtime)
  const manifestPath = join(packageRoot, 'package.json')
  await writeFile(manifestPath, JSON.stringify({ name: lock.name, version: lock.version }))
  const dependencyLockPath = join(dependencies, 'package-lock.json')
  await writeFile(dependencyLockPath, JSON.stringify({ packages: { ['node_modules/' + lock.name]: { integrity: lock.npm.integrity } } }))
  return { locks: [lock], dependencies, runtime, lock, manifestPath, dependencyLockPath }
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
  await writeFile(input.dependencyLockPath, JSON.stringify({ packages: { ['node_modules/' + input.lock.name]: { integrity: 'sha512-other' } } }))
  await assert.rejects(verifyPublishedPackageInputs(input), { code: 'ERR_ASSERTION' })
})
