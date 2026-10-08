// Content-addressed cache for native compile outputs (OpenSSL, whisper.cpp).
//
// This is the second layer: the download cache in build-util.mjs skips the
// network, this one skips the compiler. A build is reused only when a key made
// of everything that can change the result matches, and the restored tree is
// re-hashed against its manifest before it is admitted. A cache entry is never
// trusted on the strength of its name.
import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, readlink, rename, rm, writeFile } from 'node:fs/promises'
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
    const path = pending.pop()
    const entry = await lstat(path)
    const rel = unix(relative(root, path))
    if (entry.isSymbolicLink()) {
      rows.push({ path: rel, kind: 'link', target: await readlink(path) })
    } else if (entry.isDirectory()) {
      rows.push({ path: rel, kind: 'directory', mode: entry.mode & 0o777 })
      for (const name of await readdir(path)) pending.push(join(path, name))
    } else if (entry.isFile()) {
      rows.push({ path: rel, kind: 'file', mode: entry.mode & 0o777, sha256: sha256(await readFile(path)) })
    } else {
      throw new Error(`Unsupported native compile output: ${path}`)
    }
  }
  rows.sort((a, b) => a.path.localeCompare(b.path, 'en'))
  return rows
}

const MANIFEST = 'manifest.json'
const MANIFEST_VERSION = 2

async function outputRows(root, names) {
  const rows = []
  for (const name of names) {
    for (const row of await fileRows(join(root, name))) {
      rows.push({ ...row, path: row.path ? `${name}/${row.path}` : name })
    }
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path, 'en'))
}

/**
 * Re-hash a restored tree against the manifest it was stored with. Any missing,
 * added or changed file rejects the entry, so a cache cannot be a way to smuggle
 * different bytes into a release. Manifest paths carry the output name as a
 * prefix, so every declared output is verified in one pass.
 */
async function verifyRestored(stagingRoot, manifest, names) {
  return JSON.stringify(await outputRows(stagingRoot, names)) === JSON.stringify(manifest.files)
}

/**
 * Restore a compiled tree from the cache, or build it and store the result.
 *
 * `outputs` maps a path in the cache entry to the path it must be placed at.
 * Everything is built into a staging directory first, so a failed build never
 * leaves a partial artifact behind for the next stage to pick up.
 */
export async function cachedCompile({ key, outputs, build, label = '' }) {
  const names = Object.keys(outputs).sort()
  if (!names.length || names.some(name => !name || name === '.' || name === '..' || /[/\\]/.test(name))) {
    throw new Error('Native cache outputs require distinct single-component names')
  }
  const root = join(cacheDirectory(), 'objects', key)
  const manifestPath = join(root, MANIFEST)
  if (await pathExists(manifestPath)) {
    const staging = join(cacheDirectory(), 'restore', `${key}.${process.pid}`)
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      if (manifest.schemaVersion !== MANIFEST_VERSION || manifest.key !== key
        || JSON.stringify(manifest.outputs) !== JSON.stringify(names) || !Array.isArray(manifest.files)) {
        throw new Error('cache manifest does not match the requested outputs')
      }
      // Restore into a staging tree and re-hash it against the manifest before
      // anything is copied to its real destination. A cache entry is admitted on
      // verified bytes, never on its name.
      await rm(staging, { recursive: true, force: true })
      await ensureDir(staging)
      for (const name of Object.keys(outputs)) {
        const source = join(root, name)
        if (!await pathExists(source)) throw new Error(`cache entry is missing ${name}`)
        await copyTreePreserving(source, join(staging, name))
      }
      const verified = await verifyRestored(staging, manifest, names)
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
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
  }

  const staging = join(cacheDirectory(), 'staging', `${key}.${process.pid}`)
  await rm(staging, { recursive: true, force: true })
  await ensureDir(staging)
  try {
    for (const [name, destination] of Object.entries(outputs)) {
      await rm(destination, { recursive: true, force: true })
      await build(name, destination)
      if (!await pathExists(destination)) throw new Error(`build did not produce ${destination}`)
      await copyTreePreserving(destination, join(staging, name))
    }
    const files = await outputRows(staging, names)
    await writeFile(join(staging, MANIFEST), JSON.stringify({ schemaVersion: MANIFEST_VERSION, key, label, outputs: names, files }, null, 2) + '\n')
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
