import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { patchChatUserContentRuntime, patchChatUserContentSource, chatUserContentPatch } from '../patch-chat-user-content-runtime.mjs'

test('unreviewed Chat bytes are rejected', () => {
  assert.throws(() => patchChatUserContentSource(Buffer.from('changed upstream')), /Chat user content changed/)
})

const runtime = process.env.EDUWORK_TEST_RUNTIME
test('Chat adapter preserves npm input, records exact output and refuses changed versions or reapplication', { skip: !runtime }, async () => {
  const originalRoot = join(runtime, 'node_modules', chatUserContentPatch.package)
  const original = await readFile(join(originalRoot, chatUserContentPatch.file))
  const modules = await mkdtemp(join(tmpdir(), 'eduwork-chat-decoration-'))
  const copy = join(modules, chatUserContentPatch.package)
  await mkdir(join(copy, 'lib'), { recursive: true })
  const manifest = join(copy, 'package.json'), target = join(copy, chatUserContentPatch.file)
  await writeFile(manifest, await readFile(join(originalRoot, 'package.json')))
  await writeFile(target, original)
  const receipt = await patchChatUserContentRuntime(modules), patched = await readFile(target)
  assert.equal(receipt.afterSHA256, createHash('sha256').update(patched).digest('hex'))
  assert.deepEqual(await readFile(join(originalRoot, chatUserContentPatch.file)), original)
  await assert.rejects(patchChatUserContentRuntime(modules), /Chat user content changed/)
  assert.deepEqual(await readFile(target), patched)
  await writeFile(manifest, JSON.stringify({ name: chatUserContentPatch.package, version: '0.2.2' }))
  await assert.rejects(patchChatUserContentRuntime(modules), /newly qualified/)
  assert.deepEqual(await readFile(target), patched)
})
