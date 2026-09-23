import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

// Preserve the published settings namespaces used by our client extensions.
// Only Loader entry IDs change; eduwork.jsonc keeps its existing plugin keys.
export const nativeSettingsEntryIds = Object.freeze({
  'eduwork-brand-settings': 'chatecnu-brand',
  'eduwork-skill-settings': 'chatecnu-skills',
  'eduwork-request-concurrency': 'eduwork-concurrency',
  'eduwork-knowledge-studio': 'dsh-knowledge-studio',
  'local-memory': 'memories',
})

const exists = async path => readFile(path, 'utf8').catch(error => {
  if (error.code === 'ENOENT') return undefined
  throw error
})
const atomicJSON = async (path, value) => {
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  await rename(temporary, path)
}

// Called before runProfile: upstream's best-effort importer renames the file
// before it writes, and cannot map product namespaces. Retain the source until
// every section has a durable native counterpart; retry on the next launch.
export async function stageLegacySettings(home) {
  const receipt = join(home, '.eduwork-settings-migration.json')
  const completed = await exists(receipt)
  if (completed !== undefined) {
    const record = JSON.parse(completed)
    if (record?.schemaVersion !== 1 || !Array.isArray(record.imported) || !Array.isArray(record.retained)) {
      throw new Error('Invalid settings migration receipt; original settings have not been removed')
    }
    return null
  }
  const pending = join(home, 'settings.yaml.eduwork-migration')
  if (await exists(pending) !== undefined) return { source: pending, receipt }
  const legacy = join(home, 'settings.yaml')
  if (await exists(legacy) !== undefined) {
    await rename(legacy, pending)
    return { source: pending, receipt }
  }
  // Recover a previous partial upstream import, keeping its original bytes.
  const imported = join(home, 'settings.yaml.imported')
  return await exists(imported) === undefined ? null : { source: imported, receipt }
}

function merge(under, over) {
  const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  if (!plain(under) || !plain(over)) return over
  const result = { ...under }
  for (const [key, value] of Object.entries(over)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid legacy settings key')
    result[key] = Object.hasOwn(result, key) ? merge(result[key], value) : value
  }
  return result
}

export async function importLegacySettings(ctx, migration, parse) {
  if (!migration) return { imported: [] }
  const sections = parse(await readFile(migration.source, 'utf8')) ?? {}
  if (typeof sections !== 'object' || Array.isArray(sections)) throw new Error('Legacy settings must be an object')
  const aliases = {
    'ui-onboarding': 'ui-settings-general', 'ui-developer-tools': 'ui-settings',
    'agent-presets': 'agent-preset-registry',
    shell: process.platform === 'win32' ? 'pwsh-sandbox' : 'bash-sandbox',
  }
  const imported = [], retained = []
  for (const [section, raw] of Object.entries(sections)) {
    // This old generated form was never authoritative: the OIDC account
    // manager owns these routes and rereads the organization configuration.
    if (section === 'provider-enterprise') { retained.push(section); continue }
    const ns = aliases[section] ?? section
    const descriptor = ctx.settings.describe().find(row => row.ns === ns)
    if (!descriptor) {
      if ([...Object.values(nativeSettingsEntryIds), 'dsh-mail-assistant'].includes(ns)) {
        throw new Error(`Product settings entry did not activate: ${ns}; original settings retained for retry`)
      }
      // Uninstalled third-party settings remain in the source for recovery.
      retained.push(section)
      continue
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Invalid legacy settings section: ${section}`)
    const value = { ...raw }
    if (section === 'agent-presets' && value.default !== undefined) {
      value.selectedDefault ??= value.default
      delete value.default
    }
    if (section === 'eduwork-concurrency' && value.maxParallelSubagents !== undefined) {
      if (value.maxConcurrentRequests === undefined) value.maxConcurrentRequests = value.maxParallelSubagents + 1
      delete value.maxParallelSubagents
    }
    // A retry after a partial write, or an already edited native profile, must
    // not replace newer preferences with the old settings document.
    await ctx.settings.update(ns, merge(value, descriptor.user ?? {}), descriptor.revision)
    imported.push(section)
  }
  await atomicJSON(migration.receipt, { schemaVersion: 1, source: migration.source, imported, retained })
  return { imported, retained }
}
