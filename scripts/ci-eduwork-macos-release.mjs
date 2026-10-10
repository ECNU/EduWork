// End-to-end macOS arm64 Electron development and stable pipeline: Web CI
// (build-only), Host, desktop product, native inputs, Electron.app assembly,
// packaged launch acceptance and the release receipt. Node.js port of
// ci-eduwork-macos-release.ps1. Requires a macOS arm64 runner.
//
// The work itself lives in stage declarations: shared-desktop-stages.mjs holds
// the spine every platform shares, macos-stages.mjs adds what is macOS-specific.
// This file validates the arguments, enters the workspace and writes the
// receipt; it contains no build steps and no platform branch.
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import {
  capture, ensureDir, fullPath, isMacOS, isMainModule, readJSON, setCacheRoot, sha256Text, writeJSON,
} from './lib/build-util.mjs'
import { Workspace, maxParallelism, runStages } from './lib/stage-runner.mjs'
import { copyPublicWebEvidence, sharedDesktopStages } from './lib/shared-desktop-stages.mjs'
import { macosStages } from './lib/macos-stages.mjs'
import { desktopBuildPlan, desktopVersion } from './desktop-build-plan.mjs'
import { pinnedSourceStages } from './lib/pinned-source-stages.mjs'
import { desktopSourceIdentity } from './lib/build-source.mjs'

export async function ciEduworkMacosRelease({
  coreRoot,
  editionRoot,
  distributionConfig,
  version,
  releaseNotesFile = '',
  development = false,
  macUpdateConfig = '',
  releaseNotesApproved = false,
  verifyPublisherBootstrap = false,
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
  recipe = '',
} = {}) {
  if (!isMacOS || process.arch !== 'arm64') throw new Error('Use a macOS arm64 runner')
  const pythonVersion = (await capture('python3', ['-c', 'import sys; print(".".join(map(str, sys.version_info[:2])))'])).trim()
  if (Number(pythonVersion.split('.')[0]) < 3 || Number(pythonVersion.split('.')[1]) < 10) {
    throw new Error(`macOS DMG packaging requires Python 3.10 or newer; found ${pythonVersion}`)
  }
  const isDevelopmentVersion = /^\d+\.\d+\.\d+-dev\.\d{8}\.[1-9]\d*$/.test(version ?? '')
  desktopVersion(version)
  if (development && !isDevelopmentVersion) throw new Error('Development artifacts require X.Y.Z-dev.YYYYMMDD.N')
  if (!development && (!releaseNotesApproved || !/^docs\/releases\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(releaseNotesFile ?? ''))) {
    throw new Error('A reviewed release notes file and approval are required')
  }
  coreRoot = fullPath(coreRoot)
  editionRoot = fullPath(editionRoot)
  output = fullPath(output)
  recipe ||= 'pinned-source'
  if (!['npm', 'pinned-source'].includes(recipe)) throw new Error('Unknown desktop build recipe')
  const sourcePlan = recipe === 'pinned-source'
    ? await desktopBuildPlan({ core: coreRoot, edition: editionRoot, version, includeLegacyValidation: false }) : null
  verifyPublisherBootstrap ||= sourcePlan?.verifyPublisherBootstrap ?? false
  if (!development) {
    const source = await readJSON(join(coreRoot, 'source-receipt.json'))
    if (source.version !== version && !(version.includes('-') && version.split('-')[0] === source.version.split('-')[0])) {
      throw new Error('Core source receipt version differs from the requested Release')
    }
  }
  // Set before any work: the native-input stage downloads and compiles, and both
  // cache layers read this root.
  if (cacheRoot) setCacheRoot(cacheRoot)
  const name = coreRoot === editionRoot ? 'EduWork' : 'EduWork-ECNU'
  let notesSHA256 = ''
  // With the approval flags in place the notes are read once here, so an empty
  // or missing file fails before any build work starts.
  if (!development) {
    const text = await readFile(join(editionRoot, releaseNotesFile), 'utf8')
    if (!text.trim()) throw new Error('Release notes are empty')
    notesSHA256 = await sha256Text(text)
  }

  if (!development && !verifySnapshot) throw new Error('Release candidates require a verified source snapshot')
  const sourceIdentity = await desktopSourceIdentity({ coreRoot, editionRoot })

  const parameters = {
    kind: 'eduwork-macos-release',
    version,
    edition: name,
    distributionConfig,
    development,
    verifySnapshot,
    runtimeSource,
    upstreamSource: upstreamSource ? fullPath(upstreamSource) : '',
    macUpdateConfig: macUpdateConfig ? fullPath(macUpdateConfig) : '',
    releaseNotesFile,
    verifyPublisherBootstrap,
    editionRoot,
    coreRoot,
    recipe,
    sourceIdentity,
    automaticUpdates: !desktopVersion(version).prerelease,
  }

  // The publish stage writes the final receipt, so it needs everything that
  // describes the build. Run-varying facts (job count, whether the workspace was
  // reused) are deliberately excluded: they differ between an identical pair of
  // runs, and the receipt must not.
  const receiptBase = {
    schemaVersion: 1,
    kind: 'eduwork-macos-release',
    version,
    edition: name,
    platform: 'macos-arm64',
    shell: 'electron',
    validationProfile: 'ci-build-and-launch-v1',
    developerIDSigned: false,
    notarized: false,
    softwareAutoUpdate: false,
    sourceSnapshotVerified: verifySnapshot,
    recipe,
    sourceIdentity,
    automaticUpdates: !desktopVersion(version).prerelease,
    coreCommit: sourceIdentity.core.commit,
    editionCommit: sourceIdentity.edition.commit,
  }
  if (!development && releaseNotesFile) {
    receiptBase.releaseNotes = { approved: true, file: releaseNotesFile, sha256: notesSHA256 }
  }

  const common = { coreRoot, editionRoot, distributionConfig, version, verifySnapshot, runtimeSource, upstreamSource }
  const stages = [
    ...(recipe === 'pinned-source'
      ? pinnedSourceStages({ coreRoot, editionRoot, version, upstreamSource, verifySnapshot })
      : sharedDesktopStages(common)),
    ...macosStages({ coreRoot, name, version, development, releaseNotesFile, verifyPublisherBootstrap, receiptBase, recipe }),
  ]
  const workspace = new Workspace({
    root: output,
    parameters,
    stages,
    platform: 'macos-arm64',
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
    // Held from `enter` to here. `runStages` also releases on its own path, which
    // covers a caller that only uses the runner; releasing again is a no-op.
    await workspace.release()
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
      development: { type: 'boolean' },
      'mac-update-config': { type: 'string' },
      'release-notes-approved': { type: 'boolean' },
      'verify-publisher-bootstrap': { type: 'boolean' },
      'no-verify-snapshot': { type: 'boolean' },
      'runtime-source': { type: 'string' },
      'upstream-source': { type: 'string' },
      output: { type: 'string' },
      jobs: { type: 'string' },
      'reuse-workspace': { type: 'boolean' },
      'cache-root': { type: 'string' },
      'digest-budget': { type: 'string' },
      'lock-wait': { type: 'string' },
      recipe: { type: 'string' },
    },
  })
  if (!values['core-root'] || !values['edition-root'] || !values['distribution-config'] || !values.version || !values.output) {
    throw new Error('Use --core-root --edition-root --distribution-config --version --output [--recipe npm|pinned-source] [--development] [--jobs N] [--reuse-workspace] [--cache-root <dir>] [--digest-budget <bytes>] [--lock-wait <seconds>] [--mac-update-config <json>] [--release-notes-file <docs/releases/*.md>] [--release-notes-approved] [--verify-publisher-bootstrap] [--no-verify-snapshot] [--runtime-source <dir>] [--upstream-source <dir>] (--jobs 0 = as many as the graph allows)')
  }
  await ciEduworkMacosRelease({
    coreRoot: values['core-root'],
    editionRoot: values['edition-root'],
    distributionConfig: values['distribution-config'],
    version: values.version,
    releaseNotesFile: values['release-notes-file'] ?? '',
    development: Boolean(values.development),
    macUpdateConfig: values['mac-update-config'] ?? '',
    releaseNotesApproved: Boolean(values['release-notes-approved']),
    verifyPublisherBootstrap: Boolean(values['verify-publisher-bootstrap']),
    verifySnapshot: !values['no-verify-snapshot'],
    runtimeSource: values['runtime-source'] ?? '',
    upstreamSource: values['upstream-source'] ?? '',
    output: values.output,
    jobs: Number(values.jobs ?? 0),
    reuseWorkspace: Boolean(values['reuse-workspace']),
    cacheRoot: values['cache-root'] ?? '',
    digestBudget: Number(values['digest-budget'] ?? 0),
    lockWaitMs: Number(values['lock-wait'] ?? 0) * 1000,
    recipe: values.recipe ?? '',
  })
}
