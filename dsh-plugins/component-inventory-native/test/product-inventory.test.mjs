import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { productInventory } from '../lib/product-inventory.js'

test('both shells report the same native content from actual assembly receipts', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-inventory-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const put = async (path, value) => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), JSON.stringify(value)) }
  await put('assembly.json', { version: '0.3.0-rc.4', dshVersion: '0.1.5-rc.1', dshCommit: 'fixture' })
  await put('desktop-resources.json', { platform: 'win32-x64', environment: { DSH_OFFICE_PYTHON: 'r/v/Scripts/python.exe', DSH_MEDIA_BROWSER: 'r/b/chrome.exe' }, python: { baseRoot: 'r/p', version: '3.12.13' }, browser: { version: '152' } })
  for (const path of ['r/p/python.exe', 'r/v/Scripts/python.exe', 'r/b/chrome.exe', 'd/node_modules/@deepseek-ai/dsh/package.json', 'd/node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe']) await put(path, {})
  await put('d/node_modules/remotion/package.json', { version: '4.0.520' })
  const snapshots = ['wails', 'electron'].map(shell => productInventory({ EDUWORK_PRODUCT_ROOT: root, EDUWORK_DESKTOP_SHELL: shell }))
  for (const { release, components } of snapshots) {
    assert.equal(release.productVersion, '0.3.0-rc.4')
    assert.equal(release.distributionMode, 'desktop-release')
    for (const id of ['python', 'office-suite', 'video-production']) assert.equal(components.find(row => row.id === id).status, 'ready')
    assert.equal(components.find(row => row.id === 'local-asr').status, 'missing')
  }
  assert.deepEqual(snapshots[0].components.slice(1), snapshots[1].components.slice(1))
})
