import assert from 'node:assert/strict'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { assembleWindows, installedUpdateFeed } from '../dsh-electron/scripts/assemble-windows.mjs'
import { ensureDir, fullPath, isMainModule, pathExists, readJSON, writeJSON } from './lib/build-util.mjs'

function verifySource(source) {
  assert.equal(source.kind, 'eduwork-windows-development')
  assert.equal(source.platform, 'windows-x64')
  assert.equal(source.passed, true)
  assert.equal(source.sourceSnapshotVerified, true)
  assert.match(source.version, /^\d+\.\d+\.\d+-dev\.\d{8}\.[1-9]\d*$/)
  assert.match(source.coreCommit, /^[a-f0-9]{40}$/)
  for (const check of ['desktopLaunch', 'archiveManifest', 'nativeRuntimes']) assert.equal(source.checks?.[check], 'passed')
}

export async function installedCandidateReceipt(candidate, source) {
  verifySource(source)
  const config = await readJSON(join(candidate, 'resources/app/eduwork.desktop.json'))
  const release = await readJSON(join(candidate, 'release.json'))
  assert.equal(config.dataLayout, 'installed')
  assert.equal(config.shell, 'electron')
  assert.equal(config.productVersion, source.version)
  assert.equal(config.distribution, source.distribution)
  const automaticUpdates = installedUpdateFeed(config.updates) !== null
  assert.equal(config.updateChannel, automaticUpdates ? 'github' : 'disabled-candidate')
  assert.equal(release.version, source.version)
  assert.equal(release.dshVersion, source.dshVersion)
  assert.equal(release.distribution, source.distribution)
  assert.equal(release.automaticUpdates, automaticUpdates)
  assert.equal(release.published, false)
  return {
    schemaVersion: 1,
    kind: 'eduwork-windows-installed-candidate',
    version: source.version,
    coreCommit: source.coreCommit,
    sourceIdentity: source.sourceIdentity,
    sourceSnapshotVerified: true,
    distribution: source.distribution,
    dshVersion: source.dshVersion,
    dataLayout: 'installed',
    automaticUpdates,
    publication: 'artifact-only',
    checks: { portableBuildAndLaunch: 'passed', installedAssembly: 'passed', installedLaunch: 'not-run', migration: 'not-run' },
  }
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({ options: { workspace: { type: 'string' }, output: { type: 'string' }, 'installed-update-url': { type: 'string' } } })
  if (!values.workspace || !values.output) throw new Error('Use --workspace <qualified-development-build> --output <new-directory>')
  const workspace = fullPath(values.workspace), output = fullPath(values.output)
  const source = await readJSON(join(workspace, 'publish/release-receipt.json'))
  verifySource(source)
  if (await pathExists(output)) throw new Error('Installed candidate output must be a new directory')
  const inputs = await readJSON(join(workspace, 'inputs/inputs.json'))
  const candidate = join(output, 'electron-candidate')
  await ensureDir(output)
  await assembleWindows({
    product: join(workspace, 'product'), shellBuild: join(workspace, 'shell'),
    electronRuntime: join(workspace, 'electron/runtime'), node: inputs.node,
    output: candidate, version: source.version, dataLayout: 'installed',
    installedUpdateURL: values['installed-update-url'] ?? '',
  })
  await writeJSON(join(output, 'installed-candidate-receipt.json'), await installedCandidateReceipt(candidate, source))
}
