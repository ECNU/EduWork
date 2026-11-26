import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createSoftwareUpdateScheduler, mayCheckSoftware, softwareAutomationAction } from './software-update-scheduler.mjs'

const options = new Map([
  ['software-updates', 'enabled'],
  ['startup-update-check', 'checkOnStartup'],
  ['periodic-update-check', 'periodicChecks'],
  ['automatic-download', 'automaticDownload'],
  ['automatic-install', 'automaticInstall'],
])

// Separate from channel preferences, which the Windows helper also writes.
export async function softwareUpdateControl({ dataRoot, version, policy = 'stable', defaultEnabled = true,
  supported = true, start, onPolicy = async () => {} }) {
  const path = join(dataRoot, 'state/software-update-preferences.json')
  const saved = await readFile(path, 'utf8').then(JSON.parse).catch(error => {
    if (error.code !== 'ENOENT') throw error
    return undefined
  })
  if (saved !== undefined && (!saved || typeof saved !== 'object' || saved.schemaVersion !== 1 || typeof saved.enabled !== 'boolean'
    || [...options.values()].some(key => key in saved && typeof saved[key] !== 'boolean'))) throw Error('软件更新偏好文件无效，原文件已保留')
  let preferences = { ...saved, schemaVersion: 1, enabled: saved?.enabled ?? defaultEnabled }
  let hasSavedPreferences = saved !== undefined
  let backend, startFailure, queue = Promise.resolve(), closed = false, scheduler
  const automation = (update, values = preferences) => {
    const legacy = update?.nativeUpdater === true && update.automaticDownload === true
    return {
      checkOnStartup: values.checkOnStartup ?? true,
      periodicChecks: values.periodicChecks ?? true,
      automaticDownload: values.automaticDownload ?? legacy,
      automaticInstall: values.automaticInstall ?? legacy,
    }
  }
  const present = status => {
    const update = { ...status.update, ...automation(status.update), userEnabled: preferences.enabled, canToggle: supported }
    if (backend?.installOnQuit && update.enabled && update.automaticInstall && update.state === 'ready') update.installOnQuit = true
    return { ...status, update }
  }
  const persist = async next => {
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(next) + '\n', { flag: 'wx', mode: 0o600 })
      await rename(temporary, path)
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
  }
  const open = async startup => {
    try {
      if (!backend) {
        const opened = await start({ policy, applyScheduled: startup })
        if (opened?.configureAutomation) {
          const { update } = await opened.action('status')
          await opened.configureAutomation(automation(update))
        }
        backend = opened
      }
      if (!backend) throw Error('当前安装包未配置软件更新')
      startFailure = undefined
    } catch (error) { startFailure = error.message; throw error }
    return backend
  }
  const snapshot = async () => {
    const status = preferences.enabled && backend ? await backend.action('status') : {
      shell: 'electron', version, phase: 'disabled', message: supported ? '软件更新已关闭' : '当前安装包未配置软件更新',
      update: { enabled: false, state: 'disabled', policy },
    }
    if (preferences.enabled && startFailure) {
      status.phase = 'error'; status.message = startFailure
      status.update.state = 'error'; status.update.error = startFailure
    }
    return present(status)
  }
  // Only a normal enabled application launch may resume an already scheduled
  // installation. Turning the switch on must not unexpectedly quit the app.
  if (preferences.enabled && supported) await open(true)
  const requireIdle = async () => {
    const current = backend ? (await backend.action('status')).update : null
    if (current?.busy || current?.installOnNextStart || current?.installOnQuit
      || ['checking', 'downloading', 'verifying', 'ready', 'applying'].includes(current?.state)) throw Error('更新正在处理，请完成后再修改软件更新设置')
    return current
  }
  const act = async action => {
    if (closed) throw Error('软件更新服务已关闭')
    const toggle = /^(enable|disable)-(.+)$/.exec(action)
    const key = options.get(toggle?.[2])
    if (key) {
      if (!supported) throw Error('当前安装包未配置软件更新')
      const next = toggle[1] === 'enable'
      if (key === 'enabled' && next === preferences.enabled) { if (next) await open(false); return snapshot() }
      if (key !== 'enabled' && !preferences.enabled) throw Error('软件更新已关闭，请先在设置中开启')
      const current = await requireIdle()
      const before = automation(current)
      const changingPackage = key === 'automaticDownload' || key === 'automaticInstall'
      // Store both flags before changing Sparkle's legacy, combined preference.
      const updated = { ...preferences,
        ...(changingPackage && { automaticDownload: before.automaticDownload, automaticInstall: before.automaticInstall }),
        [key]: next }
      await persist(updated)
      try {
        if (changingPackage) await backend?.configureAutomation?.(automation(current, updated))
      }
      catch (error) {
        if (hasSavedPreferences) await persist(preferences)
        else await unlink(path)
        throw error
      }
      preferences = updated
      hasSavedPreferences = true
      if (key === 'enabled' && next) await open(false)
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
    if (!preferences.enabled || !supported) {
      if (action === 'check-updates' || action === 'check-updates-background') return snapshot()
      throw Error(supported ? '软件更新已关闭，请先在设置中开启' : '当前安装包未配置软件更新')
    }
    const result = await (await open(false)).action(action)
    return present(result)
  }
  const enqueue = task => {
    const result = queue.then(task); queue = result.catch(() => {})
    return result
  }
  return {
    action(action) {
      if (action === 'status') return snapshot()
      return enqueue(async () => {
        try {
          const result = await act(action)
          scheduler?.record(action, result)
          return result
        } catch (error) {
          if (action === 'check-updates' || action === 'check-updates-background') scheduler?.checkFailed()
          throw error
        }
      })
    },
    startBackground(options = {}) {
      if (closed || scheduler) return
      scheduler = createSoftwareUpdateScheduler({ ...options, readStatus: snapshot,
        startupCheck: preferences.enabled && preferences.checkOnStartup !== false,
        check: stillDue => enqueue(async () => {
          const current = await snapshot()
          if (closed || !stillDue() || !supported || !mayCheckSoftware(current.update)) return { started: false, status: current }
          return { started: true, status: await act(current.update.nativeUI ? 'check-updates-background' : 'check-updates') }
        }),
        advance: (action, stillDue) => enqueue(async () => {
          const current = await snapshot()
          if (closed || !stillDue() || !supported || softwareAutomationAction(current.update) !== action) return { started: false, status: current }
          return { started: true, status: await act(action) }
        }),
      })
      scheduler.start()
    },
    async prepareForQuit() {
      if (!preferences.enabled || preferences.automaticInstall !== true) return
      await enqueue(async () => {
        if (closed || !preferences.enabled || !backend) return
        const { update } = await snapshot()
        if (update.enabled && update.automaticInstall && update.state === 'ready') {
          if (backend.installOnQuit) await backend.installOnQuit()
          else if (softwareAutomationAction(update) === 'schedule-update') await act('schedule-update')
        }
      })
    },
    async close() { closed = true; await scheduler?.close(); await queue; await backend?.close() },
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
