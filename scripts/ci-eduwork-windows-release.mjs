// End-to-end Windows x64 Electron release pipeline: Web CI (build-only), Host,
// desktop product, native inputs, Electron assembly, immutable ZIP, packaged
// launch acceptance and the release receipt. Node.js port of
// ci-eduwork-windows-release.ps1. Requires a Windows runner.
//
// The work itself lives in stage declarations: shared-desktop-stages.mjs holds
// the spine every platform shares, windows-stages.mjs adds what is Windows
// specific. This file validates the arguments, enters the workspace and writes
// the receipt; it contains no build steps.
//
// NOT YET VERIFIED. This chain has never run: Windows x64 packages cannot be
// built on macOS, and the port has not been exercised on a Windows runner.
// A green run here is unproven until the maintainer accepts it there.
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import {
  capture, ensureDir, fullPath, isFile, isMainModule, isWindows, readJSON, setCacheRoot,
  sha256File, writeJSON,
} from './lib/build-util.mjs'
import { Workspace, maxParallelism, runStages } from './lib/stage-runner.mjs'
import { copyPublicWebEvidence, sharedDesktopStages } from './lib/shared-desktop-stages.mjs'
import { windowsStages } from './lib/windows-stages.mjs'

const DEVELOPMENT_VERSION = /^\d+\.\d+\.\d+-dev\.\d{8}\.[1-9]\d*$/

const USAGE =
  'Use --core-root --edition-root --distribution-config --version --output [--release-notes-file <docs/releases/*.md>] ' +
  '[--release-notes-approved] [--development] [--no-verify-snapshot] [--runtime-source <dir>] [--upstream-source <dir>] ' +
  '[--jobs N] [--reuse-workspace] [--cache-root <dir>] [--digest-budget <bytes>] [--lock-wait <seconds>] ' +
  '(--jobs 0 = as many as the graph allows)'

export async function ciEduworkWindowsRelease({
  coreRoot,
  editionRoot,
  distributionConfig,
  version,
  releaseNotesFile = '',
  releaseNotesApproved = false,
  development = false,
  verifySnapshot = true,
  runtimeSource = '',
  upstreamSource = '',
  output,
  jobs = 0,
  reuseWorkspace = false,
  force = [],
  cacheRoot = '',
  digestBudget = 0,
  lockWaitMs = 0,
} = {}) {
  if (!isWindows) throw new Error('The Windows release pipeline requires a Windows runner')
  coreRoot = fullPath(coreRoot)
  editionRoot = fullPath(editionRoot)
  output = fullPath(output)
  // Set before any work: the native-input stage downloads and compiles, and both
  // cache layers read this root.
  if (cacheRoot) setCacheRoot(cacheRoot)

  // Development artifacts are named for their channel and never carry approved
  // public notes; a public release requires both the flag and a reviewed file.
  const isDevelopmentVersion = DEVELOPMENT_VERSION.test(version ?? '')
  if (development) {
    if (!isDevelopmentVersion) throw new Error('Development artifacts require X.Y.Z-dev.YYYYMMDD.N')
    if (releaseNotesFile || releaseNotesApproved) throw new Error('Development artifacts do not publish Release notes.')
  } else {
    if (!/^\d+\.\d+\.\d+$/.test(version ?? '') && !isDevelopmentVersion) {
      throw new Error('GitHub Releases require X.Y.Z or X.Y.Z-dev.YYYYMMDD.N')
    }
    if (!releaseNotesApproved) throw new Error('Release notes must be discussed and approved before publication.')
    if (!/^docs\/releases\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(releaseNotesFile ?? '')) {
      throw new Error('Use a reviewed Markdown file under docs/releases in the edition repository.')
    }
    const notesPath = join(editionRoot, releaseNotesFile)
    if (!await isFile(notesPath) || !(await readFile(notesPath, 'utf8')).trim()) {
      throw new Error('Approved release notes are missing or empty.')
    }
  }

  const name = coreRoot === editionRoot ? 'EduWork' : 'EduWork-ECNU'
  // The core source receipt fixes which version this checkout may publish. It is
  // read before any build work starts, so a mismatched edition fails fast.
  const source = await readJSON(join(coreRoot, 'source-receipt.json'))
  if (!development && source.version !== version) {
    throw new Error('Core source receipt version differs from the requested Release')
  }
  if (coreRoot !== editionRoot) {
    const lock = await readJSON(join(editionRoot, 'core.lock.json'))
    if (lock.version !== source.version) throw new Error('Institution/core source versions must agree')
  }

  const parameters = {
    kind: development ? 'eduwork-windows-development' : 'eduwork-windows-release',
    name,
    edition: name,
    version,
    development,
    forUpdate: true,
    distributionConfig,
    verifySnapshot,
    runtimeSource,
    upstreamSource: upstreamSource ? fullPath(upstreamSource) : '',
    releaseNotesFile,
    editionRoot,
    coreRoot,
  }

  // The publish stage writes the final receipt, so it needs everything that
  // describes the build. Run-varying facts (job count, whether the workspace was
  // reused) are deliberately excluded: they differ between an identical pair of
  // runs, and the receipt must not.
  const receiptBase = {
    schemaVersion: 1,
    kind: parameters.kind,
    version,
    edition: name,
    shell: 'electron',
    platform: 'windows-x64',
    validationProfile: development ? 'ci-build-and-launch-v1' : 'ci-build-launch-and-extract-v2',
    sourceSnapshotVerified: verifySnapshot,
    sourceVersion: source.version,
    coreCommit: (await capture('git', ['-C', coreRoot, 'rev-parse', 'HEAD'])).trim(),
    editionCommit: (await capture('git', ['-C', editionRoot, 'rev-parse', 'HEAD'])).trim(),
  }
  if (development) {
    receiptBase.publication = 'artifact-only'
  } else {
    receiptBase.releaseNotes = {
      approved: true, file: releaseNotesFile, sha256: await sha256File(join(editionRoot, releaseNotesFile)),
    }
  }

  const common = { coreRoot, editionRoot, distributionConfig, version, verifySnapshot, runtimeSource, upstreamSource }
  const stages = [...sharedDesktopStages(common), ...windowsStages({ coreRoot, receiptBase })]
  const workspace = new Workspace({
    root: output,
    parameters,
    stages,
    platform: 'windows-x64',
    lockWaitMs,
    ...(digestBudget > 0 ? { digestBudget } : {}),
  })
  const entered = await workspace.enter({ force: reuseWorkspace })
  // Zero means "decide from the graph": no run finishes sooner than its widest
  // wave, so that is the default and an explicit number still wins.
  const workers = jobs > 0 ? jobs : maxParallelism(stages)

  const result = { ...receiptBase, jobs: workers, workspaceReused: entered.reused, passed: false, checks: {} }
  try {
    await runStages(workspace, { jobs: workers, force })
    const published = await readJSON(join(output, 'publish/release-receipt.json'))
    Object.assign(result, published)
    result.jobs = workers
    result.workspaceReused = entered.reused
    result.passed = true
  } catch (error) {
    result.error = error.message
    throw error
  } finally {
    // Held from `enter` to here, so the evidence written below belongs to this
    // run's workspace.
    await workspace.release()
    // Preserve the Web runner's redacted failure report too. Raw test homes,
    // credentials and process logs remain on the disposable runner.
    await ensureDir(join(output, 'evidence-public'))
    await writeJSON(join(output, 'evidence-public/desktop-release-result.json'), result)
    await copyPublicWebEvidence(workspace, join(output, 'evidence-public'))
  }
  return result
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      'core-root': { type: 'string' },
      'edition-root': { type: 'string' },
      'distribution-config': { type: 'string' },
      version: { type: 'string' },
      'release-notes-file': { type: 'string' },
      'release-notes-approved': { type: 'boolean' },
      development: { type: 'boolean' },
      'no-verify-snapshot': { type: 'boolean' },
      'runtime-source': { type: 'string' },
      'upstream-source': { type: 'string' },
      output: { type: 'string' },
      jobs: { type: 'string' },
      'reuse-workspace': { type: 'boolean' },
      'cache-root': { type: 'string' },
      'digest-budget': { type: 'string' },
      'lock-wait': { type: 'string' },
    },
  })
  if (!values['core-root'] || !values['edition-root'] || !values['distribution-config'] || !values.version || !values.output) {
    throw new Error(USAGE)
  }
  await ciEduworkWindowsRelease({
    coreRoot: values['core-root'],
    editionRoot: values['edition-root'],
    distributionConfig: values['distribution-config'],
    version: values.version,
    releaseNotesFile: values['release-notes-file'] ?? '',
    releaseNotesApproved: Boolean(values['release-notes-approved']),
    development: Boolean(values.development),
    verifySnapshot: !values['no-verify-snapshot'],
    runtimeSource: values['runtime-source'] ?? '',
    upstreamSource: values['upstream-source'] ?? '',
    output: values.output,
    jobs: Number(values.jobs ?? 0),
    reuseWorkspace: Boolean(values['reuse-workspace']),
    cacheRoot: values['cache-root'] ?? '',
    digestBudget: Number(values['digest-budget'] ?? 0),
    lockWaitMs: Number(values['lock-wait'] ?? 0) * 1000,
  })
}
