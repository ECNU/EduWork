import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database, Connection } from '../lib/ladybug.js'

const keep = process.argv.includes('--keep')
const installFts = process.argv.includes('--install-fts')
const ftsPathArgument = process.argv.find(argument => argument.startsWith('--fts-path='))
const ftsPath = ftsPathArgument?.slice('--fts-path='.length)
const root = await mkdtemp(join(tmpdir(), 'dsh-knowledge-studio-p0-'))
const databasePath = join(root, 'index.lbug')

async function rows(connection, statement, params) {
  let result
  if (params) {
    const prepared = await connection.prepare(statement)
    assert.equal(prepared.isSuccess(), true, prepared.getErrorMessage())
    result = await connection.execute(prepared, params)
  } else {
    result = await connection.query(statement)
  }
  assert.equal(Array.isArray(result), false, 'smoke queries must return one result')
  try {
    return await result.getAll()
  } finally {
    result.close()
  }
}

async function execute(connection, statement, params) {
  await rows(connection, statement, params)
}

async function close(connection, database) {
  if (connection) await connection.close()
  if (database) await database.close()
}

let database
let connection

try {
  database = new Database(databasePath)
  connection = new Connection(database)

  await execute(connection, 'CREATE NODE TABLE File(id STRING PRIMARY KEY, workspaceId STRING, path STRING, version STRING)')
  await execute(connection, 'CREATE NODE TABLE Chunk(id STRING PRIMARY KEY, workspaceId STRING, filePath STRING, content STRING, searchText STRING, lineStart INT64, lineEnd INT64)')
  await execute(connection, 'CREATE REL TABLE HAS_CHUNK(FROM File TO Chunk)')
  await execute(connection, 'CREATE REL TABLE NEXT(FROM Chunk TO Chunk)')

  const insertFile = await connection.prepare('CREATE (:File {id: $id, workspaceId: $workspaceId, path: $path, version: $version})')
  assert.equal(insertFile.isSuccess(), true, insertFile.getErrorMessage())
  let result = await connection.execute(insertFile, {
    id: 'ws-1:research.md',
    workspaceId: 'ws-1',
    path: 'research.md',
    version: 'v1',
  })
  result.close()

  const insertChunk = await connection.prepare('CREATE (:Chunk {id: $id, workspaceId: $workspaceId, filePath: $filePath, content: $content, searchText: $searchText, lineStart: $lineStart, lineEnd: $lineEnd})')
  assert.equal(insertChunk.isSuccess(), true, insertChunk.getErrorMessage())
  for (const chunk of [
    { id: 'c1', content: '研究 Transformer 注意力机制', searchText: '研究 transformer 注意 意力 力机 机制', lineStart: 1, lineEnd: 4 },
    { id: 'c2', content: '实验代码位于 src/experiment.py', searchText: '实验 验代 代码 位于 src experiment py', lineStart: 5, lineEnd: 8 },
  ]) {
    result = await connection.execute(insertChunk, {
      ...chunk,
      workspaceId: 'ws-1',
      filePath: 'research.md',
    })
    result.close()
  }

  await execute(connection, "MATCH (f:File {id: 'ws-1:research.md'}), (c:Chunk {id: 'c1'}) CREATE (f)-[:HAS_CHUNK]->(c)")
  await execute(connection, "MATCH (f:File {id: 'ws-1:research.md'}), (c:Chunk {id: 'c2'}) CREATE (f)-[:HAS_CHUNK]->(c)")
  await execute(connection, "MATCH (a:Chunk {id: 'c1'}), (b:Chunk {id: 'c2'}) CREATE (a)-[:NEXT]->(b)")

  const neighbors = await rows(connection, "MATCH (a:Chunk {id: 'c1'})-[:NEXT]->(b:Chunk) RETURN b.id AS id, b.content AS content")
  assert.deepEqual(neighbors, [{ id: 'c2', content: '实验代码位于 src/experiment.py' }])

  let secondOpenError = null
  let secondDatabase
  try {
    secondDatabase = new Database(databasePath)
    await secondDatabase.init()
  } catch (error) {
    secondOpenError = String(error?.message || error)
  } finally {
    if (secondDatabase) {
      try { await secondDatabase.close() } catch {}
    }
  }

  if (installFts) {
    await execute(connection, 'INSTALL fts')
  }
  let fts = { attempted: true, installedNow: installFts, loaded: false, rows: [], error: null }
  try {
    const loadStatement = ftsPath
      ? `LOAD EXTENSION '${ftsPath.replaceAll('\\', '/').replaceAll("'", "\\'")}'`
      : 'LOAD fts'
    await execute(connection, loadStatement)
    await execute(connection, "CALL CREATE_FTS_INDEX('Chunk', 'chunk_fts', ['searchText'], stemmer := 'none')")
    fts.rows = await rows(connection, "CALL QUERY_FTS_INDEX('Chunk', 'chunk_fts', '注意 意力') RETURN node.id AS id, score ORDER BY score DESC")
    assert.equal(fts.rows[0]?.id, 'c1', '预分词后的中文检索应命中 c1')
    fts.loaded = true
  } catch (error) {
    fts.error = String(error?.message || error)
  }

  await close(connection, database)
  connection = null
  database = null

  database = new Database(databasePath)
  connection = new Connection(database)
  const persisted = await rows(connection, 'MATCH (f:File)-[:HAS_CHUNK]->(c:Chunk) RETURN f.path AS path, count(c) AS chunks')
  assert.equal(persisted.length, 1)
  assert.equal(persisted[0].path, 'research.md')
  assert.equal(Number(persisted[0].chunks), 2)

  console.log(JSON.stringify({
    ok: true,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    databaseVersion: Database.getVersion(),
    storageVersion: String(Database.getStorageVersion()),
    databasePath,
    graph: { neighbors, persisted },
    concurrentOpen: secondOpenError ? { allowed: false, error: secondOpenError } : { allowed: true },
    fts,
  }, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2))
} finally {
  await close(connection, database).catch(() => {})
  if (!keep) await rm(root, { recursive: true, force: true })
  else console.error(`P0 artifacts kept at ${root}`)
}
