// Build the Linux x64 AppImage artifact from the same pinned source stages as
// the Windows and macOS candidates. Publication remains a separate future step.
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { ensureDir, fullPath, isMainModule, readJSON, writeJSON } from './lib/build-util.mjs'
import { Workspace, maxParallelism, runStages } from './lib/stage-runner.mjs'
import { pinnedSourceStages } from './lib/pinned-source-stages.mjs'
import { linuxStages } from './lib/linux-stages.mjs'
import { desktopBuildPlan, desktopVersion } from './desktop-build-plan.mjs'
import { desktopSourceIdentity } from './lib/build-source.mjs'

export async function ciEduworkLinuxRelease({ coreRoot, editionRoot, distributionConfig, version, output, development = false, jobs = 0, cacheRoot = '', recipe = 'pinned-source', verifySnapshot = true } = {}) {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Linux release requires a Linux x64 runner')
  const plan = await desktopBuildPlan({ core: coreRoot, edition: editionRoot, version, includeLegacyValidation: false })
  if (development && !desktopVersion(version).prerelease) throw new Error('Development artifacts require a prerelease version')
  const sourceIdentity = await desktopSourceIdentity({ coreRoot, editionRoot })
  const name = coreRoot === editionRoot ? 'EduWork' : 'EduWork-ECNU'
  const parameters = { arch: 'x64', kind: 'eduwork-linux-release', version, edition: name, distributionConfig, development, verifySnapshot, recipe, sourceIdentity, coreRoot: fullPath(coreRoot), editionRoot: fullPath(editionRoot), cacheRoot }
  const receiptBase = { schemaVersion: 1, kind: 'eduwork-linux-release', version, edition: name, platform: 'linux-x86_64', shell: 'electron', validationProfile: 'appimage-assembly-v1', sourceSnapshotVerified: verifySnapshot, recipe, sourceIdentity, automaticUpdates: false, coreCommit: sourceIdentity.core.commit, editionCommit: sourceIdentity.edition.commit }
  const stages = [...pinnedSourceStages({ coreRoot: fullPath(coreRoot), editionRoot: fullPath(editionRoot), version, verifySnapshot }), ...linuxStages({ coreRoot: fullPath(coreRoot), receiptBase })]
  const workspace = new Workspace({ root: fullPath(output), parameters, stages, platform: 'linux-x64' })
  await workspace.enter()
  let result = { ...receiptBase, passed: false, checks: {} }
  try {
    await runStages(workspace, { jobs: jobs > 0 ? jobs : maxParallelism(stages) })
    result = await readJSON(join(output, 'publish/release-receipt.json'))
    return result
  } catch (error) {
    result.error = error.message
    throw error
  } finally {
    await workspace.release(); await ensureDir(join(output, 'evidence-public'))
    await writeJSON(join(output, 'evidence-public/linux-release-result.json'), result)
  }
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({ options: { 'core-root': { type: 'string' }, 'edition-root': { type: 'string' }, 'distribution-config': { type: 'string' }, version: { type: 'string' }, output: { type: 'string' }, development: { type: 'boolean' }, 'no-verify-snapshot': { type: 'boolean' }, jobs: { type: 'string' }, 'cache-root': { type: 'string' }, recipe: { type: 'string' } } })
  if (!values['core-root'] || !values['edition-root'] || !values['distribution-config'] || !values.version || !values.output) throw new Error('Use --core-root --edition-root --distribution-config --version --output [--development]')
  await ciEduworkLinuxRelease({ coreRoot: values['core-root'], editionRoot: values['edition-root'], distributionConfig: values['distribution-config'], version: values.version, output: values.output, development: Boolean(values.development), verifySnapshot: !values['no-verify-snapshot'], jobs: Number(values.jobs ?? 0), cacheRoot: values['cache-root'] ?? '', recipe: values.recipe ?? 'pinned-source' })
}
