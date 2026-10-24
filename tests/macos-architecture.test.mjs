import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { macosArchitecture } from '../scripts/lib/macos-architecture.mjs'
import { desktopBuildTargets } from '../scripts/desktop-build-targets.mjs'
import { publicationPlatforms, nodeNpmAssetNames, validateRun } from '../scripts/publish-desktop-candidate.mjs'
import { validateMacUpdateConfig } from '../scripts/macos-update-feed.mjs'
import { deltaName } from '../scripts/macos-update-delta.mjs'
import { previousStableArchives } from '../scripts/update-delta-bases.mjs'

test('both Mac architectures resolve complete pinned runtime and wheel inputs', async () => {
  const load = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'))
  const node = await load('../dsh-desktop/internal/productruntime/builtin/node-runtime-manifest.json')
  const python = await load('../dsh-desktop/internal/productruntime/builtin/python-runtime-manifest.json')
  const lock = await load('../third_party/dsh/candidate-v0.2.1-rc.3/source-probe/package-lock.json')
  for (const arch of ['arm64', 'x64']) {
    const target = macosArchitecture(arch)
    assert.equal(target.runtimeKey, arch === 'x64' ? 'darwin-amd64' : 'darwin-arm64')
    for (const asset of [node.assets[target.runtimeKey], python.assets[target.runtimeKey],
      ...python.environment.packages.map(p => p.assets[target.runtimeKey] ?? p.assets.any)]) {
      assert.match(asset.url, /^https:/)
      assert.match(asset.sha256, /^[a-f0-9]{64}$/)
    }
    for (const name of [`@ladybugdb/core-${target.platform}`, `@remotion/compositor-${target.platform}`]) {
      assert.match(lock.packages[`node_modules/${name}`].integrity, /^sha512-/)
    }
  }
  assert.throws(() => macosArchitecture('amd64'))
})

test('Intel has separate feeds and cannot fall back to the ARM update URL', async () => {
  const config = JSON.parse(await readFile(new URL('../config/desktop/mac-updates.json', import.meta.url), 'utf8'))
  assert.equal(validateMacUpdateConfig(config).feeds.stable, config.feeds.stable)
  assert.equal(validateMacUpdateConfig(config, 'x64').feeds.stable, config.feedsByArch.x64.stable)
  assert.throws(() => validateMacUpdateConfig({ ...config, feedsByArch: undefined }, 'x64'), /explicit/)
  assert.throws(() => validateMacUpdateConfig({ ...config, feedsByArch: { x64: config.feeds } }, 'x64'), /separate/)
})

test('Intel assets and deltas are distinct; old ARM-only releases are not Intel bases', () => {
  const names = nodeNpmAssetNames('EduWork', '0.4.9', 'macos-x64', ['0.4.8'])
  assert.ok(names.includes('EduWork-0.4.9-macos-x64-electron.zip'))
  assert.ok(names.includes('EduWork-0.4.9-macos-x64-electron.dmg'))
  assert.ok(names.includes(deltaName('EduWork', '0.4.9', '0.4.8', 'x64')))
  assert.ok(names.every(name => !name.includes('arm64')))
  const release = (version, arch, digest = 'sha256:' + 'a'.repeat(64)) => ({ tag_name: `v${version}`, assets: [{
    name: `EduWork-${version}-macos-${arch}-electron.zip`, digest, browser_download_url: 'https://example.test/app.zip',
  }] })
  assert.deepEqual(previousStableArchives([release('0.4.7', 'arm64')], { product: 'EduWork', version: '0.4.8', platform: 'macos-x64' }), [])
  assert.equal(previousStableArchives([release('0.4.8', 'x64'), release('0.4.7', 'arm64')], { product: 'EduWork', version: '0.4.9', platform: 'macos-x64' }).length, 1)
  assert.throws(() => previousStableArchives([release('0.4.8', 'x64', '')], { product: 'EduWork', version: '0.4.9', platform: 'macos-x64' }), /digest/)
})

test('three-target releases fail closed when Intel is missing or failed', () => {
  const targets = desktopBuildTargets()
  assert.deepEqual(targets.map(t => t.platform), ['windows', 'macos', 'macos-x64'])
  assert.deepEqual(desktopBuildTargets('macos').map(t => t.runner), ['macos-26', 'macos-26-intel'])
  assert.equal(desktopBuildTargets('macos-x64')[0].script, 'macos')
  assert.throws(() => desktopBuildTargets('macos-x64', 'ps1'))
  assert.equal(desktopBuildTargets('both', 'ps1').length, 2)
  assert.deepEqual(publicationPlatforms(JSON.stringify(targets.map(t => t.platform))), targets.map(t => t.platform))
  assert.throws(() => publicationPlatforms('["windows","macos-x64"]'))
  const run = { id: 1, repository: { full_name: 'ECNU/EduWork' }, path: 'workflow.yml', event: 'workflow_dispatch', head_sha: 'a'.repeat(40), status: 'in_progress' }
  const policy = { repository: 'ECNU/EduWork', workflow: 'workflow.yml', currentRun: '1', platforms: targets.map(t => t.platform) }
  const jobs = targets.map(t => ({ name: `Build (${t.platform})`, status: 'completed', conclusion: 'success' }))
  validateRun(run, policy, jobs)
  assert.throws(() => validateRun(run, policy, jobs.slice(0, 2)), /macos-x64/)
  assert.throws(() => validateRun(run, policy, [...jobs.slice(0, 2), { ...jobs[2], conclusion: 'failure' }]), /failed/)
  const finished = { ...run, status: 'completed', conclusion: 'success' }
  const minimumPolicy = { ...policy, requireMacos15: true }
  assert.throws(() => validateRun(finished, minimumPolicy, jobs), /Missing macOS 15/)
  const compatibility = ['macos', 'macos-x64'].map(platform => ({ name: `macOS 15 (${platform})`, status: 'completed', conclusion: 'success' }))
  validateRun(finished, minimumPolicy, [...jobs, ...compatibility])
  assert.throws(() => validateRun(finished, minimumPolicy, [...jobs, compatibility[0], { ...compatibility[1], conclusion: 'failure' }]), /acceptance failed/)
})
