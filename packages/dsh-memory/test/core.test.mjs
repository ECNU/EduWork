import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_SETTINGS,
  MemoryCore,
  MemoryPolicyError,
  boundedThreadLimit,
  encodeSessionReferenceUri,
  formatSessionReferenceMention,
  normalizeSettings,
  parseMemoriesCommand,
  redactSensitive,
  sanitizeSourceUri,
  suppressionSignature,
  tokenize,
} from '../lib/core.js'

class Table {
  constructor(entries = []) { this.map = new Map(entries) }
  get size() { return this.map.size }
  get(key) { return this.map.get(key) }
  entries() { return [...this.map.entries()][Symbol.iterator]() }
  keys() { return [...this.map.keys()][Symbol.iterator]() }
  async put(key, value) { this.map.set(key, value) }
  async delete(key) { return this.map.delete(key) }
  async update(key, fn) {
    if (!this.map.has(key)) throw new Error('missing key')
    const next = fn(this.map.get(key))
    this.map.set(key, next)
    return next
  }
}

function setup(overrides = {}) {
  const records = new Table()
  const policies = new Table()
  const tombstones = new Table()
  const settings = { ...DEFAULT_SETTINGS, enabled: true, ...overrides }
  return { records, policies, tombstones, core: new MemoryCore(records, policies, () => settings, tombstones), settings }
}

test('local Memory and prior-chat retrieval are enabled by default', () => {
  const settings = normalizeSettings({})
  assert.equal(settings.enabled, true)
  assert.equal(settings.generate_memories, true)
  assert.equal(settings.use_memories, true)
  assert.equal(settings.search_prior_chats, true)
  assert.equal(settings.disable_on_external_context, true)
})

test('session references use the canonical DSH URI without leaking raw ids', () => {
  const uri = encodeSessionReferenceUri('session private id')
  assert.match(uri, /^dsh-session:[A-Za-z0-9_-]+$/)
  assert.doesNotMatch(uri, /private/)
  assert.equal(
    Buffer.from(uri.slice('dsh-session:'.length), 'base64url').toString('utf8'),
    JSON.stringify('session private id'),
  )
  assert.match(formatSessionReferenceMention('s1', '项目]讨论'), /^@\[项目\\\]讨论\]\(dsh-session:/)
  assert.equal(boundedThreadLimit(99), 10)
  assert.equal(boundedThreadLimit('bad'), 5)
})

test('sensitive values and URL credentials are removed before persistence', () => {
  assert.equal(redactSensitive('API_KEY=abcdef1234567890 keep this'), '[REDACTED] keep this')
  assert.equal(
    sanitizeSourceUri('https://user:pass@example.edu/path?q=secret#section'),
    'https://example.edu/path',
  )
})

test('automatic tool-assisted generation is blocked while explicit user memory keeps citations', async () => {
  const { core } = setup()
  const sources = [{ kind: 'web', uri: 'https://example.edu/page?q=private', label: 'policy' }]
  await assert.rejects(
    core.remember({ content: 'The policy deadline is Friday.', sources }, {
      enabled: true, generate: true, disableOnExternalContext: true,
    }),
    error => error instanceof MemoryPolicyError && error.code === 'EXTERNAL_CONTEXT_DISABLED',
  )
  const saved = await core.remember({
    content: 'The policy deadline is Friday.', sources, intent: 'explicit-user-request',
  }, { enabled: true, generate: true, disableOnExternalContext: true })
  assert.equal(saved.stored.sources[0].uri, 'https://example.edu/page')
  assert.deepEqual(saved.stored.sources.map(source => source.kind), ['web'])
})

test('a chat-level generation opt-out blocks explicit and automatic writes', async () => {
  const { core } = setup()
  await assert.rejects(
    core.remember({ content: 'Remember this.', intent: 'explicit-user-request' }, {
      enabled: true, generate: false, disableOnExternalContext: false,
    }),
    error => error instanceof MemoryPolicyError && error.code === 'GENERATION_DISABLED',
  )
})

test('near duplicates merge tags and provenance instead of growing the store', async () => {
  const { core } = setup()
  const first = await core.remember({
    content: '测试用户偏好用中文沟通', tags: ['language'], sources: [{ kind: 'manual', label: 'first' }],
  }, { enabled: true, generate: true, disableOnExternalContext: false })
  const second = await core.remember({
    content: '测试用户偏好用中文沟通。', tags: ['preference'], sources: [{ kind: 'session', sessionId: 's1' }],
  }, { enabled: true, generate: true, disableOnExternalContext: false })
  assert.equal(first.merged, false)
  assert.equal(second.merged, true)
  assert.equal(core.stats().total, 1)
  assert.deepEqual(second.stored.tags.sort(), ['language', 'preference'])
  assert.equal(second.stored.sources.length, 2)
})

test('user corrections remain authoritative and retain one-step undo', async () => {
  const { core } = setup()
  const saved = await core.remember({ content: '测试用户偏好正式英文沟通', kind: 'preference' }, {
    enabled: true, generate: true, disableOnExternalContext: false,
  })
  const corrected = await core.updateRecord(saved.stored.id, '测试用户偏好自然的中文沟通')
  assert.equal(corrected.record.authority, 'user')
  assert.equal(corrected.record.previousContent, '测试用户偏好正式英文沟通')
  assert.ok(corrected.record.userEditedAt)
  await core.remember({ content: '测试用户偏好自然的中文沟通。', kind: 'preference' }, {
    enabled: true, generate: true, disableOnExternalContext: false,
  })
  assert.equal(core.get(saved.stored.id).content, '测试用户偏好自然的中文沟通')
  const undone = await core.undoRecordUpdate(saved.stored.id)
  assert.equal(undone.record.content, '测试用户偏好正式英文沟通')
  assert.equal(undone.record.previousContent, null)
})

test('user-retained memories survive age pruning and capacity eviction', async () => {
  const { records, core } = setup({ max_records: 16, max_unused_days: 1 })
  const policy = { enabled: true, generate: true, disableOnExternalContext: false }
  const retained = await core.remember({ content: '用户要求永久保留的工作偏好' }, policy)
  const pinned = await core.setRecordPinned(retained.stored.id, true)
  assert.equal(pinned.updated, true)
  assert.ok(pinned.record.userPinnedAt)
  records.map.set(retained.stored.id, { ...core.get(retained.stored.id), updatedAt: '2000-01-01T00:00:00.000Z' })

  const ordinaryRecords = []
  for (let index = 0; index < 15; index += 1) {
    ordinaryRecords.push((await core.remember({ content: `ordinary-capacity-${index}-7f1c6a9b${index}` }, policy)).stored)
  }
  await core.remember({ content: 'ordinary-capacity-new-4c2e8d91' }, policy)
  assert.ok(core.get(retained.stored.id), 'retained memory must survive pruning and eviction')
  assert.equal(core.get(ordinaryRecords[0].id), undefined, 'an ordinary memory should make room first')

  const exported = core.exportData()
  const target = setup({ max_records: 10 })
  await target.core.importData(exported)
  assert.ok(target.core.list().find(record => record.content === '用户要求永久保留的工作偏好').userPinnedAt)

  const unpinned = await core.setRecordPinned(retained.stored.id, false)
  assert.equal(unpinned.record.userPinnedAt, null)
})

test('capacity fails closed when every stored memory is user-retained', async () => {
  const { core } = setup({ max_records: 16 })
  const policy = { enabled: true, generate: true, disableOnExternalContext: false }
  const retained = []
  for (let index = 0; index < 16; index += 1) {
    const record = await core.remember({ content: `all-retained-${index}-9d3a1f6c${index}` }, policy)
    await core.setRecordPinned(record.stored.id, true)
    retained.push(record.stored.id)
  }
  await assert.rejects(
    core.remember({ content: 'capacity-after-all-retained-5b8e2c70' }, policy),
    error => error instanceof MemoryPolicyError && error.code === 'CAPACITY_PROTECTED',
  )
  assert.equal(core.get(retained[0]).content, 'all-retained-0-9d3a1f6c0')
})

test('ordinary deletion permits relearning while forget leaves only a suppression fingerprint', async () => {
  const { core, tombstones } = setup()
  const input = { content: '测试用户不需要每周天气提醒', kind: 'preference' }
  const policy = { enabled: true, generate: true, disableOnExternalContext: false }
  const first = await core.remember(input, policy)
  const deleted = await core.removeRecord(first.stored.id, 'delete')
  assert.equal(deleted.deleted, true)
  assert.equal(tombstones.map.size, 0)
  const relearned = await core.remember(input, policy)
  const forgotten = await core.removeRecord(relearned.stored.id, 'forget')
  assert.equal(forgotten.deleted, true)
  assert.equal(tombstones.map.size, 1)
  assert.doesNotMatch(JSON.stringify([...tombstones.map.values()]), /每周天气提醒/)
  await assert.rejects(
    core.remember({ ...input, content: '测试用户不需要每周天气提醒。' }, policy),
    error => error instanceof MemoryPolicyError && error.code === 'MEMORY_SUPPRESSED',
  )
  const explicit = await core.remember({ ...input, intent: 'explicit-user-request' }, policy)
  assert.equal(explicit.stored.authority, 'user')
  assert.equal(tombstones.map.size, 0)
})

test('forgotten records can be restored during the undo window', async () => {
  const { core, tombstones } = setup()
  const saved = await core.remember({ content: '测试可撤销遗忘' }, {
    enabled: true, generate: true, disableOnExternalContext: false,
  })
  const removed = await core.removeRecord(saved.stored.id, 'forget')
  assert.equal(core.get(saved.stored.id), undefined)
  await core.restoreRemoval({ record: removed.record, tombstone: removed.tombstone })
  assert.equal(core.get(saved.stored.id).content, '测试可撤销遗忘')
  assert.equal(tombstones.map.size, 0)
  assert.equal(suppressionSignature('同一事实').fingerprint, suppressionSignature('同一事实。').fingerprint)
})

test('memory manager search is bounded to semantic records', async () => {
  const { core } = setup()
  const policy = { enabled: true, generate: true, disableOnExternalContext: false }
  await core.remember({ content: '用户偏好中文', tags: ['language'] }, policy)
  await core.remember({ content: '项目采用 SQLite', tags: ['storage'] }, policy)
  assert.equal(core.listResult({ query: '中文' }).total, 1)
  assert.equal(core.listResult({ query: 'storage' }).items[0].content, '项目采用 SQLite')
})

test('memory manager pagination returns only the requested bounded window', () => {
  const { records, core } = setup()
  for (let index = 0; index < 23; index += 1) {
    records.map.set(`m${index}`, {
      id: `m${index}`, content: `page-item-${index}`, tags: [],
      updatedAt: new Date(index * 1_000).toISOString(),
    })
  }
  const result = core.listResult({ limit: 10, offset: 10 })
  assert.equal(result.total, 23)
  assert.equal(result.offset, 10)
  assert.equal(result.limit, 10)
  assert.equal(result.items.length, 10)
  assert.deepEqual(result.items.map(record => record.id), ['m12', 'm11', 'm10', 'm9', 'm8', 'm7', 'm6', 'm5', 'm4', 'm3'])
  assert.equal(core.listResult({ limit: 1_000 }).items.length, 23)
  assert.equal(core.listResult({ limit: 1_000 }).limit, 50)
})

test('CJK bigrams make Chinese memories recallable and expose citations', async () => {
  const { core } = setup()
  assert.ok(tokenize('数据治理').includes('数据'))
  await core.remember({
    content: '示例项目采用产品数据管理流程', kind: 'fact',
    sources: [{ kind: 'file', uri: 'file:///C:/workspace/profile.md', label: 'profile' }],
  }, { enabled: true, generate: true, disableOnExternalContext: false })
  const result = await core.recall({ query: '产品数据管理', limit: 3 })
  assert.equal(result.results.length, 1)
  assert.match(result.results[0].citations[0], /^file:\/\/\/C:\/workspace\/profile\.md$/i)
  assert.deepEqual((await core.recall({ query: '完全无关的天气' })).results, [])
})

test('per-chat overrides inherit global settings and can be reset', async () => {
  const { core } = setup()
  assert.equal(core.effectivePolicy('chat-1').use, true)
  await core.setSessionPolicy('chat-1', { use_memories: false })
  assert.equal(core.effectivePolicy('chat-1').use, false)
  assert.equal(core.effectivePolicy('chat-1').generate, true)
  await core.setSessionPolicy('chat-1', { use_memories: null, generate_memories: null })
  assert.equal(core.effectivePolicy('chat-1').session.updatedAt, null)
})

test('portable export includes the complete bounded store', () => {
  const { records, core } = setup({ max_records: 1_000 })
  for (let index = 0; index < 501; index += 1) {
    records.map.set(`m${index}`, { id: `m${index}`, updatedAt: new Date(index).toISOString() })
  }
  const document = JSON.parse(core.exportData())
  assert.equal(document.format, 'dsh-local-memory')
  assert.equal(document.version, 2)
  assert.equal(document.records.length, 501)
})

test('/memories grammar is explicit and bounded', () => {
  assert.deepEqual(parseMemoriesCommand(''), { kind: 'status' })
  assert.deepEqual(parseMemoriesCommand('off'), { kind: 'off' })
  assert.deepEqual(parseMemoriesCommand('use inherit'), { kind: 'field', field: 'use_memories', value: null })
  assert.deepEqual(parseMemoriesCommand('generate on'), { kind: 'field', field: 'generate_memories', value: true })
  assert.deepEqual(parseMemoriesCommand('search off'), { kind: 'field', field: 'search_prior_chats', value: false })
  assert.deepEqual(parseMemoriesCommand('delete everything'), { kind: 'invalid' })
})
