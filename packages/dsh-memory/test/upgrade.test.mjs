import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { SqliteStorageBackend } from '@deepseek-ai/dsh-storage-sqlite'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryCore as LegacyCore } from './fixtures/legacy/core.js'
import { memoryDomain as legacySpec } from './fixtures/legacy/spec.js'
import { MemoryCore } from '../lib/core.js'
import { memoryDomain } from '../lib/spec.js'

const runtimeRequire = process.env.MEMORY_RUNTIME ? createRequire(path.join(path.resolve(process.env.MEMORY_RUNTIME), 'package.json')) : null
const ReaderBackend = runtimeRequire
  ? (await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-storage-sqlite')))).SqliteStorageBackend : SqliteStorageBackend
const ReaderFacility = runtimeRequire
  ? (await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-storage-domain')))).DomainFacility : DomainFacility

test('legacy alpha.5 SQLite survives package rename, reopen, correction, pin, suppression and session policy', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-memory-upgrade-'))
  const database = path.join(directory, 'memory.sqlite3')
  const open = async (spec, Core) => {
    const Backend = Core === LegacyCore ? SqliteStorageBackend : ReaderBackend
    const Facility = Core === LegacyCore ? DomainFacility : ReaderFacility
    const backend = new Backend({ path: database, journalMode: 'wal' })
    const ctx = { storage: { backend: { get: () => backend } }, emit() {}, logger: { warn() {}, error() {} } }
    const facility = new Facility(ctx, { backend: 'sqlite', routes: { local_memory: 'sqlite' } })
    const domain = await facility.open(spec)
    const core = new Core(domain.table('records'), domain.table('session_policies'), () => ({}), domain.table('tombstones'))
    return { domain, core, close: async () => { await domain.close(); await backend.close() } }
  }
  let instance
  try {
    instance = await open(legacySpec, LegacyCore)
    const policy = { enabled: true, generate: true, disableOnExternalContext: false }
    const saved = await instance.core.remember({ content: 'Legacy retained preference', sources: [{ kind: 'session', sessionId: 'old-session' }] }, policy)
    await instance.core.updateRecord(saved.stored.id, 'Corrected legacy preference')
    await instance.core.setRecordPinned(saved.stored.id, true)
    const forgotten = await instance.core.remember({ content: 'Legacy suppressed weather reminder' }, policy)
    await instance.core.removeRecord(forgotten.stored.id, 'forget')
    await instance.core.setSessionPolicy('old-session', { use_memories: false })
    const expected = instance.core.get(saved.stored.id)
    await instance.close()
    instance = await open(memoryDomain, MemoryCore)
    assert.deepEqual(instance.core.get(saved.stored.id), expected)
    assert.equal(instance.core.stats().suppressed, 1)
    assert.equal(instance.core.effectivePolicy('old-session').use, false)
    await assert.rejects(instance.core.remember({ content: 'Legacy suppressed weather reminder' }, policy), { code: 'MEMORY_SUPPRESSED' })
    const exported = JSON.parse(instance.core.exportData())
    assert.equal(exported.format, 'dsh-local-memory')
    assert.equal(exported.version, 2)
    assert.ok(exported.records[0].userPinnedAt)
    await instance.core.undoRecordUpdate(saved.stored.id)
    await instance.close()
    instance = await open(memoryDomain, MemoryCore)
    assert.equal(instance.core.get(saved.stored.id).content, 'Legacy retained preference')
    assert.ok(instance.core.get(saved.stored.id).userPinnedAt)
  } finally {
    if (instance) await instance.close()
    await rm(directory, { recursive: true, force: true })
  }
})
