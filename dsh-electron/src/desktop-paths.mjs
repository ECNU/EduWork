import { join, resolve, relative, isAbsolute, sep, win32, posix } from 'node:path'
import { desktopConfigurationPath } from './configuration-policy.mjs'
import { existsSync } from 'node:fs'

export function assertSeparateRoots(programRoot, userRoot, platform = process.platform) {
  const path = platform === 'win32' ? win32 : posix
  const normalize = value => { const resolved = path.resolve(value); return platform === 'win32' ? resolved.toLowerCase() : resolved }
  const a = normalize(programRoot), b = normalize(userRoot)
  const contains = (parent, child) => { const rel = path.relative(parent, child); return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel) }
  if (a === b || contains(a, b) || contains(b, a)) throw new Error('Program and user data directories must be separate')
}

/** Keep the signed app bundle separate from per-user mutable state on macOS. */
export function desktopPaths({ appRoot, appData, settings, platform = process.platform, testRoot, configOverride, exists = existsSync }) {
  const mac = platform === 'darwin'
  const root = resolve(appRoot, mac ? '../../..' : '../..')
  const installed = !mac && settings.dataLayout === 'installed'
  let namespace = settings.distribution + '-electron' + (mac && settings.sourceAlpha === true ? '-alpha' : '')
  // First ordinary-identity adoption may reuse the Alpha home in place. Never combine two
  // existing homes or copy a live database. Future launches make the same choice.
  if (mac && !testRoot && !settings.sourceAlpha
    && !exists(join(appData, namespace)) && exists(join(appData, namespace + '-alpha'))) namespace += '-alpha'
  if (testRoot && (!isAbsolute(testRoot) || /(?:^|[\\/])current(?:[\\/]|$)/iu.test(testRoot))) throw new Error('Test data requires an isolated absolute directory')
  let writableRoot
  if (mac) writableRoot = join(appData, namespace)
  else if (installed) {
    // Installed candidates keep personal state outside the program directory so
    // program replacement and uninstall never touch it.
    if (testRoot) writableRoot = resolve(testRoot)
    else {
      if (!appData || !isAbsolute(appData)) throw new Error('Installed layout requires an absolute per-user appData directory')
      writableRoot = join(appData, 'EduWork', settings.distribution)
    }
    assertSeparateRoots(root, writableRoot, platform)
  } else writableRoot = root
  const dataRoot = testRoot
    ? (installed ? join(writableRoot, 'data', namespace) : resolve(testRoot))
    : mac ? writableRoot : join(writableRoot, 'data', namespace)
  const config = desktopConfigurationPath({ root: writableRoot, version: settings.productVersion, ownership: settings.configurationOwnership, override: configOverride })
  if (installed) {
    // A file, not a directory: only "inside the program root" is forbidden.
    const norm = path => { const resolved = resolve(path); return platform === 'win32' ? resolved.toLowerCase() : resolved }
    const rel = relative(norm(root), norm(config))
    if (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep)) throw new Error('Program and user data directories must be separate')
  }
  return {
    root,
    userRoot: writableRoot,
    updateDataRoot: testRoot && !installed ? join(dataRoot, 'updates') : join(writableRoot, 'data'),
    skillsManifestPath: mac ? join(appRoot, '../bundled-skills.json') : join(root, 'RELEASE-MANIFEST.json'),
    product: resolve(appRoot, settings.product),
    node: resolve(appRoot, settings.node),
    home: join(dataRoot, 'dsh'),
    userData: join(dataRoot, 'browser'),
    logs: join(dataRoot, 'logs'),
    config,
    legacyConfig: settings.configurationOwnership === 'publisher' && settings.publisherConfig ? resolve(appRoot, settings.publisherConfig) : undefined,
    icon: mac ? resolve(appRoot, '../brand/icon-256.png') : join(root, 'resources/brand/icon-256.png'),
  }
}
