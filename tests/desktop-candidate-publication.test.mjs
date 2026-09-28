import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {assetNames, validateRun, validateCandidateReceipt, validatedCandidateFiles, verifyRemoteAssets, publishCandidate} from '../scripts/publish-desktop-candidate.mjs'

const context = {product: 'EduWork', version: '0.3.6-dev.20260928.2', distribution: 'eduwork', coreCommit: 'a'.repeat(40), editionCommit: 'b'.repeat(40)}
const hash = data => createHash('sha256').update(data).digest('hex')
async function fixture(platform) {
  const directory = await mkdtemp(join(tmpdir(), 'eduwork-publication-'))
  const names = assetNames(context.product, context.version, platform)
  const file = async (name, body, sidecar = true) => {
    await writeFile(join(directory, name), body)
    const meta = {name, bytes: Buffer.byteLength(body), sha256: hash(body)}
    if (sidecar) await writeFile(join(directory, name + '.sha256'), `${meta.sha256}  ${name}\n`)
    return meta
  }
  const receipt = {schemaVersion: 1, kind: 'eduwork-source-alpha', version: context.version, distribution: context.distribution, coreCommit: context.coreCommit, editionCommit: context.editionCommit, platform, shell: 'electron', passed: true, automaticUpdates: false, dshVersion: '0.1.7-rc.2', checks: Object.fromEntries(['sourceSnapshot', 'archiveManifest', 'mediaTemplate', 'nativeRuntimes', 'desktopLaunch', 'portableExtractor', 'macosDmg', 'readOnlyApplication'].map(name => [name, 'passed'])), asset: await file(names[0], 'synthetic archive')}
  const extra = await file(names[3], 'synthetic installer')
  if (platform === 'windows') {
    const extractor = {schemaVersion: 1, kind: 'eduwork-portable-extractor', format: 'zip-containing-self-extracting-exe', version: context.version, distribution: context.distribution, payload: receipt.asset, asset: extra, extractor: {name: 'EduWork-Setup.exe', bytes: 1, sha256: 'c'.repeat(64), sourceCommit: context.coreCommit, sourceDirty: false}, checks: {executionLevel: 'asInvoker', embeddedArchive: 'passed', manifestIdentity: 'passed', outerZIP: 'passed', extraction: 'passed'}}
    receipt.portableExtractor = {asset: extra, receipt: await file(names[5], JSON.stringify(extractor), false)}
  } else receipt.installer = {asset: extra, checks: Object.fromEntries(['imageIntegrity', 'applicationSignature', 'matchesZipApplication', 'installationWindow'].map(name => [name, 'passed']))}
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
  const jobs = ['build (windows-latest, windows)', 'build (macos-15, macos)'].map(name => ({name, status: 'completed', conclusion: 'success'}))
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
  assert.match(build, /needs: build/)
  assert.match(build, /uses: \.\/\.github\/workflows\/publish-desktop-candidate.yml/)
  assert.match(build, /SELECTED_PLATFORMS -ne 'both'/)
  assert.match(publish, /workflow_call:/)
  assert.match(publish, /if: github.ref == 'refs\/heads\/main'/)
  assert.match(publish, /runs-on: ubuntu-latest/)
})
