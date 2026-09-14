import { cp, rm, stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

export const OPTIONAL_PRESETS = Object.freeze(['minimal', 'cordis'])

export function enabledOptionalPresets(value) {
  const values = Array.isArray(value) ? value : []
  return [...new Set(values.filter(item => OPTIONAL_PRESETS.includes(item)))]
}

export async function isPresetDirectory(directory) {
  try {
    return (await stat(resolve(directory, 'agent.cordis.yml'))).isFile()
  } catch {
    return false
  }
}

export function activePresetRoot(agentPresets) {
  const roots = Array.isArray(agentPresets?.roots) ? agentPresets.roots : []
  const systemRoots = roots.filter(root => root?.trust === 'system' && typeof root.path === 'string')
  if (systemRoots.length !== 1 || !isAbsolute(systemRoots[0].path)) {
    throw new Error(`product preset roster must expose exactly one absolute system root (found ${systemRoots.length})`)
  }
  return resolve(systemRoots[0].path)
}

export function assertLauncherPresetRoot(agentPresets, environment = process.env) {
  const launcherRoot = environment.DSH_PRODUCT_PRESET_DIR
  const rosterRoot = activePresetRoot(agentPresets)
  if (typeof launcherRoot !== 'string' || !isAbsolute(launcherRoot) || resolve(launcherRoot).toLowerCase() !== rosterRoot.toLowerCase()) {
    throw new Error(`launcher preset root does not match the DSH roster root: launcher=${String(launcherRoot)} roster=${rosterRoot}`)
  }
  return rosterRoot
}

export async function assertOptionalPresetRoster(settings, agentPresets) {
  if (typeof agentPresets?.list !== 'function') throw new Error('product agent preset roster is unavailable')
  const enabled = new Set(enabledOptionalPresets(settings?.enabledOptionalPresets))
  const ids = new Set((await agentPresets.list()).map(row => row.id))
  for (const preset of OPTIONAL_PRESETS) {
    if (ids.has(preset) !== enabled.has(preset)) {
      throw new Error(`product preset roster did not converge for ${preset}`)
    }
  }
}

export async function syncOptionalPresets(settings, environment = process.env, agentPresets) {
  const configuredRoot = environment.DSH_PRODUCT_PRESET_DIR
  const activeRoot = agentPresets === undefined ? configuredRoot : assertLauncherPresetRoot(agentPresets, environment)
  const libraryRoot = environment.DSH_PRODUCT_PRESET_LIBRARY_DIR
  if (typeof activeRoot !== 'string' || typeof libraryRoot !== 'string' || !isAbsolute(activeRoot) || !isAbsolute(libraryRoot)) {
    throw new Error('product preset roots are unavailable')
  }
  const enabled = new Set(enabledOptionalPresets(settings?.enabledOptionalPresets))
  for (const preset of OPTIONAL_PRESETS) {
    const target = resolve(activeRoot, preset)
    if (!enabled.has(preset)) await rm(target, { recursive: true, force: true })
  }
  for (const preset of OPTIONAL_PRESETS) {
    if (!enabled.has(preset)) continue
    const source = resolve(libraryRoot, preset)
    const target = resolve(activeRoot, preset)
    if (!await isPresetDirectory(source)) throw new Error(`product preset library entry is unavailable: ${preset}`)
    if (!await isPresetDirectory(target)) await cp(source, target, { recursive: true, force: true })
  }
  if (agentPresets !== undefined) await assertOptionalPresetRoster(settings, agentPresets)
}
