import { join, resolve, isAbsolute } from 'node:path'
import { desktopConfigurationPath } from './configuration-policy.mjs'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { usesStableDefault } from './update-channel-migration.mjs'

/** Keep the signed app bundle separate from per-user mutable state on macOS. */
export function desktopPaths({ appRoot, appData, settings, platform = process.platform, testRoot, configOverride, userHome = homedir(), exists = existsSync }) {
  const mac = platform === 'darwin'
  const root = resolve(appRoot, mac ? '../../..' : '../..')
  let namespace = settings.distribution + '-electron' + (mac && settings.sourceAlpha === true ? '-alpha' : '')
  // First stable adoption may reuse the Alpha home in place. Never combine two
  // existing homes or copy a live database. Future launches make the same choice.
  if (mac && !testRoot && !settings.sourceAlpha && usesStableDefault(settings.productVersion)
    && !exists(join(appData, namespace)) && exists(join(appData, namespace + '-alpha'))) namespace += '-alpha'
  const writableRoot = mac ? join(appData, namespace) : root
  if (testRoot && (!isAbsolute(testRoot) || /(?:^|[\\/])current(?:[\\/]|$)/iu.test(testRoot))) throw new Error('Test data requires an isolated absolute directory')
  if (!isAbsolute(userHome) || !/^[a-z0-9-]+$/u.test(settings.distribution)) throw new Error('Invalid desktop user directory or distribution')
  let userRoot = testRoot ? resolve(testRoot) : join(userHome, '.config', settings.distribution + (mac && settings.sourceAlpha === true ? '-alpha' : ''))
  if (mac && !testRoot && !settings.sourceAlpha && usesStableDefault(settings.productVersion)
    && !exists(userRoot) && exists(userRoot + '-alpha')) userRoot += '-alpha'
  const legacyDataRoot = mac ? writableRoot : join(root, 'data', namespace)
  const dataRoot = userRoot
  return {
    root,
    userRoot,
    legacy: testRoot ? undefined : { dataRoot: legacyDataRoot, configRoot: join(writableRoot, 'config'), updateDataRoot: join(writableRoot, 'data') },
    updateDataRoot: join(userRoot, 'data'),
    skillsManifestPath: mac ? join(appRoot, '../bundled-skills.json') : join(root, 'RELEASE-MANIFEST.json'),
    product: resolve(appRoot, settings.product),
    node: resolve(appRoot, settings.node),
    home: join(dataRoot, 'dsh'),
    userData: join(dataRoot, 'browser'),
    logs: join(dataRoot, 'logs'),
    config: desktopConfigurationPath({ root: userRoot, flat: true, version: settings.productVersion, ownership: settings.configurationOwnership, override: configOverride }),
    legacyConfig: settings.configurationOwnership === 'publisher' && settings.publisherConfig ? resolve(appRoot, settings.publisherConfig) : undefined,
    icon: mac ? resolve(appRoot, '../brand/icon-256.png') : join(root, 'resources/brand/icon-256.png'),
  }
}
