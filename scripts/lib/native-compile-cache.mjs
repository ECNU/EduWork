// Content-addressed cache for native compile outputs (OpenSSL, whisper.cpp).
//
// This is the second layer: the download cache in build-util.mjs skips the
// network, this one skips the compiler. A build is reused only when a key made
// of everything that can change the result matches, and the restored tree is
// re-hashed against its manifest before it is admitted. A cache entry is never
// trusted on the strength of its name.
import { createHash } from 'node:crypto'
import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import {
  cacheDirectory, copyTreePreservingLinks, ensureDir, pathExists, run,
} from './build-util.mjs'

const unix = path => path.split(sep).join('/')
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex')

/**
 * Tool versions are part of the key. A compiler upgrade must not silently reuse
 * objects the old compiler produced, so a version change costs a rebuild.
 */
async function toolVersions(commands) {
  const versions = {}
  for (const [name, args] of Object.entries(commands)) {
    try {
      const { stdout } = await run(name, args, { capture: true, echo: false })
      versions[name] = stdout.trim().split('\n')[0].slice(0, 200)
    } catch {
      // A missing tool cannot build anything; record it so the key reflects the
      // machine honestly and the build itself fails with a real error.
      versions[name] = 'missing'
    }
  }
  return versions
}

/**
 * Build a cache key from the declared inputs. `parts` must contain everything
 * that can change the output bytes.
 */
export async function compileKey({ name, parts, tools = {} }) {
  const resolved = await toolVersions(tools)
  return sha256(JSON.stringify({ name, parts, tools: resolved }))
}

async function fileRows(root) {
  const rows = []
  const pending = [root]
  while (pending.length) {
    const directory = pending.pop()
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const path = join(directory, entry.name)
      const rel = unix(relative(root, path))
      if (entry.isSymbolicLink()) rows.push({ path: rel, kind: 'link' })
      else if (entry.isDirectory()) pending.push(path)
      else if (entry.isFile()) rows.push({ path: rel, kind: 'file', sha256: await sha256(await readFile(path)) })
      else rows.push({ path: rel, kind: 'other' })
    }
  }
  rows.sort((a, b) => a.path.localeCompare(b.path, 'en'))
  return rows
}

const MANIFEST = 'manifest.json'

/**
 * Re-hash a restored tree against the manifest it was stored with. Any missing,
 * added or changed file rejects the entry, so a cache cannot be a way to smuggle
 * different bytes into a release. Manifest paths carry the output name as a
 * prefix, so every declared output is verified in one pass.
 */
async function verifyRestored(stagingRoot, manifest) {
  const actual = []
  for (const name of new Set(manifest.files.map(row => row.path.split('/')[0]))) {
    for (const row of await fileRows(join(stagingRoot, name))) actual.push({ ...row, path: `${name}/${row.path}` })
  }
  actual.sort((a, b) => a.path.localeCompare(b.path, 'en'))
  const expected = manifest.files
  if (actual.length !== expected.length) return false
  for (let index = 0; index < actual.length; index += 1) {
    const a = actual[index], b = expected[index]
    if (a.path !== b.path || a.kind !== b.kind || a.sha256 !== b.sha256) return false
  }
  return true
}

/**
 * Restore a compiled tree from the cache, or build it and store the result.
 *
 * `outputs` maps a path in the cache entry to the path it must be placed at.
 * Everything is built into a staging directory first, so a failed build never
 * leaves a partial artifact behind for the next stage to pick up.
 */
export async function cachedCompile({ key, outputs, build, label = '' }) {
  const root = join(cacheDirectory(), 'objects', key)
  const manifestPath = join(root, MANIFEST)
  if (await pathExists(manifestPath)) {
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      // Restore into a staging tree and re-hash it against the manifest before
      // anything is copied to its real destination. A cache entry is admitted on
      // verified bytes, never on its name.
      const staging = join(cacheDirectory(), 'restore', `${key}.${process.pid}`)
      await rm(staging, { recursive: true, force: true })
      await ensureDir(staging)
      for (const name of Object.keys(outputs)) {
        const source = join(root, name)
        if (!await pathExists(source)) throw new Error(`cache entry is missing ${name}`)
        await copyTreePreserving(source, join(staging, name))
      }
      const verified = await verifyRestored(staging, manifest)
      if (!verified) {
        await rm(staging, { recursive: true, force: true })
        console.log(`Native cache entry failed verification, rebuilding: ${label || key.slice(0, 12)}`)
        await rm(root, { recursive: true, force: true })
      } else {
        for (const [name, destination] of Object.entries(outputs)) {
          await rm(destination, { recursive: true, force: true })
          await ensureDir(dirname(destination))
          await copyTreePreserving(join(staging, name), destination)
        }
        await rm(staging, { recursive: true, force: true })
        console.log(`Native cache hit: ${label || key.slice(0, 12)}`)
        return { hit: true, key }
      }
    } catch (error) {
      console.log(`Native cache entry unusable (${error.message}), rebuilding: ${label || key.slice(0, 12)}`)
      await rm(root, { recursive: true, force: true })
    }
  }

  const staging = join(cacheDirectory(), 'staging', `${key}.${process.pid}`)
  await rm(staging, { recursive: true, force: true })
  await ensureDir(staging)
  try {
    for (const [name, destination] of Object.entries(outputs)) {
      await build(name, destination)
      if (!await pathExists(destination)) throw new Error(`build did not produce ${destination}`)
      await copyTreePreserving(destination, join(staging, name))
    }
    const files = []
    for (const name of Object.keys(outputs)) {
      for (const row of await fileRows(join(staging, name))) files.push({ ...row, path: `${name}/${row.path}` })
    }
    files.sort((a, b) => a.path.localeCompare(b.path, 'en'))
    await writeFile(join(staging, MANIFEST), JSON.stringify({ schemaVersion: 1, key, label, files }, null, 2) + '\n')
    // Rename into place so a concurrent reader sees nothing or a complete entry.
    await ensureDir(dirname(root))
    await rm(root, { recursive: true, force: true })
    await rename(staging, root)
    console.log(`Native cache stored: ${label || key.slice(0, 12)}`)
    return { hit: false, key }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

/**
 * Copy a tree preserving internal symlinks. `copyTree` in build-util rejects
 * links by design, but a compiled prefix legitimately contains versioned
 * symlinks (`libssl.3.dylib` -> `libssl.3.5.8.dylib`), so the shared
 * link-preserving copy is the right one here.
 */
const copyTreePreserving = copyTreePreservingLinks
