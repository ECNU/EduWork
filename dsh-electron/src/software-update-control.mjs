import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

// Separate from channel preferences, which the Windows helper also writes.
export async function softwareUpdateControl({ dataRoot, version, policy = 'stable', defaultEnabled = true,
  supported = true, start, onPolicy = async () => {} }) {
  const path = join(dataRoot, 'state/software-update-preferences.json')
  const saved = await readFile(path, 'utf8').then(JSON.parse).catch(error => {
    if (error.code !== 'ENOENT') throw error
    return undefined
  })
  if (saved !== undefined && (!saved || typeof saved !== 'object' || saved.schemaVersion !== 1 || typeof saved.enabled !== 'boolean')) throw Error('软件更新偏好文件无效，原文件已保留')
  let enabled = saved?.enabled ?? defaultEnabled, backend, startFailure, queue = Promise.resolve(), closed = false
  const persist = async next => {
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify({ schemaVersion: 1, enabled: next }) + '\n', { flag: 'wx', mode: 0o600 })
      await rename(temporary, path)
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
  }
  const open = async startup => {
    try {
      if (!backend) backend = await start({ policy, applyScheduled: startup })
      if (!backend) throw Error('当前安装包未配置软件更新')
      startFailure = undefined
    } catch (error) { startFailure = error.message; throw error }
    return backend
  }
  const snapshot = async () => {
    const status = enabled && backend ? await backend.action('status') : {
      shell: 'electron', version, phase: 'disabled', message: supported ? '软件更新已关闭' : '当前安装包未配置软件更新',
      update: { enabled: false, state: 'disabled', policy },
    }
    if (enabled && startFailure) {
      status.phase = 'error'; status.message = startFailure
      status.update.state = 'error'; status.update.error = startFailure
    }
    return { ...status, update: { ...status.update, userEnabled: enabled, canToggle: supported } }
  }
  // Only a normal enabled application launch may resume an already scheduled
  // installation. Turning the switch on must not unexpectedly quit the app.
  if (enabled && supported) await open(true)
  const requireIdle = async () => {
    const current = backend ? (await backend.action('status')).update : null
    if (current?.busy || current?.installOnNextStart || current?.installOnQuit
      || ['checking', 'downloading', 'ready', 'applying'].includes(current?.state)) throw Error('更新正在处理，请完成后再修改软件更新设置')
  }
  const act = async action => {
    if (closed) throw Error('软件更新服务已关闭')
    if (action === 'enable-software-updates' || action === 'disable-software-updates') {
      if (!supported) throw Error('当前安装包未配置软件更新')
      const next = action === 'enable-software-updates'
      if (next === enabled) { if (next) await open(false); return snapshot() }
      await requireIdle()
      // Persist before changing runtime behavior. On write failure the current
      // setting remains in effect, including any existing native service.
      await persist(next)
      enabled = next
      if (enabled) await open(false)
      return snapshot()
    }
    if (action === 'use-stable-updates' || action === 'use-development-updates') {
      await requireIdle()
      const next = action === 'use-development-updates' ? 'development' : 'stable'
      if (backend) {
        const result = await backend.action(action)
        if (result.update?.policy !== next) throw Error(result.update?.error || '软件更新渠道未能切换')
      } else await onPolicy(next)
      policy = next
      return snapshot()
    }
    if (!enabled || !supported) {
      if (action === 'check-updates' || action === 'check-updates-background') return snapshot()
      throw Error('软件更新已关闭，请先在设置中开启')
    }
    const result = await (await open(false)).action(action)
    return { ...result, update: { ...result.update, userEnabled: enabled, canToggle: supported } }
  }
  return {
    action(action) {
      if (action === 'status') return snapshot()
      const result = queue.then(() => act(action)); queue = result.catch(() => {})
      return result
    },
    async close() { closed = true; await queue; await backend?.close() },
  }
}

// provider:disabled is the legacy opt-out. Explicitly enabling from the UI
// recovers its retained source (or the trusted package default) in memory only.
export function updatesWhenEnabled(updates = {}) {
  if (updates.provider !== 'disabled') return updates
  const { provider, ...rest } = updates
  if (rest.manifestURL) rest.provider = 'static'
  else if (rest.repository) rest.provider = 'github'
  return rest
}
