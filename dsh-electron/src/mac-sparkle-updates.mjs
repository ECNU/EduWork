import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)

export function editableMacUpdateConfiguration({ defaults = {}, updates = {}, feeds = {}, version }) {
  return { ...defaults, ...updates, macFeeds: { ...feeds, ...updates.macFeeds },
    defaultPolicy: updates.defaultPolicy ?? defaults.defaultPolicy ?? (version.includes('-dev.') ? 'development' : 'stable') }
}

// Sparkle owns download validation and installation; the workbench owns reminders.
export function startMacSparkleUpdates({ appPath, version, enabled = false, feeds = {}, policy = 'stable', onPolicy = async () => {}, platform = process.platform, loadAddon = require }) {
  if (platform !== 'darwin' || !enabled) return null
  let addon, failure
  try {
    addon = loadAddon(join(appPath, 'native/sparkle.node'))
    if (['start','check','setFeed','probe','snapshot','setAutomaticDownload','install'].some(name => typeof addon[name] !== 'function')) throw Error('Invalid Sparkle native bridge')
    for (const [channel, value] of Object.entries(feeds)) {
      const url = new URL(value)
      if (!['stable','development'].includes(channel) || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('Invalid Sparkle appcast')
    }
    if (!feeds[policy]) throw Error('No Sparkle appcast for the selected channel')
    addon.start(feeds[policy])
  } catch (error) { failure = error }
  const status = () => ({ shell: 'electron', version, phase: failure ? 'error' : 'ready',
    message: failure ? `macOS 更新组件不可用：${failure.message}` : '检查在后台进行；可选择自动下载并在退出时安装，不会强制重启。',
    update: { enabled: !failure, nativeUI: false, nativeUpdater: true, policy, policies:Object.keys(feeds), ...(failure ? {state:'error',error:failure.message} : addon.snapshot()) } })
  return {
    action: async action => {
      if (action === 'status') return status()
      // Sparkle chooses quiet checks or background downloads from its persisted preference.
      if (action === 'check-updates' || action === 'check-updates-background') {
        if (failure && action === 'check-updates') throw Error(`macOS 更新组件不可用：${failure.message}`)
        if (!failure) addon.probe()
        return status()
      }
      if (action === 'use-stable-updates' || action === 'use-development-updates') {
        if (failure) throw failure
        const next = action === 'use-development-updates' ? 'development' : 'stable'
        if (!feeds[next]) throw Error('此发行尚未配置该 macOS 更新渠道')
        addon.setFeed(feeds[next])
        try { await onPolicy(next) } catch (error) { addon.setFeed(feeds[policy]); throw error }
        policy = next
        return status()
      }
      if (action === 'enable-automatic-download' || action === 'disable-automatic-download') {
        if (failure) throw failure
        addon.setAutomaticDownload(action === 'enable-automatic-download')
        if (action === 'enable-automatic-download') addon.probe()
        return status()
      }
      if (action === 'install-update') {
        if (failure) throw failure
        addon.install(); return status()
      }
      if (action === 'download-update') {
        if (failure) throw Error(`macOS 更新组件不可用：${failure.message}`)
        addon.check()
        return status()
      }
      throw Error('不支持此 macOS 更新操作')
    },
    async close() { /* The host process owns the native controller lifetime. */ },
  }
}
