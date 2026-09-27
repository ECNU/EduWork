import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve, join, relative } from 'node:path'
import { desktopPaths } from '../src/desktop-paths.mjs'

const settings = { distribution: 'example', productVersion: '0.3.6', configurationOwnership: 'user', product: '../product', node: '../runtime/node' }

test('macOS mutable paths and both editions use the user config directory, including older publisher metadata', () => {
  const root = resolve('synthetic-installed/Example.app'), appRoot = join(root, 'Contents/Resources/app'), appData = resolve('synthetic-user/Application Support')
  const options = { appRoot, appData, settings, platform: 'darwin' }
  const paths = desktopPaths(options), userRoot = join(appData, 'example-electron')
  assert.equal(paths.root, root)
  assert.equal(paths.product, join(root, 'Contents/Resources/product'))
  for (const path of [paths.config, paths.home, paths.userData, paths.logs, paths.updateDataRoot]) {
    assert.equal(relative(userRoot, path).startsWith('..'), false)
    assert.equal(relative(root, path).startsWith('..'), true)
  }
  assert.equal(paths.skillsManifestPath, join(root, 'Contents/Resources/bundled-skills.json'))
  const publisherConfig = resolve('synthetic-publisher/config.jsonc')
  assert.equal(desktopPaths({ ...options, settings: { ...settings, configurationOwnership: 'publisher', publisherConfig } }).config, paths.config)
  assert.equal(desktopPaths({ ...options, configOverride: publisherConfig }).config, publisherConfig)
  const testRoot = resolve('synthetic-isolated-test')
  assert.equal(desktopPaths({ ...options, testRoot }).updateDataRoot, join(testRoot, 'updates'))
})

test('Windows portable config, update state and manifest locations stay compatible', () => {
  const root = resolve('synthetic-portable'), appRoot = join(root, 'resources/app')
  const paths = desktopPaths({ appRoot, settings, platform: 'win32' })
  assert.equal(paths.root, root)
  assert.equal(paths.config, join(root, 'config/eduwork.jsonc'))
  assert.equal(paths.home, join(root, 'data/example-electron/dsh'))
  assert.equal(paths.updateDataRoot, join(root, 'data'))
  assert.equal(paths.skillsManifestPath, join(root, 'RELEASE-MANIFEST.json'))
  assert.throws(() => desktopPaths({ appRoot, settings, platform: 'win32', testRoot: 'relative' }))
  assert.throws(() => desktopPaths({ appRoot, settings, platform: 'win32', testRoot: join(root, 'current') }))
})

test('macOS source Alpha isolates all writable state without moving the read-only product', () => {
  const appRoot = resolve('synthetic-installed/Example Alpha.app/Contents/Resources/app')
  const options = { appRoot, appData: resolve('synthetic-user/Application Support'), settings, platform: 'darwin' }
  const normal = desktopPaths(options), alpha = desktopPaths({ ...options, settings: { ...settings, sourceAlpha: true } })
  assert.equal(alpha.product, normal.product)
  assert.equal(alpha.skillsManifestPath, normal.skillsManifestPath)
  for (const field of ['config', 'home', 'userData', 'logs', 'updateDataRoot']) {
    assert.notEqual(alpha[field], normal[field])
    assert.equal(relative(join(options.appData, 'example-electron-alpha'), alpha[field]).startsWith('..'), false)
  }
  assert.equal(desktopPaths({ ...options, settings: { ...settings, sourceAlpha: false } }).config, normal.config)
  const windows = { appRoot: resolve('synthetic-portable/resources/app'), settings, platform: 'win32' }
  assert.deepEqual(desktopPaths({ ...windows, settings: { ...settings, sourceAlpha: true } }), desktopPaths(windows))
})
