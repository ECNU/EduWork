import { readFile, writeFile, mkdir, readdir, lstat, rename, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { loadUserConfig } from './user-config.mjs'
import { compareVersions, digest } from './content-update-protocol.mjs'

const business = config => ({ organizations: config.organizations, features: config.features,
  ...(config.media ? { media: config.media } : {}) })

/** Only publisher-owned editions can opt in. The descriptor is part of the app. */
export async function readPublisherBootstrap({ ownership, product }) {
  if (ownership !== 'publisher') return null
  const descriptorPath = join(product, 'resources/desktop/publisher-bootstrap.json')
  let bytes
  try { bytes = await readFile(descriptorPath) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
  if (bytes.length > 16384) throw Error('发行引导配置过大')
  const descriptor = JSON.parse(bytes.toString('utf8'))
  if (!descriptor || Object.keys(descriptor).some(k => !['schemaVersion', 'updates', 'contentUpdates'].includes(k))) throw Error('发行引导配置只能包含更新渠道与验签信息')
  const trusted = loadUserConfig(descriptorPath), source = trusted.contentUpdates
  if (!source?.configuration || (source.bundled.configuration ?? 0) !== 0) throw Error('首次下载配置必须启用 configuration，内置配置修订号必须为 0')
  // A packaging channel is chosen by desktop settings, not by a shared descriptor.
  if (trusted.updates.defaultPolicy) throw Error('默认渠道须在打包时指定，不能写入发行引导配置')
  return trusted
}

export async function publisherBootstrap({ ownership, product, distribution, version, configPath, dataRoot }) {
  const trusted = await readPublisherBootstrap({ ownership, product })
  if (!trusted) return null
  const source = trusted.contentUpdates
  const scope = digest(JSON.stringify([distribution, source.publisher, source.baseURL, source.publicKey]))
  const directory = join(dataRoot, 'publisher-bootstrap', scope), target = join(directory, 'eduwork.jsonc')
  await mkdir(directory, { recursive: true })
  if ((await lstat(directory)).isSymbolicLink()) throw Error('发行配置目录不能是符号链接')
  let baseline, migratedFrom
  const previous = await lstat(target).catch(error => { if (error.code !== 'ENOENT') throw error })
  if (previous) {
    if (!previous.isFile() || previous.isSymbolicLink()) throw Error('发行配置缓存无效')
    try {
      if (previous.size > 1024 * 1024) throw Error('发行配置缓存过大')
      baseline = loadUserConfig(target)
    } catch (error) {
      if (error.code) throw error
      // Preserve damaged local bytes, then reuse a valid legacy configuration
      // or the verified content cache. A partial JSON write must not brick startup.
      await rename(target, target + '.invalid-' + randomUUID())
    }
  }
  if (!baseline) {
    // Read only this installation's configuration directory. Never search other
    // installations, account vaults or the user's projects for a fallback.
    const folder = dirname(configPath)
    const candidates = (await readdir(folder).catch(error => { if (error.code === 'ENOENT') return []; throw error }))
      .map(name => ({ name, version: /^eduwork\.(.+)\.jsonc$/.exec(name)?.[1] }))
      .filter(item => { try { return item.version && compareVersions(item.version, version) <= 0 } catch { return false } })
      .sort((a, b) => compareVersions(b.version, a.version))
    for (const path of [...new Set([configPath, ...candidates.map(item => join(folder, item.name)), join(folder, 'eduwork.jsonc')])]) {
      const info = await lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error })
      if (!info?.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) continue
      try {
        const candidate = loadUserConfig(path)
        if (candidate.organizations.length) { baseline = candidate; migratedFrom = path; break }
      } catch { /* An invalid old file cannot prevent a signed first-run download. */ }
    }
  }
  const seed = loadUserConfig(join(product, 'resources/desktop/eduwork.jsonc'))
  const value = { schemaVersion: 1, product: seed.product.name ? { name: seed.product.name } : {},
    ...business(baseline ?? seed), desktop: { closeAction: baseline?.closeAction ?? seed.closeAction },
    updates: trusted.updates, contentUpdates: source }
  // The cached fallback is mutable state; it can never replace the app's trust
  // root. Reapply the packaged descriptor on every launch, including offline.
  const temporary = target + '.' + randomUUID() + '.tmp'
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  try { loadUserConfig(temporary); await rename(temporary, target) }
  finally { await rm(temporary, { force: true }) }
  return { configPath: target, source, updates: trusted.updates, migratedFrom,
    hasBaseline: value.organizations.length > 0 }
}

/** Reuse the content journal: commit remains gated by desktopReady(). */
export async function preparePublisherContent(manager, bootstrap, { onDownload = () => {} } = {}) {
  let managed = await manager.prepare()
  if (!bootstrap || bootstrap.hasBaseline || managed.configurationRevision > 0) return managed
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
