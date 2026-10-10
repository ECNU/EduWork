// Locked DSH package acquisition and payload staging. Node.js port of
// install-locked-dsh-package.ps1 and copy-dsh-package-payload.ps1.
import { rename } from 'node:fs/promises'
import { dirname, isAbsolute, join, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  assertNoLinks, capture, copyFileTo, copyTree, ensureDir, fullPath, isFile, pathExists,
  readJSON, readdirNames, removeTree, run, runBundledCli, sha256File, sha512Integrity, statEntry,
} from './build-util.mjs'

function insideParent(parent, path) {
  const prefix = fullPath(parent).replace(/[\\/]+$/, '') + sep
  const target = fullPath(path)
  if (process.platform === 'linux') return target.startsWith(prefix)
  return target.toLowerCase().startsWith(prefix.toLowerCase())
}

async function npmPack(args, { cwd } = {}) {
  return runBundledCli('npm', ['pack', ...args, '--ignore-scripts'], { cwd, capture: true })
}

export async function copyDshPackagePayload(source, destination) {
  source = fullPath(source)
  destination = fullPath(destination)
  const sourceStat = await statEntry(source)
  if (!sourceStat?.isDirectory() || sourceStat.isSymbolicLink()) throw new Error('Package source must be a real directory.')
  if (await pathExists(destination)) throw new Error(`Package destination already exists: ${destination}`)
  const parent = dirname(destination)
  await ensureDir(parent)
  const stage = fullPath(join(parent, `.pack-${randomUUID().replaceAll('-', '')}`))
  if (!insideParent(parent, stage)) throw new Error('Package staging escapes destination parent.')
  await ensureDir(stage)
  try {
    const { stdout } = await runBundledCli('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', stage], { cwd: source, capture: true })
      .catch(() => { throw new Error(`Package packing failed: ${source}`) })
    const record = JSON.parse(stdout)[0]
    for (const file of record.files ?? []) {
      if (isAbsolute(file.path) || String(file.path).split(/[/\\]/).includes('..') || /(^|\/)node_modules\//.test(file.path)) {
        throw new Error(`Invalid package payload: ${file.path}`)
      }
    }
    await run('tar', ['-xf', join(stage, record.filename), '-C', stage], { echo: false })
      .catch(() => { throw new Error('Package extraction failed.') })
    await assertNoLinks(join(stage, 'package'))
    await rename(join(stage, 'package'), destination)
  } finally {
    await removeTree(stage)
  }
}

function resolvePackageArtifactPath(packageName, packageRoot, relativePath) {
  if (!relativePath || isAbsolute(relativePath) || String(relativePath).split(/[/\\]/).includes('..')) {
    throw new Error(`${packageName} required artifact must be a package-relative path without parent traversal: ${relativePath}`)
  }
  const rootFull = fullPath(packageRoot).replace(/[\\/]+$/, '')
  const resolved = fullPath(join(rootFull, relativePath))
  if (!insideParent(rootFull, resolved)) {
    throw new Error(`${packageName} required artifact escapes the package root: ${relativePath}`)
  }
  return resolved
}

export async function installLockedDshPackage({ source = '', destination, lockPath, requiredFiles = [] }) {
  destination = fullPath(destination)
  lockPath = fullPath(lockPath)
  if (!await isFile(lockPath)) throw new Error(`Locked DSH package input is missing: ${lockPath}`)

  const lock = await readJSON(lockPath)
  const packageName = String(lock.name ?? '')
  if (!packageName.trim() || !String(lock.version ?? '').trim()) {
    throw new Error(`Locked DSH package identity is incomplete: ${lockPath}`)
  }

  const fromSource = Boolean(source && source.trim())
  // Published releases are fetched by exact npm identity. Retained review
  // tarballs are evidence, not an implicit fallback when the registry fails.
  const fromRegistry = !fromSource && String(lock.publicationStatus) === 'published'
  let localTarball = ''
  if (!fromSource && !fromRegistry && String(lock.tarball ?? '').trim()) {
    localTarball = resolvePackageArtifactPath(packageName, dirname(lockPath), String(lock.tarball))
    const tarballStat = await statEntry(localTarball)
    if (!tarballStat) throw new Error(`Locked package tarball is missing: ${localTarball}`)
    if (tarballStat.isSymbolicLink()) throw new Error('Locked package tarball must not be a link.')
    if (tarballStat.isDirectory()) throw new Error('Locked package tarball must be a regular file.')
  }
  if (fromSource) {
    source = fullPath(source)
    const sourceManifestPath = join(source, 'package.json')
    if (!await isFile(sourceManifestPath)) throw new Error(`Locked ${packageName} input is missing: ${sourceManifestPath}`)
    const manifest = await readJSON(sourceManifestPath)
    if (String(manifest.name) !== packageName || String(manifest.version) !== String(lock.version)) {
      throw new Error(`${packageName} package identity mismatch: expected ${packageName}@${lock.version}, got ${manifest.name}@${manifest.version}`)
    }
    if (await pathExists(join(source, '.git'))) {
      const sourceCommit = await capture('git', ['-C', source, 'rev-parse', 'HEAD'])
      if (sourceCommit !== String(lock.commit)) throw new Error(`${packageName} source commit mismatch: expected ${lock.commit}, got ${sourceCommit}`)
      const dirty = await capture('git', ['-C', source, 'status', '--short'])
      if (dirty.trim()) throw new Error(`${packageName} source must be clean before packaging:\n${dirty}`)
    }
  } else if (!String(lock.npm?.integrity ?? '').trim()) {
    throw new Error(`${packageName} lock has no npm integrity; provide a source override for source assembly.`)
  }

  const destinationParent = dirname(destination)
  const safeName = packageName.replace(/[^A-Za-z0-9._-]/g, '-')
  const packRoot = fullPath(join(destinationParent, `.${safeName}-package-staging`))
  if (!insideParent(destinationParent, packRoot)) {
    throw new Error(`Refusing to stage ${packageName} outside the destination parent: ${packRoot}`)
  }
  await removeTree(packRoot)
  await ensureDir(packRoot)

  try {
    if (fromSource) {
      await npmPack(['--pack-destination', packRoot], { cwd: source })
        .catch(() => { throw new Error(`npm pack failed for ${packageName}`) })
    } else if (localTarball) {
      await copyFileTo(localTarball, join(packRoot, `${safeName}-${lock.version}.tgz`))
    } else {
      await npmPack([`${packageName}@${lock.version}`, '--registry=https://registry.npmjs.org/', '--pack-destination', packRoot])
        .catch(() => { throw new Error(`npm pack from registry failed for ${packageName}`) })
    }
    const tarballs = (await readdirNames(packRoot)).filter(name => name.endsWith('.tgz'))
    if (tarballs.length !== 1) throw new Error(`Expected exactly one ${packageName} tarball, found ${tarballs.length}`)
    const tarball = join(packRoot, tarballs[0])
    const actualHash = await sha256File(tarball)
    if (actualHash !== String(lock.tarballSHA256)) {
      throw new Error(`${packageName} tarball SHA-256 mismatch: expected ${lock.tarballSHA256}, got ${actualHash}`)
    }
    const actualIntegrity = await sha512Integrity(tarball)
    if (String(lock.npm?.integrity ?? '').trim() && actualIntegrity !== String(lock.npm.integrity)) {
      throw new Error(`${packageName} npm integrity mismatch: expected ${lock.npm.integrity}, got ${actualIntegrity}`)
    }

    await run('tar', ['-xf', tarball, '-C', packRoot], { echo: false })
      .catch(() => { throw new Error(`Extracting ${packageName} tarball failed`) })
    const extracted = join(packRoot, 'package')
    const extractedManifest = await readJSON(join(extracted, 'package.json'))
    if (String(extractedManifest.name) !== packageName || String(extractedManifest.version) !== String(lock.version)) {
      throw new Error(`Extracted ${packageName} identity differs from the lock.`)
    }
    for (const required of requiredFiles ?? []) {
      const requiredPath = resolvePackageArtifactPath(packageName, extracted, required)
      if (!await isFile(requiredPath)) {
        throw new Error(`Packed ${packageName} is missing required artifact: ${required}`)
      }
    }
    await removeTree(destination)
    await ensureDir(destinationParent)
    await copyTree(extracted, destination)
  } finally {
    await removeTree(packRoot)
  }

  return {
    name: packageName,
    version: String(lock.version),
    commit: String(lock.commit ?? ''),
    tarballSHA256: String(lock.tarballSHA256),
    source: fromSource ? 'source' : localTarball && lock.sourceMode === 'development-source' ? 'development-source' : localTarball ? 'locked-tarball' : 'npm',
  }
}
