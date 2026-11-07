import { editablePortableUpdateConfiguration, resolveUpdateConfiguration } from './portable-updates.mjs'
import { spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'

export async function launchPortableInstaller({ installer, sourceRoot, spawnProcess = spawn }) {
  if (typeof installer !== 'string' || !isAbsolute(installer) || typeof sourceRoot !== 'string' || !isAbsolute(sourceRoot)) throw new Error('安装程序或旧便携版目录无效')
  const child = spawnProcess(installer, ['--updated', '--force-run', `/MIGRATE_FROM=${sourceRoot}`],
    { detached: true, stdio: 'ignore', windowsHide: false })
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
  child.unref()
}

export function editableInstalledUpdateConfiguration({ defaults, updates = {}, prior, version, distribution }) {
  const explicit = updates.provider || updates.repository || updates.manifestURL || updates.windowsFeeds
  if (!explicit && prior?.schemaVersion === 1 && prior.enabled !== false && (prior.manifestBaseURL || prior.provider === 'github')) {
    return editablePortableUpdateConfiguration({ defaults, updates, prior, version, distribution })
  }
  return resolveUpdateConfiguration(defaults, updates)
}

export function installedUpdateSource({ updates = {}, defaults = {}, policy = 'stable', version = '' }) {
  if (!['stable', 'development'].includes(policy)) throw new Error('安装版更新渠道无效')
  const config = resolveUpdateConfiguration(defaults, updates)
  if (config.provider === 'disabled') return null
  const channel = policy === 'stable' ? 'latest' : 'nightly'
  const feed = config.windowsFeeds?.[policy]
  if (feed) {
    const url = new URL(feed)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || !url.pathname.endsWith(`/${channel}.yml`)) throw new Error(`安装版更新地址须为无凭据和参数的 HTTPS ${channel}.yml`)
    return { provider: 'generic', url: new URL('.', url).href, channel }
  }
  if (config.provider !== 'github') return null
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(config.repository ?? '')) throw new Error('GitHub 更新源需要 owner/repo')
  const [owner, repo] = config.repository.split('/')
  const prerelease = /^\d+\.\d+\.\d+-(alpha|beta|rc|dev)\./u.exec(version)?.[1] ?? 'dev'
  return { provider: 'github', owner, repo, channel: policy === 'development' ? prerelease : 'latest' }
}

/** The pinned official coordinator owns checks, downloads, verification and NSIS handoff. */
export function startInstalledUpdates({ updater, Coordinator, createCancellationToken, version, updates, defaults,
  policy = 'stable', beforeRestart, onPolicy, installFromPortable, onInstallFailure = () => {} }) {
  if (!installedUpdateSource({ updates, defaults, policy, version })) throw new Error('当前安装版没有 NSIS 更新源')
  let current, checking = false, disposed = false, transfer = {}, cancellation
  const originalDownload = updater.downloadUpdate
  const originalInstall = updater.quitAndInstall
  updater.downloadUpdate = () => {
    cancellation = createCancellationToken()
    return originalDownload.call(updater, cancellation)
  }
  const onProgress = progress => { transfer = { downloadedBytes: progress.transferred, totalBytes: progress.total } }
  updater.on('download-progress', onProgress)
  let coordinator
  const open = () => {
    const source = installedUpdateSource({ updates, defaults, policy, version })
    if (!source) throw new Error('当前安装版没有 NSIS 更新源；便携版 JSON 更新清单不能用于安装版')
    updater.setFeedURL(source)
    current = { phase: 'idle' }
    coordinator = new Coordinator(state => {
      current = state
      if (state.phase === 'error' && state.failedOperation === 'install') onInstallFailure(state.message)
      return state
    }, beforeRestart, updater, () => true, () => version, undefined, policy === 'development' ? 'nightly' : 'latest')
    if (source.provider === 'github' && policy === 'development') {
      // electron-updater matches GitHub prerelease tags by prefix (dev/alpha/beta/rc).
      updater.channel = source.channel
      updater.allowPrerelease = true
      updater.allowDowngrade = false
    }
  }
  try { open() } catch (error) {
    updater.off('download-progress', onProgress)
    updater.downloadUpdate = originalDownload
    throw error
  }
  if (installFromPortable) updater.quitAndInstall = () => {
    Promise.resolve().then(() => installFromPortable(updater.installerPath)).catch(error => {
      if (!disposed) updater.emit('error', error)
      else onInstallFailure(error.message)
    })
  }
  const snapshot = () => {
    const state = checking ? 'checking' : { idle: 'up_to_date', verifying: 'downloading', installing: 'applying' }[current.phase] ?? current.phase
    return { shell: 'electron', version, phase: state, message: current.message ?? '安装版使用 NSIS 更新，个人数据独立保留。',
      update: { enabled: true, state, policy, backend: 'nsis', latestVersion: current.version,
        busy: ['checking', 'downloading', 'applying'].includes(state), ...transfer,
        ...(current.phase === 'verifying' ? { downloadStage: 'verifying' } : {}),
        ...(current.phase === 'error' ? { error: current.message, failedOperation: current.failedOperation } : {}) } }
  }
  return {
    async action(action) {
      if (disposed) throw new Error('安装版更新服务已关闭')
      if (action === 'status') return snapshot()
      if (action === 'check-updates' || action === 'check-updates-background') {
        checking = true
        try { current = await coordinator.check(action === 'check-updates') }
        finally { checking = false }
      } else if (action === 'download-update') {
        transfer = {}; current = await coordinator.download(current.version)
      } else if (action === 'install-update') {
        current = await coordinator.install(current.version)
      } else if (action === 'use-stable-updates' || action === 'use-development-updates') {
        const next = action === 'use-development-updates' ? 'development' : 'stable'
        if (!installedUpdateSource({ updates, defaults, policy: next, version })) throw new Error('所选渠道尚未配置安装版更新源')
        await onPolicy(next)
        coordinator.dispose(); policy = next; transfer = {}; open()
      } else throw new Error('不支持的安装版更新操作')
      return snapshot()
    },
    async close() {
      if (disposed) return
      disposed = true
      cancellation?.cancel()
      coordinator.dispose()
      updater.off('download-progress', onProgress)
      updater.downloadUpdate = originalDownload
      updater.quitAndInstall = originalInstall
    },
  }
}
