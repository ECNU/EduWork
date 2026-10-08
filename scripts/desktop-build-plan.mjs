import assert from 'node:assert/strict'
import { readFile, realpath } from 'node:fs/promises'
import { resolve, relative, isAbsolute, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { versionParts } from '../dsh-host/release-policy.mjs'

// One product version policy shared by assembly, receipts and publication.
// Deliberately exclude build metadata and unqualified prerelease labels from filenames.
export function desktopVersion(version) {
  versionParts(version)
  assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:(?:alpha|beta|rc)\.[1-9]\d*|dev\.\d{8}\.[1-9]\d*))?$/, 'Unsupported desktop release version')
  const prerelease = version.includes('-')
  return { version, prerelease, channel: prerelease ? 'development' : 'stable', automaticUpdates: !prerelease }
}

const read = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''))
async function inside(root, path) {
  assert.ok(typeof path === 'string' && path && !isAbsolute(path), 'Build inputs must be repository-relative paths')
  const base = await realpath(root), target = await realpath(resolve(base, path))
  const suffix = relative(base, target)
  assert.ok(suffix && suffix !== '..' && !suffix.startsWith('../') && !suffix.startsWith('..\\') && !isAbsolute(suffix), 'Build input escapes its repository')
  return target
}

export function validateBuildRequest({ version, publish, notesApproved, releaseNotes, platform, ref }) {
  const identity = desktopVersion(version)
  assert.ok(['both', 'windows', 'macos'].includes(platform), 'Unknown target platform')
  if (publish) {
    assert.equal(ref, 'refs/heads/main', 'Publication requires reviewed main')
    assert.equal(platform, 'both', 'Publication requires both platforms')
    assert.equal(notesApproved, true, 'Publication requires approved release notes')
    assert.equal(releaseNotes, `docs/releases/${version}.md`, 'Use version-specific release notes')
  }
  return identity
}

export async function desktopBuildPlan({ core, edition = core, version }) {
  core = await realpath(core); edition = await realpath(edition)
  const recipe = await read(await inside(core, 'config/desktop-build.json'))
  assert.equal(recipe.schemaVersion, 1)
  assert.equal(recipe.runtimeMode, 'source', 'Unsupported build recipe; do not silently select another runtime')
  const sourceLock = await inside(core, recipe.sourceLock), lock = await read(sourceLock)
  assert.equal(lock.repository, 'https://github.com/deepseek-ai/deepseek-harness.git')
  assert.match(lock.commit, /^[a-f0-9]{40}$/)
  versionParts(lock.packageVersion)
  const plan = { schemaVersion: 1, ...desktopVersion(version), core, edition, sourceLock,
    candidate: dirname(sourceLock), upstreamRepository: lock.repository, upstreamCommit: lock.commit,
    dshVersion: lock.packageVersion, publisherDescriptors: null, verifyPublisherBootstrap: false, validationScript: null }
  if (core !== edition) {
    const institutional = await read(await inside(edition, 'edition/desktop-build.json'))
    assert.equal(institutional.schemaVersion, 1)
    assert.equal(institutional.verifyPublisherBootstrap, true, 'Institution builds must qualify the signed first launch')
    plan.publisherDescriptors = await inside(edition, institutional.publisherDescriptors)
    plan.validationScript = await inside(edition, institutional.validationScript)
    plan.verifyPublisherBootstrap = true
  }
  return plan
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { ...Object.fromEntries(['core', 'edition', 'version'].map(key => [key, { type: 'string' }])), identity: { type: 'boolean' } } })
  const env = process.env
  validateBuildRequest({ version: values.version, publish: env.PUBLISH_RELEASE === 'true', notesApproved: env.RELEASE_NOTES_APPROVED === 'true',
    releaseNotes: env.RELEASE_NOTES, platform: env.SELECTED_PLATFORMS || 'both', ref: env.GITHUB_REF })
  console.log(JSON.stringify(values.identity ? desktopVersion(values.version) : await desktopBuildPlan(values)))
}
