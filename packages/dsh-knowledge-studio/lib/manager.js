import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { scanWorkspace } from './indexer.js'
import { INDEX_FORMAT_VERSION, WorkspaceKnowledgeStore } from './store.js'
import { TaskJournal } from './task-journal.js'

function safeWorkspaceId(id) {
  const value = String(id).replace(/[^a-zA-Z0-9_-]/g, '_')
  if (!value) throw new Error('Workspace has no stable id')
  return value
}

export class KnowledgeIndexManager {
  #ctx
  #root
  #stores = new Map()
  #tasks = new Map()
  #journal
  #closed = false

  constructor(ctx, { dataRoot } = {}) {
    this.#ctx = ctx
    this.#root = dataRoot ?? dshHomePath('plugins', 'dsh-knowledge-studio', 'workspaces')
    this.#journal = new TaskJournal(workspaceId => join(this.#root, safeWorkspaceId(workspaceId), 'task.json'))
  }

  databasePath(workspaceId) {
    return join(this.#root, safeWorkspaceId(workspaceId), 'index.lbug')
  }

  async workspaceForAgent(agent) {
    const cwd = agent?.session?.header?.cwd
    if (!cwd) throw new Error('This tool requires a DSH session attached to a workspace')
    const workspace = await this.#ctx.workspaceRegistry.resolveByPath(cwd)
    if (!workspace) throw new Error(`No DSH workspace owns the current session directory: ${cwd}`)
    return workspace
  }

  async #store(workspace, { requireExisting = true } = {}) {
    if (this.#closed) throw new Error('Workspace knowledge manager is closed')
    const key = String(workspace.id)
    const existing = this.#stores.get(key)
    if (existing) return existing
    const databasePath = this.databasePath(workspace.id)
    if (requireExisting && !existsSync(databasePath)) return null
    const store = new WorkspaceKnowledgeStore(databasePath)
    this.#stores.set(key, store)
    return store
  }

  async indexWorkspace(workspace, options = {}) {
    const store = await this.#store(workspace, { requireExisting: false })
    const manifest = await store.manifest()
    const scan = await scanWorkspace(this.#ctx.fs, workspace, { ...options, manifest, indexVersion: INDEX_FORMAT_VERSION })
    const result = await store.syncDocuments({
      id: String(workspace.id),
      title: workspace.title,
      rootPath: workspace.path,
    }, scan.documents, {
      ...options,
      presentPaths: scan.presentPaths,
      unchangedPaths: scan.unchangedPaths,
    })
    return { ...result, discovered: scan.discovered, parsed: scan.documents.length, skipped: scan.skipped }
  }

  async #restoreTask(workspaceId) {
    const key = String(workspaceId)
    if (this.#tasks.has(key)) return
    const restored = await this.#journal.read(key)
    if (this.#tasks.has(key)) return
    // Retired non-index tasks are historical data; never resume or rewrite them.
    if (!restored || restored.type !== 'index') return
    if (['running', 'stopping'].includes(restored.status)) {
      restored.status = 'interrupted'
      restored.message = 'The previous DSH process stopped before this task completed. Start it again to resume from the durable index.'
      restored.finishedAt = new Date().toISOString()
      await this.#journal.write(key, restored)
    }
    this.#tasks.set(key, restored)
  }

  #persistSoon(workspaceId, task, immediate = false) {
    if (immediate) return this.#journal.write(workspaceId, task)
    if (task.persistTimer) return Promise.resolve()
    task.persistTimer = setTimeout(() => {
      task.persistTimer = null
      void this.#journal.write(workspaceId, task)
    }, 400)
    return Promise.resolve()
  }

  task(workspaceId) {
    const task = this.#tasks.get(String(workspaceId))
    if (!task) return null
    const { controller: _controller, promise: _promise, persistTimer: _persistTimer, ...snapshot } = task
    return { ...snapshot }
  }

  startIndex(workspace, options = {}) {
    if (this.#closed) throw new Error('Workspace knowledge manager is closed')
    const key = String(workspace.id)
    const current = this.#tasks.get(key)
    if (current && (current.status === 'running' || current.status === 'stopping')) {
      throw new Error('Workspace indexing is already running')
    }
    const controller = new AbortController()
    const task = {
      type: 'index', status: 'running', phase: 'scan', processed: 0, total: null, currentPath: null,
      startedAt: new Date().toISOString(), finishedAt: null, message: null,
      result: null,
      controller, persistTimer: null, promise: null,
    }
    const onProgress = progress => {
      task.phase = progress.phase
      task.processed = Number(progress.processed) || 0
      task.total = progress.total == null ? null : Number(progress.total)
      task.currentPath = progress.path ?? null
      void this.#persistSoon(key, task)
    }
    task.promise = this.indexWorkspace(workspace, { ...options, signal: controller.signal, onProgress })
      .then(result => {
        task.status = 'completed'; task.phase = 'done'
        task.processed = result.discovered; task.total = result.discovered; task.currentPath = null
        task.result = result
      })
      .catch(error => {
        task.status = controller.signal.aborted ? 'killed' : 'failed'
        task.message = error instanceof Error ? error.message : String(error)
      })
      .finally(() => {
        if (task.persistTimer) clearTimeout(task.persistTimer)
        task.persistTimer = null
        task.finishedAt = new Date().toISOString()
        void this.#persistSoon(key, task, true)
      })
    this.#tasks.set(key, task)
    void this.#persistSoon(key, task, true)
    return this.task(key)
  }

  cancelIndex(workspaceId, reason = 'Cancelled by user') {
    const key = String(workspaceId)
    const task = this.#tasks.get(key)
    if (!task || !['running', 'stopping'].includes(task.status)) return this.task(key)
    task.status = 'stopping'
    task.controller.abort(new Error(reason))
    return this.task(key)
  }

  cancelTask(workspaceId, reason = 'Cancelled by user') {
    return this.cancelIndex(workspaceId, reason)
  }

  async waitForIndex(workspaceId) {
    const task = this.#tasks.get(String(workspaceId))
    if (task?.promise) await task.promise
    return this.task(workspaceId)
  }

  async status(workspace) {
    await this.#restoreTask(workspace.id)
    const databasePath = this.databasePath(workspace.id)
    const store = await this.#store(workspace)
    if (!store) return { indexed: false, files: 0, chunks: 0, databasePath }
    const status = await store.status()
    return { indexed: Boolean(status.workspace?.indexedAt), ...status }
  }

  async search(workspace, query, options) {
    return (await this.searchDetailed(workspace, query, options)).results
  }

  async searchDetailed(workspace, query, options = {}) {
    const store = await this.#store(workspace)
    if (!store) throw new Error('This workspace knowledge index is not ready yet')
    const limit = Math.max(1, Math.min(50, Number(options.limit) || 10))
    const results = await store.search(query, { ...options, limit })
    return { results, trace: { engine: 'local-lexical', remote: false } }
  }

  async readChunk(workspace, chunkId) {
    const store = await this.#store(workspace)
    if (!store) throw new Error('This workspace has not been indexed')
    return store.readChunk(chunkId)
  }

  async neighbors(workspace, chunkId) {
    const store = await this.#store(workspace)
    if (!store) throw new Error('This workspace has not been indexed')
    return store.neighbors(chunkId)
  }

  async readEvidence(workspace, evidenceId) {
    const store = await this.#store(workspace)
    return store ? store.readEvidence(evidenceId) : null
  }

  async sample(workspace, limit = 24) {
    const store = await this.#store(workspace)
    if (!store) throw new Error('This workspace has not been indexed')
    const chunks = await store.chunks()
    const count = Math.max(1, Math.min(50, Number(limit) || 24, chunks.length))
    if (count >= chunks.length) return chunks
    const sampled = []
    for (let index = 0; index < count; index += 1) sampled.push(chunks[Math.floor(index * chunks.length / count)])
    return sampled
  }

  async clear(workspace) {
    const key = String(workspace.id)
    this.cancelIndex(key, 'Index cleared by user')
    await this.waitForIndex(key)
    this.#tasks.delete(key)
    const store = this.#stores.get(key)
    if (store) {
      this.#stores.delete(key)
      await store.close()
    }
    const databasePath = this.databasePath(workspace.id)
    const workspaceDataRoot = dirname(databasePath)
    const rel = relative(this.#root, workspaceDataRoot)
    if (!rel || rel === '..' || rel.startsWith('..\\') || rel.startsWith('../')) {
      throw new Error(`Refusing to clear workspace knowledge data outside its managed root: ${workspaceDataRoot}`)
    }
    await rm(workspaceDataRoot, { recursive: true, force: true })
  }

  async close() {
    if (this.#closed) return
    this.#closed = true
    for (const [key] of this.#tasks) this.cancelIndex(key, 'Plugin is stopping')
    await Promise.allSettled([...this.#tasks.values()].map(task => task.promise).filter(Boolean))
    await this.#journal.flush()
    await Promise.allSettled([...this.#stores.values()].map(store => store.close()))
    this.#tasks.clear()
    this.#stores.clear()
  }
}
