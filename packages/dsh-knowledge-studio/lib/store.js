import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { Database, Connection } from './ladybug.js'
import { parseDocument } from './parser.js'
import { tokenCounts, tokenize } from './tokenizer.js'

export const INDEX_FORMAT_VERSION = 3

function stableId(...parts) {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32)
}

function normalizedPath(value) {
  return String(value).replaceAll('\\', '/').replace(/^\.\//, '')
}

function normalizeChunk(value) {
  return {
    ...value,
    pageStart: value.pageStart == null ? null : Number(value.pageStart),
    pageEnd: value.pageEnd == null ? null : Number(value.pageEnd),
    lineStart: Number(value.lineStart),
    lineEnd: Number(value.lineEnd),
  }
}

function oneResult(result) {
  if (Array.isArray(result)) throw new Error('Expected one Ladybug query result')
  return result
}

function hashText(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

function parsedContent(parsed) {
  return parsed.sections.flatMap(section => section.chunks.map(chunk => chunk.content)).join('\n\u0000\n')
}

export class WorkspaceKnowledgeStore {
  #databasePath
  #database
  #connection
  #ready
  #tail = Promise.resolve()
  #closed = false
  #statusSnapshot = null

  constructor(databasePath) {
    this.#databasePath = databasePath
    this.#ready = this.#open()
  }

  async #open() {
    await mkdir(dirname(this.#databasePath), { recursive: true })
    this.#database = new Database(this.#databasePath)
    this.#connection = new Connection(this.#database)
    await this.#initialize()
    await this.#refreshStatus()
  }

  async #rows(statement, params) {
    let result
    if (params) {
      const prepared = await this.#connection.prepare(statement)
      if (!prepared.isSuccess()) throw new Error(prepared.getErrorMessage())
      result = oneResult(await this.#connection.execute(prepared, params))
    } else {
      result = oneResult(await this.#connection.query(statement))
    }
    try {
      return await result.getAll()
    } finally {
      result.close()
    }
  }

  async #execute(statement, params) {
    await this.#rows(statement, params)
  }

  async #initialize() {
    const statements = [
      'CREATE NODE TABLE IF NOT EXISTS Workspace(id STRING PRIMARY KEY, title STRING, rootPath STRING, indexedAt STRING, indexVersion INT64)',
      'CREATE NODE TABLE IF NOT EXISTS File(id STRING PRIMARY KEY, workspaceId STRING, path STRING, version STRING, size INT64, kind STRING, linksJSON STRING, indexedAt STRING, contentHash STRING, revisionHash STRING, indexVersion INT64)',
      'CREATE NODE TABLE IF NOT EXISTS Section(id STRING PRIMARY KEY, fileId STRING, title STRING, level INT64, ordinal INT64, locator STRING, pageStart INT64, pageEnd INT64, lineStart INT64, lineEnd INT64)',
      'CREATE NODE TABLE IF NOT EXISTS Chunk(id STRING PRIMARY KEY, fileId STRING, sectionId STRING, path STRING, heading STRING, ordinal INT64, content STRING, locator STRING, pageStart INT64, pageEnd INT64, lineStart INT64, lineEnd INT64, tokenCount INT64, contentHash STRING, revisionHash STRING, evidenceId STRING)',
      'CREATE NODE TABLE IF NOT EXISTS CitationAnchor(id STRING PRIMARY KEY, chunkId STRING, fileId STRING, path STRING, locator STRING, pageStart INT64, pageEnd INT64, lineStart INT64, lineEnd INT64, excerptHash STRING, revisionHash STRING)',
      'CREATE NODE TABLE IF NOT EXISTS WikiEdition(id STRING PRIMARY KEY, workspaceId STRING, profileName STRING, title STRING, status STRING, sourceFingerprint STRING, providerId STRING, modelId STRING, createdAt STRING, publishedAt STRING, error STRING)',
      'CREATE NODE TABLE IF NOT EXISTS WikiPage(id STRING PRIMARY KEY, editionId STRING, slug STRING, title STRING, ordinal INT64, summary STRING, content STRING, status STRING, importance STRING, citationsJSON STRING, relatedJSON STRING, updatedAt STRING, error STRING)',
      'CREATE NODE TABLE IF NOT EXISTS Term(value STRING PRIMARY KEY)',
      'CREATE REL TABLE IF NOT EXISTS CONTAINS(FROM Workspace TO File)',
      'CREATE REL TABLE IF NOT EXISTS HAS_SECTION(FROM File TO Section)',
      'CREATE REL TABLE IF NOT EXISTS HAS_CHUNK(FROM Section TO Chunk)',
      'CREATE REL TABLE IF NOT EXISTS HAS_EVIDENCE(FROM Chunk TO CitationAnchor)',
      'CREATE REL TABLE IF NOT EXISTS HAS_WIKI_PAGE(FROM WikiEdition TO WikiPage)',
      'CREATE REL TABLE IF NOT EXISTS NEXT(FROM Chunk TO Chunk)',
      'CREATE REL TABLE IF NOT EXISTS LINKS_TO(FROM File TO File)',
      'CREATE REL TABLE IF NOT EXISTS HAS_TERM(FROM Chunk TO Term, tf INT64)',
    ]
    for (const statement of statements) await this.#execute(statement)
    for (const statement of [
      'ALTER TABLE Workspace ADD IF NOT EXISTS indexVersion INT64',
      'ALTER TABLE File ADD IF NOT EXISTS contentHash STRING',
      'ALTER TABLE File ADD IF NOT EXISTS revisionHash STRING',
      'ALTER TABLE File ADD IF NOT EXISTS indexVersion INT64',
      'ALTER TABLE Chunk ADD IF NOT EXISTS contentHash STRING',
      'ALTER TABLE Chunk ADD IF NOT EXISTS revisionHash STRING',
      'ALTER TABLE Chunk ADD IF NOT EXISTS evidenceId STRING',
    ]) await this.#execute(statement)
  }

  #serialize(task, checkpoint = false) {
    if (this.#closed) return Promise.reject(new Error('Workspace knowledge store is closed'))
    const run = this.#tail.then(async () => {
      await this.#ready
      let value
      try { value = await task() }
      catch (error) {
        // File transactions may have committed before cancellation.
        if (checkpoint) await this.#refreshStatus().catch(() => {})
        throw error
      }
      if (checkpoint) {
        await this.#refreshStatus()
        await this.#execute('CHECKPOINT')
      }
      return value
    })
    this.#tail = run.catch(() => {})
    return run
  }

  async #transaction(task) {
    await this.#execute('BEGIN TRANSACTION')
    try {
      const value = await task()
      await this.#execute('COMMIT')
      return value
    } catch (error) {
      await this.#execute('ROLLBACK').catch(() => {})
      throw error
    }
  }

  async #removeFile(fileId) {
    await this.#execute('MATCH (f:File {id: $fileId})-[:HAS_SECTION]->(:Section)-[:HAS_CHUNK]->(:Chunk)-[:HAS_EVIDENCE]->(e:CitationAnchor) DETACH DELETE e', { fileId })
    await this.#execute('MATCH (f:File {id: $fileId})-[:HAS_SECTION]->(s:Section)-[:HAS_CHUNK]->(c:Chunk) DETACH DELETE c', { fileId })
    await this.#execute('MATCH (f:File {id: $fileId})-[:HAS_SECTION]->(s:Section) DETACH DELETE s', { fileId })
    await this.#execute('MATCH (f:File {id: $fileId}) DETACH DELETE f', { fileId })
  }

  #prepareDocument(document) {
    const path = normalizedPath(document.path)
    const parsed = document.parsed ?? parseDocument({ path, text: document.text, maxChunkChars: document.maxChunkChars })
    const contentHash = hashText(document.text ?? parsedContent(parsed))
    const revisionHash = hashText(`${INDEX_FORMAT_VERSION}\u0000${contentHash}`)
    return { path, parsed, contentHash, revisionHash }
  }

  async #insertFile(workspace, document, prepared = this.#prepareDocument(document)) {
    const { path, parsed, contentHash, revisionHash } = prepared
    const fileId = stableId(workspace.id, path)
    const now = new Date().toISOString()

    await this.#removeFile(fileId)
    await this.#execute(
      'CREATE (:File {id: $id, workspaceId: $workspaceId, path: $path, version: $version, size: $size, kind: $kind, linksJSON: $linksJSON, indexedAt: $indexedAt, contentHash: $contentHash, revisionHash: $revisionHash, indexVersion: $indexVersion})',
      {
        id: fileId,
        workspaceId: workspace.id,
        path,
        version: String(document.version),
        size: Number(document.size ?? Buffer.byteLength(document.text ?? '', 'utf8')),
        kind: parsed.kind,
        linksJSON: JSON.stringify(parsed.links),
        indexedAt: now,
        contentHash,
        revisionHash,
        indexVersion: INDEX_FORMAT_VERSION,
      },
    )
    await this.#execute(
      'MATCH (w:Workspace {id: $workspaceId}), (f:File {id: $fileId}) CREATE (w)-[:CONTAINS]->(f)',
      { workspaceId: workspace.id, fileId },
    )

    let previousChunkId = null
    const sectionOccurrences = new Map()
    for (const section of parsed.sections) {
      const sectionKey = `${section.level}\u0000${section.title}`
      const sectionOccurrence = sectionOccurrences.get(sectionKey) ?? 0
      sectionOccurrences.set(sectionKey, sectionOccurrence + 1)
      const sectionId = stableId(fileId, 'section', section.level, section.title, sectionOccurrence)
      await this.#execute(
        'CREATE (:Section {id: $id, fileId: $fileId, title: $title, level: $level, ordinal: $ordinal, locator: $locator, pageStart: $pageStart, pageEnd: $pageEnd, lineStart: $lineStart, lineEnd: $lineEnd})',
        {
          id: sectionId,
          fileId,
          title: section.title,
          level: section.level,
          ordinal: section.ordinal,
          locator: section.locator,
          pageStart: section.pageStart,
          pageEnd: section.pageEnd,
          lineStart: section.lineStart,
          lineEnd: section.lineEnd,
        },
      )
      await this.#execute(
        'MATCH (f:File {id: $fileId}), (s:Section {id: $sectionId}) CREATE (f)-[:HAS_SECTION]->(s)',
        { fileId, sectionId },
      )

      const chunkOccurrences = new Map()
      for (const chunk of section.chunks) {
        const chunkContentHash = hashText(chunk.content)
        const chunkOccurrence = chunkOccurrences.get(chunkContentHash) ?? 0
        chunkOccurrences.set(chunkContentHash, chunkOccurrence + 1)
        const chunkId = stableId(sectionId, 'chunk', chunkContentHash, chunkOccurrence)
        const chunkRevisionHash = hashText(`${revisionHash}\u0000${chunkContentHash}`)
        const evidenceId = stableId('evidence', chunkId, chunkRevisionHash)
        const counts = tokenCounts(chunk.content)
        const weightedFields = [
          [path, 3],
          [path.split('/').at(-1) ?? path, 4],
          [section.title, 4],
        ]
        for (const [value, weight] of weightedFields) {
          for (const [term, frequency] of tokenCounts(value)) counts.set(term, (counts.get(term) ?? 0) + frequency * weight)
        }
        const tokenCount = [...counts.values()].reduce((sum, value) => sum + value, 0)
        await this.#execute(
          'CREATE (:Chunk {id: $id, fileId: $fileId, sectionId: $sectionId, path: $path, heading: $heading, ordinal: $ordinal, content: $content, locator: $locator, pageStart: $pageStart, pageEnd: $pageEnd, lineStart: $lineStart, lineEnd: $lineEnd, tokenCount: $tokenCount, contentHash: $contentHash, revisionHash: $revisionHash, evidenceId: $evidenceId})',
          {
            id: chunkId,
            fileId,
            sectionId,
            path,
            heading: section.title,
            ordinal: chunk.ordinal,
            content: chunk.content,
            locator: chunk.locator,
            pageStart: chunk.pageStart,
            pageEnd: chunk.pageEnd,
            lineStart: chunk.lineStart,
            lineEnd: chunk.lineEnd,
            tokenCount,
            contentHash: chunkContentHash,
            revisionHash: chunkRevisionHash,
            evidenceId,
          },
        )
        await this.#execute(
          'MATCH (s:Section {id: $sectionId}), (c:Chunk {id: $chunkId}) CREATE (s)-[:HAS_CHUNK]->(c)',
          { sectionId, chunkId },
        )
        await this.#execute(
          'CREATE (:CitationAnchor {id: $id, chunkId: $chunkId, fileId: $fileId, path: $path, locator: $locator, pageStart: $pageStart, pageEnd: $pageEnd, lineStart: $lineStart, lineEnd: $lineEnd, excerptHash: $excerptHash, revisionHash: $revisionHash})',
          {
            id: evidenceId, chunkId, fileId, path, locator: chunk.locator,
            pageStart: chunk.pageStart, pageEnd: chunk.pageEnd,
            lineStart: chunk.lineStart, lineEnd: chunk.lineEnd,
            excerptHash: chunkContentHash, revisionHash: chunkRevisionHash,
          },
        )
        await this.#execute(
          'MATCH (c:Chunk {id: $chunkId}), (e:CitationAnchor {id: $evidenceId}) CREATE (c)-[:HAS_EVIDENCE]->(e)',
          { chunkId, evidenceId },
        )
        if (previousChunkId) {
          await this.#execute(
            'MATCH (a:Chunk {id: $previousChunkId}), (b:Chunk {id: $chunkId}) CREATE (a)-[:NEXT]->(b)',
            { previousChunkId, chunkId },
          )
        }
        previousChunkId = chunkId

        if (counts.size > 0) {
          await this.#execute(
            'UNWIND $terms AS item MERGE (t:Term {value: item.value}) WITH t, item MATCH (c:Chunk {id: $chunkId}) CREATE (c)-[:HAS_TERM {tf: item.tf}]->(t)',
            { chunkId, terms: [...counts].map(([value, tf]) => ({ value, tf })) },
          )
        }
      }
    }
  }

  async #rebuildLinks(signal) {
    if (signal?.aborted) throw signal.reason ?? new Error('Workspace indexing aborted')
    await this.#execute('MATCH ()-[r:LINKS_TO]->() DELETE r')
    const files = await this.#rows('MATCH (f:File) RETURN f.id AS id, f.path AS path, f.linksJSON AS linksJSON')
    const byPath = new Map(files.map(file => [normalizedPath(file.path), file.id]))
    for (const file of files) {
      if (signal?.aborted) throw signal.reason ?? new Error('Workspace indexing aborted')
      const links = JSON.parse(file.linksJSON || '[]')
      for (const targetPath of links) {
        const candidates = [targetPath, `${targetPath}.md`, `${targetPath}.markdown`, `${targetPath}/README.md`]
        const targetId = candidates.map(normalizedPath).map(candidate => byPath.get(candidate)).find(Boolean)
        if (!targetId || targetId === file.id) continue
        await this.#execute(
          'MATCH (source:File {id: $sourceId}), (target:File {id: $targetId}) CREATE (source)-[:LINKS_TO]->(target)',
          { sourceId: file.id, targetId },
        )
      }
    }
  }

  syncDocuments(workspace, documents, { signal, onProgress, presentPaths, unchangedPaths } = {}) {
    return this.#serialize(async () => {
      if (signal?.aborted) throw signal.reason ?? new Error('Workspace indexing aborted')
      const now = new Date().toISOString()
      await this.#execute(
        'MERGE (w:Workspace {id: $id}) SET w.title = $title, w.rootPath = $rootPath, w.indexVersion = $indexVersion',
        { id: workspace.id, title: workspace.title, rootPath: workspace.rootPath, indexedAt: now, indexVersion: INDEX_FORMAT_VERSION },
      )
      const existingRows = await this.#rows('MATCH (f:File) RETURN f.id AS id, f.path AS path, f.version AS version, f.contentHash AS contentHash')
      const existingByPath = new Map(existingRows.map(row => [normalizedPath(row.path), row]))
      const incomingPaths = new Set((presentPaths ?? documents.map(document => document.path)).map(normalizedPath))
      let added = 0
      let changed = 0
      let unchanged = Array.isArray(unchangedPaths) ? unchangedPaths.length : 0

      let processed = 0
      for (const document of documents) {
        if (signal?.aborted) throw signal.reason ?? new Error('Workspace indexing aborted')
        const path = normalizedPath(document.path)
        const existing = existingByPath.get(path)
        if (existing?.version === String(document.version)) {
          unchanged += 1
          processed += 1
          onProgress?.({ phase: 'write', processed, total: documents.length, path })
          continue
        }
        const prepared = this.#prepareDocument({ ...document, path })
        if (existing?.contentHash && existing.contentHash === prepared.contentHash) {
          await this.#execute(
            'MATCH (f:File {id: $id}) SET f.version = $version, f.size = $size, f.indexedAt = $indexedAt, f.revisionHash = $revisionHash, f.indexVersion = $indexVersion',
            {
              id: existing.id, version: String(document.version), size: Number(document.size ?? 0), indexedAt: now,
              revisionHash: prepared.revisionHash, indexVersion: INDEX_FORMAT_VERSION,
            },
          )
          unchanged += 1
          processed += 1
          onProgress?.({ phase: 'write', processed, total: documents.length, path })
          continue
        }
        await this.#transaction(() => this.#insertFile(workspace, { ...document, path }, prepared))
        await this.#refreshStatus()
        if (existing) changed += 1
        else added += 1
        processed += 1
        onProgress?.({ phase: 'write', processed, total: documents.length, path })
      }

      let removed = 0
      for (const [path, existing] of existingByPath) {
        if (signal?.aborted) throw signal.reason ?? new Error('Workspace indexing aborted')
        if (incomingPaths.has(path)) continue
        await this.#transaction(() => this.#removeFile(existing.id))
        removed += 1
      }
      if (signal?.aborted) throw signal.reason ?? new Error('Workspace indexing aborted')
      await this.#execute('MATCH (t:Term) WHERE NOT (t)<-[:HAS_TERM]-(:Chunk) DELETE t')
      await this.#transaction(() => this.#rebuildLinks(signal))
      await this.#execute('MATCH (w:Workspace {id: $id}) SET w.indexedAt = $indexedAt', { id: workspace.id, indexedAt: now })
      return { added, changed, unchanged, removed, indexedAt: now }
    }, true)
  }

  manifest() {
    return this.#serialize(async () => {
      const rows = await this.#rows(
        'MATCH (f:File) RETURN f.path AS path, f.version AS version, f.contentHash AS contentHash, f.revisionHash AS revisionHash, f.indexVersion AS indexVersion ORDER BY f.path',
      )
      return rows.map(row => ({ ...row, indexVersion: Number(row.indexVersion ?? 0) }))
    })
  }

  chunks() {
    return this.#serialize(async () => {
      const rows = await this.#rows(
        'MATCH (c:Chunk) RETURN c.id AS id, c.path AS path, c.heading AS heading, c.content AS content, c.contentHash AS contentHash, c.revisionHash AS revisionHash, c.evidenceId AS evidenceId, c.locator AS locator, c.pageStart AS pageStart, c.pageEnd AS pageEnd, c.lineStart AS lineStart, c.lineEnd AS lineEnd ORDER BY c.path, c.lineStart',
      )
      return rows.map(normalizeChunk)
    })
  }

  sourceFingerprint() {
    return this.#serialize(async () => {
      const rows = await this.#rows('MATCH (f:File) RETURN f.path AS path, f.revisionHash AS revisionHash ORDER BY f.path')
      return hashText(rows.map(row => `${row.path}\u0000${row.revisionHash ?? ''}`).join('\n'))
    })
  }

  fileOverview() {
    return this.#serialize(async () => {
      const files = await this.#rows('MATCH (f:File) RETURN f.path AS path, f.kind AS kind, f.size AS size, f.linksJSON AS linksJSON ORDER BY f.path')
      return files.map(file => ({ ...file, size: Number(file.size ?? 0), links: JSON.parse(file.linksJSON || '[]'), linksJSON: undefined }))
    })
  }

  readEvidence(evidenceId) {
    return this.#serialize(async () => {
      const [row] = await this.#rows(
        'MATCH (c:Chunk)-[:HAS_EVIDENCE]->(e:CitationAnchor {id: $evidenceId}) RETURN e.id AS evidenceId, e.path AS path, e.locator AS locator, e.pageStart AS pageStart, e.pageEnd AS pageEnd, e.lineStart AS lineStart, e.lineEnd AS lineEnd, e.excerptHash AS excerptHash, e.revisionHash AS revisionHash, c.id AS chunkId, c.heading AS heading, c.content AS content',
        { evidenceId },
      )
      return row ? normalizeChunk(row) : null
    })
  }

  verifyEvidence(citations) {
    return this.#serialize(async () => {
      const results = []
      for (const citation of citations ?? []) {
        const [current] = await this.#rows(
          'MATCH (e:CitationAnchor {id: $evidenceId}) RETURN e.revisionHash AS revisionHash, e.excerptHash AS excerptHash',
          { evidenceId: citation.evidenceId },
        )
        results.push({ ...citation, fresh: Boolean(current && current.revisionHash === citation.revisionHash && current.excerptHash === citation.excerptHash) })
      }
      return results
    })
  }

  search(query, { limit = 10, pathPrefix = '' } = {}) {
    return this.#serialize(async () => {
      const queryTokens = tokenize(query)
      const queryCounts = new Map()
      for (const token of queryTokens) queryCounts.set(token, (queryCounts.get(token) ?? 0) + 1)
      if (queryCounts.size === 0) return []

      const [stats] = await this.#rows('MATCH (c:Chunk) RETURN count(c) AS n, avg(c.tokenCount) AS avgdl')
      const corpusSize = Number(stats?.n ?? 0)
      const averageLength = Number(stats?.avgdl ?? 1) || 1
      if (corpusSize === 0) return []

      const scores = new Map()
      const normalizedQuery = String(query).normalize('NFKC').toLocaleLowerCase('en-US').trim()
      const k1 = 1.2
      const b = 0.75
      for (const [term, queryFrequency] of queryCounts) {
        const matches = await this.#rows(
          'MATCH (t:Term {value: $term})<-[r:HAS_TERM]-(c:Chunk) RETURN c.id AS id, c.fileId AS fileId, c.path AS path, c.heading AS heading, c.content AS content, c.locator AS locator, c.pageStart AS pageStart, c.pageEnd AS pageEnd, c.lineStart AS lineStart, c.lineEnd AS lineEnd, c.tokenCount AS tokenCount, c.evidenceId AS evidenceId, c.revisionHash AS revisionHash, r.tf AS tf',
          { term },
        )
        const documentFrequency = matches.length
        if (documentFrequency === 0) continue
        const idf = Math.log(1 + (corpusSize - documentFrequency + 0.5) / (documentFrequency + 0.5))
        for (const match of matches) {
          if (pathPrefix && !normalizedPath(match.path).startsWith(normalizedPath(pathPrefix))) continue
          const tf = Number(match.tf)
          const documentLength = Number(match.tokenCount) || 1
          const contribution = idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * documentLength / averageLength))) * queryFrequency
          const current = scores.get(match.id) ?? { ...match, score: 0, matchedTerms: new Set() }
          current.score += contribution
          current.matchedTerms.add(term)
          scores.set(match.id, current)
        }
      }
      for (const result of scores.values()) {
        const path = String(result.path).normalize('NFKC').toLocaleLowerCase('en-US')
        const heading = String(result.heading ?? '').normalize('NFKC').toLocaleLowerCase('en-US')
        const content = String(result.content ?? '').normalize('NFKC').toLocaleLowerCase('en-US')
        if (normalizedQuery && path.includes(normalizedQuery)) result.score += 8
        if (normalizedQuery && heading.includes(normalizedQuery)) result.score += 6
        if (normalizedQuery && content.includes(normalizedQuery)) result.score += 2
      }
      return [...scores.values()]
        .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path) || Number(left.lineStart) - Number(right.lineStart))
        .slice(0, Math.max(1, Math.min(50, Number(limit) || 10)))
        .map(result => ({
          id: result.id,
          path: result.path,
          heading: result.heading,
          locator: result.locator,
          pageStart: result.pageStart == null ? null : Number(result.pageStart),
          pageEnd: result.pageEnd == null ? null : Number(result.pageEnd),
          lineStart: Number(result.lineStart),
          lineEnd: Number(result.lineEnd),
          content: result.content,
          score: result.score,
          matchedTerms: [...result.matchedTerms],
          evidenceId: result.evidenceId ?? null,
          revisionHash: result.revisionHash ?? null,
        }))
    })
  }

  readChunk(chunkId) {
    return this.#serialize(async () => {
      const [chunk] = await this.#rows(
        'MATCH (c:Chunk {id: $chunkId}) RETURN c.id AS id, c.path AS path, c.heading AS heading, c.content AS content, c.locator AS locator, c.pageStart AS pageStart, c.pageEnd AS pageEnd, c.lineStart AS lineStart, c.lineEnd AS lineEnd, c.evidenceId AS evidenceId, c.revisionHash AS revisionHash',
        { chunkId },
      )
      return chunk ? normalizeChunk(chunk) : null
    })
  }

  neighbors(chunkId) {
    return this.#serialize(async () => {
      const [chunk] = await this.#rows('MATCH (c:Chunk {id: $chunkId}) RETURN c.fileId AS fileId', { chunkId })
      if (!chunk) return null
      const previous = await this.#rows(
        'MATCH (n:Chunk)-[:NEXT]->(c:Chunk {id: $chunkId}) RETURN n.id AS id, n.path AS path, n.heading AS heading, n.locator AS locator, n.pageStart AS pageStart, n.pageEnd AS pageEnd, n.lineStart AS lineStart, n.lineEnd AS lineEnd, n.content AS content',
        { chunkId },
      )
      const next = await this.#rows(
        'MATCH (c:Chunk {id: $chunkId})-[:NEXT]->(n:Chunk) RETURN n.id AS id, n.path AS path, n.heading AS heading, n.locator AS locator, n.pageStart AS pageStart, n.pageEnd AS pageEnd, n.lineStart AS lineStart, n.lineEnd AS lineEnd, n.content AS content',
        { chunkId },
      )
      const linkedFiles = await this.#rows(
        'MATCH (f:File {id: $fileId})-[:LINKS_TO]->(target:File) RETURN target.path AS path, target.kind AS kind',
        { fileId: chunk.fileId },
      )
      return { previous: previous.map(normalizeChunk), next: next.map(normalizeChunk), linkedFiles }
    })
  }

  async #refreshStatus() {
    const [workspace] = await this.#rows('MATCH (w:Workspace) RETURN w.id AS workspaceId, w.title AS title, w.rootPath AS rootPath, w.indexedAt AS indexedAt LIMIT 1')
    const [counts] = await this.#rows('OPTIONAL MATCH (f:File) WITH count(f) AS files OPTIONAL MATCH (c:Chunk) RETURN files, count(c) AS chunks')
    this.#statusSnapshot = { workspace: workspace ?? null, files: Number(counts?.files ?? 0), chunks: Number(counts?.chunks ?? 0), databasePath: this.#databasePath }
  }

  async status() {
    if (this.#closed) throw new Error('Workspace knowledge store is closed')
    await this.#ready
    return structuredClone(this.#statusSnapshot)
  }

  async close() {
    if (this.#closed) return
    this.#closed = true
    await this.#tail.catch(() => {})
    await this.#ready
    await this.#connection.close()
    await this.#database.close()
  }
}

export { stableId }
