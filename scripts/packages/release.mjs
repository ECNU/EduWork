import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { selectPackage, repository } from './catalog.mjs'
import { inspectArchive } from './archive.mjs'
import { npm } from './npm.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const [mode, id] = process.argv.slice(2)
assert.ok(['preflight', 'publish'].includes(mode), 'Expected preflight or publish')
const selected = selectPackage(id)
const manifest = JSON.parse(await readFile(join(root, selected.directory, 'package.json'), 'utf8'))
const groupDirectory = `packages/${selected.group}`
const groupManifest = JSON.parse(await readFile(join(root, groupDirectory, 'package.json'), 'utf8'))
const lock = JSON.parse(await readFile(join(root, groupDirectory, 'package-lock.json'), 'utf8'))
const importer = selected.directory === groupDirectory ? '' : selected.directory.slice(groupDirectory.length + 1)
assert.equal(lock.packages[''].version, groupManifest.version, 'Update the development-root lock version')
assert.equal(lock.packages[importer]?.version, manifest.version, 'Update the selected package lock version')
assert.deepEqual(lock.packages[importer]?.dependencies || {}, manifest.dependencies || {}, 'Manifest dependencies and lock must match')
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const commit = git(['rev-parse', 'HEAD'])
assert.equal(git(['status', '--porcelain']), '', 'Use a clean committed checkout')
assert.equal(manifest.repository.url, `git+https://github.com/${repository}.git`)
assert.equal(manifest.repository.directory, selected.directory)
assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
const publish = process.env.PUBLISH === 'true'
if (mode === 'publish') assert.ok(publish, 'Publishing requires the explicit workflow input')
if (publish) {
  assert.equal(process.env.GITHUB_REPOSITORY, repository, 'Only the source repository may publish')
  assert.equal(process.env.GITHUB_SHA, commit, 'Workflow and checked-out source commits must match')
  const tag = `${selected.id}-v${manifest.version}`
  assert.equal(process.env.GITHUB_REF, `refs/tags/${tag}`, 'Dispatch the workflow from the package version tag')
  assert.equal(git(['rev-parse', `refs/tags/${tag}^{commit}`]), commit)
  assert.ok(['latest', 'dev'].includes(process.env.DIST_TAG), 'Choose latest or dev')
  assert.ok(!manifest.version.includes('-') || process.env.DIST_TAG === 'dev', 'Prereleases must use the dev dist-tag')
  // npm versions are immutable. 401/network/server errors are not evidence of availability.
  const current = await fetch(`https://registry.npmjs.org/${encodeURIComponent(manifest.name)}/${manifest.version}`)
  assert.equal(current.status, 404, 'Version already exists or registry availability cannot be established; inspect npm before retrying')
  for (const [name, version] of Object.entries(manifest.dependencies || {})) {
    if (!name.startsWith('@eduwork/')) continue
    assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'Internal package dependencies must use exact npm versions')
    const dependency = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`)
    assert.equal(dependency.status, 200, `Publish ${name}@${version} before ${manifest.name}`)
    const metadata = await dependency.json()
    assert.equal(metadata.name, name)
    assert.equal(metadata.version, version)
    assert.ok(metadata.dist?.integrity && metadata.dist?.tarball, 'Published dependency lacks a registry receipt')
  }
}
if (mode === 'publish') {
  const output = join(root, 'dist/npm-release')
  const receipt = JSON.parse(await readFile(join(output, 'receipt.json'), 'utf8'))
  assert.equal(receipt.id, id)
  assert.equal(receipt.name, manifest.name)
  assert.equal(receipt.version, manifest.version)
  assert.equal(receipt.directory, selected.directory)
  assert.equal(receipt.sourceCommit, commit)
  assert.equal(receipt.sourceDirty, false)
  assert.equal(basename(receipt.filename), receipt.filename)
  const tarball = join(output, receipt.filename), bytes = await readFile(tarball)
  assert.equal(bytes.length, receipt.bytes)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), receipt.sha256)
  assert.equal('sha512-' + createHash('sha512').update(bytes).digest('base64'), receipt.integrity)
  inspectArchive(bytes, selected, manifest.version)
  npm(['publish', tarball, '--access', 'public', '--provenance', '--ignore-scripts', '--tag', process.env.DIST_TAG], { cwd: root, stdio: 'inherit' })
} else console.log(`Checked ${manifest.name}@${manifest.version} at ${commit}; publish=${publish}`)
