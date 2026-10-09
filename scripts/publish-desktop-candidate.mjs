import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {createReadStream, createWriteStream} from 'node:fs'
import {readFile, writeFile, mkdir, readdir, lstat, appendFile, copyFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {execFileSync} from 'node:child_process'
import {Readable} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {githubUpdateManifestBytes, updateManifestName} from './github-update-manifest.mjs'
import {validateExtractorReceipt, validatedReleaseFiles} from './publish-windows-release.mjs'
import {bundleVersion} from './macos-update-feed.mjs'
import {desktopVersion} from './desktop-build-plan.mjs'

const sha = /^[a-f0-9]{40}$/
const digest = /^[a-f0-9]{64}$/
const json = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''))
async function hashFile(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
export function assetNames(product, version, platform) {
  assert.match(product, /^[A-Za-z0-9-]+$/)
  desktopVersion(version)
  assert.ok(['windows', 'macos'].includes(platform))
  const zip = `${product}-${version}-${platform === 'windows' ? 'windows-x64' : 'macos-arm64'}-electron.zip`
  const extra = platform === 'windows' ? `${product}-${version}-windows-x64-setup.zip` : zip.replace(/\.zip$/, '.dmg')
  return [zip, zip + '.sha256', `${platform}-${desktopVersion(version).prerelease?'alpha':'release'}-receipt.json`, extra, extra + '.sha256', ...(platform === 'windows' ? [extra + '.json', ...(!desktopVersion(version).prerelease ? [updateManifestName] : [])] : [])]
}
export function nodeNpmAssetNames(product, version, platform) {
  assert.match(product, /^[A-Za-z0-9-]+$/)
  desktopVersion(version)
  assert.ok(['windows', 'macos'].includes(platform))
  const zip = `${product}-${version}-${platform === 'windows' ? 'windows-x64' : 'macos-arm64'}-electron.zip`
  const names = [zip, `${zip}.sha256`, 'release-receipt.json', 'RELEASE-NOTES.md']
  if (platform === 'windows') {
    const setup = `${product}-${version}-windows-x64-setup.zip`
    names.push(...(!desktopVersion(version).prerelease ? [updateManifestName] : []), setup, `${setup}.sha256`, `${setup}.json`)
  } else {
    const dmg = `${product}-${version}-macos-arm64-electron.dmg`
    names.push(dmg, `${dmg}.sha256`)
  }
  return names
}
export function validateRun(run, {repository, workflow, currentRun}, jobs = []) {
  assert.equal(run.repository.full_name.toLowerCase(), repository.toLowerCase(), 'Wrong source repository')
  assert.equal(run.path, workflow, 'Wrong source workflow')
  assert.equal(run.event, 'workflow_dispatch', 'Only explicitly requested candidates may be published')
  assert.match(run.head_sha, sha)
  if (run.status === 'completed') assert.equal(run.conclusion, 'success', 'Candidate build failed')
  else {
    // The publishing job can follow the matrix in the same still-running workflow.
    assert.equal(String(run.id), String(currentRun), 'Another build is still running')
    for (const name of ['build (windows-latest, windows)', 'build (macos-15, macos)']) {
      const found = jobs.filter(job => job.name === name)
      assert.equal(found.length, 1, 'Missing or ambiguous platform build: ' + name)
      assert.equal(found[0].status, 'completed')
      assert.equal(found[0].conclusion, 'success', 'Platform build failed: ' + name)
    }
  }
}
export function validateCandidateReceipt(receipt, context) {
  const {product, version, distribution, platform, coreCommit, editionCommit} = context
  assert.match(coreCommit, sha)
  assert.match(editionCommit, sha)
  for (const [key, value] of Object.entries({schemaVersion: 1, kind: desktopVersion(version).prerelease?'eduwork-source-alpha':'eduwork-source-release', version, distribution, platform, shell: 'electron', passed: true, automaticUpdates: !desktopVersion(version).prerelease, coreCommit, editionCommit})) {
    assert.equal(receipt[key], value, 'Candidate identity mismatch: ' + key)
  }
  assert.ok(typeof receipt.dshVersion === 'string' && receipt.dshVersion.length > 0)
  for (const check of ['sourceSnapshot', 'archiveManifest', 'mediaTemplate', 'nativeRuntimes', 'desktopLaunch']) assert.equal(receipt.checks[check], 'passed', check)
  if (context.requirePublisherBootstrap) assert.equal(receipt.checks.publisherFirstLaunch, 'passed')
  assert.equal(receipt.asset.name, assetNames(product, version, platform)[0])
  if (platform === 'windows') {
    assert.equal(receipt.checks.portableExtractor, 'passed')
    if (!desktopVersion(version).prerelease) assert.equal(receipt.checks.updateContract, 'passed')
  }
  else {
    if (!desktopVersion(version).prerelease) {
      assert.equal(receipt.sparkleEnabled, true, 'Stable macOS requires Sparkle updates')
      assert.equal(receipt.bundleVersion, bundleVersion(version), 'Sparkle bundle version mismatch')
    }
    assert.equal(receipt.checks.macosDmg, 'passed')
    assert.equal(receipt.checks.readOnlyApplication, 'passed')
    for (const check of ['imageIntegrity', 'applicationSignature', 'matchesZipApplication', 'installationWindow']) assert.equal(receipt.installer.checks[check], 'passed', check)
  }
}
export async function validatedCandidateFiles(directory, context) {
  const names = assetNames(context.product, context.version, context.platform)
  assert.deepEqual((await readdir(directory)).sort(), [...names].sort(), 'Unexpected candidate files')
  const receipt = await json(join(directory, `${context.platform}-${desktopVersion(context.version).prerelease?'alpha':'release'}-receipt.json`))
  validateCandidateReceipt(receipt, context)
  const files = []
  for (const name of names) {
    const path = join(directory, name), info = await lstat(path)
    assert.ok(info.isFile() && !info.isSymbolicLink(), 'Assets must be regular files')
    files.push({name, path, bytes: info.size, sha256: await hashFile(path)})
  }
  const verifyFile = async (expected, name, sidecar = true) => {
    assert.equal(expected.name, name)
    assert.match(expected.sha256, digest)
    const file = files.find(item => item.name === name)
    assert.equal(file.bytes, expected.bytes, 'Wrong asset size: ' + name)
    assert.equal(file.sha256, expected.sha256, 'Wrong asset digest: ' + name)
    if (sidecar) assert.equal((await readFile(file.path + '.sha256', 'utf8')).trim(), `${file.sha256}  ${name}`)
  }
  await verifyFile(receipt.asset, names[0])
  if (context.platform === 'windows') {
    await verifyFile(receipt.portableExtractor.asset, names[3])
    await verifyFile(receipt.portableExtractor.receipt, names[5], false)
    validateExtractorReceipt(await json(join(directory, names[5])), {...receipt, edition: context.product})
    if (!desktopVersion(context.version).prerelease) assert.equal(await readFile(join(directory, updateManifestName), 'utf8'), githubUpdateManifestBytes(receipt, 'ECNU/' + context.product), 'Update manifest differs from verified artifact')
  } else await verifyFile(receipt.installer.asset, names[3])
  return {files, receipt}
}
export async function validatedNodeNpmFiles(directory, context) {
  nodeNpmAssetNames(context.product, context.version, context.platform)
  if (context.platform === 'windows') {
    const checked = await validatedReleaseFiles(directory, {
      repository: context.repository,
      version: context.version,
      commit: context.editionCommit,
    })
    assert.equal(checked.receipt.coreCommit, context.coreCommit)
    assert.equal(checked.receipt.releaseNotes.file, context.releaseNotes)
    assert.equal(checked.receipt.recipe, 'pinned-source', 'Node candidate must use the reviewed source recipe')
    for (const check of ['sourceSnapshot', 'mediaTemplate']) {
      assert.equal(checked.receipt.checks?.[check], 'passed', check)
    }
    if (context.requirePublisherBootstrap) assert.equal(checked.receipt.checks.publisherFirstLaunch, 'passed')
    return checked
  }
  const names = nodeNpmAssetNames(context.product, context.version, 'macos')
  const name = names[0]
  assert.deepEqual((await readdir(directory)).sort(), [...names].sort(), 'Unexpected macOS files')
  const receipt = await json(join(directory, 'release-receipt.json'))
  for (const [key, value] of Object.entries({
    schemaVersion: 1, kind: 'eduwork-macos-release', version: context.version,
    edition: context.product, platform: 'macos-arm64', shell: 'electron', passed: true,
    coreCommit: context.coreCommit, editionCommit: context.editionCommit,
  })) assert.equal(receipt[key], value, 'macOS candidate identity mismatch: ' + key)
  assert.equal(receipt.releaseNotes?.approved, true)
  assert.equal(receipt.releaseNotes.file, context.releaseNotes)
  assert.equal(receipt.recipe, 'pinned-source', 'Node candidate must use the reviewed source recipe')
  for (const check of ['sourceSnapshot', 'mediaTemplate']) assert.equal(receipt.checks?.[check], 'passed', check)
  if (context.requirePublisherBootstrap) assert.equal(receipt.checks?.publisherFirstLaunch, 'passed')
  assert.match(receipt.releaseNotes.sha256, digest)
  for (const check of ['sourceAndDependencies', 'archiveManifest', 'nativeRuntimes', 'desktopLaunch', 'readOnlyApplication']) {
    assert.equal(receipt.checks?.[check], 'passed', check)
  }
  assert.equal(receipt.checks?.macosDmg, 'passed')
  if (!desktopVersion(context.version).prerelease) {
    assert.equal(receipt.softwareAutoUpdate, true, 'Stable macOS requires Sparkle updates')
    assert.equal(receipt.bundleVersion, bundleVersion(context.version), 'Sparkle bundle version mismatch')
  }
  for (const check of ['imageIntegrity', 'applicationSignature', 'matchesZipApplication', 'installationWindow']) {
    assert.equal(receipt.installer?.checks?.[check], 'passed', check)
  }
  const files = []
  for (const filename of names) {
    const path = join(directory, filename), info = await lstat(path)
    assert.ok(info.isFile() && !info.isSymbolicLink(), 'Release assets must be regular files')
    files.push({name: filename, path, bytes: info.size, sha256: await hashFile(path)})
  }
  assert.deepEqual(receipt.asset, {name, bytes: files[0].bytes, sha256: files[0].sha256})
  assert.equal((await readFile(files[1].path, 'utf8')).trim(), `${files[0].sha256}  ${name}`)
  assert.equal(files[3].sha256, receipt.releaseNotes.sha256, 'macOS release notes differ from the build receipt')
  assert.deepEqual(receipt.installer.asset, {name: names[4], bytes: files[4].bytes, sha256: files[4].sha256})
  assert.equal((await readFile(files[5].path, 'utf8')).trim(), `${files[4].sha256}  ${names[4]}`)
  return {files, receipt}
}
export function verifyRemoteAssets(assets, files) {
  assert.equal(assets.length, files.length, 'Release asset count differs')
  for (const file of files) {
    const matches = assets.filter(asset => asset.name === file.name)
    assert.equal(matches.length, 1, 'Duplicate or missing asset: ' + file.name)
    const asset = matches[0]
    assert.equal(asset.state, 'uploaded')
    assert.equal(asset.size, file.bytes, file.name)
    assert.equal(asset.digest, `sha256:${file.sha256}`, file.name)
    assert.ok(!asset.label, 'Release assets must display full filenames')
  }
}
export async function publishCandidate(env = process.env) {
  assert.equal(env.GITHUB_ACTIONS, 'true', 'Publish CI-built candidates from GitHub Actions')
  assert.equal(env.GITHUB_REF, 'refs/heads/main', 'Only the reviewed main workflow may publish')
  assert.equal(env.RELEASE_NOTES_APPROVED, 'true', 'Release notes must be approved')
  assert.ok(['true', 'false'].includes(env.PUBLISH_RELEASE))
  assert.match(env.SOURCE_RUN_ID, /^\d+$/)
  const repository = env.GITHUB_REPOSITORY, version = env.RELEASE_VERSION, product = env.RELEASE_PRODUCT
  const aliases = {source: 'ps1', 'source-ps1': 'ps1', staged: 'node', 'node-npm': 'node'}
  const buildMode = aliases[env.BUILD_MODE] ?? env.BUILD_MODE ?? 'node'
  assert.ok(['ps1', 'node'].includes(buildMode), 'Unknown desktop build mode')
  assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
  const sourceWorkflow = env.CANDIDATE_WORKFLOW
  if (buildMode === 'node') nodeNpmAssetNames(product, version, 'macos')
  else assetNames(product, version, 'windows')
  assert.equal(env.RELEASE_NOTES, `docs/releases/${version}.md`, 'Use the reviewed version-specific notes')
  const notesPath = resolve(env.EDITION_ROOT, env.RELEASE_NOTES)
  const notes = await readFile(notesPath, 'utf8'), title = notes.split(/\r?\n/)[0]
  assert.ok(notes.trim().length > 0 && title.includes(version), 'Missing or mismatched notes')
  assert.ok(env.GITHUB_TOKEN, 'Release job token required')
  const headers = {Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'EduWork-Candidate-Publisher', 'X-GitHub-Api-Version': '2022-11-28'}
  const api = `https://api.github.com/repos/${repository}`
  async function request(path, options = {}, missing = false) {
    const response = await fetch(api + path, {...options, headers: {...headers, ...options.headers}})
    if (missing && response.status === 404) return null
    assert.ok(response.ok, `GitHub HTTP ${response.status}: ${path}`)
    return response.status === 204 ? null : response.json()
  }
  const run = await request(`/actions/runs/${env.SOURCE_RUN_ID}`)
  const jobs = run.status === 'completed' ? [] : (await request(`/actions/runs/${run.id}/jobs?per_page=100`)).jobs
  validateRun(run, {repository, workflow: sourceWorkflow, currentRun: env.GITHUB_RUN_ID}, jobs)
  const ancestry = await request(`/compare/${run.head_sha}...main`)
  assert.equal(ancestry.merge_base_commit.sha, run.head_sha, 'Candidate source has not been merged into main')
  let coreCommit = run.head_sha
  if (env.HAS_CORE_LOCK === 'true') {
    const content = await request(`/contents/core.lock.json?ref=${run.head_sha}`)
    const lock = JSON.parse(Buffer.from(content.content, 'base64').toString('utf8'))
    assert.equal(lock.repository.toLowerCase(), 'https://github.com/ecnu/eduwork.git')
    assert.match(lock.commit, sha)
    coreCommit = lock.commit
  }
  const root = resolve(env.RUNNER_TEMP, 'desktop-publication-' + env.GITHUB_RUN_ID)
  await mkdir(root, {recursive: true})
  const artifacts = (await request(`/actions/runs/${run.id}/artifacts?per_page=100`)).artifacts
  const files = [], receipts = []
  for (const platform of ['windows', 'macos']) {
    const matches = artifacts.filter(artifact => artifact.name === platform + '-release' && !artifact.expired)
    assert.equal(matches.length, 1, 'Missing or ambiguous CI artifact: ' + platform)
    const artifact = matches[0], archive = join(root, platform + '.zip'), directory = join(root, platform)
    assert.match(artifact.digest, /^sha256:[a-f0-9]{64}$/)
    const redirect = await fetch(`${api}/actions/artifacts/${artifact.id}/zip`, {headers, redirect: 'manual'})
    assert.equal(redirect.status, 302, 'Expected artifact download redirect')
    const location = new URL(redirect.headers.get('location'))
    assert.equal(location.protocol, 'https:')
    // Do not forward the repository token to artifact storage.
    const download = await fetch(location)
    assert.ok(download.ok, 'Artifact download failed')
    await pipeline(Readable.fromWeb(download.body), createWriteStream(archive))
    assert.equal((await lstat(archive)).size, artifact.size_in_bytes)
    assert.equal('sha256:' + await hashFile(archive), artifact.digest, 'Actions artifact digest mismatch')
    const names = execFileSync('unzip', ['-Z1', archive], {encoding: 'utf8'}).trim().split(/\r?\n/)
    const expected = buildMode === 'ps1' ? assetNames(product, version, platform)
      : nodeNpmAssetNames(product, version, platform)
    assert.deepEqual(names.sort(), expected.sort(), 'Unexpected paths in artifact archive')
    await mkdir(directory, {recursive: true})
    execFileSync('unzip', ['-q', archive, '-d', directory])
    const checked = buildMode === 'ps1'
      ? await validatedCandidateFiles(directory, {product, version, platform, distribution: env.RELEASE_DISTRIBUTION, coreCommit, editionCommit: run.head_sha, requirePublisherBootstrap: env.REQUIRE_PUBLISHER_BOOTSTRAP === 'true'})
      : await validatedNodeNpmFiles(directory, {product, version, platform, repository, coreCommit, editionCommit: run.head_sha, releaseNotes: env.RELEASE_NOTES, requirePublisherBootstrap: env.REQUIRE_PUBLISHER_BOOTSTRAP === 'true'})
    if (buildMode === 'ps1') files.push(...checked.files)
    else {
      const receiptPath = join(root, `${platform}-release-receipt.json`)
      await copyFile(join(directory, 'release-receipt.json'), receiptPath)
      files.push(...checked.files.filter(file => !['release-receipt.json', 'RELEASE-NOTES.md'].includes(file.name)))
      files.push({name: `${platform}-release-receipt.json`, path: receiptPath, bytes: (await lstat(receiptPath)).size, sha256: await hashFile(receiptPath)})
      assert.equal(checked.files.find(file => file.name === 'RELEASE-NOTES.md').sha256, await hashFile(notesPath), 'Platform notes differ from approved main')
    }
    receipts.push(checked.receipt)
    console.log('Verified CI artifact and all release files: ' + platform)
  }
  assert.equal(receipts[0].dshVersion, receipts[1].dshVersion, 'Platforms use different DSH versions')
  if (buildMode === 'node') {
    assert.match(receipts[0].dshCommit, sha, 'Windows DSH commit is missing')
    assert.equal(receipts[0].dshCommit, receipts[1].dshCommit, 'Platforms use different DSH source commits')
    assert.equal(receipts[0].recipe, receipts[1].recipe, 'Platforms use different build recipes')
  }
  const notesAsset = join(root, 'RELEASE-NOTES.md')
  await writeFile(notesAsset, notes)
  files.push({name: 'RELEASE-NOTES.md', path: notesAsset, bytes: Buffer.byteLength(notes), sha256: await hashFile(notesAsset)})
  assert.equal(files.length, desktopVersion(version).prerelease ? 12 : 13)
  const result = {verified: true, published: false, buildMode, repository, sourceRun: run.id, editionCommit: run.head_sha, coreCommit, tag: 'v' + version, files: files.map(({path, ...file}) => file)}
  if (env.PUBLISH_RELEASE === 'true') {
    const tag = result.tag
    let ref = await request('/git/ref/tags/' + tag, {}, true)
    if (ref) { assert.equal(ref.object.type, 'commit'); assert.equal(ref.object.sha, run.head_sha, 'Existing tag differs') }
    let release = await request('/releases/tags/' + tag, {}, true)
    if (!release) {
      const matches = (await request('/releases?per_page=100')).filter(item => item.tag_name === tag)
      assert.ok(matches.length <= 1, 'Ambiguous release')
      release = matches[0]
    }
    const identity = release => {
      assert.equal(release.target_commitish, run.head_sha)
      assert.equal(release.tag_name, tag)
      assert.equal(release.prerelease, desktopVersion(version).prerelease)
      assert.equal(release.name, title)
      assert.equal(release.body.trimEnd(), notes.trimEnd())
    }
    if (!release) release = await request('/releases', {method: 'POST', body: JSON.stringify({tag_name: tag, target_commitish: run.head_sha, name: title, body: notes, draft: true, prerelease: desktopVersion(version).prerelease, make_latest: desktopVersion(version).prerelease?'false':'true'})})
    identity(release)
    for (const file of files) {
      const existing = release.assets.filter(asset => asset.name === file.name)
      if (existing.length) { verifyRemoteAssets(existing, [file]); continue }
      assert.equal(release.draft, true, 'Refuse to mutate an incomplete public release')
      const url = new URL(release.upload_url.replace(/\{.*$/, ''))
      assert.equal(url.origin, 'https://uploads.github.com')
      url.searchParams.set('name', file.name)
      const response = await fetch(url, {method: 'POST', headers: {...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(file.bytes)}, body: createReadStream(file.path), duplex: 'half'})
      assert.ok(response.ok, `Upload failed: ${file.name}, HTTP ${response.status}; draft retained`)
      verifyRemoteAssets([await response.json()], [file])
      console.log('Uploaded and verified ' + file.name)
    }
    release = await request('/releases/' + release.id)
    identity(release)
    verifyRemoteAssets(release.assets, files)
    if (release.draft) await request('/releases/' + release.id, {method: 'PATCH', body: JSON.stringify({draft: false, prerelease: desktopVersion(version).prerelease, make_latest: desktopVersion(version).prerelease?'false':'true'})})
    release = await request('/releases/' + release.id)
    identity(release)
    assert.equal(release.draft, false)
    verifyRemoteAssets(release.assets, files)
    ref = await request('/git/ref/tags/' + tag)
    assert.equal(ref.object.type, 'commit')
    assert.equal(ref.object.sha, run.head_sha)
    result.published = true
    result.url = release.html_url
    console.log('Published ' + result.url)
  }
  await writeFile(join(root, 'publication-verification.json'), JSON.stringify(result, null, 2) + '\n')
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, `${result.published ? 'Published: ' + result.url : 'Verified; publication was not requested.'}\n\nSource run: ${run.id}; source commit: ${run.head_sha}; ${files.length} files verified.\n`)
  return result
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await publishCandidate()
