// DSH compatibility gate: verifies the pinned upstream source (Git checkout or
// verified archive), the pnpm lock, package contracts and source anchors from
// the checked-in contract snapshot. Node.js port of test-dsh-compatibility.ps1.
import { readFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { capture, ensureDir, fullPath, isFile, isMainModule, pathExists, readJSON, run, sha256File, writeJSON } from '../../scripts/lib/build-util.mjs'

const repositoryRoot = fullPath(join(dirname(fileURLToPath(import.meta.url)), '..', '..'))

export async function testDshCompatibility({ upstream = join(repositoryRoot, '.research/upstream/deepseek-harness'), report = '', lockPath = '', snapshotPath = '' } = {}) {
  upstream = fullPath(upstream)
  lockPath = fullPath(lockPath || join(repositoryRoot, 'third_party/dsh/LOCK.json'))
  snapshotPath = fullPath(snapshotPath || join(dirname(lockPath), 'DSH-CONTRACT-SNAPSHOT.json'))
  const lock = await readJSON(lockPath)
  const snapshot = await readJSON(snapshotPath)
  const failures = []
  const upstreamPath = relativePath => join(upstream, relativePath.replaceAll('/', sep))

  if (snapshot.upstreamCommit !== lock.commit) {
    failures.push(`snapshot commit ${snapshot.upstreamCommit} does not match lock commit ${lock.commit}`)
  }

  if (await pathExists(join(upstream, '.git'))) {
    const actualCommit = await capture('git', ['-C', upstream, 'rev-parse', 'HEAD']).catch(() => '')
    if (actualCommit !== lock.commit) {
      failures.push(`upstream commit mismatch: expected ${lock.commit}, got ${actualCommit}`)
    }
    const unstaged = await run('git', ['-C', upstream, 'diff', '--quiet', '--ignore-submodules', '--exit-code', '--', '.'], { allowFailure: true, echo: false })
    if (unstaged.code !== 0) {
      failures.push('upstream tracked files contain product or local modifications; DSH mainline must remain read-only')
    }
    const staged = await run('git', ['-C', upstream, 'diff', '--cached', '--quiet', '--ignore-submodules', '--exit-code', '--', '.'], { allowFailure: true, echo: false })
    if (staged.code !== 0) {
      failures.push('upstream tracked files contain staged modifications; DSH mainline must remain read-only')
    }
  } else {
    const sourceMarkerPath = join(upstream, '.dsh-source-lock.json')
    if (!await isFile(sourceMarkerPath)) {
      failures.push(`upstream source has neither Git metadata nor a verified source-archive marker: ${upstream}`)
    } else {
      try {
        const sourceMarker = await readJSON(sourceMarkerPath)
        if (Number(sourceMarker.schemaVersion) !== 1 ||
          String(sourceMarker.commit) !== String(lock.commit) ||
          String(sourceMarker.repository) !== String(lock.repository) ||
          String(sourceMarker.sourceArchiveSHA256) !== String(lock.sourceArchiveSHA256)) {
          failures.push('verified source-archive marker does not match third_party/dsh/LOCK.json')
        }
      } catch (error) {
        failures.push(`verified source-archive marker is invalid: ${error.message}`)
      }
    }
  }

  const rootManifestPath = join(upstream, 'package.json')
  if (await pathExists(rootManifestPath)) {
    const rootManifest = await readJSON(rootManifestPath)
    if (rootManifest.version !== lock.packageVersion) {
      failures.push(`root package version mismatch: expected ${lock.packageVersion}, got ${rootManifest.version}`)
    }
  } else {
    failures.push('upstream package.json is missing')
  }

  const pnpmLockPath = join(upstream, 'pnpm-lock.yaml')
  if (await pathExists(pnpmLockPath)) {
    const actualLockHash = await sha256File(pnpmLockPath)
    if (actualLockHash !== lock.pnpmLockSHA256) {
      failures.push(`pnpm lock hash mismatch: expected ${lock.pnpmLockSHA256}, got ${actualLockHash}`)
    }
  } else {
    failures.push('upstream pnpm-lock.yaml is missing')
  }

  for (const contract of snapshot.packages ?? []) {
    const path = upstreamPath(contract.path)
    if (!await pathExists(path)) {
      failures.push(`package manifest is missing: ${contract.path}`)
      continue
    }
    const manifest = await readJSON(path)
    if (manifest.name !== contract.name) {
      failures.push(`${contract.path} name mismatch: expected ${contract.name}, got ${manifest.name}`)
    }
    const expectedPackageVersion = String(contract.name).startsWith('@deepseek-ai/dsh-') ? String(lock.packageVersion) : String(contract.version)
    if (manifest.version !== expectedPackageVersion) {
      failures.push(`${contract.name} version mismatch: expected ${expectedPackageVersion}, got ${manifest.version}`)
    }
    const availableExports = Object.keys(manifest.exports ?? {})
    for (const requiredExport of contract.requiredExports ?? []) {
      if (!availableExports.includes(requiredExport)) {
        failures.push(`${contract.name} no longer exports ${requiredExport}`)
      }
    }
  }

  for (const anchor of snapshot.sourceAnchors ?? []) {
    const path = upstreamPath(anchor.path)
    if (!await pathExists(path)) {
      failures.push(`contract source is missing: ${anchor.path}`)
      continue
    }
    const content = await readFile(path, 'utf8')
    const actualCount = content.split(String(anchor.text)).length - 1
    if (actualCount !== Number(anchor.count)) {
      failures.push(`${anchor.path} anchor '${anchor.text}' expected ${anchor.count}, got ${actualCount} (${anchor.purpose})`)
    }
  }

  const result = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    upstream,
    expectedCommit: lock.commit,
    packageVersion: lock.packageVersion,
    packageContracts: (snapshot.packages ?? []).length,
    sourceAnchors: (snapshot.sourceAnchors ?? []).length,
    passed: failures.length === 0,
    failures,
  }

  if (report) {
    report = fullPath(report)
    await ensureDir(dirname(report))
    await writeJSON(report, result)
  }

  if (failures.length > 0) {
    throw new Error(`DSH compatibility gate failed:\n${failures.map(item => ` - ${item}`).join('\n')}`)
  }

  console.log(`DSH compatibility gate passed: ${lock.packageVersion} / ${lock.commit}`)
  return result
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      upstream: { type: 'string' },
      report: { type: 'string' },
      lock: { type: 'string' },
      snapshot: { type: 'string' },
    },
  })
  await testDshCompatibility({
    ...(values.upstream ? { upstream: values.upstream } : {}),
    report: values.report ?? '',
    lockPath: values.lock ?? '',
    snapshotPath: values.snapshot ?? '',
  })
}
