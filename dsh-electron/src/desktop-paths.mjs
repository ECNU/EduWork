import { join, resolve, isAbsolute } from 'node:path'
import { desktopConfigurationPath } from './configuration-policy.mjs'

/** Keep the signed app bundle separate from per-user mutable state on macOS. */
export function desktopPaths({ appRoot, appData, settings, platform = process.platform, testRoot, configOverride }) {
  const mac = platform === 'darwin'
  const root = resolve(appRoot, mac ? '../../..' : '../..')
  const writableRoot = mac ? join(appData, settings.distribution + '-electron') : root
  if (testRoot && (!isAbsolute(testRoot) || /(?:^|[\\/])current(?:[\\/]|$)/iu.test(testRoot))) throw new Error('Test data requires an isolated absolute directory')
  const dataRoot = testRoot ? resolve(testRoot) : mac ? writableRoot : join(root, 'data', settings.distribution + '-electron')
  return {
    root,
    updateDataRoot: testRoot ? join(dataRoot, 'updates') : join(writableRoot, 'data'),
    skillsManifestPath: mac ? join(appRoot, '../bundled-skills.json') : join(root, 'RELEASE-MANIFEST.json'),
    product: resolve(appRoot, settings.product),
    node: resolve(appRoot, settings.node),
    home: join(dataRoot, 'dsh'),
    userData: join(dataRoot, 'browser'),
    logs: join(dataRoot, 'logs'),
    config: desktopConfigurationPath({ root: writableRoot, version: settings.productVersion, ownership: settings.configurationOwnership, override: configOverride }),
    legacyConfig: settings.configurationOwnership === 'publisher' && settings.publisherConfig ? resolve(appRoot, settings.publisherConfig) : undefined,
    icon: mac ? resolve(appRoot, '../brand/icon-256.png') : join(root, 'resources/brand/icon-256.png'),
  }
}
