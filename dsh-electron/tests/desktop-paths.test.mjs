import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve, join, relative } from 'node:path'
import { desktopPaths } from '../src/desktop-paths.mjs'

const settings = { distribution: 'example', productVersion: '0.3.6', configurationOwnership: 'user', product: '../product', node: '../runtime/node' }

test('macOS mutable paths stay outside the app and external publisher config remains external', () => {
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
  assert.equal(desktopPaths({ ...options, settings: { ...settings, configurationOwnership: 'publisher', publisherConfig } }).config, publisherConfig)
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
