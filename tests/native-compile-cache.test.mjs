// The compile cache is admitted on verified bytes, never on its name. These
// tests cover the two ways it could betray a release: a stale key and a
// tampered entry.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cachedCompile, compileKey } from '../scripts/lib/native-compile-cache.mjs'
import { cacheDirectory, ensureDir, pathExists, setCacheRoot } from '../scripts/lib/build-util.mjs'

async function sandbox(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  setCacheRoot(join(root, 'cache'))
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) }
}

test('a first build stores an entry and a second run restores it', async () => {
  const { root, cleanup } = await sandbox('l3-compile-hit-')
  try {
    const key = await compileKey({ name: 'fake', parts: { source: 'abc' } })
    let builds = 0
    const outputs = { 'lib': join(root, 'out/lib') }
    const build = async (name, destination) => {
      builds += 1
      await ensureDir(destination)
      await writeFile(join(destination, `${name}.txt`), 'compiled')
    }

    const first = await cachedCompile({ key, outputs, build, label: 'fake' })
    assert.equal(first.hit, false)
    assert.equal(builds, 1)
    assert.equal(await readFile(join(root, 'out/lib/lib.txt'), 'utf8'), 'compiled')

    // A second run with the same key must not rebuild.
    await rm(join(root, 'out'), { recursive: true, force: true })
    const second = await cachedCompile({ key, outputs, build, label: 'fake' })
    assert.equal(second.hit, true)
    assert.equal(builds, 1, 'the compiler ran twice for an unchanged key')
    assert.equal(await readFile(join(root, 'out/lib/lib.txt'), 'utf8'), 'compiled')
  } finally {
    await cleanup()
  }
})

test('a different key rebuilds instead of reusing', async () => {
  const { root, cleanup } = await sandbox('l3-compile-key-')
  try {
    const outputs = { lib: join(root, 'out/lib') }
    let builds = 0
    const build = async (name, destination) => {
      builds += 1
      await ensureDir(destination)
      await writeFile(join(destination, 'v.txt'), String(builds))
    }
    await cachedCompile({ key: await compileKey({ name: 'fake', parts: { source: 'v1' } }), outputs, build })
    await cachedCompile({ key: await compileKey({ name: 'fake', parts: { source: 'v2' } }), outputs, build })
    assert.equal(builds, 2, 'a changed key must not reuse the old object')
  } finally {
    await cleanup()
  }
})

test('a tool version change changes the key', async () => {
  const a = await compileKey({ name: 'fake', parts: { source: 'x' }, tools: { node: ['--version'] } })
  const b = await compileKey({ name: 'fake', parts: { source: 'x' }, tools: {} })
  assert.notEqual(a, b)
})

test('a tampered cache entry is rejected and rebuilt', async () => {
  const { root, cleanup } = await sandbox('l3-compile-tamper-')
  try {
    const key = await compileKey({ name: 'fake', parts: { source: 'abc' } })
    const outputs = { lib: join(root, 'out/lib') }
    let builds = 0
    const build = async (name, destination) => {
      builds += 1
      await ensureDir(destination)
      await writeFile(join(destination, 'lib.txt'), 'genuine')
    }
    await cachedCompile({ key, outputs, build })
    assert.equal(builds, 1)

    // Corrupt the stored object without touching its manifest.
    const stored = join(cacheDirectory(), 'objects', key, 'lib/lib.txt')
    assert.equal(await pathExists(stored), true)
    await writeFile(stored, 'tampered')

    await rm(join(root, 'out'), { recursive: true, force: true })
    const second = await cachedCompile({ key, outputs, build })
    assert.equal(second.hit, false, 'a tampered entry must not be served')
    assert.equal(builds, 2)
    assert.equal(await readFile(join(root, 'out/lib/lib.txt'), 'utf8'), 'genuine')
  } finally {
    await cleanup()
  }
})

test('a missing file in the entry is rejected', async () => {
  const { root, cleanup } = await sandbox('l3-compile-missing-')
  try {
    const key = await compileKey({ name: 'fake', parts: { source: 'abc' } })
    const outputs = { lib: join(root, 'out/lib') }
    let builds = 0
    const build = async (name, destination) => {
      builds += 1
      await ensureDir(destination)
      await writeFile(join(destination, 'a.txt'), 'a')
      await writeFile(join(destination, 'b.txt'), 'b')
    }
    await cachedCompile({ key, outputs, build })
    await rm(join(cacheDirectory(), 'objects', key, 'lib/b.txt'))
    await rm(join(root, 'out'), { recursive: true, force: true })
    const second = await cachedCompile({ key, outputs, build })
    assert.equal(second.hit, false)
    assert.equal(builds, 2)
  } finally {
    await cleanup()
  }
})

test('a build that produces nothing fails instead of caching an empty object', async () => {
  const { root, cleanup } = await sandbox('l3-compile-empty-')
  try {
    const key = await compileKey({ name: 'fake', parts: { source: 'abc' } })
    await assert.rejects(
      cachedCompile({
        key,
        outputs: { lib: join(root, 'out/lib') },
        build: async () => {},
      }),
      /did not produce/,
    )
    assert.equal(await pathExists(join(cacheDirectory(), 'objects', key)), false)
  } finally {
    await cleanup()
  }
})

test('symlinks inside a compiled tree survive the round trip', async () => {
  const { root, cleanup } = await sandbox('l3-compile-links-')
  try {
    const key = await compileKey({ name: 'fake', parts: { source: 'links' } })
    const outputs = { lib: join(root, 'out/lib') }
    const build = async (name, destination) => {
      const { symlink } = await import('node:fs/promises')
      await ensureDir(destination)
      await writeFile(join(destination, 'libssl.3.5.8.dylib'), 'bytes')
      await symlink('libssl.3.5.8.dylib', join(destination, 'libssl.3.dylib'))
    }
    await cachedCompile({ key, outputs, build })
    await rm(join(root, 'out'), { recursive: true, force: true })
    const second = await cachedCompile({ key, outputs, build })
    assert.equal(second.hit, true)
    const { lstat, readlink } = await import('node:fs/promises')
    assert.equal((await lstat(join(root, 'out/lib/libssl.3.dylib'))).isSymbolicLink(), true)
    assert.equal(await readlink(join(root, 'out/lib/libssl.3.dylib')), 'libssl.3.5.8.dylib')
  } finally {
    await cleanup()
  }
})
