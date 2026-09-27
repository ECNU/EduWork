import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { zstdCompressSync } from 'node:zlib'
import { DataImporter } from '../lib/data-import.js'
import { loadImportFormats, findSessionCandidates, prepareImportCatalogs, inspectSession } from '../lib/import-inspection.js'

const runtime = process.env.EDUWORK_TEST_RUNTIME
async function fixture(t) {
  const require = createRequire(join(runtime, 'package.json')), load = name => import(pathToFileURL(require.resolve(name)))
  const [{ Context }, { default: Jsonl }, formats] = await Promise.all([
    load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-session-persistence-jsonl'), loadImportFormats(load),
  ])
  if (formats.currentVersion < 4) { t.skip('V4 corpus migration requires the native candidate Runtime'); return }
  const root = await mkdtemp(join(tmpdir(), 'eduwork-import-corpus-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'old'), sourceHome = join(source, 'data/dsh'), home = join(root, 'new'), cwd = join(root, 'workspace')
  await mkdir(home); await mkdir(cwd)
  const openStore = async path => {
    const ctx = new Context(); await ctx.plugin(Jsonl, { root: path, compression: 'zstd' })
    return { persistence: ctx.sessionPersistence, close: () => ctx.fiber.dispose() }
  }
  const target = await openStore(join(home, 'sessions'))
  const importer = new DataImporter({ home, persistence: target.persistence, openStore, loadFormats: () => loadImportFormats(load) })
  t.after(async () => { await importer.close(); await target.close() })
  const originals = new Map()
  async function write(id, { version = 3, parent, seeded = false, events = [], at = 100, otherHome = sourceHome } = {}) {
    let header = { type: 'session', version, id, createdAt: at, cwd, delegationDepth: parent ? 1 : 0, agentPreset: 'standard',
      ...(parent ? { parentSession: parent, origin: 'subagent' } : {}) }
    if (version >= 2) header.isSeeded = seeded
    if (version === 4) { const { type, ...logical } = header; header = formats.encodeCurrentHeader(logical, 0) }
    const bytes = zstdCompressSync(Buffer.from([header, ...events].map(row => JSON.stringify(row)).join('\n') + '\n'))
    const dir = join(otherHome, 'sessions', 'project', id); await mkdir(dir, { recursive: true })
    const path = join(dir, version ? `session.v${version}.jsonl.zstd` : 'session.jsonl.zstd')
    await writeFile(path, bytes); originals.set(path, bytes); return path
  }
  const read = async id => {
    const handle = await target.persistence.open(id, 'read')
    try { return { header: handle.header, inheritedEventCount: handle.inheritedEventCount, ...(await handle.read()) } }
    finally { await handle.close() }
  }
  const preview = async () => { importer.preview(source); await importer.running; return importer.status() }
  const run = async () => { const job = await preview(); assert.equal(job.state, 'ready', JSON.stringify(job)); importer.start(job.id); await importer.running; return importer.status() }
  return { root, source, sourceHome, home, cwd, target, importer, formats, originals, write, read, preview, run }
}
const descriptor = (seq, label, provider = 'spawn') => ({ type: 'subagent/descriptor', seq, time: 100 + seq,
  data: { version: 3, provider, mode: 'continuable', label } })
const catalog = artifact => artifact.events.filter(event => event.type === 'subagent/catalog').map(event => event.data)

test('imports V0–V4 with direct children, nested/forked subagents and repeat-safe source preservation', { skip: !runtime }, async t => {
  const f = await fixture(t); if (!f) return
  for (const version of [0, 1, 2, 3, 4]) await f.write(`standalone-${version}`, { version })
  await f.write('parent')
  await f.write('child', { parent: 'parent', at: 200, events: [descriptor(0, 'Child')] })
  await f.write('fork', { parent: 'child', at: 300, seeded: true, events: [
    descriptor(0, 'Ancestor descriptor'),
    { type: 'session/end-seed', seq: 1, time: 101, data: { inherited: true } },
    descriptor(2, 'Own fork descriptor', 'fork'),
  ] })
  await f.write('native-child', { version: 4, parent: 'parent', at: 201, events: [descriptor(0, 'Native child')] })
  const prepared = await f.preview()
  assert.equal(prepared.total, 9, JSON.stringify(prepared)); assert.equal(prepared.excluded, 0)
  assert.equal((await f.target.persistence.list()).length, 0, 'preview never writes live sessions')
  f.importer.start(prepared.id); await f.importer.running
  assert.equal(f.importer.status().imported, 9, JSON.stringify(f.importer.status()))
  assert.deepEqual(catalog(await f.read('parent')).map(row => [row.childId, row.label]), [['child', 'Child'], ['native-child', 'Native child']])
  assert.deepEqual(catalog(await f.read('child')).map(row => [row.childId, row.label]), [['fork', 'Own fork descriptor']])
  const fork = await f.read('fork'); assert.equal(fork.header.parentSession, 'child'); assert.equal(fork.inheritedEventCount, 1)
  for (const version of [0, 1, 2, 3, 4]) assert.deepEqual(catalog(await f.read(`standalone-${version}`)), [])
  const repeated = await f.run(); assert.equal(repeated.imported, 0); assert.equal(repeated.skipped, 9, JSON.stringify(repeated))
  for (const [path, bytes] of f.originals) assert.deepEqual(await readFile(path), bytes)
})

test('unreadable child remains explicit unknown evidence without blocking its healthy parent and sibling', { skip: !runtime }, async t => {
  const f = await fixture(t); if (!f) return
  await f.write('parent')
  await f.write('good', { parent: 'parent', events: [descriptor(0, 'Good child')] })
  const bad = await f.write('bad', { parent: 'parent' })
  await writeFile(bad, Buffer.concat([await readFile(bad), zstdCompressSync(Buffer.from('{broken\n'))]))
  const job = await f.run(); assert.equal(job.imported, 2, JSON.stringify(job)); assert.equal(job.excluded, 1)
  assert.ok(job.issues[0].reason.includes('第 2 行'))
  assert.deepEqual(catalog(await f.read('parent')).map(row => [row.childId, row.mode]), [['bad', 'unknown'], ['good', 'continuable']])
})

test('isolates source-home child inventories and detects related files changed after inspection', { skip: !runtime }, async t => {
  const f = await fixture(t); if (!f) return
  await f.write('parent')
  const child = await f.write('child', { parent: 'parent', events: [descriptor(0, 'Own child')] })
  const otherHome = join(f.source, 'data/other-electron/dsh')
  await f.write('parent', { otherHome })
  await f.write('other-child', { otherHome, parent: 'parent', events: [descriptor(0, 'Other home')] })
  for (const [home, expected] of [[f.sourceHome, 'child'], [otherHome, 'other-child']]) {
    const { groups } = await findSessionCandidates(home)
    const prepared = await prepareImportCatalogs(groups, f.formats, async () => {})
    const parent = groups.map(group => group[0]).find(row => row.path.includes(`${join('project', 'parent')}`))
    assert.deepEqual(catalog(await inspectSession(parent, prepared.forSession(parent))).map(row => row.childId), [expected])
    if (home === f.sourceHome) {
      await writeFile(child, Buffer.concat([await readFile(child), zstdCompressSync(Buffer.from('\n'))]))
      await assert.rejects(prepared.validate(), /来源文件发生变化/)
    }
  }
})

test('a child added while staging invalidates the preview instead of declaring an incomplete family', { skip: !runtime }, async t => {
  const f = await fixture(t); if (!f) return
  await f.write('parent')
  const openStore = f.importer.openStore
  let added = false
  f.importer.openStore = async path => {
    if (!added) { added = true; await f.write('late-child', { parent: 'parent', events: [descriptor(0, 'Late child')] }) }
    return openStore(path)
  }
  const job = await f.preview()
  assert.equal(job.state, 'error'); assert.match(job.message, /来源会话目录发生变化/)
  assert.equal((await f.target.persistence.list()).length, 0)
  assert.equal(f.importer.prepared, null)
})
