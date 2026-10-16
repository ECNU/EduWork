import assert from 'node:assert/strict'
import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const json = async path => JSON.parse(await readFile(path, 'utf8'))

export async function verifyPublishedPackageInputs({ locks, dependencies, runtime }) {
  const dependencyLock = await json(join(dependencies, 'package-lock.json'))
  for (const lock of locks) {
    assert.equal(lock.publicationStatus, 'published')
    const manifest = await json(join(dependencies, 'node_modules', lock.name, 'package.json'))
    assert.equal(manifest.name, lock.name)
    assert.equal(manifest.version, lock.version)
    assert.equal(dependencyLock.packages['node_modules/' + lock.name]?.integrity, lock.npm.integrity)
    // The supplement pass skips existing Runtime packages. Refuse an ambiguous
    // source rather than silently retaining another version under a new receipt.
    const existing = await lstat(join(runtime, 'node_modules', lock.name)).then(() => true, error => {
      if (error.code === 'ENOENT') return false
      throw error
    })
    if (existing) throw new Error(`Published package already exists in Runtime: ${lock.name}`)
  }
}
