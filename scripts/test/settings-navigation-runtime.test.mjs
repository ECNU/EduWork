import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { patchSettingsNavigationRuntime, patchSettingsNavigationSource, settingsNavigationPatch } from '../patch-settings-navigation-runtime.mjs'

test('unreviewed settings bytes fail before mutation', () => {
  assert.throws(() => patchSettingsNavigationSource(Buffer.from('changed upstream')), /input changed/)
})

const runtime = process.env.EDUWORK_TEST_RUNTIME
test('settings adapter checks the pinned version and bytes, records output and leaves npm input intact', { skip: !runtime }, async () => {
  const originalRoot = join(runtime, 'node_modules', settingsNavigationPatch.package)
  const original = await readFile(join(originalRoot, settingsNavigationPatch.file))
  const modules = await mkdtemp(join(tmpdir(), 'eduwork-settings-icons-'))
  const copy = join(modules, settingsNavigationPatch.package)
  await mkdir(join(copy, 'lib'), { recursive: true })
  await writeFile(join(copy, 'package.json'), await readFile(join(originalRoot, 'package.json')))
  const target = join(copy, settingsNavigationPatch.file)
  await writeFile(target, original)
  const receipt = await patchSettingsNavigationRuntime(modules)
  const patched = await readFile(target)
  assert.equal(receipt.afterSHA256, createHash('sha256').update(patched).digest('hex'))
  assert.deepEqual(await readFile(join(originalRoot, settingsNavigationPatch.file)), original)
  await assert.rejects(patchSettingsNavigationRuntime(modules), /input changed/)
  assert.deepEqual(await readFile(target), patched)
  await writeFile(join(copy, 'package.json'), JSON.stringify({ name: settingsNavigationPatch.package, version: '0.2.2' }))
  await assert.rejects(patchSettingsNavigationRuntime(modules), /newly qualified/)
  assert.deepEqual(await readFile(target), patched)
})
