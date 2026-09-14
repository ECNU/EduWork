import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KnowledgeStudioService } from '../lib/index.js'
import { KnowledgeIndexManager } from '../lib/manager.js'
import { WorkspaceKnowledgeStore } from '../lib/store.js'
import { Database, Connection } from '../lib/ladybug.js'
import { installKnowledgeStudioTools } from '../lib/tools.js'
import { DEFAULT_SETTINGS, mergeDefaultSettings, validateSettings } from '../lib/settings.js'
import { TYPERT } from '../lib/typert.host.js'

test('production host has artifact tools and evidence APIs without the retired workflow', () => {
  const registered = []
  installKnowledgeStudioTools({ tools: { register: value => registered.push(value) } }, {}, {})
  const names = registered.map(tool => tool.name)
  assert.deepEqual(names, ['knowledge_studio_create_artifact'])
  const explicit=[]
  installKnowledgeStudioTools({tools:{register:value=>explicit.push(value)}},{},{},{indexedRetrievalTools:true})
  assert.deepEqual(explicit.map(tool=>tool.name).sort(), ['knowledge_studio_create_artifact', 'knowledge_studio_neighbors', 'knowledge_studio_read', 'knowledge_studio_search', 'knowledge_studio_status'])
  for (const method of ['prepare', 'wiki', 'readWikiPage', 'clear']) {
    assert.equal(TYPERT.invocations.some(item => item.method === method), false)
    assert.equal(typeof KnowledgeStudioService.prototype[method], 'undefined')
  }
  for (const method of ['startWiki', 'wikiSnapshot', 'readWikiPage', 'knowledgeSummary', 'acceptConsent']) {
    assert.equal(typeof KnowledgeIndexManager.prototype[method], 'undefined')
  }
  for (const method of ['createWikiEdition', 'updateWikiPage', 'publishWikiEdition', 'failWikiEdition']) {
    assert.equal(typeof WorkspaceKnowledgeStore.prototype[method], 'undefined')
  }
  assert.equal(typeof WorkspaceKnowledgeStore.prototype.readEvidence, 'function')
  assert.equal(typeof WorkspaceKnowledgeStore.prototype.verifyEvidence, 'function')
})

test('legacy workflow configuration is inert while supported settings remain valid', () => {
  const settings = mergeDefaultSettings({ wikiConcurrency: 3, wiki: true, profile: 'code' })
  assert.deepEqual(settings, DEFAULT_SETTINGS)
  validateSettings(settings)
  // Loading old values must not rewrite the user's settings file or restore code.
  validateSettings({ ...settings, wikiConcurrency: 0 })
  assert.equal(Object.hasOwn(DEFAULT_SETTINGS, 'wikiConcurrency'), false)
})

test('ordinary status and close leave retired task and consent files unchanged', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-retired-task-'))
  const workspace = { id: 'synthetic', title: 'Synthetic workspace', path: join(root, 'workspace') }
  const dataRoot = join(root, 'data'), directory = join(dataRoot, workspace.id)
  await mkdir(directory, { recursive: true })
  const taskPath = join(directory, 'task.json'), consentPath = join(directory, 'consent.json')
  const task = JSON.stringify({ type: 'build', status: 'running', phase: 'wiki-write', activePages: [{ id: 'saved-page' }], result: { wiki: { completed: 2 } } })
  const consent = JSON.stringify({ version: 1, workspaceId: workspace.id, scope: 'manual-knowledge-build', acceptedAt: '2026-09-08T00:00:00Z' })
  await writeFile(taskPath, task); await writeFile(consentPath, consent)
  const manager = new KnowledgeIndexManager({ fs: { readFile: () => { throw new Error('Must not scan') } } }, { dataRoot })
  try {
    assert.equal((await manager.status(workspace)).indexed, false)
    assert.equal(manager.task(workspace.id), null)
    assert.equal((await manager.status(workspace)).indexed, false)
  } finally { await manager.close() }
  assert.equal(await readFile(taskPath, 'utf8'), task)
  assert.equal(await readFile(consentPath, 'utf8'), consent)
})

async function rawQuery(path, statements) {
  const database = new Database(path), connection = new Connection(database)
  try {
    const rows = []
    for (const statement of statements) {
      const result = await connection.query(statement)
      try { rows.push(await result.getAll()) } finally { result.close() }
    }
    return rows
  } finally { await connection.close(); await database.close() }
}

test('normal index use preserves historical pages and existing artifact evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-legacy-index-')), path = join(root, 'index.lbug')
  const workspace = { id: 'synthetic', title: 'Synthetic workspace', rootPath: root }
  const initial = new WorkspaceKnowledgeStore(path)
  let citation
  try {
    await initial.syncDocuments(workspace, [{ path: 'source.md', version: '1', text: '# Evidence\n\nDurable artifact evidence.' }])
    const [chunk] = await initial.chunks()
    citation = await initial.readEvidence(chunk.evidenceId)
    assert.ok(citation)
  } finally { await initial.close() }
  await rawQuery(path, [
    "CREATE (:WikiEdition {id:'historical-edition', workspaceId:'synthetic', title:'Saved edition', status:'partial', profileName:'general'})",
    "CREATE (:WikiPage {id:'historical-page', editionId:'historical-edition', title:'Saved page', ordinal:0, content:'Retained historical content', status:'completed', citationsJSON:'[]', relatedJSON:'[]'})",
    "MATCH (e:WikiEdition {id:'historical-edition'}), (p:WikiPage {id:'historical-page'}) CREATE (e)-[:HAS_WIKI_PAGE]->(p)",
  ])
  const readLegacy = ["MATCH (e:WikiEdition)-[:HAS_WIKI_PAGE]->(p:WikiPage) RETURN e.id AS editionId, e.status AS status, p.id AS pageId, p.content AS content, p.relatedJSON AS relatedJSON"]
  const before = await rawQuery(path, readLegacy)
  const reopened = new WorkspaceKnowledgeStore(path)
  try {
    assert.equal((await reopened.status()).files, 1)
    assert.equal((await reopened.readEvidence(citation.evidenceId)).content, citation.content)
    assert.equal((await reopened.verifyEvidence([citation]))[0].fresh, true)
    assert.ok((await reopened.search('Durable evidence')).length)
    await reopened.syncDocuments(workspace, [{ path: 'source.md', version: '1', text: '# Evidence\n\nDurable artifact evidence.' }])
  } finally { await reopened.close() }
  assert.deepEqual(await rawQuery(path, readLegacy), before)
})
