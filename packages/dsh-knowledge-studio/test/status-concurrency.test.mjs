import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceKnowledgeStore } from '../lib/store.js'

test('status returns committed data while a batch write is still running', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-status-'))
  const store = new WorkspaceKnowledgeStore(join(root, 'index.lbug'))
  const workspace = { id: 'test', title: 'Test', rootPath: root }
  try {
    await store.syncDocuments(workspace, [{ path: 'old.md', version: '1', text: 'original evidence' }])
    let observed
    let finished = false
    let pending
    await store.syncDocuments(workspace, Array.from({ length: 12 }, (_, i) => ({
      path: `${i}.md`, version: '1', text: `# Evidence ${i}\nNew document ${i}`,
    })), { onProgress() {
      pending ??= store.status().then(value => { observed = { value, finished } })
    } }).then(() => { finished = true })
    await pending
    assert.equal(observed.finished, false, 'status was queued behind the entire write')
    assert.equal(observed.value.files, 2, 'old file plus one atomically committed file should be exposed')
    assert.equal((await store.status()).files, 12)
  } finally { await store.close() }
})


test('cancelling a batch retains committed files for the next process', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-resume-'))
  const path = join(root, 'index.lbug')
  const store = new WorkspaceKnowledgeStore(path)
  const workspace = { id: 'resume', title: 'Resume', rootPath: root }
  const controller = new AbortController()
  try {
    await assert.rejects(store.syncDocuments(workspace, [
      { path: 'one.md', version: '1', text: 'first committed document' },
      { path: 'two.md', version: '1', text: 'second document' },
    ], { signal: controller.signal, onProgress() { controller.abort(new Error('cancel test')) } }), /cancel test/)
    assert.equal((await store.status()).files, 1)
    assert.equal((await store.status()).workspace.indexedAt, null)
  } finally { await store.close() }
  const reopened = new WorkspaceKnowledgeStore(path)
  try { assert.deepEqual((await reopened.manifest()).map(item => item.path), ['one.md']) }
  finally { await reopened.close() }
})
