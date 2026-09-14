import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, rename, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { prepareNativeResources } from '../native-resources.mjs'

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'eduwork-resource-contract-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const product = join(directory, 'before')
  for (const sub of ['r/p', 'r/v/Scripts', 'r/v/Lib/site-packages', 'r/b', 'r/a', 'd']) await mkdir(join(product, sub), { recursive: true })
  for (const sub of ['r/p/python.exe', 'r/v/Scripts/python.exe', 'r/b/chrome.exe', 'r/a/whisper-cli.exe', 'r/a/model.bin']) await writeFile(join(product, sub), 'synthetic resource contract')
  await writeFile(join(product, 'r/v/.eduwork-venv.json'), JSON.stringify({ schemaVersion: 1, environmentLockSHA256: 'lock' }))
  await writeFile(join(product, 'r/v/pyvenv.cfg'), 'home = stale location\n')
  const manifest = { schemaVersion: 1, platform: `${process.platform}-${process.arch}`,
    python: { baseRoot: 'r/p', venvRoot: 'r/v', version: '3.12.13', environmentLockSHA256: 'lock' },
    environment: { DSH_OFFICE_PYTHON: 'r/v/Scripts/python.exe', DSH_MEDIA_BROWSER: 'r/b/chrome.exe', DSH_MEDIA_NODE_ENV: 'd' },
    pluginConfig: { 'eduwork-artifact-services': { transcription: { local: { executablePath: 'r/a/whisper-cli.exe', modelPath: 'r/a/model.bin' } } } },
  }
  const save = (base = product) => writeFile(join(base, 'desktop-resources.json'), JSON.stringify(manifest))
  await save()
  return { directory, product, manifest, save }
}

test('resource resolution repairs only the managed venv after moving a product', async t => {
  const { directory, product } = await fixture(t)
  const moved = join(directory, '移动后的 便携产品')
  await rename(product, moved)
  const result = await prepareNativeResources({ product: moved })
  const canonical = await realpath(moved)
  assert.equal(result.environment.DSH_OFFICE_PYTHON, join(canonical, 'r/v/Scripts/python.exe'))
  assert.equal(result.environment.DSH_MEDIA_NODE_ENV, join(canonical, 'd'))
  assert.equal(result.pluginConfig['eduwork-artifact-services'].transcription.local.modelPath, join(canonical, 'r/a/model.bin'))
  const cfg = await readFile(join(moved, 'r/v/pyvenv.cfg'), 'utf8')
  assert.ok(cfg.includes(`home = ${join(canonical, 'r/p')}`))
  assert.ok(!cfg.includes('stale location'))
  assert.deepEqual(await prepareNativeResources({ product: moved }), result)
})

test('resource resolver refuses escape paths, links and unowned Python environments', async t => {
  const { directory, product, manifest, save } = await fixture(t)
  manifest.environment.DSH_MEDIA_NODE_ENV = '../'
  await save(); await assert.rejects(prepareNativeResources({ product }), /escapes/)
  const outside = join(directory, 'outside'); await mkdir(outside)
  await symlink(outside, join(product, 'external'), process.platform === 'win32' ? 'junction' : 'dir')
  manifest.environment.DSH_MEDIA_NODE_ENV = 'external'
  await save(); await assert.rejects(prepareNativeResources({ product }), /link escapes/)
  manifest.environment.DSH_MEDIA_NODE_ENV = 'd'
  await save(); await writeFile(join(product, 'r/v/.eduwork-venv.json'), '{}')
  await assert.rejects(prepareNativeResources({ product }), /not managed/)
})

test('unconfigured products remain usable; resources cannot inject unrelated environment variables', async t => {
  const { product, manifest, save } = await fixture(t)
  manifest.environment.PYTHONPATH = 'r/p'
  await save(); await assert.rejects(prepareNativeResources({ product }), /Unsupported/)
  await rm(join(product, 'desktop-resources.json'))
  assert.deepEqual(await prepareNativeResources({ product }), { environment: {}, pluginConfig: {} })
})
