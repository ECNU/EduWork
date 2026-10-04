import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { desktopVersion, desktopBuildPlan, validateBuildRequest } from '../scripts/desktop-build-plan.mjs'

test('product prerelease semantics are consistent across future versions', () => {
  for (const version of ['0.4.0-alpha.1', '0.4.0-beta.2', '1.0.0-rc.1', '0.3.6-dev.20260928.2']) {
    assert.deepEqual(desktopVersion(version), { version, prerelease: true, channel: 'development', automaticUpdates: false })
  }
  assert.deepEqual(desktopVersion('1.2.3'), { version: '1.2.3', prerelease: false, channel: 'stable', automaticUpdates: true })
  for (const value of ['../0.4.0', '0.4.0-alpha.0', '0.4.0-alpha.01', '00.4.0', '0.4.0+local', '0.4.0-preview']) assert.throws(() => desktopVersion(value))
})

test('publication preflight preserves main, both-platform and notes requirements', () => {
  const request = { version: '0.4.0-alpha.1', publish: true, notesApproved: true, releaseNotes: 'docs/releases/0.4.0-alpha.1.md', platform: 'both', ref: 'refs/heads/main' }
  validateBuildRequest(request)
  for (const change of [{ref: 'refs/heads/topic'}, {platform: 'windows'}, {notesApproved: false}, {releaseNotes: 'other.md'}]) assert.throws(() => validateBuildRequest({...request, ...change}))
  validateBuildRequest({...request, publish: false, notesApproved: false, releaseNotes: '', ref: 'refs/heads/topic', platform: 'macos'})
  validateBuildRequest({...request, publish: false, notesApproved: false, releaseNotes: '', ref: 'refs/heads/topic', platform: 'linux'})
})

test('institution recipe inherits the pinned core runtime and cannot relax bootstrap checks', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-build-plan-')), core = join(root, 'core'), edition = join(root, 'edition')
  t.after(() => rm(root, { recursive: true, force: true }))
  const save = async (base, path, value) => { await mkdir(join(base, path, '..'), {recursive: true}); await writeFile(join(base, path), JSON.stringify(value)) }
  await save(core, 'config/desktop-build.json', {schemaVersion: 1, runtimeMode: 'source', sourceLock: 'runtime/LOCK.json'})
  await save(core, 'runtime/LOCK.json', {repository: 'https://github.com/deepseek-ai/deepseek-harness.git', commit: 'a'.repeat(40), packageVersion: '9.0.0-rc.2'})
  await save(edition, 'edition/desktop-build.json', {schemaVersion: 1, publisherDescriptors: 'edition/publisher', verifyPublisherBootstrap: true, validationScript: 'edition/tests.ps1'})
  await mkdir(join(edition, 'edition/publisher'), {recursive: true})
  await writeFile(join(edition, 'edition/tests.ps1'), '# synthetic')
  const publicPlan = await desktopBuildPlan({core, version: '0.4.0-alpha.1'})
  assert.equal(publicPlan.dshVersion, '9.0.0-rc.2')
  assert.equal(publicPlan.verifyPublisherBootstrap, false)
  const institutionPlan = await desktopBuildPlan({core, edition, version: '0.4.0-alpha.1'})
  assert.equal(institutionPlan.sourceLock, publicPlan.sourceLock)
  assert.equal(institutionPlan.verifyPublisherBootstrap, true)
  await save(edition, 'edition/desktop-build.json', {schemaVersion: 1, verifyPublisherBootstrap: false})
  await assert.rejects(desktopBuildPlan({core, edition, version: '0.4.0-alpha.1'}), /signed first launch/)
  await save(core, 'config/desktop-build.json', {schemaVersion: 1, runtimeMode: 'source', sourceLock: '../edition/edition/desktop-build.json'})
  await assert.rejects(desktopBuildPlan({core, version: '0.4.0-alpha.1'}), /escapes/)
})
