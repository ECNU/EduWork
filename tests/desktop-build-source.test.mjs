import test from 'node:test'
import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sourceFileSet } from '../scripts/audit-eduwork-distribution.mjs'
import { desktopSourceIdentity } from '../scripts/lib/build-source.mjs'
import { run, sha256Text } from '../scripts/lib/build-util.mjs'
import { pinnedSourceStages } from '../scripts/lib/pinned-source-stages.mjs'
import { Workspace, runPipeline } from '../scripts/lib/stage-runner.mjs'

const quiet = () => {}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-build-source-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const coreRoot = join(root, 'core')
  await mkdir(join(coreRoot, 'scripts'), { recursive: true })
  for (const script of ['audit-eduwork-distribution.mjs', 'check-source-docs.mjs']) {
    await copyFile(new URL(`../scripts/${script}`, import.meta.url), join(coreRoot, 'scripts', script))
  }
  await writeFile(join(coreRoot, 'entry.mjs'), 'export const value = 1\n')
  const files = sourceFileSet(coreRoot)
  await writeFile(join(coreRoot, 'source-receipt.json'), JSON.stringify({
    schemaVersion: 1, edition: 'generic', files, fileSetSHA256: sha256Text(JSON.stringify(files)),
  }))
  const git = args => run('git', ['-C', coreRoot, ...args], { echo: false })
  await git(['init'])
  await git(['add', '.'])
  await git(['-c', 'user.name=Synthetic Build', '-c', 'user.email=build@example.test', 'commit', '-m', 'Synthetic source'])
  return { coreRoot, git, output: join(root, 'build') }
}

async function workspace({ coreRoot, output }, verifySnapshot = true) {
  const sourceIdentity = await desktopSourceIdentity({ coreRoot })
  const stages = pinnedSourceStages({ coreRoot, editionRoot: coreRoot, version: '0.0.0-dev.20261010.1', verifySnapshot })
  return new Workspace({ root: output, parameters: { sourceIdentity, verifySnapshot }, stages: [stages[0]] })
}

test('unchanged sources resume, but same-size working-tree edits cannot reuse the checkpoint', async t => {
  const f = await fixture(t)
  const first = await workspace(f)
  await first.enter()
  await runPipeline(first, { log: quiet })
  const second = await workspace(f)
  await second.enter()
  await runPipeline(second, { log: quiet })
  assert.deepEqual(second.skipped, ['source-audit'])

  await writeFile(join(f.coreRoot, 'entry.mjs'), 'export const value = 2\n')
  const changed = await workspace(f)
  await assert.rejects(() => changed.enter(), { code: 'EDUWORK_SOURCE_CHANGED' })
})

test('source identity includes added files and commits, and excludes generated build outputs', async t => {
  const { coreRoot, git } = await fixture(t)
  const before = await desktopSourceIdentity({ coreRoot })
  await mkdir(join(coreRoot, 'dist'))
  await writeFile(join(coreRoot, 'dist/generated.mjs'), 'generated')
  assert.deepEqual(await desktopSourceIdentity({ coreRoot }), before)
  await writeFile(join(coreRoot, 'added.mjs'), 'new input')
  assert.notEqual((await desktopSourceIdentity({ coreRoot })).core.fileSetSHA256, before.core.fileSetSHA256)
  await rm(join(coreRoot, 'added.mjs'))
  await git(['-c', 'user.name=Synthetic Build', '-c', 'user.email=build@example.test', 'commit', '--allow-empty', '-m', 'New source commit'])
  const after = await desktopSourceIdentity({ coreRoot })
  assert.equal(after.core.fileSetSHA256, before.core.fileSetSHA256)
  assert.notEqual(after.core.commit, before.core.commit)
})

test('working-tree mode skips receipt matching but retains the source audit', async t => {
  const f = await fixture(t)
  await writeFile(join(f.coreRoot, 'entry.mjs'), 'export const value = 2\n')
  const strict = await workspace(f)
  await strict.enter()
  await assert.rejects(() => runPipeline(strict, { log: quiet }), /Source file set differs/)

  const working = await workspace({ ...f, output: `${f.output}-working` }, false)
  await working.enter()
  await runPipeline(working, { log: quiet })
  assert.deepEqual(JSON.parse(await readFile(join(working.root, 'source-audit/core.json'), 'utf8')).errors, [])

  await writeFile(join(f.coreRoot, 'deployment.json'), '{"clientId":"synthetic-deployment-id"}')
  const unsafe = await workspace({ ...f, output: `${f.output}-unsafe` }, false)
  await unsafe.enter()
  await assert.rejects(() => runPipeline(unsafe, { log: quiet }), /live OIDC client identifier/)
})

test('institution source edits also invalidate a workspace without changing its core lock', async t => {
  const f = await fixture(t)
  const editionRoot = join(f.coreRoot, 'dist/edition')
  await mkdir(editionRoot, { recursive: true })
  await writeFile(join(editionRoot, 'source-receipt.json'), '{}')
  await writeFile(join(editionRoot, 'core.lock.json'), '{}')
  await writeFile(join(editionRoot, 'entry.mjs'), 'one')
  const before = await desktopSourceIdentity({ coreRoot: f.coreRoot, editionRoot })
  await writeFile(join(editionRoot, 'entry.mjs'), 'two')
  const after = await desktopSourceIdentity({ coreRoot: f.coreRoot, editionRoot })
  assert.deepEqual(after.core, before.core)
  assert.notEqual(after.edition.fileSetSHA256, before.edition.fileSetSHA256)
})
