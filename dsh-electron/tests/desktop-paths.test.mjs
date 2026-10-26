import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve, join, relative } from 'node:path'
import { desktopPaths } from '../src/desktop-paths.mjs'

const settings = { distribution: 'example', productVersion: '0.3.6', configurationOwnership: 'user', product: '../product', node: '../runtime/node' }

test('first stable reuses Alpha data without combining two existing macOS homes', () => {
  const appRoot = resolve('synthetic-installed/Example.app/Contents/Resources/app'), appData = resolve('synthetic-user/Application Support')
  const options = { appRoot, appData, settings: { ...settings, productVersion: '0.4.0' }, platform: 'darwin' }
  const alphaOnly = desktopPaths({ ...options, exists: path => path.endsWith('example-electron-alpha') })
  assert.equal(alphaOnly.home, join(appData, 'example-electron-alpha/dsh'))
  const both = desktopPaths({ ...options, exists: () => true })
  assert.equal(both.home, join(appData, 'example-electron/dsh'))
  const future = desktopPaths({ ...options, settings: { ...settings, productVersion: '1.0.0' }, exists: path => path.endsWith('example-electron-alpha') })
  assert.equal(future.home, alphaOnly.home)
  const dev = { ...options, settings: { ...settings, productVersion: '0.4.4-dev.20261016.1' } }
  assert.equal(desktopPaths({ ...dev, exists: () => true }).home, both.home)
  assert.equal(desktopPaths({ ...dev, exists: path => path.endsWith('example-electron-alpha') }).home, alphaOnly.home)
})

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

test('Windows installed layout keeps program resources in P and writes under LocalAppData', () => {
  const appRoot = resolve('synthetic-installed/resources/app'), root = resolve('synthetic-installed')
  const localAppData = resolve('synthetic-user/LocalAppData')
  const paths = desktopPaths({ appRoot, localAppData, settings: { ...settings, dataLayout: 'installed' }, platform: 'win32' })
  const userRoot = join(localAppData, 'EduWork', 'example')
  assert.equal(paths.root, root)
  assert.equal(paths.layout, 'installed')
  assert.equal(paths.writableRoot, userRoot)
  assert.equal(paths.config, join(userRoot, 'config/eduwork.jsonc'))
  assert.equal(paths.home, join(userRoot, 'data/example-electron/dsh'))
  assert.equal(paths.userData, join(userRoot, 'data/example-electron/browser'))
  assert.equal(paths.logs, join(userRoot, 'data/example-electron/logs'))
  assert.equal(paths.updateDataRoot, join(userRoot, 'data'))
  assert.equal(paths.skillsManifestPath, join(root, 'RELEASE-MANIFEST.json'))
  assert.equal(paths.product, join(root, 'resources/product'))
  assert.equal(relative(userRoot, paths.config).startsWith('..'), false)
  assert.equal(relative(userRoot, paths.home).startsWith('..'), false)
  assert.equal(relative(root, paths.config).startsWith('..'), true)
  assert.equal(relative(root, paths.home).startsWith('..'), true)
})

test('Windows installed testRoot becomes the complete writable root', () => {
  const appRoot = resolve('synthetic-installed/resources/app'), root = resolve('synthetic-installed')
  const testRoot = resolve('synthetic-installed-user-root/example')
  const paths = desktopPaths({ appRoot, settings: { ...settings, dataLayout: 'installed' }, platform: 'win32', testRoot })
  assert.equal(paths.root, root)
  assert.equal(paths.writableRoot, testRoot)
  assert.equal(paths.config, join(testRoot, 'config/eduwork.jsonc'))
  assert.equal(paths.home, join(testRoot, 'data/example-electron/dsh'))
  assert.equal(paths.userData, join(testRoot, 'data/example-electron/browser'))
  assert.equal(paths.updateDataRoot, join(testRoot, 'data'))
  assert.equal(relative(root, paths.config).startsWith('..'), true)
  assert.equal(relative(testRoot, paths.config).startsWith('..'), false)
})

test('Windows installed layout requires a separate LocalAppData root and a Windows platform', () => {
  const appRoot = resolve('synthetic-installed/resources/app'), root = resolve('synthetic-installed')
  assert.throws(() => desktopPaths({ appRoot, settings: { ...settings, dataLayout: 'installed' }, platform: 'win32' }), /LocalAppData/)
  assert.throws(() => desktopPaths({ appRoot, localAppData: join(root, 'user'), settings: { ...settings, dataLayout: 'installed' }, platform: 'win32' }), /separate/)
  assert.throws(() => desktopPaths({ appRoot, appData: resolve('synthetic-user'), settings: { ...settings, dataLayout: 'installed' }, platform: 'darwin' }), /Windows/)
  assert.throws(() => desktopPaths({ appRoot, settings: { ...settings, dataLayout: 'unknown' }, platform: 'win32' }), /Unknown/)
})

test('Portable layout ignores LocalAppData and keeps the program root', () => {
  const appRoot = resolve('synthetic-portable/resources/app'), root = resolve('synthetic-portable')
  const paths = desktopPaths({ appRoot, localAppData: resolve('synthetic-user/LocalAppData'), settings, platform: 'win32' })
  assert.equal(paths.layout, 'portable')
  assert.equal(paths.writableRoot, root)
  assert.equal(paths.config, join(root, 'config/eduwork.jsonc'))
  assert.equal(paths.home, join(root, 'data/example-electron/dsh'))
})
