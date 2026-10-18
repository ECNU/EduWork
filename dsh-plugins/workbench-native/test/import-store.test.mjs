import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import { openImportStore } from '../lib/data-import.js'

const runtime = process.env.EDUWORK_TEST_RUNTIME
test('the actual import store opens the selected official JSONL backend', { skip: !runtime }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-import-backend-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const parentURL = pathToFileURL(join(runtime, 'package.json')).href
  const hook = registerHooks({ resolve(name, context, next) {
    return next(name, name.startsWith('@deepseek-ai/') ? { ...context, parentURL } : context)
  } })
  try {
    const store = await openImportStore(root)
    try { assert.equal(typeof store.persistence?.open, 'function') }
    finally { await store.close() }
  } finally { hook.deregister() }
})
