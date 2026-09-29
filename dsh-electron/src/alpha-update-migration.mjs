import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { usesStableDefault } from './update-channel-migration.mjs'
import { ConfigurationFile, readConfiguration } from '../../dsh-host/configuration-file.mjs'

const digest = text => createHash('sha256').update(text).digest('hex')
const read = path => readFile(path, 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return null; throw error })
async function save(path, value) {
  const temporary = path + '.' + randomUUID() + '.tmp'
  try { await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); await rename(temporary, path) }
  finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
}

// Alpha did not record whether provider:disabled was the package default or a
// later user edit. Ask once instead of silently re-enabling an indistinguishable
// explicit choice. Source:user on the separate policy is NOT provider intent.
export async function migrateAlphaUpdates({ version, dataRoot, config, logs, defaults = {}, policy, choose, platform = process.platform, priorUpdates }) {
  if (!usesStableDefault(version)) return
  const directory = join(dataRoot, 'state'), path = join(directory, 'alpha-updates-040.json')
  let receipt = await read(path)
  if (receipt?.schemaVersion === 1 && receipt.state === 'complete') return
  if (receipt && (receipt.schemaVersion !== 1 || receipt.state !== 'pending' || !['enable', 'disabled'].includes(receipt.choice))) throw Error('Alpha 更新迁移记录无效，原配置已保留')
  const file = await new ConfigurationFile(config, dataRoot).open()
  const current = await readConfiguration(config)
  if (!current) return
  if (!receipt) {
    const prior = await read(join(logs, 'desktop-start.json'))
    const oldAlpha = /^0\.3\.6-dev\.\d{8}\.[1-9]\d*$/u.test(prior?.productVersion ?? '') && prior?.dshVersion === '0.1.7-rc.2'
    const currentAlpha = /^0\.4\.0-(?:(?:alpha|beta|rc)\.[1-9]\d*|dev\.\d{8}\.[1-9]\d*)$/u.test(prior?.productVersion ?? '') && prior?.dshVersion === '0.2.0-rc.1'
    if (!oldAlpha && !currentAlpha) return
    const macFeeds = current.value.updates?.macFeeds
    const customFeeds = macFeeds !== undefined && (macFeeds === null || typeof macFeeds !== 'object' || Array.isArray(macFeeds) || Object.keys(macFeeds).length > 0)
    if (current.value.updates?.provider !== 'disabled' || current.value.updates.manifestURL || current.value.updates.repository || customFeeds || current.value.updates.releasesURL) return
    // A legacy Go bridge may be the only record of a custom/institution route.
    // Preserve that installation instead of materializing the public default.
    if (priorUpdates?.schemaVersion === 1 && (priorUpdates.manifestBaseURL || priorUpdates.repository)) return
    // Sparkle is configured by appcasts, not a Windows software provider.
    const available = platform === 'darwin'
      ? defaults.provider !== 'disabled' && Boolean(defaults.macFeeds?.[policy])
      : defaults.provider === 'github' && Boolean(defaults.repository)
        || defaults.provider === 'static' && Boolean(defaults.manifestURL)
    if (!available) return
    const choice = await choose({ policy }) === 'enable' ? 'enable' : 'disabled'
    await mkdir(directory, { recursive: true })
    receipt = { schemaVersion: 1, state: 'pending', choice, before: digest(current.text), defaults, policy }
    await save(path, receipt)
  }
  if (receipt.choice === 'enable' && digest(current.text) === receipt.before) {
    const backup = join(directory, 'alpha-updates-040.previous.jsonc')
    await writeFile(backup, current.text, { flag: 'wx', mode: 0o600 }).catch(async error => {
      if (error.code !== 'EEXIST' || digest(await readFile(backup, 'utf8')) !== receipt.before) throw error
    })
    await file.initialize({ ...current.value, updates: { ...receipt.defaults, defaultPolicy: receipt.policy } },
      { current, defaults: file.state.defaults, cleanup: file.state.cleanup })
  }
  // Recovery never overwrites a file edited since the choice was recorded.
  await save(path, { ...receipt, state: 'complete' })
}
