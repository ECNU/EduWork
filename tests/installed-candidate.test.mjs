import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installedCandidateReceipt } from '../scripts/assemble-windows-installed-candidate.mjs'

test('the candidate archive step writes a real ZIP and verifies its format', async () => {
  const workflow = await readFile(new URL('../.github/workflows/development-desktop.yml', import.meta.url), 'utf8')
  const step = workflow.slice(workflow.indexOf('Assemble Windows installed-layout candidate'), workflow.indexOf('Retain Windows installed-layout candidate'))
  // Windows tar.exe has no zip write support; -a only selects compression and
  // silently produced a ustar tar named .zip.
  assert.doesNotMatch(step, /^\s*tar\.exe/m)
  // CreateFromDirectory emits backslash entry names; entries must be written
  // with forward slashes and verified.
  assert.match(step, /CreateEntryFromFile/)
  assert.doesNotMatch(step, /ZipFile\]::CreateFromDirectory/)
  assert.match(step, /Replace\("\\", "\/"\)/)
  assert.match(step, /Contains\("\\"\)/)
  assert.match(step, /-File -Force/)
  assert.match(step, /differs from source file count/)
  assert.match(step, /0x04034b50/)
  assert.match(step, /0x06054b50/)
})

test('installed artifact records its source and leaves runtime acceptance pending', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-installed-artifact-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = {
    kind: 'eduwork-windows-development', platform: 'windows-x64', passed: true,
    sourceSnapshotVerified: true, version: '0.4.13-dev.20261115.1', coreCommit: 'a'.repeat(40),
    distribution: 'eduwork', dshVersion: '0.2.2-rc.1',
    checks: { desktopLaunch: 'passed', archiveManifest: 'passed', nativeRuntimes: 'passed' },
  }
  const config = { shell: 'electron', dataLayout: 'installed', productVersion: source.version,
    distribution: source.distribution, updates: { provider: 'disabled' }, updateChannel: 'disabled-candidate' }
  const release = { version: source.version, dshVersion: source.dshVersion,
    distribution: source.distribution, automaticUpdates: false, published: false }
  const save = async () => {
    await writeFile(join(root, 'resources/app/eduwork.desktop.json'), JSON.stringify(config))
    await writeFile(join(root, 'release.json'), JSON.stringify(release))
  }
  await mkdir(join(root, 'resources/app'), { recursive: true })
  await save()
  const receipt = await installedCandidateReceipt(root, source)
  assert.equal(receipt.coreCommit, source.coreCommit)
  assert.equal(receipt.dataLayout, 'installed')
  assert.equal(receipt.publication, 'artifact-only')
  assert.equal(receipt.checks.installedAssembly, 'passed')
  assert.equal(receipt.checks.installedLaunch, 'not-run')
  assert.equal(receipt.checks.migration, 'not-run')

  for (const change of [{ passed: false }, { sourceSnapshotVerified: false }, { version: '0.4.13' },
    { checks: { ...source.checks, desktopLaunch: 'not-run' } }]) {
    await assert.rejects(installedCandidateReceipt(root, { ...source, ...change }))
  }
  for (const [object, key, bad] of [[config, 'dataLayout', 'portable'], [release, 'automaticUpdates', true],
    [release, 'version', '0.4.12'], [config.updates, 'provider', 'github']]) {
    const original = object[key]
    object[key] = bad
    await save()
    await assert.rejects(installedCandidateReceipt(root, source))
    object[key] = original
  }
})
