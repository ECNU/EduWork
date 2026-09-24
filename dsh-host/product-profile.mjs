import { readFile, writeFile, mkdir, lstat, readlink, symlink, unlink, realpath, rename } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep, dirname, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { prepareProductPresets } from './product-presets.mjs'
import { prepareNativeResources } from './native-resources.mjs'
import { loadUserConfig } from './user-config.mjs'
import { loadMediaProviders } from './media-config.mjs'
import { loadEnterpriseModelUpdates } from './enterprise-model-updates.mjs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { bundledConfigurationPlugins } from './configuration-plugin-options.mjs'
import { writeNativeProfile, legacyPresetPatches, nativePresetPatches } from './native-profile.mjs'

const json = async path => JSON.parse(await readFile(path, 'utf8'))
const same = (a, b) => process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b)
function inside(root, target) { const path = relative(root, target); return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep)) }
async function canonical(path) {
  path = resolve(path)
  try { return await realpath(path) }
  catch (error) {
    if (error.code !== 'ENOENT' || dirname(path) === path) throw error
    return join(await canonical(dirname(path)), basename(path))
  }
}
// Receipts may retain a short Windows path after a move. Compare the existing
// ancestor's identity even when the previous module directory is now absent.
const sameTarget = async (a, b) => typeof a === 'string' && typeof b === 'string' && same(await canonical(a), await canonical(b))
async function atomicJSON(path, value) {
  const temporary = path + '.' + randomUUID() + '.pending'
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n')
  await rename(temporary, path)
}
function mergeConfig(base = {}, extra = {}) {
  const result = { ...base }
  for (const [key, value] of Object.entries(extra)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid desktop configuration field')
    result[key] = value && typeof value === 'object' && !Array.isArray(value) ? mergeConfig(base[key], value) : value
  }
  return result
}

export async function prepareProductProfile({ product, home, shell, pluginConfig = {}, patches = [], enterpriseProfile, userConfig, configurationOwnership = 'user', managedContent = {} }) {
  if(!['user','publisher'].includes(configurationOwnership))throw new Error('Unknown desktop configuration ownership')
  product = await canonical(product); home = await canonical(home)
  if (!['electron', 'wails'].includes(shell)) throw new Error('Unknown desktop shell')
  // Assembly refuses to overwrite current. Runtime paths may legitimately live
  // there after an explicit promotion; data must still remain outside product.
  if (inside(product, home) || inside(home, product)) throw new Error('Desktop requires isolated product and data directories')
  const identity = await json(join(product, 'assembly.json'))
  const native = (identity.dshVersion === '0.1.7-rc.1' && identity.dshCommit === '46a7f68b0922371ce7144b668b90e377d8e799f4')
    || (identity.dshVersion === '0.1.7-alpha.2' && identity.dshCommit === '00102833dfaee1da9f48a3a8eae9d34005a75218')
  if (native && shell !== 'electron') throw new Error('The DSH 0.1.7 candidate supports Electron only')
  if (!native && (identity.dshVersion !== '0.1.5-rc.2' || identity.dshCommit !== 'fb2c4b9e698e30edb738bca4cf0618587db7d203')) throw new Error('Desktop product does not match the qualified DSH baseline')
  if (!/^[a-z0-9-]+$/u.test(identity.distribution)) throw new Error('Invalid distribution identity')
  const user = userConfig ? loadUserConfig(userConfig) : undefined
  if (user) {
    pluginConfig = mergeConfig(pluginConfig, user.pluginConfig)
    if (user.organizations.length) {
      try {
        const req = createRequire(join(product, 'd/package.json'))
        const { loadEnterpriseProfiles } = await import(pathToFileURL(req.resolve('@eduwork/dsh-oidc/profile')).href)
        // Validate profiles before starting the Host. No credentials are read.
        loadEnterpriseProfiles({ profiles: user.organizations }, {})
        if (shell === 'wails') user.organizations = await loadEnterpriseModelUpdates(product, user.organizations)
        loadEnterpriseProfiles({ profiles: user.organizations }, {})
      } catch (error) { throw new Error(`请检查配置文件 ${user.source.path}\n${error.message}`, { cause: error }) }
    }
    pluginConfig = mergeConfig(pluginConfig, {
      'eduwork-brand-settings': { product: user.product },
      'enterprise-oidc': { profiles: user.organizations, allowEmptyProfiles: true, manageProductBrand: false, configFile: user.source,
        ...(!enterpriseProfile ? { profilePathEnv: 'EDUWORK_NO_IMPLICIT_ENTERPRISE_PROFILE' } : {}) },
    })
  }
  // Shared provider configuration is independent of the desktop shell/edition.
  const media = await loadMediaProviders(product, shell === 'electron' && user ? { ...user, media: user.media ?? { providers: [] } } : user)
  pluginConfig = mergeConfig(pluginConfig, { 'eduwork-media-openai': media,
    'eduwork-artifact-services': { images: { enabled: media.providers.some(provider => provider.images?.enabled) } } })
  const resources = await prepareNativeResources({ product })
  pluginConfig = mergeConfig(resources.pluginConfig, pluginConfig)
  const ownerFile = join(home, '.eduwork-desktop-home.json')
  const owner = await json(ownerFile).catch(error => { if (error.code === 'ENOENT') return null; throw error })
  if (owner && (owner.schemaVersion !== 1 || owner.shell !== shell || owner.distribution !== identity.distribution)) throw new Error('This data directory belongs to another desktop edition')
  await mkdir(home, { recursive: true })
  await atomicJSON(ownerFile, { schemaVersion: 1, shell, distribution: identity.distribution })
  const profile = await canonical(join(home, 'profiles', native ? 'desktop-017' : 'desktop'))
  const target = await canonical(join(product, 'd', 'node_modules'))
  if (!inside(home, profile) || !inside(product, target)) throw new Error('Desktop profile or modules link escapes its owned directory')
  const link = join(profile, 'node_modules')
  const receiptFile = join(profile, '.eduwork-module-link.json')
  const pendingFile = join(profile, '.eduwork-module-link.pending.json')
  await mkdir(profile, { recursive: true })
  if (!native) {
  const entry = await lstat(link).catch(error => { if (error.code === 'ENOENT') return null; throw error })
  let receipt = await json(receiptFile).catch(error => { if (error.code === 'ENOENT') return null; throw error })
  const pending = await json(pendingFile).catch(error => { if (error.code === 'ENOENT') return null; throw error })
  let previous
  if (entry) {
    if (!entry.isSymbolicLink()) throw new Error('Desktop profile contains an unmanaged module directory')
    previous = await readlink(link)
    const committed = receipt?.schemaVersion === 1 && await sameTarget(previous, receipt.target)
    const interrupted = pending?.schemaVersion === 1 && await sameTarget(previous, pending.target)
      && (pending.previous === null || (receipt?.schemaVersion === 1 && await sameTarget(pending.previous, receipt.target)))
    if (!committed && !interrupted) throw new Error('Desktop profile contains an unmanaged module link')
    if (!committed && interrupted) {
      // Commit the already authenticated intermediate target before recording
      // another move. Repeated interruptions cannot lose ownership of it.
      receipt = { schemaVersion: 1, target: previous }
      await atomicJSON(receiptFile, receipt)
    }
  }
  // Record intent before unlink/create. A process interrupted after creating
  // the new junction can safely recognize it on the next launch.
  await atomicJSON(pendingFile, { schemaVersion: 1, previous: receipt?.target ?? null, target })
  if (entry) {
    if (!await sameTarget(previous, target)) await unlink(link)
  }
  if (!entry || !await sameTarget(await readlink(link).catch(error => { if (error.code === 'ENOENT') return null; throw error }), target)) await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir')
  await atomicJSON(receiptFile, { schemaVersion: 1, target })
  await unlink(pendingFile)
  }
  const composition = await json(join(product, 'composition.json'))
  const installed = new Set(composition.flatMap(row => (row.insert ?? []).map(plugin => plugin.id)))
  const bundleRows = []
  for (const [id, name] of Object.entries(bundledConfigurationPlugins)) if (identity.bundles?.includes(name)) {
    installed.add(id)
    if (pluginConfig[id]) bundleRows.push({ id, config: pluginConfig[id] })
  }
  for (const id of Object.keys(user?.pluginConfig ?? {})) {
    if (!installed.has(id)) throw new Error(`请检查配置文件 ${user.source.path}\nplugins.${id} 不属于此发行版已安装的插件`)
  }
  for (const row of composition) {
    for (const plugin of row.insert || []) {
      if (pluginConfig[plugin.id]) plugin.config = mergeConfig(plugin.config, pluginConfig[plugin.id])
      if (plugin.id === 'enterprise-oidc') plugin.config = { ...plugin.config, backend: 'desktop' }
    }
    if (row.id === 'session-query-sqlite') row.config = { ...row.config, path: join(home, 'session-query-memory.sqlite3') }
  }
  const desktop = [
    { id: 'credentials', disabled: true },
    { insert: [
      { id: 'eduwork-native-reveal', name: '@chatecnu-work/dsh-artifact-preview-native/session-controller' },
      { id: 'eduwork-native-credentials', name: '@chatecnu-work/dsh-credentials-native' },
      { id: 'eduwork-desktop-boundary', name: '@chatecnu-work/dsh-desktop-boundary' },
      { id: 'eduwork-desktop-services', name: '@eduwork/desktop-services', config: { notifications: user?.notifications ?? {} } },
    ] },
  ]
  if (native) {
    const yaml = await import(pathToFileURL(createRequire(join(product, 'd/package.json')).resolve('yaml')).href)
    const parse = text => yaml.parse(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => ({ __jsExpr: value }) }] })
    const legacyPresets = await legacyPresetPatches(home, parse)
    const nativePresets = await nativePresetPatches(join(product, 'd'), parse)
    await writeNativeProfile({ profile, bundles: identity.bundles, patches: [...nativePresets, ...composition, ...bundleRows, ...desktop, ...legacyPresets, ...patches], parse })
  } else {
    await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'eduwork-desktop-profile', private: true, type: 'module', dsh: { profile: { bundles: identity.bundles } } }, null, 2) + '\n')
    await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([...composition, ...bundleRows, ...desktop, ...patches], null, 2) + '\n')
  }
  const environment = {
    DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1',
    DSH_BUNDLED_SKILL_DIR: managedContent.skillRoot ?? join(product, 'skills'),
    ...native ? {} : await prepareProductPresets({ product, home }),
    EDUWORK_PRODUCT_ROOT: product, EDUWORK_DESKTOP_SHELL: shell,
    DSH_MEDIA_NODE_ENV: join(product, 'd'),
  }
  if (enterpriseProfile) {
    environment.EDUWORK_OIDC_PROFILE = resolve(enterpriseProfile)
    environment.DSH_OIDC_ENTERPRISE_PROFILE = resolve(enterpriseProfile)
  }
  Object.assign(environment, resources.environment)
  if (user?.features?.visionFallback !== undefined) environment.EDUWORK_VISION_FALLBACK = String(user.features.visionFallback)
  environment.EDUWORK_MAX_CONCURRENT_REQUESTS = String(user?.features?.maxConcurrentRequests ?? 3)
  return { profile, environment, identity, ...(user ? { desktop: { productName: user.product.name || identity.brand?.product?.name || 'EduWork', closeAction: user.closeAction, configFile: user.source } } : {}) }
}
