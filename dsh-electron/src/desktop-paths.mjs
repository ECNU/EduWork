import { join, resolve, isAbsolute, relative, sep } from 'node:path'
import { desktopConfigurationPath } from './configuration-policy.mjs'
import { existsSync } from 'node:fs'

const inside = (root, target, platform) => {
  let base = resolve(root), child = resolve(target)
  if (platform === 'win32') { base = base.toLowerCase(); child = child.toLowerCase() }
  const rel = relative(base, child)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep))
}

/** Keep the signed app bundle separate from per-user mutable state on macOS. */
export function desktopPaths({ appRoot, appData, localAppData, settings, platform = process.platform, testRoot, configOverride, exists = existsSync }) {
  const mac = platform === 'darwin'
  const layout = settings.dataLayout ?? 'portable'
  if (!['portable', 'installed'].includes(layout)) throw new Error('Unknown desktop data layout')
  if (layout === 'installed' && platform !== 'win32') throw new Error('Installed desktop data layout is only supported on Windows')
  const installed = layout === 'installed'
  const root = resolve(appRoot, mac ? '../../..' : '../..')
  let namespace = settings.distribution + '-electron' + (mac && settings.sourceAlpha === true ? '-alpha' : '')
  // First ordinary-identity adoption may reuse the Alpha home in place. Never combine two
  // existing homes or copy a live database. Future launches make the same choice.
  if (mac && !testRoot && !settings.sourceAlpha
    && !exists(join(appData, namespace)) && exists(join(appData, namespace + '-alpha'))) namespace += '-alpha'
  if (testRoot && (!isAbsolute(testRoot) || /(?:^|[\\/])current(?:[\\/]|$)/iu.test(testRoot))) throw new Error('Test data requires an isolated absolute directory')
  let writableRoot
  if (installed) {
    if (testRoot) writableRoot = resolve(testRoot)
    else if (localAppData) writableRoot = join(resolve(localAppData), 'EduWork', settings.distribution)
    else throw new Error('Installed desktop data layout requires the system LocalAppData directory')
    if (inside(root, writableRoot, platform) || inside(writableRoot, root, platform)) {
      throw new Error('Installed data directory must be separate from the program directory')
    }
    if (configOverride && (!isAbsolute(configOverride) || !inside(writableRoot, configOverride, platform))) {
      throw new Error('Installed mode configuration override must be an absolute path inside the writable root')
    }
  } else {
    writableRoot = mac ? join(appData, namespace) : root
  }
  const dataRoot = installed
    ? join(writableRoot, 'data', namespace)
    : testRoot ? resolve(testRoot) : mac ? writableRoot : join(root, 'data', namespace)
  const updateDataRoot = installed
    ? join(writableRoot, 'data')
    : testRoot ? join(dataRoot, 'updates') : join(writableRoot, 'data')
  return {
    root,
    writableRoot,
    dataRoot,
    layout,
    updateDataRoot,
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
