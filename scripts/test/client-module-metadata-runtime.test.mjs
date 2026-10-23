import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire, registerHooks } from 'node:module'
import { mkdtemp, mkdir, readFile, writeFile, rm, link, unlink, utimes, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { patchClientModuleMetadataRuntime, patchClientModuleMetadataSource, clientModuleMetadataPatch as patch } from '../patch-client-module-metadata-runtime.mjs'

test('rejects unreviewed client-module bytes', () => {
  assert.throws(() => patchClientModuleMetadataSource(Buffer.from('unreviewed')), /input changed/)
})

const runtime = process.env.EDUWORK_TEST_RUNTIME
test('real upstream rebuild method distinguishes backup unlink from a code rebuild', { skip: !runtime }, async t => {
  const require = createRequire(join(runtime, 'package.json'))
  const originalPath = require.resolve(patch.package)
  const original = await readFile(originalPath)
  const originalRoot = join(runtime, 'node_modules', patch.package)
  const temporary = await mkdtemp(join(tmpdir(), 'eduwork-module-metadata-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const modules = join(temporary, 'node_modules'), copy = join(modules, patch.package)
  await mkdir(join(copy, 'lib'), { recursive: true })
  const manifest = join(copy, 'package.json'), target = join(copy, patch.file)
  await writeFile(manifest, await readFile(join(originalRoot, 'package.json')))
  await writeFile(target, original)
  const receipt = await patchClientModuleMetadataRuntime(modules)
  const patched = await readFile(target)
  assert.equal(receipt.afterSHA256, createHash('sha256').update(patched).digest('hex'))
  assert.deepEqual(await readFile(originalPath), original, 'verified npm source remains unchanged')
  await assert.rejects(patchClientModuleMetadataRuntime(modules), /input changed/)
  await writeFile(manifest, JSON.stringify({ name: patch.package, version: '0.2.2', type: 'module' }))
  await assert.rejects(patchClientModuleMetadataRuntime(modules), /newly qualified/)
  assert.deepEqual(await readFile(target), patched)
  await writeFile(manifest, await readFile(join(originalRoot, 'package.json')))
  const { ClientModuleRegistry: Original } = await import(pathToFileURL(originalPath).href)
  const cordisURL = pathToFileURL(require.resolve('@deepseek-ai/cordis')).href
  const hook = registerHooks({ resolve(name, context, next) {
    return name === '@deepseek-ai/cordis'
      ? { url: cordisURL, shortCircuit: true } : next(name, context)
  } })
  let Patched
  try { Patched = (await import(pathToFileURL(target).href)).ClientModuleRegistry }
  finally { hook.deregister() }

  // Exercise the actual packaged registry methods against real files. Only
  // graph composition is a minimal fixture; no browser or loader is emulated.
  const bytes = Buffer.from('export const value = 1;')
  const stableTime = new Date('2020-01-01T00:00:00Z')
  let sequence = 0
  async function fixture(Registry) {
    const file = join(temporary, `plugin-${sequence++}.js`), backup = file + '.backup'
    await writeFile(file, bytes); await utimes(file, stableTime, stableTime); await link(file, backup)
    const record = { meta: { clientPath: file, external: [] }, baseline: Original.prototype.captureArtifactBaseline(file), bundle: bytes,
      entry: { id: 'fixture', rev: 'bootstrap' } }
    const events = []
    const registry = { table: new Map([['fixture', record]]), rebuildListeners: new Set(), graphListeners: new Set(),
      ctx: { logger: { error: error => { throw error } } },
      captureArtifactBaseline: Original.prototype.captureArtifactBaseline,
      notifyGraphChanged: Original.prototype.notifyGraphChanged,
      compose: () => ({ entries: [record.entry] }), rebuilt: Registry.prototype.rebuilt }
    Original.prototype.rebuilt.call(registry, 'fixture')
    registry.rebuildListeners.add((id, rev) => events.push({ id, rev }))
    registry.graphListeners.add(() => events.push('graph'))
    return { registry, record, file, backup, events }
  }
  const unlinkBackup = async f => {
    const before = await stat(f.file)
    await new Promise(resolve => setTimeout(resolve, 20))
    await unlink(f.backup)
    const after = await stat(f.file)
    assert.equal(before.mtimeMs, after.mtimeMs)
    assert.notEqual(before.ctimeMs, after.ctimeMs, 'exercise the same metadata change as updater cleanup')
  }
  await t.test('unpatched package publishes a false rebuild after unlink', async () => {
    const f = await fixture(Original), rev = f.record.entry.rev
    await unlinkBackup(f)
    assert.notEqual(f.registry.rebuilt('fixture'), rev)
    assert.equal(f.events.length, 2)
  })
  await t.test('unchanged bytes retain graph, revision and bundle, while baseline advances', async () => {
    const f = await fixture(Patched), rev = f.record.entry.rev, graph = f.registry.composed, bundle = f.record.bundle
    await unlinkBackup(f)
    assert.equal(f.registry.rebuilt('fixture'), rev)
    assert.equal(f.registry.rebuilt('fixture'), rev, 'repeated notification remains harmless')
    assert.equal(f.record.baseline.ctimeMs, (await stat(f.file)).ctimeMs)
    assert.equal(f.registry.composed, graph)
    assert.equal(f.record.bundle, bundle)
    assert.deepEqual(f.events, [])
    assert.equal(f.registry.rebuilt('missing'), undefined)
  })
  await t.test('same length real edit reloads even with preserved mtime, after a skipped unlink', async () => {
    const f = await fixture(Patched), rev = f.record.entry.rev
    await unlinkBackup(f); f.registry.rebuilt('fixture')
    const changed = Buffer.from('export const value = 2;')
    await writeFile(f.file, changed); await utimes(f.file, stableTime, stableTime)
    assert.notEqual(f.registry.rebuilt('fixture'), rev)
    assert.deepEqual(f.record.bundle, changed)
    assert.equal(f.events.length, 2)
    f.registry.rebuilt('fixture')
    assert.equal(f.events.length, 2, 'a completed rebuild is not published twice')
  })
  await t.test('explicit rebuild timestamp still reloads identical entry bytes for lazy chunk updates', async () => {
    const f = await fixture(Patched), rev = f.record.entry.rev
    const rebuiltTime = new Date(stableTime.getTime() + 2000)
    await utimes(f.file, rebuiltTime, rebuiltTime)
    assert.notEqual(f.registry.rebuilt('fixture'), rev)
    assert.equal(f.events.length, 2)
  })
  await t.test('missing bundle fails without publishing or replacing the current snapshot', async () => {
    const f = await fixture(Patched), entry = f.record.entry, baseline = f.record.baseline
    await unlink(f.file)
    assert.throws(() => f.registry.rebuilt('fixture'), { code: 'ENOENT' })
    assert.equal(f.record.entry, entry)
    assert.equal(f.record.baseline, baseline)
    assert.deepEqual(f.events, [])
  })
})
