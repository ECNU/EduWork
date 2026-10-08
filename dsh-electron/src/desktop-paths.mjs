import { join, resolve, isAbsolute } from 'node:path'
import { desktopConfigurationPath } from './configuration-policy.mjs'
import { existsSync } from 'node:fs'
import { usesStableDefault } from './update-channel-migration.mjs'

/** Keep the signed app bundle separate from per-user mutable state on macOS. */
export function desktopPaths({ appRoot, appData, settings, platform = process.platform, testRoot, configOverride, exists = existsSync }) {
  const mac = platform === 'darwin'
  const root = resolve(appRoot, mac ? '../../..' : '../..')
  let namespace = settings.distribution + '-electron' + (mac && settings.sourceAlpha === true ? '-alpha' : '')
  // First stable adoption may reuse the Alpha home in place. Never combine two
  // existing homes or copy a live database. Future launches make the same choice.
  if (mac && !testRoot && !settings.sourceAlpha && usesStableDefault(settings.productVersion)
    && !exists(join(appData, namespace)) && exists(join(appData, namespace + '-alpha'))) namespace += '-alpha'
  const writableRoot = mac ? join(appData, namespace) : root
  if (testRoot && (!isAbsolute(testRoot) || /(?:^|[\\/])current(?:[\\/]|$)/iu.test(testRoot))) throw new Error('Test data requires an isolated absolute directory')
  const dataRoot = testRoot ? resolve(testRoot) : mac ? writableRoot : join(root, 'data', namespace)
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
