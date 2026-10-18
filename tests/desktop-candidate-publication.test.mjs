import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {githubUpdateManifestBytes, updateManifestName} from '../scripts/github-update-manifest.mjs'
import {bundleVersion} from '../scripts/macos-update-feed.mjs'
import {desktopVersion} from '../scripts/desktop-build-plan.mjs'
import {assetNames, nodeNpmAssetNames, validateRun, validateCandidateReceipt, validatedCandidateFiles, validatedNodeNpmFiles, verifyRemoteAssets, publishCandidate} from '../scripts/publish-desktop-candidate.mjs'

const globalContext = {product: 'EduWork', version: '0.3.6-dev.20260928.2', distribution: 'eduwork', coreCommit: 'a'.repeat(40), editionCommit: 'b'.repeat(40)}
const context = globalContext
const hash = data => createHash('sha256').update(data).digest('hex')
async function fixture(platform, context = globalContext) {
  const directory = await mkdtemp(join(tmpdir(), 'eduwork-publication-'))
  const names = assetNames(context.product, context.version, platform)
  const file = async (name, body, sidecar = true) => {
    await writeFile(join(directory, name), body)
    const meta = {name, bytes: Buffer.byteLength(body), sha256: hash(body)}
    if (sidecar) await writeFile(join(directory, name + '.sha256'), `${meta.sha256}  ${name}\n`)
    return meta
  }
  const receipt = {schemaVersion: 1, kind: desktopVersion(context.version).prerelease ? 'eduwork-source-alpha' : 'eduwork-source-release', edition: context.product, version: context.version, distribution: context.distribution, coreCommit: context.coreCommit, editionCommit: context.editionCommit, platform, shell: 'electron', passed: true, automaticUpdates: true, dshVersion: '0.1.7-rc.2', checks: Object.fromEntries(['sourceSnapshot', 'archiveManifest', 'mediaTemplate', 'nativeRuntimes', 'desktopLaunch', 'portableExtractor', 'updateContract', 'macosDmg', 'readOnlyApplication'].map(name => [name, 'passed'])), asset: await file(names[0], 'synthetic archive')}
  const extra = await file(names[3], 'synthetic installer')
  if (platform === 'windows') {
    const extractor = {schemaVersion: 1, kind: 'eduwork-portable-extractor', format: 'zip-containing-self-extracting-exe', version: context.version, distribution: context.distribution, payload: receipt.asset, asset: extra, extractor: {name: 'EduWork-Setup.exe', bytes: 1, sha256: 'c'.repeat(64), sourceCommit: context.coreCommit, sourceDirty: false}, checks: {executionLevel: 'asInvoker', embeddedArchive: 'passed', manifestIdentity: 'passed', outerZIP: 'passed', extraction: 'passed'}}
    receipt.portableExtractor = {asset: extra, receipt: await file(names[5], JSON.stringify(extractor), false)}
  } else receipt.installer = {asset: extra, checks: Object.fromEntries(['imageIntegrity', 'applicationSignature', 'matchesZipApplication', 'installationWindow'].map(name => [name, 'passed']))}
  if (platform === 'windows') await file(updateManifestName, githubUpdateManifestBytes(receipt, 'ECNU/' + context.product), false)
  if (platform === 'macos') Object.assign(receipt, {sparkleEnabled: true, bundleVersion: bundleVersion(context.version)})
  await writeFile(join(directory, names[2]), JSON.stringify(receipt))
  return {directory, names, receipt, context: {...context, platform}}
}
for (const platform of ['windows', 'macos']) {
  test(platform + ': verifies bytes, source identity and installer checks', async t => {
    const data = await fixture(platform)
    t.after(() => rm(data.directory, {recursive: true, force: true}))
    const checked = await validatedCandidateFiles(data.directory, data.context)
    assert.equal(checked.files.length, data.names.length)
    assert.throws(() => validateCandidateReceipt(data.receipt, {...data.context, editionCommit: 'd'.repeat(40)}))
    assert.throws(() => validateCandidateReceipt(data.receipt, {...data.context, requirePublisherBootstrap: true}))
    const missing = structuredClone(data.receipt)
    delete missing.checks.desktopLaunch
    assert.throws(() => validateCandidateReceipt(missing, data.context))
    await writeFile(join(data.directory, data.names[0]), 'tampered archive')
    await assert.rejects(validatedCandidateFiles(data.directory, data.context), /Wrong asset/)
  })
  test(platform + ': rejects extra assets and mismatched sidecar', async t => {
    const data = await fixture(platform)
    t.after(() => rm(data.directory, {recursive: true, force: true}))
    await writeFile(join(data.directory, 'unexpected.json'), '{}')
    await assert.rejects(validatedCandidateFiles(data.directory, data.context), /Unexpected candidate/)
    await rm(join(data.directory, 'unexpected.json'))
    await writeFile(join(data.directory, data.names[1]), '0'.repeat(64) + '  ' + data.names[0])
    await assert.rejects(validatedCandidateFiles(data.directory, data.context))
  })
}
test('source must be the correct successful manually requested workflow', () => {
  const run = {id: 12, repository: {full_name: 'ECNU/EduWork'}, path: '.github/workflows/desktop-candidates.yml', event: 'workflow_dispatch', head_sha: 'a'.repeat(40), status: 'completed', conclusion: 'success'}
  const policy = {repository: 'ecnu/eduwork', workflow: run.path, currentRun: '13'}
  validateRun(run, policy)
  for (const changed of [{conclusion: 'failure'}, {event: 'pull_request'}, {path: 'another.yml'}, {repository: {full_name: 'someone/another'}}]) assert.throws(() => validateRun({...run, ...changed}, policy))
  assert.throws(() => validateRun({...run, status: 'in_progress'}, policy))
  const jobs = ['Build (windows)', 'Build (macos)'].map(name => ({name, status: 'completed', conclusion: 'success'}))
  validateRun({...run, status: 'in_progress'}, {...policy, currentRun: '12'}, jobs)
  assert.throws(() => validateRun({...run, status: 'in_progress'}, {...policy, currentRun: '12'}, jobs.slice(0, 1)))
  assert.throws(() => validateRun({...run, status: 'in_progress'}, {...policy, currentRun: '12'}, [...jobs, jobs[0]]))
  jobs[1].conclusion = 'failure'
  assert.throws(() => validateRun({...run, status: 'in_progress'}, {...policy, currentRun: '12'}, jobs))
})
test('release asset verification rejects missing, duplicate, changed, incomplete or relabeled files', () => {
  const files = [{name: 'example.zip', bytes: 4, sha256: 'a'.repeat(64)}, {name: 'example.dmg', bytes: 3, sha256: 'b'.repeat(64)}]
  const assets = files.map(file => ({name: file.name, size: file.bytes, digest: 'sha256:' + file.sha256, state: 'uploaded', label: null}))
  verifyRemoteAssets(assets, files)
  assert.throws(() => verifyRemoteAssets(assets.slice(1), files))
  assert.throws(() => verifyRemoteAssets([assets[0], assets[0]], files))
  for (const changed of [{size: 5}, {digest: 'sha256:' + '0'.repeat(64)}, {state: 'starter'}, {label: 'Windows 安装包'}]) assert.throws(() => verifyRemoteAssets([{...assets[0], ...changed}, assets[1]], files))
})
test('publication requires Actions, main and approved notes before any network mutation', async () => {
  await assert.rejects(publishCandidate({}), /GitHub Actions/)
  await assert.rejects(publishCandidate({GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/topic'}), /reviewed main/)
  await assert.rejects(publishCandidate({GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main', RELEASE_NOTES_APPROVED: 'false'}), /approved/)
  assert.throws(() => assetNames('../escape', context.version, 'windows'))
  assert.throws(() => assetNames('EduWork', '../../escape', 'windows'))
})
test('build and standalone workflows expose the same guarded cloud publication path', async () => {
  const build = await readFile(new URL('../.github/workflows/desktop-candidates.yml', import.meta.url), 'utf8')
  const publish = await readFile(new URL('../.github/workflows/publish-desktop-candidate.yml', import.meta.url), 'utf8')
  assert.match(build, /needs: \[policy, build\]/)
  assert.match(build, /uses: \.\/\.github\/workflows\/publish-desktop-candidate.yml/)
  assert.match(build, /build-desktop-candidate\.ps1/)
  assert.doesNotMatch(build, /source_alpha:|source_stable:/)
  assert.match(publish, /workflow_call:/)
  assert.match(publish, /if: github.ref == 'refs\/heads\/main'/)
  assert.match(publish, /runs-on: ubuntu-latest/)
})

for (const platform of ['windows', 'macos']) test('stable ' + platform + ' carries validated update metadata', async t => {
  const data = await fixture(platform, { ...context, version: '0.4.0' })
  t.after(() => rm(data.directory, { recursive: true, force: true }))
  await validatedCandidateFiles(data.directory, data.context)
  assert.equal(data.names.length, platform === 'windows' ? 7 : 5)
  if (platform === 'windows') {
    await writeFile(join(data.directory, updateManifestName), '{}')
    await assert.rejects(validatedCandidateFiles(data.directory, data.context), /Update manifest differs/)
    const invalid = structuredClone(data.receipt); delete invalid.checks.updateContract
    assert.throws(() => validateCandidateReceipt(invalid, data.context))
  } else {
    for (const changed of [{sparkleEnabled: false}, {sparkleEnabled: undefined}, {bundleVersion: '0'}, {bundleVersion: undefined}]) {
      assert.throws(() => validateCandidateReceipt({...data.receipt, ...changed}, data.context), /Sparkle/)
    }
  }
})

for (const platform of ['windows', 'macos']) test('alpha SemVer ' + platform + ' remains a prerelease with usable update metadata', async t => {
  const data = await fixture(platform, { ...context, version: '0.4.0-alpha.1' })
  t.after(() => rm(data.directory, { recursive: true, force: true }))
  await validatedCandidateFiles(data.directory, data.context)
  assert.equal(data.receipt.automaticUpdates, true)
  assert.equal(data.names.includes(updateManifestName), platform === 'windows')
  assert.equal(data.names[2], `${platform}-alpha-receipt.json`)
  assert.throws(() => validateCandidateReceipt({...data.receipt, automaticUpdates: false}, data.context), /automaticUpdates/)
})

async function macosNodeFixture(deltaFrom) {
  const directory = await mkdtemp(join(tmpdir(), 'eduwork-macos-publication-'))
  const context = {product: 'EduWork', version: '0.4.4', platform: 'macos', repository: 'ECNU/EduWork', coreCommit: 'a'.repeat(40), editionCommit: 'b'.repeat(40), releaseNotes: 'docs/releases/0.4.4.md'}
  const names = nodeNpmAssetNames(context.product, context.version, 'macos', deltaFrom)
  const file = async (name, body) => {
    await writeFile(join(directory, name), body)
    return {name, bytes: Buffer.byteLength(body), sha256: hash(body)}
  }
  const asset = await file(names[0], 'synthetic archive')
  await writeFile(join(directory, names[1]), `${asset.sha256}  ${asset.name}\n`)
  const notes = await file(names[3], '# EduWork 0.4.4\n')
  const dmg = await file(names[4], 'synthetic installer')
  await writeFile(join(directory, names[5]), `${dmg.sha256}  ${dmg.name}\n`)
  const deltas = []
  for (const [index, from] of deltaFrom.entries()) deltas.push({from, ...await file(names[6 + index], 'patch from ' + from)})
  const receipt = {schemaVersion: 1, kind: 'eduwork-macos-release', version: context.version, edition: context.product, platform: 'macos-arm64', shell: 'electron', passed: true, coreCommit: context.coreCommit, editionCommit: context.editionCommit, recipe: 'pinned-source', releaseNotes: {approved: true, file: context.releaseNotes, sha256: notes.sha256}, checks: Object.fromEntries(['sourceAndDependencies', 'archiveManifest', 'nativeRuntimes', 'desktopLaunch', 'mediaTemplate', 'sourceSnapshot', 'readOnlyApplication', 'macosDmg'].map(name => [name, 'passed'])), automaticUpdates: true, softwareAutoUpdate: true, bundleVersion: bundleVersion(context.version), asset, installer: {asset: dmg, checks: Object.fromEntries(['imageIntegrity', 'applicationSignature', 'matchesZipApplication', 'installationWindow'].map(name => [name, 'passed']))}, deltas}
  await writeFile(join(directory, names[2]), JSON.stringify(receipt))
  return {directory, names, context}
}
test('stable macOS publishes exactly the delta updates its receipt verifies', async t => {
  const data = await macosNodeFixture(['0.4.3', '0.4.2'])
  t.after(() => rm(data.directory, {recursive: true, force: true}))
  const checked = await validatedNodeNpmFiles(data.directory, data.context)
  assert.deepEqual(checked.files.slice(6).map(file => file.name), ['EduWork-0.4.4-macos-arm64-electron-from-0.4.3.delta', 'EduWork-0.4.4-macos-arm64-electron-from-0.4.2.delta'])
  await writeFile(join(data.directory, 'EduWork-0.4.4-macos-arm64-electron-from-0.4.1.delta'), 'unlisted patch')
  await assert.rejects(validatedNodeNpmFiles(data.directory, data.context), /Unexpected macOS files/)
  await rm(join(data.directory, 'EduWork-0.4.4-macos-arm64-electron-from-0.4.1.delta'))
  await writeFile(join(data.directory, data.names[7]), 'changed patch')
  await assert.rejects(validatedNodeNpmFiles(data.directory, data.context), /delta update differs from the build receipt/)
  await rm(join(data.directory, data.names[7]))
  await assert.rejects(validatedNodeNpmFiles(data.directory, data.context), /Unexpected macOS files/)
})
test('Windows candidates add each delta update with its SHA-256 sidecar', () => {
  assert.deepEqual(nodeNpmAssetNames('EduWork', '0.4.4', 'windows', ['0.4.3']).slice(-2),
    ['EduWork-0.4.4-windows-x64-electron-from-0.4.3.zip', 'EduWork-0.4.4-windows-x64-electron-from-0.4.3.zip.sha256'])
})
test('macOS without delta updates keeps the fixed release files', async t => {
  const data = await macosNodeFixture([])
  t.after(() => rm(data.directory, {recursive: true, force: true}))
  assert.equal((await validatedNodeNpmFiles(data.directory, data.context)).files.length, 6)
})
