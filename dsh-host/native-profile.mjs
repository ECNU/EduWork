import { mkdir, readFile, writeFile, rename, lstat, unlink, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { nativeSettingsEntryIds } from './settings-migration.mjs'
import { isDeepStrictEqual } from 'node:util'

const missing = error => { if (error.code !== 'ENOENT') throw error }

// Take complete definitions from the pinned official bundle. Only the skill
// provider is replaced; tools, permissions and scoped preset ownership remain.
export async function nativePresetPatches(runtime, parse) {
  const result = []
  const replaceSkills = rows => rows.map(row => ({ ...row,
    ...(row.name === '@deepseek-ai/dsh-skill-filesystem' ? { name: '@chatecnu-work/dsh-skill-control-native' } : {}),
    ...(row.group === true && Array.isArray(row.config) ? { config: replaceSkills(row.config) } : {}),
  }))
  for (const name of ['standard', 'ptc', 'minimal', 'cordis']) {
    const patches = parse(await readFile(join(runtime, `node_modules/@deepseek-ai/dsh-web-app/presets/${name}.patch.yml`), 'utf8'))
    const row = patches.flatMap(patch => patch.insert ?? []).find(row => row.id === `preset-${name}`)
    if (!row?.config?.plugins) throw new Error(`Pinned preset definition missing: ${name}`)
    result.push({ id: row.id, config: { ...row.config, plugins: replaceSkills(row.config.plugins) } })
  }
  return result
}

// Read the previous directory format without changing it. The new registry
// owns the resulting definitions and preserves their IDs in existing sessions.
export async function legacyPresetPatches(home, parse) {
  const patches = []
  for (const file of ['settings.yaml.eduwork-migration', 'settings.yaml', 'settings.yaml.imported']) {
    const text = await readFile(join(home, file), 'utf8').catch(missing)
    if (text === undefined) continue
    const selected = parse(text)?.['chatecnu-brand']?.enabledOptionalPresets
    if (Array.isArray(selected)) for (const id of ['minimal', 'cordis']) patches.push({ id: `preset-${id}`, disabled: !selected.includes(id) })
    break
  }
  const root = join(home, '.agent-presets')
  await refuseLink(root)
  const entries = await readdir(root, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error })
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) throw new Error('Legacy preset root contains an unmanaged link')
    if (!entry.isDirectory()) continue
    const directory = join(root, entry.name), source = join(directory, 'agent.cordis.yml')
    await refuseLink(source)
    const text = await readFile(source, 'utf8').catch(missing)
    if (text === undefined) continue
    const plugins = parse(text)
    if (!Array.isArray(plugins)) throw new Error(`Invalid legacy preset composition: ${entry.name}; original retained`)
    const metadataPath = join(directory, 'preset.yml')
    await refuseLink(metadataPath)
    const metadataText = await readFile(metadataPath, 'utf8').catch(missing)
    const metadata = metadataText === undefined ? {} : parse(metadataText) ?? {}
    const resolvePlugins = rows => rows.map(row => {
      if (!row || typeof row !== 'object') throw new Error(`Invalid legacy preset plugin: ${entry.name}`)
      if (row.group === true && Array.isArray(row.config)) return { ...row, config: resolvePlugins(row.config) }
      if (typeof row.name !== 'string') throw new Error(`Invalid legacy preset plugin: ${entry.name}`)
      return row.name.startsWith('.') ? { ...row, name: pathToFileURL(resolve(directory, row.name)).href } : row
    })
    const config = { id: entry.name, plugins: resolvePlugins(plugins) }
    for (const key of ['name', 'description', 'order']) if (metadata[key] !== undefined) config[key] = metadata[key]
    const id = ['standard', 'ptc', 'minimal', 'cordis'].includes(entry.name) ? `preset-${entry.name}` : `eduwork-legacy-preset-${createHash('sha256').update(entry.name).digest('hex').slice(0, 16)}`
    patches.push(id.startsWith('eduwork-legacy-') ? { insert: [{ id, name: '@deepseek-ai/dsh-agent-preset', config }] } : { id, config })
  }
  return patches
}
async function refuseLink(path) {
  const entry = await lstat(path).catch(missing)
  if (entry?.isSymbolicLink()) throw new Error(`Native profile contains an unmanaged link: ${path}`)
}

async function writeChanged(path, text) {
  await refuseLink(path)
  const previous = await readFile(path, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error })
  if (previous === text) return
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, text, { mode: 0o600 })
    await rename(temporary, path)
  } finally { await unlink(temporary).catch(missing) }
}

async function completePendingWrite(journalPath, bundlePath, preferencesPath) {
  await refuseLink(journalPath)
  const text = await readFile(journalPath, 'utf8').catch(missing)
  if (text === undefined) return
  const pending = JSON.parse(text)
  if (pending.schemaVersion !== 1 || ['beforeBundle', 'afterBundle', 'beforePreferences', 'afterPreferences'].some(key => typeof pending[key] !== 'string')) {
    throw new Error('Invalid native profile update journal')
  }
  for (const [path, before, after] of [[preferencesPath, pending.beforePreferences, pending.afterPreferences], [bundlePath, pending.beforeBundle, pending.afterBundle]]) {
    await refuseLink(path)
    const current = await readFile(path, 'utf8')
    if (current !== before && current !== after) throw new Error('Native profile changed during interrupted update; existing preferences were preserved')
  }
  await writeChanged(preferencesPath, pending.afterPreferences)
  await writeChanged(bundlePath, pending.afterBundle)
  await unlink(journalPath)
}

// Settings stores a complete raw config, including inherited deployment
// values. Rebase those copied defaults after an edition update or directory
// move while retaining every value that differs from the prior default.
export function rebaseNativeConfig(previous, next, saved) {
  if (isDeepStrictEqual(previous, saved)) return structuredClone(next)
  const object = value => value && typeof value === 'object' && !Array.isArray(value)
  if (!object(saved) || (previous !== undefined && !object(previous)) || (next !== undefined && !object(next))) return saved
  const result = { ...next }
  for (const key of Object.keys(saved)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid native configuration key')
    const value = rebaseNativeConfig(previous?.[key], next?.[key], saved[key])
    if (value === undefined) delete result[key]
    else result[key] = value
  }
  return result
}

function configurations(patches) {
  const values = new Map()
  for (const row of patches) {
    for (const plugin of row.insert ?? []) if (plugin.config !== undefined) values.set(plugin.id, plugin.config)
    if (row.id && row.config !== undefined) values.set(row.id, row.config)
  }
  return values
}

export function nativeEntryIds(patches) {
  const brand = configurations(patches).get('eduwork-brand-settings') ?? configurations(patches).get('chatecnu-brand')
  const policy = []
  if (brand?.upstreamWelcomeNoticeVersion) policy.push({ id: 'ui-settings-general', config: { welcomeNoticeVersion: brand.upstreamWelcomeNoticeVersion } })
  if (brand?.manageOptionalPresets) {
    for (const id of ['minimal', 'cordis']) policy.push({ id: `preset-${id}`, disabled: !brand.enabledOptionalPresets?.includes(id) })
  }
  return [...policy, ...patches.map(row => ({ ...row,
    ...(row.id ? { id: nativeSettingsEntryIds[row.id] ?? row.id } : {}),
    ...(row.insert ? { insert: row.insert.map(plugin => ({ ...plugin,
      id: nativeSettingsEntryIds[plugin.id] ?? plugin.id,
      ...(plugin.id === 'eduwork-request-concurrency' ? { name: '@eduwork/dsh-request-concurrency/lib/native.js' } : {}),
      ...(plugin.id === 'eduwork-artifact-publish' ? { name: '@chatecnu-work/dsh-tool-artifact-publish/native' } : {}),
    })) } : {}),
  }))]
}

// Generated deployment defaults are an ordinary bundle BELOW the native user
// patch. Never regenerate the latter: Settings writes it through configEditor.
// This profile lives beside the 0.1.5 profile for rollback, in the same DSH home.
export async function writeNativeProfile({ profile, bundles, patches, parse = JSON.parse }) {
  const name = '@eduwork/generated-profile'
  const bundle = join(profile, 'node_modules', name)
  for (const path of [profile, join(profile, 'node_modules'), join(profile, 'node_modules/@eduwork'), bundle]) {
    await refuseLink(path); await mkdir(path, { recursive: true })
  }
  const json = value => JSON.stringify(value, null, 2) + '\n'
  const next = nativeEntryIds(patches)
  const bundlePath = join(bundle, 'cordis.patch.yml'), preferencesPath = join(profile, 'cordis.patch.yml')
  const journalPath = join(profile, '.eduwork-profile-update.json')
  await refuseLink(bundlePath); await refuseLink(preferencesPath)
  // Finish the previous pair before rebasing again, including after a second
  // directory move. Rebased defaults cannot be mistaken for personal edits.
  await completePendingWrite(journalPath, bundlePath, preferencesPath)
  const previousText = await readFile(bundlePath, 'utf8').catch(missing)
  const preferencesText = await readFile(preferencesPath, 'utf8').catch(missing)
  if (previousText && preferencesText && previousText !== json(next)) {
    const before = configurations(JSON.parse(previousText)), after = configurations(next)
    const saved = parse(preferencesText)
    if (!Array.isArray(saved)) throw new Error('Native profile preferences must be a patch list')
    const rebased = saved.map(row => row.config === undefined || !before.has(row.id) || !after.has(row.id) ? row
      : { ...row, config: rebaseNativeConfig(before.get(row.id), after.get(row.id), row.config) })
    if (!isDeepStrictEqual(saved, rebased)) {
      await writeChanged(journalPath, json({ schemaVersion: 1, beforeBundle: previousText, afterBundle: json(next), beforePreferences: preferencesText, afterPreferences: json(rebased) }))
      await completePendingWrite(journalPath, bundlePath, preferencesPath)
    }
  }
  await writeChanged(join(bundle, 'package.json'), json({ name, version: '0.0.0', private: true, type: 'module',
    dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  await writeChanged(bundlePath, json(next))
  const manifestPath = join(profile, 'package.json')
  await refuseLink(manifestPath)
  const savedManifest = JSON.parse(await readFile(manifestPath, 'utf8').catch(error => { missing(error); return '{}' }))
  const savedBundles = savedManifest.dsh?.profile?.bundles ?? []
  if (!Array.isArray(savedBundles) || savedBundles.some(value => typeof value !== 'string')) throw new Error('Invalid native profile bundle list')
  // Native plugin management writes dependencies and bundle activation here.
  // Keep them on restart; only the generated product bundle is kept last.
  await writeChanged(manifestPath, json({ name: 'eduwork-desktop-profile', private: true, type: 'module', ...savedManifest,
    dsh: { ...savedManifest.dsh, profile: { ...savedManifest.dsh?.profile,
      bundles: [...new Set([...bundles, ...savedBundles].filter(value => value !== name)), name] } } }))
  // Exclusive create protects both a saved native preference and an in-flight
  // settings update. Absence is the only condition that initializes the file.
  try { await writeFile(join(profile, 'cordis.patch.yml'), '[]\n', { flag: 'wx', mode: 0o600 }) }
  catch (error) { if (error.code !== 'EEXIST') throw error }
}
