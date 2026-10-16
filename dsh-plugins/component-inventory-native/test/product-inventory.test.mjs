import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { productInventory } from '../lib/product-inventory.js'

test('both shells report the same native content; Electron is its own Chromium', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-inventory-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const put = async (path, value) => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), JSON.stringify(value)) }
  await put('assembly.json', { version: '0.3.0-rc.4', dshVersion: '0.1.5-rc.1', dshCommit: 'fixture' })
  await put('desktop-resources.json', { platform: 'win32-x64', environment: { DSH_OFFICE_PYTHON: 'r/v/Scripts/python.exe', DSH_MEDIA_BROWSER: 'r/b/chrome.exe' }, python: { baseRoot: 'r/p', version: '3.12.13' }, browser: { version: '152' } })
  for (const path of ['r/p/python.exe', 'r/v/Scripts/python.exe', 'r/b/chrome.exe', 'd/node_modules/@deepseek-ai/dsh/package.json', 'd/node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe', 'EduWork-Electron.exe']) await put(path, {})
  await put('d/node_modules/remotion/package.json', { version: '4.0.520' })
  const shell = { EDUWORK_PRODUCT_ROOT: root, EDUWORK_DESKTOP_SHELL: 'electron', DSH_MEDIA_BROWSER: join(root, 'EduWork-Electron.exe'), EDUWORK_CHROMIUM_VERSION: '152.0.7977.54' }
  const snapshots = [productInventory({ EDUWORK_PRODUCT_ROOT: root, EDUWORK_DESKTOP_SHELL: 'wails' }), productInventory(shell)]
  for (const { release, components } of snapshots) {
    assert.equal(release.productVersion, '0.3.0-rc.4')
    assert.equal(release.distributionMode, 'desktop-release')
    for (const id of ['python', 'office-suite', 'chromium', 'video-production']) assert.equal(components.find(row => row.id === id).status, 'ready')
    assert.equal(components.find(row => row.id === 'local-asr').status, 'missing')
  }
  const chromium = snapshot => snapshot.components.find(row => row.id === 'chromium')
  assert.deepEqual([chromium(snapshots[0]).version, chromium(snapshots[0]).path], ['152', 'r/b/chrome.exe'])
  assert.deepEqual([chromium(snapshots[1]).version, chromium(snapshots[1]).path, chromium(snapshots[1]).dependencies], ['152.0.7977.54', null, ['electron']])
  const content = snapshot => snapshot.components.filter(row => !['desktop-shell', 'electron', 'chromium'].includes(row.id))
  assert.deepEqual(content(snapshots[0]), content(snapshots[1]))
  // Video depends on the running shell, not on a browser left in the product.
  const unlaunched = productInventory({ ...shell, DSH_MEDIA_BROWSER: undefined }).components
  for (const id of ['chromium', 'video-production']) assert.equal(unlaunched.find(row => row.id === id).status, 'missing')
})

test('About reports the edition and running Electron version without mistaking the product version for a framework version', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-about-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const name of ['EduWork', 'EduWork@ECNU']) {
    await writeFile(join(root, 'assembly.json'), JSON.stringify({ version: '0.3.6-dev.fixture', brand: { product: { name } }, dshVersion: '0.1.5-rc.2', dshCommit: 'fixture' }))
    const env = { EDUWORK_PRODUCT_ROOT: root, EDUWORK_DESKTOP_SHELL: 'electron', EDUWORK_ELECTRON_VERSION: '42.0.0' }
    const snapshot = productInventory(env)
    assert.equal(snapshot.release.productName, name)
    assert.equal(snapshot.release.platform, `${process.platform}-${process.arch}`)
    assert.equal(snapshot.release.productVersion, '0.3.6-dev.fixture')
    assert.equal(snapshot.components.find(row => row.id === 'electron').version, '42.0.0')
    assert.equal(snapshot.components.find(row => row.id === 'electron').status, 'ready')
    assert.equal(productInventory({ ...env, EDUWORK_PRODUCT_NAME: 'Example institution' }).release.productName, 'Example institution')
    delete env.EDUWORK_ELECTRON_VERSION
    assert.equal(productInventory(env).components.find(row => row.id === 'electron').status, 'unavailable')
    delete env.EDUWORK_DESKTOP_SHELL
    assert.equal(productInventory(env).components.some(row => row.id === 'electron'), false)
  }
})

test('macOS receipts resolve native executables and preserve older receipts without invented versions', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-mac-inventory-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const put = async (path, value) => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), JSON.stringify(value)) }
  await put('assembly.json', { version: 'fixture', dshVersion: 'fixture', dshCommit: 'fixture' })
  const receipt = { platform: 'darwin-arm64', environment: { DSH_OFFICE_PYTHON: 'r/office-python' } }
  for (const path of ['r/p/bin/python3', ...Object.values(receipt.environment), 'd/node_modules/@remotion/compositor-darwin-arm64/ffmpeg', 'Electron']) await put(path, {})
  await put('d/node_modules/remotion/package.json', { version: '4.0.520' })
  const env = { EDUWORK_PRODUCT_ROOT: root, EDUWORK_DESKTOP_SHELL: 'electron', DSH_MEDIA_BROWSER: join(root, 'Electron') }
  await put('desktop-resources.json', receipt)
  const old = productInventory(env).components
  for (const id of ['python', 'office-suite', 'video-production']) assert.equal(old.find(row => row.id === id).status, 'ready')
  assert.equal(old.find(row => row.id === 'python').version, null)
  receipt.python = { executable: 'r/p/bin/python3', version: '3.12.13' }
  await put('desktop-resources.json', receipt)
  assert.equal(productInventory(env).components.find(row => row.id === 'python').version, '3.12.13')
  await rm(join(root, 'd/node_modules/@remotion/compositor-darwin-arm64/ffmpeg'))
  assert.equal(productInventory(env).components.find(row => row.id === 'video-production').status, 'missing')
})
