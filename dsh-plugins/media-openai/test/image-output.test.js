import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { prepareManagedOutput, writeUniqueFile } from '../lib/core.js'
import { after } from 'node:test'
const tempRoots = []
async function temporary(prefix) { const root = await mkdtemp(prefix); tempRoots.push(root); return root }
after(async () => { for (const root of tempRoots) await rm(root, { recursive: true, force: true }) })
import { saveGeneratedImage } from '../lib/image-output.js'

const original = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64')
const generated = { bytes: original, format: { mime: 'image/png', extension: '.png' }, dimensions: { size: '1x1' }, generationSize: '512x512' }

test('matching actual dimensions preserve original bytes without processing', async () => {
  const projectPath = await temporary(join(tmpdir(), 'media-image-native-'))
  const managed = await prepareManagedOutput(projectPath, 'images')
  const result = await saveGeneratedImage({ generated, request: { size: '1x1', fit: 'crop' }, managed, projectPath, resize: () => assert.fail('matching image should not be resized') })
  assert.equal(result.size, '1x1')
  assert.equal(result.resized, false)
  assert.deepEqual(await readFile(result.path), original)
})

for (const size of ['512x512', '1200x800']) test(`failed local sizing to ${size} preserves the paid source and reports unmet dimensions`, async () => {
  const projectPath = await temporary(join(tmpdir(), 'media-image-fallback-'))
  const managed = await prepareManagedOutput(projectPath, 'images')
  let attempted = false
  const result = await saveGeneratedImage({ generated, request: { size, fit: 'crop' }, managed, projectPath, resize: async () => { attempted = true; throw new Error('private runtime detail') } })
  assert.equal(attempted, true)
  assert.equal(result.size, '1x1')
  assert.equal(result.requestedSize, size)
  assert.match(result.resizeWarning, /did not complete/)
  assert.doesNotMatch(result.resizeWarning, /private runtime/)
  assert.equal(result.resized, false)
  assert.deepEqual(await readFile(result.path), original)
  assert.equal((await readdir(managed.output)).length, 1)
})

test('second file write failure returns the saved original without regenerating', async () => {
  const projectPath = await temporary(join(tmpdir(), 'media-image-save-fallback-'))
  const managed = await prepareManagedOutput(projectPath, 'images')
  let writes = 0
  const result = await saveGeneratedImage({ generated: {...generated, dimensions: {size:'512x512'}}, request: {size:'1x1', fit:'crop'}, managed, projectPath,
    resize: async () => original,
    write: async (...args) => { if (++writes === 2) throw new Error('synthetic disk write failure'); return writeUniqueFile(...args) },
  })
  assert.equal(writes, 2)
  assert.equal(result.resized, false)
  assert.match(result.resizeWarning, /did not complete/)
  assert.deepEqual(await readFile(result.path), original)
  assert.equal((await readdir(managed.output)).length, 1)
})

test('cancellation propagates instead of masquerading as a sizing fallback', async () => {
  const projectPath = await temporary(join(tmpdir(), 'media-image-cancel-'))
  const managed = await prepareManagedOutput(projectPath, 'images')
  const controller = new AbortController()
  await assert.rejects(saveGeneratedImage({ generated, request: { size: '1200x800', fit: 'crop' }, managed, projectPath, signal: controller.signal,
    resize: async () => { controller.abort(); throw new Error('interrupted') },
  }), { name: 'AbortError' })
})
