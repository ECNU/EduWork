import { readFile, readdir, lstat } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { loadUserConfig } from './user-config.mjs'
import { compareVersions, digest, verifiedManifest, validateBundle, incompatible } from './content-update-protocol.mjs'
import { ConfigurationFile, readConfiguration, configurationFingerprints } from './configuration-file.mjs'
import { updateEnterpriseModels } from './enterprise-model-updates.mjs'

/** Only publisher-owned editions can opt in. The descriptor is part of the app. */
export async function readPublisherBootstrap({ ownership, product, platform = process.platform }) {
  if (ownership !== 'publisher') return null
  if (!['win32', 'darwin', 'linux'].includes(platform)) throw Error('不支持的发行配置平台')
  let bytes, descriptorPath
  for (const name of [`publisher-bootstrap.${platform}.json`, 'publisher-bootstrap.json']) {
    descriptorPath = join(product, 'resources/desktop', name)
    try { bytes = await readFile(descriptorPath); break }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  if (!bytes) return null
  if (bytes.length > 16384) throw Error('发行引导配置过大')
  const descriptor = JSON.parse(bytes.toString('utf8'))
  if (!descriptor || Object.keys(descriptor).some(k => !['schemaVersion', 'updates', 'contentUpdates'].includes(k))) throw Error('发行引导配置只能包含更新渠道与验签信息')
  const trusted = loadUserConfig(descriptorPath), source = trusted.contentUpdates
  if (!source?.configuration || (source.bundled.configuration ?? 0) !== 0) throw Error('首次下载配置必须启用 configuration，内置配置修订号必须为 0')
  // A packaging channel is chosen by desktop settings, not by a shared descriptor.
  if (trusted.updates.defaultPolicy) throw Error('默认渠道须在打包时指定，不能写入发行引导配置')
  return trusted
}

export async function publisherBootstrap({ ownership, product, distribution, version, configPath, dataRoot, identity = {}, legacyConfigPath, migrateLegacy = true }) {
  if (ownership !== 'publisher') return null
  const trusted = await readPublisherBootstrap({ ownership, product })
  const file = await new ConfigurationFile(configPath, dataRoot).open()
  let migratedFrom
  if (!file.state.initialized) {
    const source = trusted?.contentUpdates
    const scope = source ? digest(JSON.stringify([distribution, source.publisher, source.baseURL, source.publicKey])) : null
    const oldCache = scope ? join(dataRoot, 'publisher-bootstrap', scope, 'eduwork.jsonc') : null
    const current = await readConfiguration(configPath)
    const seed = await readConfiguration(legacyConfigPath ?? join(product, 'resources/desktop/eduwork.jsonc'))
    if (!seed && !current) throw Error('缺少初始配置，请创建 config/eduwork.jsonc')
    const folder = dirname(configPath), cleanup = []
    const names = (await readdir(folder).catch(error => { if (error.code === 'ENOENT') return []; throw error }))
      .map(name => ({ name, version: /^eduwork\.(.+)\.jsonc$/.exec(name)?.[1] }))
      .filter(item => { try { return item.version && compareVersions(item.version, version) <= 0 } catch { return false } })
      .sort((a, b) => compareVersions(b.version, a.version))
    let baseline
    for (const path of migrateLegacy ? [oldCache, ...names.map(item => join(folder, item.name))].filter(Boolean) : []) {
      const info = await lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error })
      if (!info?.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) continue
      // A damaged obsolete cache can be ignored. An invalid editable active
      // file above is reported to its owner, never silently replaced.
      const candidate = await readConfiguration(path).catch(() => null)
      if (!candidate) continue
      cleanup.push(path === oldCache ? { kind: 'bootstrap', scope, hash: digest(candidate.text) }
        : { kind: 'version', name: path.slice(folder.length + 1), hash: digest(candidate.text) })
      if (!baseline && candidate.value.organizations?.length) { baseline = candidate.value; migratedFrom = path }
    }
    let value = baseline ? { ...seed?.value, ...baseline, ...(trusted ? { updates: trusted.updates, contentUpdates: source } : {}) }
      : { ...seed?.value, ...current?.value,
          updates: Object.keys(current?.value.updates ?? {}).length ? current.value.updates : trusted?.updates ?? seed?.value.updates ?? {},
          ...(current?.value.contentUpdates || source ? { contentUpdates: current?.value.contentUpdates ?? source } : {}) }
    let defaults = null
    if (baseline) {
      // Materialize the old *effective* configuration, not the stale root file.
      const state = scope ? await readFile(join(dataRoot, 'content-updates', scope, 'state.json'), 'utf8').then(JSON.parse)
        .catch(error => { if (error.code !== 'ENOENT') throw error; return {} })
        : {}
      const key = state.active?.configuration
      if (key && /^[1-9]\d*-[a-f0-9]{64}$/.test(key)) {
        const directory = join(dataRoot, 'content-updates', scope, key)
        const envelope = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
        const manifest = verifiedManifest(envelope, source)
        if (key !== `${manifest.revision}-${manifest.bundle.sha256}`) throw Error('旧配置内容身份不一致')
        const environment = { version, dshVersion: identity.dshVersion,
          capabilities: [...Object.keys(identity.localPlugins ?? {}).map(name => 'plugin:' + name), ...Object.keys(identity.managedPackages ?? {}).map(name => 'package:' + name)] }
        const reason = incompatible(manifest.requires, environment)
        if (reason) throw Error(reason)
        const bundle = validateBundle(await readFile(join(directory, 'bundle.json')), manifest, environment)
        value = { ...value, ...bundle.configuration, features: { ...value.features, ...bundle.configuration?.features } }
        defaults = { key, scope, revision: manifest.components.configuration, fingerprints: configurationFingerprints(bundle.configuration), conflicts: [] }
      } else {
        const catalog = await readFile(join(product, 'resources/desktop/enterprise-model-updates.json'), 'utf8').then(JSON.parse)
          .catch(error => { if (error.code !== 'ENOENT') throw error })
        if (catalog) value.organizations = updateEnterpriseModels(value.organizations, catalog)
      }
      if (value.media === undefined) {
        const media = await readFile(join(product, 'resources/desktop/media-defaults.json'), 'utf8').then(JSON.parse)
          .catch(error => { if (error.code !== 'ENOENT') throw error })
        if (media) value.media = { providers: media.providers.filter(provider => !provider.oidcProfileId || value.organizations.some(org => org.id === provider.oidcProfileId)) }
      }
    }
    await file.initialize(value, { defaults, cleanup })
  }
  const config = loadUserConfig(configPath)
  return { configPath, source: config.contentUpdates, updates: config.updates, migratedFrom, file,
    hasBaseline: config.organizations.length > 0 }
}

/** Reuse the content journal: commit remains gated by desktopReady(). */
export async function preparePublisherContent(manager, bootstrap, { onDownload = () => {} } = {}) {
  let managed = await manager.prepare()
  if (!bootstrap || bootstrap.hasBaseline || managed.configurationRevision > 0 || !manager.source?.configuration) return managed
  onDownload()
  const offer = await manager.check({ repair: true })
  if (offer.state === 'available') await manager.download()
  if (manager.snapshot().state === 'ready') managed = await manager.prepare()
  if (!managed.configurationRevision) {
    const status = manager.snapshot()
    const message = status.message === 'fetch failed' ? '暂时无法连接配置服务，请检查网络后重试。' : status.message
    const error = new Error(message || '当前渠道尚无可用的发行配置，请重试或联系发行方。')
    error.code = 'EDUWORK_BOOTSTRAP_REQUIRED'
    throw error
  }
  return managed
}
