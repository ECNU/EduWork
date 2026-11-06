import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { groups, selectProductChecks } from '../scripts/packages/catalog.mjs'
import { readChanges, receiptInputs, selectChanges } from '../scripts/ci-changes.mjs'
import { verifyCiResult } from '../scripts/ci-result.mjs'

const receipt = () => ({ schemaVersion: 1, kind: 'eduwork-public-source-snapshot', edition: 'generic', version: '1.2.3',
  createdAt: '2026-01-01T00:00:00Z', fileSetSHA256: 'a'.repeat(64), files: [{ path: 'README.md', sha256: 'b'.repeat(64) }],
  artifacts: [{ name: 'synthetic', version: '1.0.0' }] })

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'eduwork-ci-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const write = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value) }
  const commit = () => {
    git('add', '--all')
    git('-c', 'user.name=CI fixture', '-c', 'user.email=ci@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--no-verify', '-m', 'Synthetic change')
    return git('rev-parse', 'HEAD')
  }
  git('init', '-b', 'main')
  write('source-receipt.json', JSON.stringify(receipt()))
  write('README.md', 'Synthetic docs')
  const base = commit()
  return { root, git, write, commit, base }
}

test('documentation and published package sources skip assembly, but not packaged Skills or resources', () => {
  for (const file of ['README.md', 'README_EN.md', 'docs/BUILD.md', 'website/src/page.astro', 'updates/macos/stable.xml']) {
    const selected = selectProductChecks([file])
    assert.equal(selected.build, false, file)
    assert.equal(selected.integration, false, file)
    assert.deepEqual(selected.groups, [], file)
  }
  for (const file of ['dsh-skills/eduwork-help/SKILL.md', 'dsh-plugins/tool-browser/README.md', 'assets/icon.png', 'LICENSING.md',
    'THIRD_PARTY_NOTICES.md', 'config/distributions/generic.json', 'dsh-host/main.mjs', 'dsh-electron/src/main.mjs',
    'third_party/dsh/candidate/LOCK.json', 'scripts/assemble-eduwork-web.mjs', '.gitattributes', '.github/workflows/development-desktop.yml']) {
    const selected = selectProductChecks([file])
    assert.equal(selected.build, true, file)
    assert.equal(selected.integration, true, file)
  }
  for (const file of ['packages/dsh-decision/skills/decision/SKILL.md', 'packages/dsh-decision/assets/icon.svg', 'packages/dsh-decision/src/core.js']) {
    const selected = selectProductChecks([file])
    assert.equal(selected.build, false, file)
    assert.equal(selected.integration, false, file)
    assert.deepEqual(selected.groups, ['dsh-decision'], file)
  }
  assert.deepEqual(selectProductChecks(['packages/dsh-remote-access/docs/PROTOCOL.md']).groups, ['dsh-remote-access'])
})

test('direct source integration dependencies and mixed changes retain their checks', () => {
  for (const file of ['packages/dsh-desktop-pet/skins/default/idle.svg', 'packages/dsh-memory/scripts/check-query-contract.mjs',
    'packages/dsh-knowledge-studio/scripts/build-video-template.mjs', 'packages/dsh-oidc/package.json',
    'packages/dsh-knowledge-studio/packages/artifact-services/package.json']) {
    const selected = selectProductChecks([file])
    assert.equal(selected.build, false, file)
    assert.equal(selected.integration, true, file)
    assert.ok(selected.groups.length, file)
  }
  const mixed = selectProductChecks(['README.md', 'packages/dsh-annotation/src/index.js', 'third_party/npm-015-rc1/dsh-oidc/LOCK.json'])
  assert.equal(mixed.build, true)
  assert.equal(mixed.integration, true)
  assert.deepEqual(mixed.groups, ['dsh-annotation', 'dsh-side-chat'])
  for (const file of ['unclassified/input.md', 'packages/new-package/src/index.js', '.github/actions/new/action.yml']) {
    const selected = selectProductChecks([file])
    assert.equal(selected.build, true, file)
    assert.equal(selected.integration, true, file)
    assert.deepEqual(selected.groups, groups, file)
  }
})

test('receipt refresh ignores only timestamps and source hashes; identity and unknown metadata still build', () => {
  const before = receipt(), after = { ...receipt(), createdAt: '2026-02-01T00:00:00Z', fileSetSHA256: 'c'.repeat(64),
    files: [{ path: 'docs/new.md', sha256: 'd'.repeat(64) }] }
  assert.deepEqual(receiptInputs(before), receiptInputs(after))
  for (const field of ['version', 'artifacts', 'newMetadata']) {
    const changed = { ...after, [field]: field === 'version' ? '1.2.4' : 'changed' }
    assert.notDeepEqual(receiptInputs(before), receiptInputs(changed), field)
  }
  for (const invalid of [{ ...after, version: 'not-a-version' }, { ...after, files: [] }, { ...after, files: [{ path: 'a', sha256: 'bad' }] },
    { ...after, schemaVersion: 2 }, { ...after, files: [after.files[0], after.files[0]] }]) assert.throws(() => receiptInputs(invalid), /Invalid source receipt/)
})

test('Git comparisons cover whole pushes, PR merge bases, deletions and renames', t => {
  const f = repository(t)
  f.write('dsh-host/input.mjs', 'export {}')
  const product = f.commit()
  f.write('docs/new page.md', 'Docs')
  const head = f.commit()
  const push = readChanges(f.root, { eventName: 'push', base: f.base, head })
  assert.deepEqual(push.files, ['docs/new page.md', 'dsh-host/input.mjs'])
  assert.equal(selectProductChecks(push.files, push).build, true)
  f.git('switch', '-c', 'docs', f.base)
  f.write('docs/pr.md', 'PR docs')
  const prHead = f.commit()
  const pr = readChanges(f.root, { eventName: 'pull_request', base: product, head: prHead })
  assert.equal(pr.comparisonBase, f.base)
  assert.deepEqual(pr.files, ['docs/pr.md'])
  assert.equal(selectProductChecks(pr.files, pr).build, false)
  // A non-fast-forward push must include removed inputs from its previous tip.
  const replacement = readChanges(f.root, { eventName: 'push', base: product, head: prHead })
  assert.ok(replacement.files.includes('dsh-host/input.mjs'))
  f.git('switch', 'main')
  f.git('mv', 'dsh-host/input.mjs', 'docs/moved.md')
  const renamed = f.commit()
  const rename = readChanges(f.root, { eventName: 'push', base: head, head: renamed })
  assert.deepEqual(rename.files, ['docs/moved.md', 'dsh-host/input.mjs'])
  assert.equal(selectProductChecks(rename.files, rename).build, true)
})

test('Git receipt changes and missing comparisons fail open to full work, never skip silently', t => {
  const f = repository(t)
  const refreshed = { ...receipt(), createdAt: '2026-02-01T00:00:00Z', fileSetSHA256: 'c'.repeat(64) }
  f.write('source-receipt.json', JSON.stringify(refreshed))
  let head = f.commit()
  const refreshedChanges = readChanges(f.root, { eventName: 'push', base: f.base, head })
  assert.equal(refreshedChanges.receiptOnly, true)
  assert.equal(selectProductChecks(refreshedChanges.files, refreshedChanges).build, false)
  f.write('source-receipt.json', JSON.stringify({ ...refreshed, version: '1.2.4' }))
  head = f.commit()
  const changed = readChanges(f.root, { eventName: 'push', base: f.base, head })
  assert.equal(changed.receiptOnly, false)
  assert.equal(selectProductChecks(changed.files, changed).build, true)
  for (const options of [{ eventName: 'push', base: '0'.repeat(40), head }, { eventName: 'push', base: 'f'.repeat(40), head },
    { eventName: 'push' }, { eventName: 'workflow_dispatch' }, { eventName: 'workflow_call' }]) {
    const changes = readChanges(f.root, options)
    assert.equal(changes.full, true)
    const selected = selectProductChecks(changes.files, changes)
    assert.equal(selected.build, true)
    assert.equal(selected.integration, true)
    assert.deepEqual(selected.groups, groups)
  }
  f.write('source-receipt.json', '{invalid')
  assert.throws(() => selectChanges(f.root, { GITHUB_EVENT_NAME: 'workflow_dispatch' }))
})

test('selection consumes push payloads and invalid event data cannot report success', t => {
  const f = repository(t)
  f.write('README.md', 'Changed docs')
  const head = f.commit(), eventPath = join(f.root, 'event.json')
  writeFileSync(eventPath, JSON.stringify({ before: f.base, after: head }))
  const selected = selectChanges(f.root, { GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_PATH: eventPath })
  assert.equal(selected.build, false)
  assert.deepEqual(selected.comparison.files, ['README.md'])
  assert.deepEqual(selectChanges(f.root, {}, f.base).comparison.files, ['README.md'])
  writeFileSync(eventPath, '{invalid')
  assert.throws(() => selectChanges(f.root, { GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_PATH: eventPath }))
})

test('CI result accepts only successful required jobs or deliberate skips', () => {
  assert.match(verifyCiResult('success', 'true', ['success', 'success']), /passed/)
  assert.match(verifyCiResult('success', 'false', ['skipped', 'skipped']), /skipped/)
  for (const status of ['failure', 'cancelled', 'skipped', '']) {
    assert.throws(() => verifyCiResult(status, 'false', ['skipped']))
    assert.throws(() => verifyCiResult('success', 'true', ['success', status]))
  }
  for (const status of ['failure', 'cancelled', 'success', '']) assert.throws(() => verifyCiResult('success', 'false', [status]))
  assert.throws(() => verifyCiResult('success', '', ['skipped']))
  assert.throws(() => verifyCiResult('success', 'true', []))
  const script = fileURLToPath(new URL('../scripts/ci-result.mjs', import.meta.url))
  assert.throws(() => execFileSync(process.execPath, [script], { env: { ...process.env, SELECTION_RESULT: 'failure', REQUIRED: 'false', RESULTS: '["skipped"]' }, stdio: 'pipe' }))
})
