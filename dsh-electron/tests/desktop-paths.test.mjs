import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve, join, relative } from 'node:path'
import { desktopPaths } from '../src/desktop-paths.mjs'

const settings = { distribution: 'eduwork', productVersion: '0.4.2', configurationOwnership: 'user', product: '../product', node: '../runtime/node' }
const userHome = resolve('synthetic-user')
function options(platform = 'darwin') {
  return { platform, userHome, appData: join(userHome, 'Application Support'), settings,
    appRoot: resolve(platform === 'darwin' ? 'installed/EduWork.app/Contents/Resources/app' : 'installed/resources/app'), exists: () => false }
}

for (const platform of ['darwin', 'win32']) test(`${platform} uses the same user layout outside installation`, () => {
  const paths = desktopPaths(options(platform)), userRoot = join(userHome, '.config/eduwork')
  assert.equal(paths.userRoot, userRoot)
  assert.equal(paths.config, join(userRoot, 'eduwork.jsonc'))
  assert.equal(paths.home, join(userRoot, 'dsh'))
  assert.equal(paths.userData, join(userRoot, 'browser'))
  assert.equal(paths.logs, join(userRoot, 'logs'))
  assert.equal(paths.updateDataRoot, join(userRoot, 'data'))
  for (const field of ['config', 'home', 'userData', 'logs', 'updateDataRoot']) assert.ok(relative(paths.root, paths[field]).startsWith('..'))
  const publisher = desktopPaths({ ...options(platform), settings: { ...settings, configurationOwnership: 'publisher' } })
  assert.equal(publisher.config, paths.config)
})

test('legacy source paths and immutable product assets stay platform specific', () => {
  const mac = desktopPaths(options()), win = desktopPaths(options('win32'))
  assert.equal(mac.legacy.dataRoot, join(userHome, 'Application Support/eduwork-electron'))
  assert.equal(mac.legacy.configRoot, join(mac.legacy.dataRoot, 'config'))
  assert.equal(win.legacy.dataRoot, join(win.root, 'data/eduwork-electron'))
  assert.equal(win.legacy.configRoot, join(win.root, 'config'))
  assert.equal(win.legacy.updateDataRoot, join(win.root, 'data'))
  assert.equal(mac.skillsManifestPath, join(mac.root, 'Contents/Resources/bundled-skills.json'))
  assert.equal(win.skillsManifestPath, join(win.root, 'RELEASE-MANIFEST.json'))
})

test('edition and Alpha namespaces remain isolated with deterministic stable adoption', () => {
  const normal = desktopPaths(options())
  const edition = desktopPaths({ ...options(), settings: { ...settings, distribution: 'eduwork-example' } })
  const alpha = desktopPaths({ ...options(), settings: { ...settings, sourceAlpha: true } })
  assert.notEqual(edition.userRoot, normal.userRoot)
  assert.equal(alpha.userRoot, normal.userRoot + '-alpha')
  const reuse = desktopPaths({ ...options(), exists: path => path.endsWith('-alpha') })
  assert.equal(reuse.userRoot, alpha.userRoot)
  assert.equal(reuse.legacy.dataRoot, join(userHome, 'Application Support/eduwork-electron-alpha'))
  assert.equal(desktopPaths({ ...options(), exists: () => true }).userRoot, normal.userRoot)
})

test('test roots isolate configuration too; explicit overrides remain absolute', () => {
  const testRoot = resolve('isolated-test'), paths = desktopPaths({ ...options(), testRoot })
  assert.equal(paths.config, join(testRoot, 'eduwork.jsonc'))
  assert.equal(paths.home, join(testRoot, 'dsh'))
  assert.equal(paths.legacy, undefined)
  const override = join(testRoot, 'custom.jsonc')
  assert.equal(desktopPaths({ ...options(), testRoot, configOverride: override }).config, override)
  assert.throws(() => desktopPaths({ ...options(), testRoot: 'relative' }))
  assert.throws(() => desktopPaths({ ...options(), configOverride: 'relative' }))
  assert.throws(() => desktopPaths({ ...options(), settings: { ...settings, distribution: '../invalid' } }))
})
