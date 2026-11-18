import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function startInstalledUpdates({ app, resourcesPath, version, policy, onPolicy, stopBeforeInstall, Coordinator }) {
  const enabled = () => app.isPackaged && existsSync(join(resourcesPath, 'app-update.yml'))
  if (!enabled()) return {
    async action() {
      return { shell: 'electron', version, phase: 'disabled', message: '当前安装包未配置软件更新',
        update: { enabled: false, state: 'disabled', policy, canToggle: false } }
    },
    async close() {},
  }
  const coordinator = new Coordinator(() => {}, async () => {
    if (!enabled()) return false
    await stopBeforeInstall()
    return true
  }, undefined, enabled, () => version, undefined, policy === 'development' ? 'nightly' : 'stable')
  const status = () => {
    const state = coordinator.state
    const mapped = { idle: 'idle', checking: 'checking', available: 'available', downloading: 'downloading',
      verifying: 'verifying', installing: 'applying', ready: 'ready', error: 'error' }[state.phase]
    return { shell: 'electron', version, phase: state.phase, message: state.message,
      update: { enabled: enabled(), state: mapped, policy, latestVersion: state.version, percent: state.percent,
        downloadedBytes: state.percent, totalBytes: state.percent === undefined ? undefined : 100,
        failedOperation: state.failedOperation, error: state.phase === 'error' ? state.message : undefined } }
  }
  return {
    async action(action) {
      if (action === 'status') return status()
      if (!enabled()) return status()
      if (action === 'check-updates' || action === 'check-updates-background') await coordinator.check(action === 'check-updates')
      else if (action === 'download-update') {
        const state = coordinator.state
        if (!state.version) throw new Error('尚无可下载的更新')
        await coordinator.download(state.version)
      } else if (action === 'install-update') {
        await coordinator.install(coordinator.state.version)
      } else if (action === 'use-stable-updates' || action === 'use-development-updates') {
        const next = action === 'use-development-updates' ? 'development' : 'stable'
        await coordinator.switchChannel(next === 'development' ? 'nightly' : 'stable', () => onPolicy(next))
        policy = next
      } else throw new Error('不支持此 Windows 安装版更新操作')
      return status()
    },
    async close() { coordinator.dispose() },
  }
}
