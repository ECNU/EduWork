// The download cache is content-addressed and only admits pinned downloads.
// These tests pin that contract, because a cache that silently serves the wrong
// bytes is worse than no cache at all.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { sep, join } from 'node:path'
import { defaultCacheRoot, download, ensureDir, pathExists } from '../scripts/lib/build-util.mjs'

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex')

async function sandbox(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) }
}

test('a download without a pinned hash is never cached', async () => {
  const { root, cleanup } = await sandbox('l3-uncached-')
  try {
    const cache = join(root, 'cache')
    const source = join(root, 'payload.bin')
    await writeFile(source, 'bytes')
    // No sha256 means no key. The call must not create a cache entry.
    await assert.rejects(
      download('https://example.invalid/x', join(root, 'out'), { cacheRoot: cache, retries: 1 }),
    )
    assert.equal(await pathExists(join(cache, 'downloads')), false)
  } finally {
    await cleanup()
  }
})

test('a cache hit is served without touching the network', async () => {
  const { root, cleanup } = await sandbox('l3-hit-')
  try {
    const payload = Buffer.from('cached-bytes-'.repeat(64))
    const hash = sha256(payload)
    const cache = join(root, 'cache')
    const entry = join(cache, 'downloads', hash.slice(0, 2), hash)
    await ensureDir(join(cache, 'downloads', hash.slice(0, 2)))
    await writeFile(entry, payload)

    const target = join(root, 'served.bin')
    // Port 1 is unbound; a cache hit must never reach it.
    await download('https://127.0.0.1:1/never', target, { sha256: hash, cacheRoot: cache, retries: 1 })
    assert.equal((await readFile(target)).toString(), payload.toString())
  } finally {
    await cleanup()
  }
})

test('a corrupt cache entry is discarded, not trusted', async () => {
  const { root, cleanup } = await sandbox('l3-corrupt-')
  try {
    const payload = Buffer.from('truth')
    const hash = sha256(payload)
    const cache = join(root, 'cache')
    const shard = join(cache, 'downloads', hash.slice(0, 2))
    await ensureDir(shard)
    // The entry exists under the right content address but holds wrong bytes.
    await writeFile(join(shard, hash), Buffer.from('lie'))

    const target = join(root, 'served.bin')
    await assert.rejects(
      download('https://127.0.0.1:1/never', target, { sha256: hash, cacheRoot: cache, retries: 1 }),
    )
    // The poisoned entry is removed; the failure is a fetch failure, not a
    // silent wrong-bytes success.
    assert.equal(await pathExists(join(shard, hash)), false)
  } finally {
    await cleanup()
  }
})

test('a mismatched hash fails instead of populating the cache', async () => {
  const { root, cleanup } = await sandbox('l3-mismatch-')
  try {
    const cache = join(root, 'cache')
    const target = join(root, 'served.bin')
    await assert.rejects(
      download('https://127.0.0.1:1/never', target, {
        sha256: 'a'.repeat(64), cacheRoot: cache, retries: 1,
      }),
    )
    assert.equal(await pathExists(join(cache, 'downloads', 'aa', 'a'.repeat(64))), false)
  } finally {
    await cleanup()
  }
})

test('the default cache root lives outside any repository', () => {
  const root = defaultCacheRoot()
  assert.match(root, /eduwork-native-cache$/)
  // It must never be inside a checkout, because the source audit rejects
  // generated content found in the repository.
  assert.ok(!root.includes(`${sep}.git${sep}`), 'the cache root must not be inside a checkout')
  // On POSIX it is a flat, predictable path rather than the per-user or per-job
  // temporary directory: on a GitHub-hosted runner `$TMPDIR` is `RUNNER_TEMP`,
  // which is wiped at the start of every job, so a cache there never survives to
  // be used. Windows keeps `%TEMP%`, which is the documented location there.
  if (process.platform === 'win32') {
    assert.ok(root.startsWith(join(realpathSync(tmpdir()), '')))
  } else {
    assert.ok(root.startsWith('/tmp/'), `expected a flat /tmp root, got ${root}`)
  }
})

test('EDUWORK_TMPDIR relocates the cache root for callers that need a durable one', () => {
  const previous = process.env.EDUWORK_TMPDIR
  try {
    // A caller that needs a durable root — CI caching the native inputs, or a
    // machine with a small /tmp — can name it without a code change.
    const relocated = join(tmpdir(), 'eduwork-relocated')
    process.env.EDUWORK_TMPDIR = relocated
    assert.equal(defaultCacheRoot(), join(relocated, 'eduwork-native-cache'))
  } finally {
    if (previous === undefined) delete process.env.EDUWORK_TMPDIR
    else process.env.EDUWORK_TMPDIR = previous
  }
})

test('non-HTTPS downloads are still rejected before any cache write', async () => {
  const { root, cleanup } = await sandbox('l3-http-')
  try {
    await assert.rejects(
      download('http://example.test/x', join(root, 'out'), { sha256: 'b'.repeat(64), cacheRoot: join(root, 'c') }),
      /HTTPS/,
    )
    assert.equal(await pathExists(join(root, 'c')), false)
  } finally {
    await cleanup()
  }
})
