import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import test from 'node:test'

const runtime = process.env.EDUWORK_SIDE_CHAT_RUNTIME

test('every design token the client paints with is defined by the DSH theme', { skip: !runtime }, async () => {
  const theme = createRequire(join(runtime, 'package.json')).resolve('@deepseek-ai/dsh-client-ui-theme/client')
  const defined = new Set((await readFile(theme, 'utf8')).match(/--dsw-[\w-]+(?=:)/g))
  const client = new URL('../src/client/', import.meta.url)
  const used = new Set()
  for (const file of await readdir(client)) {
    for (const token of (await readFile(new URL(file, client), 'utf8')).match(/--dsw-[\w-]+/g) ?? []) used.add(token)
  }
  assert.ok(used.has('--dsw-alias-toast-bg'))
  assert.deepEqual([...used].filter(token => !defined.has(token)), [])
})
