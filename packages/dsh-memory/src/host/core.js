import { createHash, randomUUID } from 'node:crypto'

export const MEMORY_KINDS = Object.freeze(['fact', 'preference', 'decision', 'lesson', 'todo', 'note'])
export const MEMORY_SCOPES = Object.freeze(['user', 'project'])
export const SOURCE_KINDS = Object.freeze(['session', 'web', 'file', 'email', 'tool', 'manual', 'other'])

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  generate_memories: true,
  use_memories: true,
  search_prior_chats: true,
  // Product policy: external evidence may be cited, but tool-assisted chats
  // do not create memories automatically until the user opts in.
  disable_on_external_context: true,
  max_raw_memories_for_consolidation: 256,
  max_rollout_age_days: 30,
  max_rollouts_per_startup: 16,
  max_unused_days: 30,
  min_rate_limit_remaining_percent: 25,
  min_rollout_idle_hours: 6,
  max_records: 400,
})

const MAX_CONTENT_CHARS = 2_000
const MAX_TAGS = 16
const MAX_SOURCES = 12
const DUPLICATE_SIMILARITY = 0.82
const SUPPRESSION_SIMILARITY = 0.9

export class MemoryPolicyError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'MemoryPolicyError'
    this.code = code
  }
}

export function normalizeSettings(raw = {}) {
  const integer = (key, min, max) => {
    const value = Number(raw[key])
    return Number.isSafeInteger(value) && value >= min && value <= max ? value : DEFAULT_SETTINGS[key]
  }
  return Object.freeze({
    enabled: raw.enabled !== false,
    generate_memories: raw.generate_memories !== false,
    use_memories: raw.use_memories !== false,
    search_prior_chats: raw.search_prior_chats !== false,
    disable_on_external_context: raw.disable_on_external_context !== false,
    max_raw_memories_for_consolidation: integer('max_raw_memories_for_consolidation', 1, 10_000),
    max_rollout_age_days: integer('max_rollout_age_days', 1, 3650),
    max_rollouts_per_startup: integer('max_rollouts_per_startup', 1, 10_000),
    max_unused_days: integer('max_unused_days', 1, 3650),
    min_rate_limit_remaining_percent: integer('min_rate_limit_remaining_percent', 0, 100),
    min_rollout_idle_hours: integer('min_rollout_idle_hours', 0, 8760),
    max_records: integer('max_records', 16, 10_000),
  })
}

export function redactSensitive(value) {
  let text = String(value ?? '').normalize('NFKC').trim()
  const patterns = [
    /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/giu,
    /\b(?:authorization\s*:\s*)?bearer\s+[a-z0-9._~+\/-]{12,}/giu,
    /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret)\s*[:=]\s*["']?[^\s,"']{6,}["']?/giu,
    /\b(?:sk|rk|pk)-[a-z0-9_-]{16,}\b/giu,
  ]
  for (const pattern of patterns) text = text.replace(pattern, '[REDACTED]')
  return text.slice(0, MAX_CONTENT_CHARS).trim()
}

function boundedString(value, max) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().slice(0, max) : ''
}

function normalizeTags(values) {
  if (!Array.isArray(values)) return []
  return [...new Set(values.map(value => boundedString(String(value), 48).toLowerCase()).filter(Boolean))].slice(0, MAX_TAGS)
}

export function sanitizeSourceUri(value) {
  const raw = boundedString(value, 4_096)
  if (raw === '') return null
  try {
    const url = new URL(raw)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    if (!['http:', 'https:', 'file:', 'mailto:'].includes(url.protocol)) return raw.split(/[?#]/u, 1)[0]
    return url.toString()
  } catch {
    return raw
  }
}

function sourceKey(source) {
  return [source.kind, source.uri, source.sessionId, source.messageId, source.eventSeq, source.toolName, source.callId]
    .map(value => value ?? '').join('\0')
}

export function normalizeSources(values, capturedAt = new Date().toISOString()) {
  if (!Array.isArray(values)) return []
  const sources = []
  const seen = new Set()
  for (const value of values) {
    if (typeof value !== 'object' || value === null) continue
    const kind = SOURCE_KINDS.includes(value.kind) ? value.kind : 'other'
    const source = {
      kind,
      uri: sanitizeSourceUri(value.uri),
      label: boundedString(redactSensitive(value.label), 256) || null,
      sessionId: boundedString(value.sessionId, 256) || null,
      messageId: boundedString(value.messageId, 256) || null,
      eventSeq: Number.isSafeInteger(value.eventSeq) && value.eventSeq >= 0 ? value.eventSeq : null,
      toolName: boundedString(value.toolName, 128) || null,
      callId: boundedString(value.callId, 256) || null,
      capturedAt: typeof value.capturedAt === 'string' && !Number.isNaN(Date.parse(value.capturedAt))
        ? value.capturedAt : capturedAt,
    }
    const key = sourceKey(source)
    if (seen.has(key)) continue
    seen.add(key)
    sources.push(source)
    if (sources.length >= MAX_SOURCES) break
  }
  return sources
}

export function hasExternalSources(sources) {
  return sources.some(source => ['web', 'file', 'email', 'tool'].includes(source.kind))
}

export function tokenize(value) {
  const normalized = String(value ?? '').normalize('NFKC').toLowerCase()
  const tokens = []
  for (const word of normalized.match(/[\p{L}\p{N}_-]+/gu) ?? []) {
    if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u.test(word)) {
      const chars = [...word]
      tokens.push(...chars)
      for (let index = 0; index + 1 < chars.length; index += 1) tokens.push(chars[index] + chars[index + 1])
    } else if (word.length > 1) {
      tokens.push(word)
    }
  }
  return tokens
}

export function tokenSimilarity(left, right) {
  const a = new Set(tokenize(left))
  const b = new Set(tokenize(right))
  if (a.size === 0 || b.size === 0) return 0
  let overlap = 0
  for (const token of a) if (b.has(token)) overlap += 1
  return overlap / (a.size + b.size - overlap)
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function digest(value) {
  return createHash('sha256').update(value).digest('base64url')
}

function suppressionTokens(value) {
  const tokens = [...new Set(tokenize(value))]
  const meaningful = tokens.filter(token => [...token].length > 1)
  return (meaningful.length > 0 ? meaningful : tokens).sort().slice(0, 256)
}

export function suppressionSignature(value) {
  const tokenHashes = suppressionTokens(value).map(token => digest(token))
  return {
    fingerprint: digest(tokenHashes.join('\0')),
    tokenHashes,
  }
}

function hashSetSimilarity(left, right) {
  const a = new Set(left)
  const b = new Set(right)
  if (a.size === 0 || b.size === 0) return 0
  let overlap = 0
  for (const token of a) if (b.has(token)) overlap += 1
  return overlap / (a.size + b.size - overlap)
}

function validKind(value) {
  return MEMORY_KINDS.includes(value) ? value : 'note'
}

function validScope(value) {
  return MEMORY_SCOPES.includes(value) ? value : 'user'
}

function normalizedImportance(value) {
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= 3 ? numeric : 2
}

function recordScore(record, query, now) {
  const queryTokens = new Set(tokenize(query))
  if (queryTokens.size === 0) return 0
  const corpus = tokenize(`${record.content} ${record.tags.join(' ')}`)
  let overlap = 0
  for (const token of new Set(corpus)) if (queryTokens.has(token)) overlap += 1
  const phrase = record.content.toLowerCase().includes(query.toLowerCase())
  if (overlap === 0 && !phrase) return 0
  const lexical = overlap / queryTokens.size
  const ageDays = Math.max(0, now - Date.parse(record.updatedAt)) / 86_400_000
  const recency = Math.exp(-ageDays / 90) * 0.12
  const importance = record.importance * 0.08
  const use = Math.min(record.accessCount, 20) * 0.005
  return lexical + (phrase ? 0.35 : 0) + recency + importance + use
}

function sourceLabel(source) {
  if (source.uri) return source.uri
  if (source.kind === 'tool' && source.toolName) return `${source.toolName}${source.callId ? `#${source.callId}` : ''}`
  if (source.kind === 'session' && source.sessionId) {
    return `${source.sessionId}${source.eventSeq === null ? '' : `:${source.eventSeq}`}`
  }
  return source.label ?? source.kind
}

export function citeSources(sources) {
  return sources.map(sourceLabel)
}

export function encodeSessionReferenceUri(sessionId) {
  const payload = Buffer.from(JSON.stringify(String(sessionId ?? '')), 'utf8').toString('base64url')
  return `dsh-session:${payload}`
}

export function formatSessionReferenceMention(sessionId, label = sessionId) {
  const safeLabel = boundedString(redactSensitive(label), 256).replace(/[\\\]]/gu, match => `\\${match}`)
  return `@[${safeLabel || String(sessionId)}](${encodeSessionReferenceUri(sessionId)})`
}

export function boundedThreadLimit(value, fallback = 5, max = 10) {
  const numeric = Number(value)
  return Number.isSafeInteger(numeric) && numeric >= 1 ? Math.min(numeric, max) : fallback
}

export class MemoryCore {
  constructor(records, sessionPolicies, settings, tombstones) {
    this.records = records
    this.sessionPolicies = sessionPolicies
    this.settings = settings
    this.tombstones = tombstones
  }

  currentSettings() {
    return normalizeSettings(this.settings())
  }

  stats() {
    const byKind = Object.fromEntries(MEMORY_KINDS.map(kind => [kind, 0]))
    for (const [, record] of this.records.entries()) byKind[record.kind] += 1
    return { total: this.records.size, suppressed: this.tombstones.size, byKind }
  }

  list({ query = '', limit = 100, offset = 0 } = {}) {
    const text = boundedString(query, 2_000).toLowerCase()
    const queryTokens = new Set(tokenize(text))
    const matches = record => {
      if (text === '') return true
      if (`${record.content} ${record.tags.join(' ')}`.toLowerCase().includes(text)) return true
      const corpus = new Set(tokenize(`${record.content} ${record.tags.join(' ')}`))
      for (const token of queryTokens) if (corpus.has(token)) return true
      return false
    }
    return [...this.records.entries()]
      .map(([, record]) => clone(record))
      .filter(matches)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(Math.max(0, offset), Math.max(0, offset) + Math.min(10_000, Math.max(1, limit)))
  }

  listResult({ query = '', limit = 10, offset = 0 } = {}) {
    const boundedLimit = Math.min(50, Math.max(1, Number.isSafeInteger(limit) ? limit : 10))
    const boundedOffset = Math.max(0, Number.isSafeInteger(offset) ? offset : 0)
    const total = this.list({ query, limit: 10_000 }).length
    return { total, offset: boundedOffset, limit: boundedLimit, items: this.list({ query, limit: boundedLimit, offset: boundedOffset }) }
  }

  get(id) {
    const record = this.records.get(id)
    return record === undefined ? undefined : clone(record)
  }

  async remember(input, policy = {}) {
    const content = redactSensitive(input.content)
    if (content === '' || content === '[REDACTED]') {
      throw new MemoryPolicyError('EMPTY_AFTER_REDACTION', '记忆内容为空，或仅包含已移除的敏感信息。')
    }
    const now = new Date().toISOString()
    const sources = normalizeSources([...(policy.sources ?? []), ...(input.sources ?? [])], now)
    const intent = input.intent === 'explicit-user-request' ? 'explicit-user-request' : 'automatic'
    const userPinnedAt = intent === 'explicit-user-request'
      && typeof input.userPinnedAt === 'string' && !Number.isNaN(Date.parse(input.userPinnedAt))
      ? input.userPinnedAt : null
    if (policy.enabled === false) throw new MemoryPolicyError('MEMORY_DISABLED', '本地 Memory 当前已关闭。')
    if (policy.generate === false) {
      throw new MemoryPolicyError('GENERATION_DISABLED', '当前对话不参与 Memory 生成。')
    }
    if (intent === 'automatic' && policy.disableOnExternalContext === true && hasExternalSources(sources)) {
      throw new MemoryPolicyError('EXTERNAL_CONTEXT_DISABLED', '当前设置不允许从使用工具或外部来源的对话自动生成 Memory；用户明确要求记住时仍可保存。')
    }

    const tags = normalizeTags(input.tags)
    const scope = validScope(input.scope)
    const project = scope === 'project' ? boundedString(input.project, 4_096) || null : null
    if (scope === 'project' && project === null) {
      throw new MemoryPolicyError('PROJECT_REQUIRED', '项目级 Memory 需要项目路径。')
    }
    const suppressions = this.matchingTombstones(content, scope, project)
    if (suppressions.length > 0 && intent !== 'explicit-user-request') {
      throw new MemoryPolicyError('MEMORY_SUPPRESSED', '这条内容已被用户标记为遗忘，不会从旧对话自动重新生成。')
    }
    if (intent === 'explicit-user-request') {
      for (const [id] of suppressions) await this.tombstones.delete(id)
    }
    const candidates = [...this.records.entries()].filter(([, record]) => record.scope === scope && record.project === project)
    let duplicate
    let bestSimilarity = 0
    for (const pair of candidates) {
      const similarity = tokenSimilarity(pair[1].content, content)
      if (similarity > bestSimilarity) {
        duplicate = pair
        bestSimilarity = similarity
      }
    }
    if (duplicate !== undefined && bestSimilarity >= DUPLICATE_SIMILARITY) {
      const [id, previous] = duplicate
      const previousIsUserAuthoritative = previous.authority === 'user'
        || previous.origin === 'explicit-user-request' || Boolean(previous.userEditedAt)
      const nextContent = previousIsUserAuthoritative && intent !== 'explicit-user-request'
        ? previous.content
        : content.length >= previous.content.length ? content : previous.content
      const merged = {
        ...previous,
        content: nextContent,
        kind: validKind(input.kind ?? previous.kind),
        tags: normalizeTags([...previous.tags, ...tags]),
        importance: Math.max(previous.importance, normalizedImportance(input.importance)),
        sources: normalizeSources([...previous.sources, ...sources], now),
        origin: previous.origin === 'explicit-user-request' || intent === 'explicit-user-request'
          ? 'explicit-user-request' : previous.origin,
        authority: previousIsUserAuthoritative || intent === 'explicit-user-request' ? 'user' : 'automatic',
        userPinnedAt: previous.userPinnedAt ?? userPinnedAt,
        revision: (previous.revision ?? 1) + 1,
        updatedAt: now,
      }
      await this.records.put(id, merged)
      return { stored: clone(merged), merged: true, similarity: bestSimilarity }
    }

    await this.pruneUnused(now)
    await this.reserveCapacity()
    const id = `mem_${randomUUID()}`
    const record = {
      id,
      content,
      kind: validKind(input.kind),
      tags,
      scope,
      project,
      importance: normalizedImportance(input.importance),
      sources,
      origin: intent,
      authority: intent === 'explicit-user-request' ? 'user' : 'automatic',
      userEditedAt: typeof input.userEditedAt === 'string' && !Number.isNaN(Date.parse(input.userEditedAt))
        ? input.userEditedAt : null,
      userPinnedAt,
      previousContent: null,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      accessedAt: null,
      accessCount: 0,
    }
    await this.records.put(id, record)
    return { stored: clone(record), merged: false, similarity: 0 }
  }

  matchingTombstones(content, scope, project) {
    const signature = suppressionSignature(content)
    return [...this.tombstones.entries()].filter(([, tombstone]) => {
      if (tombstone.scope !== scope || tombstone.project !== project) return false
      return tombstone.fingerprint === signature.fingerprint
        || hashSetSimilarity(tombstone.tokenHashes, signature.tokenHashes) >= SUPPRESSION_SIMILARITY
    })
  }

  async updateRecord(id, content) {
    const key = String(id ?? '')
    const previous = this.records.get(key)
    if (previous === undefined) throw new MemoryPolicyError('MEMORY_NOT_FOUND', '这条 Memory 已不存在。')
    const nextContent = redactSensitive(content)
    if (nextContent === '' || nextContent === '[REDACTED]') {
      throw new MemoryPolicyError('EMPTY_AFTER_REDACTION', '记忆内容为空，或仅包含已移除的敏感信息。')
    }
    if (nextContent === previous.content) return { updated: false, record: clone(previous) }
    const now = new Date().toISOString()
    const updated = {
      ...previous,
      content: nextContent,
      authority: 'user',
      userEditedAt: now,
      previousContent: previous.content,
      revision: (previous.revision ?? 1) + 1,
      updatedAt: now,
    }
    await this.records.put(key, updated)
    return { updated: true, record: clone(updated) }
  }

  async setRecordPinned(id, pinned) {
    const key = String(id ?? '')
    const current = this.records.get(key)
    if (current === undefined) throw new MemoryPolicyError('MEMORY_NOT_FOUND', '找不到这条 Memory。')
    const shouldPin = pinned === true
    const isPinned = typeof current.userPinnedAt === 'string'
    if (shouldPin === isPinned) return { updated: false, record: clone(current) }
    const now = new Date().toISOString()
    const updated = {
      ...current,
      userPinnedAt: shouldPin ? now : null,
      updatedAt: now,
      revision: (current.revision ?? 1) + 1,
    }
    await this.records.put(key, updated)
    return { updated: true, record: clone(updated) }
  }

  async undoRecordUpdate(id) {
    const key = String(id ?? '')
    const current = this.records.get(key)
    if (current === undefined) throw new MemoryPolicyError('MEMORY_NOT_FOUND', '这条 Memory 已不存在。')
    if (typeof current.previousContent !== 'string' || current.previousContent === '') {
      return { updated: false, record: clone(current) }
    }
    const restored = {
      ...current,
      content: current.previousContent,
      previousContent: null,
      authority: 'user',
      userEditedAt: new Date().toISOString(),
      revision: (current.revision ?? 1) + 1,
      updatedAt: new Date().toISOString(),
    }
    await this.records.put(key, restored)
    return { updated: true, record: clone(restored) }
  }

  async recall({ query, project, limit = 5, touch = false } = {}) {
    const text = boundedString(query, 2_000)
    if (text === '') return { query: '', results: [] }
    const now = Date.now()
    const matching = [...this.records.entries()]
      .filter(([, record]) => record.scope === 'user' || (project && record.project === project))
      .map(([id, record]) => ({ id, record, score: recordScore(record, text, now) }))
      .filter(result => result.score >= 0.22)
      .sort((left, right) => right.score - left.score || right.record.updatedAt.localeCompare(left.record.updatedAt))
      .slice(0, Math.min(20, Math.max(1, Number(limit) || 5)))

    if (touch) {
      const timestamp = new Date(now).toISOString()
      for (const { id } of matching) {
        await this.records.update(id, current => ({
          ...current, accessedAt: timestamp, accessCount: current.accessCount + 1,
        }))
      }
    }
    return {
      query: text,
      results: matching.map(({ record, score }) => ({
        ...clone(record),
        score: Number(score.toFixed(6)),
        citations: citeSources(record.sources),
      })),
    }
  }

  async removeRecord(id, mode = 'delete') {
    const key = String(id ?? '')
    const record = this.records.get(key)
    if (record === undefined) return { id: key, deleted: false, mode, record: null, tombstone: null }
    if (mode !== 'forget') {
      return { id: key, deleted: await this.records.delete(key), mode: 'delete', record: clone(record), tombstone: null }
    }
    const signature = suppressionSignature(record.content)
    const tombstone = {
      id: `forgot_${randomUUID()}`,
      fingerprint: signature.fingerprint,
      tokenHashes: signature.tokenHashes,
      scope: record.scope,
      project: record.project,
      sourceRecordId: record.id,
      reason: 'user-forgotten',
      createdAt: new Date().toISOString(),
    }
    await this.tombstones.put(tombstone.id, tombstone)
    try {
      const deleted = await this.records.delete(key)
      if (!deleted) await this.tombstones.delete(tombstone.id)
      return { id: key, deleted, mode: 'forget', record: clone(record), tombstone: clone(tombstone) }
    } catch (error) {
      await this.tombstones.delete(tombstone.id).catch(() => {})
      throw error
    }
  }

  async forget(id) {
    return (await this.removeRecord(id, 'forget')).deleted
  }

  async restoreRemoval(snapshot) {
    if (snapshot?.record === null || typeof snapshot?.record !== 'object') {
      throw new MemoryPolicyError('UNDO_INVALID', '无法恢复这条 Memory。')
    }
    const id = String(snapshot.record.id ?? '')
    if (id === '' || this.records.get(id) !== undefined) {
      throw new MemoryPolicyError('UNDO_CONFLICT', '原位置已有 Memory，无法恢复。')
    }
    if (snapshot.tombstone?.id) await this.tombstones.delete(snapshot.tombstone.id)
    try {
      await this.records.put(id, snapshot.record)
    } catch (error) {
      if (snapshot.tombstone?.id) await this.tombstones.put(snapshot.tombstone.id, snapshot.tombstone).catch(() => {})
      throw error
    }
    return clone(snapshot.record)
  }

  async deleteAll() {
    let deleted = 0
    for (const id of [...this.records.keys()]) if (await this.records.delete(id)) deleted += 1
    for (const id of [...this.tombstones.keys()]) await this.tombstones.delete(id)
    return { deleted, ...this.stats() }
  }

  exportData() {
    return JSON.stringify({
      format: 'dsh-local-memory',
      version: 2,
      exportedAt: new Date().toISOString(),
      records: this.list({ limit: 10_000 }),
    }, null, 2)
  }

  async importData(document) {
    if (typeof document !== 'string' || document.length > 8_000_000) {
      throw new MemoryPolicyError('IMPORT_TOO_LARGE', 'Memory 导入文件必须是小于 8 MB 的 JSON。')
    }
    let parsed
    try {
      parsed = JSON.parse(document)
    } catch {
      throw new MemoryPolicyError('IMPORT_INVALID_JSON', 'Memory 导入文件不是有效 JSON。')
    }
    const rows = Array.isArray(parsed) ? parsed : parsed?.records
    if (!Array.isArray(rows)) throw new MemoryPolicyError('IMPORT_INVALID_SHAPE', 'Memory 导入文件缺少 records 数组。')
    let imported = 0
    let merged = 0
    let skipped = 0
    for (const row of rows.slice(0, 10_000)) {
      if (typeof row !== 'object' || row === null || typeof row.content !== 'string') {
        skipped += 1
        continue
      }
      try {
        const result = await this.remember({
          content: row.content,
          kind: row.kind,
          tags: row.tags,
          scope: row.scope,
          project: row.project,
          importance: row.importance,
          sources: row.sources,
          intent: 'explicit-user-request',
          userEditedAt: row.userEditedAt,
          userPinnedAt: row.userPinnedAt,
        }, { enabled: true, generate: true, disableOnExternalContext: false })
        if (result.merged) merged += 1
        else imported += 1
      } catch {
        skipped += 1
      }
    }
    return { imported, merged, skipped, ...this.stats() }
  }

  getSessionPolicy(sessionId) {
    return clone({
      sessionId,
      use_memories: null,
      generate_memories: null,
      search_prior_chats: null,
      updatedAt: null,
      ...(this.sessionPolicies.get(sessionId) ?? {}),
    })
  }

  async setSessionPolicy(sessionId, patch) {
    const current = this.getSessionPolicy(sessionId)
    const next = {
      sessionId,
      use_memories: patch.use_memories === null || typeof patch.use_memories === 'boolean'
        ? patch.use_memories : current.use_memories,
      generate_memories: patch.generate_memories === null || typeof patch.generate_memories === 'boolean'
        ? patch.generate_memories : current.generate_memories,
      search_prior_chats: patch.search_prior_chats === null || typeof patch.search_prior_chats === 'boolean'
        ? patch.search_prior_chats : current.search_prior_chats,
      updatedAt: new Date().toISOString(),
    }
    if (next.use_memories === null && next.generate_memories === null && next.search_prior_chats === null) {
      await this.sessionPolicies.delete(sessionId)
      return this.getSessionPolicy(sessionId)
    }
    await this.sessionPolicies.put(sessionId, next)
    return clone(next)
  }

  effectivePolicy(sessionId) {
    const settings = this.currentSettings()
    const session = this.getSessionPolicy(sessionId)
    return {
      enabled: settings.enabled,
      use: settings.enabled && settings.use_memories && session.use_memories !== false,
      generate: settings.enabled && settings.generate_memories && session.generate_memories !== false,
      search: settings.enabled && settings.use_memories && settings.search_prior_chats
        && session.use_memories !== false && session.search_prior_chats !== false,
      disableOnExternalContext: settings.disable_on_external_context,
      session,
      settings,
    }
  }

  async pruneUnused(nowIso) {
    const days = this.currentSettings().max_unused_days
    const cutoff = Date.parse(nowIso) - days * 86_400_000
    for (const [id, record] of [...this.records.entries()]) {
      const last = Date.parse(record.accessedAt ?? record.updatedAt)
      if (!record.userPinnedAt && record.importance < 3 && Number.isFinite(last) && last < cutoff) await this.records.delete(id)
    }
  }

  async reserveCapacity() {
    const max = this.currentSettings().max_records
    if (this.records.size < max) return
    const candidates = [...this.records.entries()]
      .filter(([, record]) => !record.userPinnedAt && record.importance < 3)
      .sort((left, right) => {
        const a = left[1]
        const b = right[1]
        return a.importance - b.importance || a.accessCount - b.accessCount || a.updatedAt.localeCompare(b.updatedAt)
      })
    const candidate = candidates[0]
    if (candidate === undefined) {
      throw new MemoryPolicyError('CAPACITY_PROTECTED', 'Memory 已达到容量上限，且所有记录都已被用户保留或标记为关键记忆。')
    }
    await this.records.delete(candidate[0])
  }
}

export function queryFromMessages(messages) {
  if (!Array.isArray(messages)) return ''
  return messages.flatMap(message => Array.isArray(message?.content) ? message.content : [])
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
    .slice(-4_000)
    .trim()
}

export function parseMemoriesCommand(rawInput) {
  const tokens = String(rawInput ?? '').trim().toLowerCase().split(/\s+/u).filter(Boolean)
  if (tokens.length === 0 || tokens[0] === 'status') return { kind: 'status' }
  if (tokens.length === 1 && ['on', 'off', 'reset'].includes(tokens[0])) return { kind: tokens[0] }
  if (tokens.length === 2 && ['use', 'generate', 'search'].includes(tokens[0]) && ['on', 'off', 'inherit'].includes(tokens[1])) {
    const field = tokens[0] === 'search' ? 'search_prior_chats' : `${tokens[0]}_memories`
    return { kind: 'field', field, value: tokens[1] === 'inherit' ? null : tokens[1] === 'on' }
  }
  return { kind: 'invalid' }
}
