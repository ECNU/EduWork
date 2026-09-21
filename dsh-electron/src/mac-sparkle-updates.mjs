import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)

export function editableMacUpdateConfiguration({ defaults = {}, updates = {}, feeds = {}, version }) {
  return { ...defaults, ...updates, macFeeds: { ...feeds, ...updates.macFeeds },
    defaultPolicy: updates.defaultPolicy ?? defaults.defaultPolicy ?? (version.includes('-dev.') ? 'development' : 'stable') }
}

// Sparkle owns its own native update dialog. The workbench reports only that
// availability from its delegate; download/install progress stays in that dialog.
export function startMacSparkleUpdates({ appPath, version, enabled = false, feeds = {}, policy = 'stable', onPolicy = async () => {}, platform = process.platform, loadAddon = require }) {
  if (platform !== 'darwin' || !enabled) return null
  let addon, failure
  try {
    addon = loadAddon(join(appPath, 'native/sparkle.node'))
    if (['start','check','setFeed','probe','snapshot'].some(name => typeof addon[name] !== 'function')) throw Error('Invalid Sparkle native bridge')
    for (const [channel, value] of Object.entries(feeds)) {
      const url = new URL(value)
      if (!['stable','development'].includes(channel) || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('Invalid Sparkle appcast')
    }
    if (!feeds[policy]) throw Error('No Sparkle appcast for the selected channel')
    addon.start(feeds[policy])
  } catch (error) { failure = error }
  const status = () => ({ shell: 'electron', version, phase: failure ? 'error' : 'ready',
    message: failure ? `macOS 更新组件不可用：${failure.message}` : 'macOS 应用更新由 Sparkle 管理；检查、下载和安装会在系统窗口中进行。',
    update: { enabled: !failure, nativeUI: true, policy, policies:Object.keys(feeds), ...(failure ? {state:'error',error:failure.message} : addon.snapshot()) } })
  return {
    action: async action => {
      if (action === 'status') return status()
      // Probe only: the native delegate reports availability without a dialog.
      if (action === 'check-updates-background') { if (!failure) addon.probe(); return status() }
      if (action === 'use-stable-updates' || action === 'use-development-updates') {
        if (failure) throw failure
        const next = action === 'use-development-updates' ? 'development' : 'stable'
        if (!feeds[next]) throw Error('此发行尚未配置该 macOS 更新渠道')
        addon.setFeed(feeds[next])
        try { await onPolicy(next) } catch (error) { addon.setFeed(feeds[policy]); throw error }
        policy = next
        return status()
      }
      if (action === 'check-updates' || action === 'download-update') {
        if (failure) throw Error(`macOS 更新组件不可用：${failure.message}`)
        addon.check(); return status()
      }
      throw Error('macOS Sparkle 仅接受手动检查；后续操作请在系统更新窗口完成')
    },
    async close() { /* The host process owns the native controller lifetime. */ },
  }
}
