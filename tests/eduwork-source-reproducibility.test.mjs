import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import test from 'node:test'
import { normalizationContract, packingHook, patchEduworkSourceReproducibility, reviewedCommit, reviewedFiles } from '../scripts/patch-eduwork-source-reproducibility.mjs'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/eduwork-dsh-015')
const archive = 'b191f0aa10836ed6db59d8f196416892b7e40e03a09cae4bed3625c1efd32e84'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-build-patch-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const upstream = join(root, 'upstream'), lockPath = join(root, 'LOCK.json')
  await mkdir(upstream)
  for (const file of reviewedFiles.filter(file => file.beforeSHA256)) {
    await mkdir(dirname(join(upstream, file.path)), { recursive: true })
    await cp(join(fixtures, file.path.split('/').at(-1)), join(upstream, file.path))
  }
  const identity = { schemaVersion: 1, repository: 'https://github.com/deepseek-ai/deepseek-harness.git', commit: reviewedCommit, sourceArchiveSHA256: archive }
  await writeFile(join(upstream, '.dsh-source-lock.json'), JSON.stringify(identity))
  await writeFile(lockPath, JSON.stringify({ ...identity, runtime: { source: { buildNormalization: normalizationContract() } } }))
  return { root, upstream, lockPath }
}

test('rc.1 uses the reviewed unchanged build inputs with its own archive identity', async t => {
  const f = await fixture(t)
  const commit = '183f08e9c6dde7e36cd2318eaee70b0da08fb35e'
  const sourceArchiveSHA256 = '23af26a7f422f3d3ba7ce148492e2937af3fe5cc39e8f05dd109e12dadd8262c'
  const identity = { schemaVersion: 1, repository: 'https://github.com/deepseek-ai/deepseek-harness.git', commit, sourceArchiveSHA256 }
  await writeFile(join(f.upstream, '.dsh-source-lock.json'), JSON.stringify(identity))
  await writeFile(f.lockPath, JSON.stringify({ ...identity, runtime: { source: { buildNormalization: normalizationContract(commit) } } }))
  const receipt = await patchEduworkSourceReproducibility(f)
  assert.equal(receipt.commit, commit)
  assert.equal(receipt.sourceArchiveSHA256, sourceArchiveSHA256)
  for (const file of reviewedFiles) assert.equal(hash(await readFile(join(f.upstream, file.path))), file.afterSHA256)
})

test('reviewed archive patch is byte-exact and repeatable; altered second target leaves first untouched', async t => {
  const f = await fixture(t)
  const first = join(f.upstream, reviewedFiles[0].path), second = join(f.upstream, reviewedFiles[1].path)
  const originalFirst = await readFile(first), originalSecond = await readFile(second)
  await writeFile(second, Buffer.concat([originalSecond, Buffer.from('// unexpected edit\n')]))
  await assert.rejects(patchEduworkSourceReproducibility(f), /Unreviewed build patch input/)
  assert.deepEqual(await readFile(first), originalFirst)
  await writeFile(second, originalSecond)
  const receipt = await patchEduworkSourceReproducibility(f)
  for (const file of reviewedFiles) assert.equal(hash(await readFile(join(f.upstream, file.path))), file.afterSHA256)
  assert.deepEqual(await patchEduworkSourceReproducibility(f), receipt)
  await writeFile(first, Buffer.concat([await readFile(first), Buffer.from('// tampered patch\n')]))
  await assert.rejects(patchEduworkSourceReproducibility(f), /Unreviewed build patch input/)
})

test('normalization refuses developer checkouts and a different archive identity', async t => {
  const f = await fixture(t)
  await mkdir(join(f.upstream, '.git'))
  await assert.rejects(patchEduworkSourceReproducibility(f), /developer Git checkout/)
  await rm(join(f.upstream, '.git'), { recursive: true })
  await writeFile(join(f.upstream, '.dsh-source-lock.json'), JSON.stringify({ commit: '0'.repeat(40) }))
  await assert.rejects(patchEduworkSourceReproducibility(f), /matching verified source archive/)
})

test('source and output-parent junctions are rejected before any reviewed input changes', async t => {
  const f = await fixture(t), alias = join(f.root, 'source-alias'), outside = join(f.root, 'outside')
  const first = join(f.upstream, reviewedFiles[0].path), before = await readFile(first)
  await symlink(f.upstream, alias, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(patchEduworkSourceReproducibility({ ...f, upstream: alias }), /Linked source build directory/)
  await mkdir(outside)
  await symlink(outside, join(f.upstream, '.eduwork-build'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(patchEduworkSourceReproducibility(f), /Linked build patch parent/)
  assert.deepEqual(await readFile(first), before)
})

test('packing hook stabilizes dependency order without changing versions, export condition order or arrays', () => {
  const context = { module: { exports: {} } }
  vm.runInNewContext(packingHook, context)
  const hook = context.module.exports.hooks.beforePacking
  const manifest = { name: 'fixture', dependencies: { z: '^2.0.0', a: 'npm:other@1.0.0' }, exports: { '.': { types: './types.d.ts', browser: './web.js', default: './index.js' } }, bundledDependencies: ['z', 'a'] }
  const expected = JSON.parse(JSON.stringify(manifest))
  const value = hook(manifest)
  assert.equal(JSON.stringify(value.dependencies), '{"a":"npm:other@1.0.0","z":"^2.0.0"}')
  assert.deepEqual(JSON.parse(JSON.stringify(value)), expected)
  assert.deepEqual(Object.keys(value.exports['.']), ['types', 'browser', 'default'])
  assert.deepEqual(value.bundledDependencies, ['z', 'a'])
})
