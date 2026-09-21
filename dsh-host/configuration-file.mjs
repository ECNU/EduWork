import { explicitConfigurationDefaults, documentConfiguration, configurationComments } from './configuration-documentation.mjs'
import { readFile, writeFile, mkdir, rename, rm, lstat } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { randomUUID } from 'node:crypto'
import * as jsonc from './vendor/jsonc-parser/parser.js'
import { loadUserConfig, parseUserConfig } from './user-config.mjs'
import { digest } from './content-update-protocol.mjs'

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const canonical = value => JSON.stringify(value, (_, item) => object(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
const hash = value => digest(canonical(value) ?? 'undefined')
const keyed = value => Array.isArray(value) && value.length > 0 && value.every(item => object(item) && typeof item.id === 'string') && new Set(value.map(item => item.id)).size === value.length
const own = (value, key) => value && Object.hasOwn(value, key) ? value[key] : undefined
const business = value => Object.fromEntries(['organizations', 'features', 'media'].filter(key => value[key] !== undefined).map(key => [key, value[key]]))

// Only fingerprints are retained: this is merge metadata, not another config.
export function configurationFingerprints(value) {
  const result = { hash: hash(value) }
  if (object(value)) result.children = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, configurationFingerprints(item)]))
  else if (keyed(value)) result.items = Object.fromEntries(value.map(item => [item.id, configurationFingerprints(item)]))
  return result
}

// Documentation may introduce absent defaults, but must never turn a user's
// existing value into a publisher baseline. Keep hashes for prior deletions too.
function addedDefaultFingerprints(previous, before, after) {
  if (hash(before) === hash(after)) return previous
  if (before === undefined && !previous) return configurationFingerprints(after)
  let field, left, right
  if (object(before) && object(after)) { field = 'children'; left = before; right = after }
  else if (keyed(before) && keyed(after)) {
    field = 'items'
    left = Object.fromEntries(before.map(item => [item.id, item]))
    right = Object.fromEntries(after.map(item => [item.id, item]))
  } else return previous
  const entries = { ...previous?.[field] }
  let changed = false
  for (const [key, value] of Object.entries(right)) {
    const child = addedDefaultFingerprints(own(entries, key), own(left, key), value)
    if (child !== own(entries, key)) { entries[key] = child; changed = true }
  }
  // The old aggregate hash no longer describes the extended baseline. Children
  // still distinguish unchanged publisher defaults from local edits.
  return changed ? { hash: '', [field]: entries } : previous
}

/** Three-way defaults update. Local additions, deletions and edits win. */
export function mergeConfiguration(local, previous, incoming, conflicts = [], path = '') {
  if (!previous && incoming === undefined) return local
  if (hash(local) === previous?.hash || hash(local) === hash(incoming) || local === undefined && !previous) return incoming
  if (object(local) && object(incoming) && previous?.children) {
    const result = {}
    for (const key of new Set([...Object.keys(local), ...Object.keys(previous.children), ...Object.keys(incoming)])) {
      const value = mergeConfiguration(own(local,key), own(previous.children,key), own(incoming,key), conflicts, path ? path + '.' + key : key)
      if (value !== undefined) result[key] = value
    }
    return result
  }
  if (keyed(local) && (keyed(incoming) || Array.isArray(incoming) && !incoming.length) && previous?.items) {
    const left = new Map(local.map(item => [item.id, item])), right = new Map(incoming.map(item => [item.id, item])), result = []
    for (const id of new Set([...left.keys(), ...right.keys(), ...Object.keys(previous.items)])) {
      const value = mergeConfiguration(left.get(id), own(previous.items,id), right.get(id), conflicts, `${path}[${id}]`)
      if (value !== undefined) result.push(value)
    }
    return result
  }
  if (hash(incoming) !== previous?.hash) conflicts.push(path)
  return local
}

export async function readConfiguration(path) {
  const info = await lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error })
  if (!info) return null
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw Error('配置文件必须是普通文件且不超过 1 MiB')
  const text = await readFile(path, 'utf8')
  parseUserConfig(path, text)
  return { text, value: jsonc.getNodeValue(jsonc.parseTree(text.replace(/^\uFEFF/, ''), [], { allowTrailingComma: true })) }
}

// Keep comments/formatting around unchanged values. A changed container's key
// set is rewritten as a unit; the exact original bytes remain in the one backup.
export function renderConfiguration(text, value) {
  const prefix = text.startsWith('\uFEFF') ? 1 : 0
  const tree = jsonc.parseTree(text.slice(prefix), [], { allowTrailingComma: true }), edits = []
  function visit(node, next) {
    const previous = jsonc.getNodeValue(node)
    if (hash(previous) === hash(next)) return
    if (node.type === 'object' && object(next) && Object.keys(previous).sort().join('\0') === Object.keys(next).sort().join('\0')) {
      for (const property of node.children ?? []) visit(property.children[1], next[property.children[0].value])
    } else {
      const comments = configurationComments(text.slice(node.offset + prefix, node.offset + prefix + node.length)).filter(comment => !comment.startsWith('// [eduwork] '))
      edits.push({ offset: node.offset + prefix, length: node.length, text: (comments.length ? comments.join('\n') + '\n' : '') + JSON.stringify(next, null, 2) })
    }
  }
  visit(tree, value)
  for (const edit of edits.sort((a, b) => b.offset - a.offset)) text = text.slice(0, edit.offset) + edit.text + text.slice(edit.offset + edit.length)
  return text
}

async function atomic(path, text) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = path + '.' + randomUUID() + '.tmp'
  try { await writeFile(temporary, text, { flag: 'wx', mode: 0o600 }); await rename(temporary, path) }
  finally { await rm(temporary, { force: true }) }
}

/** One effective file and one backup; transactions contain hashes, not copies. */
export class ConfigurationFile {
  constructor(path, dataRoot, { fields = {}, defaults = {} } = {}) {
    this.fields = fields
    this.explicitDefaults = defaults
    this.path = path; this.dataRoot = dataRoot
    this.directory = join(dataRoot, 'configuration')
    this.backup = join(this.directory, 'eduwork.previous.jsonc')
    this.statePath = join(this.directory, 'state.json')
    this.identity = relative(dataRoot, path).replaceAll('\\', '/')
    this.state = { schemaVersion: 1, configuration: this.identity, initialized: false, defaults: null, trial: null, cleanup: [] }
  }
  async open() {
    const saved = await readFile(this.statePath, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error })
    if (saved) {
      const state = JSON.parse(saved)
      if (state.schemaVersion !== 1 || state.configuration !== this.identity) throw Error('配置状态与当前文件不匹配；测试配置请使用独立的数据目录')
      this.state = state
    }
    if (this.state.trial) {
      const trial = this.state.trial
      let committed = false
      if (trial.scope === 'initialization') committed = digest(await readFile(this.path).catch(error => { if (error.code !== 'ENOENT') throw error; return '' })) === trial.after
      else if (/^[a-f0-9]{64}$/.test(trial.scope)) {
        const state = await readFile(join(this.dataRoot, 'content-updates', trial.scope, 'state.json'), 'utf8').then(JSON.parse).catch(error => { if (error.code !== 'ENOENT') throw error; return {} })
        committed = !state.trial && state.active?.configuration === trial.key
      }
      if (committed) await this.commit()
      else await this.rollback()
    }
    if (!this.state.initialFingerprints) {
      const current = await readConfiguration(this.path)
      if (current) { this.state.initialFingerprints = configurationFingerprints(business(current.value)); await this.save() }
    }
    return this
  }
  async save() { await atomic(this.statePath, JSON.stringify(this.state, null, 2) + '\n') }
  async begin(next, { key, scope, defaults, current, initialized = this.state.initialized, cleanup = this.state.cleanup, initialFingerprints = this.state.initialFingerprints }) {
    if (this.state.trial) throw Error('请先完成当前配置更新')
    if (current === undefined) throw Error('配置更新缺少原始文件快照')
    next = explicitConfigurationDefaults(next, this.explicitDefaults)
    const before = current?.text ?? '{"schemaVersion":1}\n', after = documentConfiguration(renderConfiguration(before, next), this.fields)
    const ensureUnchanged = async () => {
      const fresh = await readFile(this.path, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return null })
      if (fresh !== (current?.text ?? null)) throw Error('配置文件在更新期间被修改，请重试；手工修改已保留')
    }
    // Validate before replacing either the active file or its only backup.
    const temporary = this.path + '.' + randomUUID() + '.tmp'
    await mkdir(dirname(this.path), { recursive: true })
    try {
      await writeFile(temporary, after, { flag: 'wx', mode: 0o600 }); loadUserConfig(temporary)
      // Compare with the snapshot used to plan the merge, before rotating the
      // only backup. A newer read must never silently authorize a stale result.
      await ensureUnchanged()
      await atomic(this.backup, before)
      this.state.trial = { key, scope, before: digest(before), after: digest(after), afterFingerprints: configurationFingerprints(next), defaults, initialized, cleanup,
        initialFingerprints }
      await this.save()
      try { await ensureUnchanged() }
      catch (error) {
        this.state.trial = null; await this.save()
        throw error
      }
      await rename(temporary, this.path)
    } finally { await rm(temporary, { force: true }) }
  }
  async document() {
    if (this.state.trial) return // A content update already owns the only rollback backup.
    const current = await readConfiguration(this.path)
    if (!current) return
    const next = explicitConfigurationDefaults(current.value, this.explicitDefaults)
    if (documentConfiguration(renderConfiguration(current.text, next), this.fields) === current.text) return
    await this.begin(next, { current, key: 'documentation', scope: 'initialization', defaults: this.state.defaults,
      initialFingerprints: addedDefaultFingerprints(this.state.initialFingerprints, business(current.value), business(next)) })
    await this.commit()
  }
  async initialize(value, { defaults = null, cleanup = [], current } = {}) {
    if (current === undefined) current = await readConfiguration(this.path)
    await this.begin(value, { current, key: 'initialization', scope: 'initialization', defaults, initialized: true, cleanup,
      initialFingerprints: configurationFingerprints(business(explicitConfigurationDefaults(value, this.explicitDefaults))) })
    await this.commit()
  }
  async apply({ scope, key, patch, revision, legacy = false }) {
    if (this.state.defaults?.scope === scope && this.state.defaults?.key === key) return this.state.defaults.conflicts ?? []
    const current = await readConfiguration(this.path)
    if (!current) throw Error('找不到生效配置文件')
    const basis = this.state.initialFingerprints ?? configurationFingerprints(business(current.value))
    const firstDefaults = { hash: '', children: Object.fromEntries(Object.keys(patch).map(name => [name, name === 'features' && basis.children?.features
      ? { hash: '', children: Object.fromEntries(Object.keys(patch.features).map(key => [key, basis.children?.features?.children?.[key]])) }
      : name === 'organizations' && keyed(patch.organizations) && basis.children?.organizations?.items
        ? { hash: '', items: Object.fromEntries(patch.organizations.map(item => [item.id, basis.children.organizations.items[item.id]]).filter(([, value]) => value)) }
      : basis.children?.[name]])) }
    const previous = this.state.defaults?.fingerprints ?? firstDefaults
    const conflicts = []
    // Old releases already used this signed overlay; migrate exactly that
    // effective value once. Subsequent starts read the local file exclusively.
    const update = legacy ? { ...business(current.value), ...patch, features: { ...current.value.features, ...patch.features } }
      : mergeConfiguration(business(current.value), previous, patch, conflicts)
    const next = { ...current.value }
    for (const name of ['organizations', 'features', 'media']) {
      if (update[name] === undefined) delete next[name]
      else next[name] = update[name]
    }
    await this.begin(next, { current, key, scope, initialized: true, defaults: { key, scope, revision, fingerprints: configurationFingerprints(patch), conflicts } })
    return conflicts
  }
  async commit() {
    const trial = this.state.trial
    if (!trial) return
    Object.assign(this.state, { defaults: trial.defaults, initialized: trial.initialized, initialFingerprints: trial.initialFingerprints, cleanup: trial.cleanup, trial: null })
    await this.save()
  }
  async rollback() {
    const trial = this.state.trial
    if (!trial) return false
    const backup = await readConfiguration(this.backup)
    if (!backup || digest(backup.text) !== trial.before) throw Error('配置备份校验失败，未覆盖当前文件')
    const current = await readConfiguration(this.path)
    if (!current || digest(current.text) !== trial.before) {
      const restored = !current || digest(current.text) === trial.after ? backup.text
        : renderConfiguration(current.text, mergeConfiguration(current.value, trial.afterFingerprints, backup.value))
      await atomic(this.path, restored)
    }
    this.state.trial = null
    await this.save()
    return true
  }
  async cleanupLegacy() {
    if (!this.state.initialized || this.state.trial) return
    const remaining = []
    for (const item of this.state.cleanup ?? []) {
      let path
      if (item.kind === 'version' && /^eduwork\.[0-9A-Za-z.-]+\.jsonc$/.test(item.name)) path = join(dirname(this.path), item.name)
      else if (item.kind === 'bootstrap' && /^[a-f0-9]{64}$/.test(item.scope)) path = join(this.dataRoot, 'publisher-bootstrap', item.scope, 'eduwork.jsonc')
      else throw Error('旧配置清理记录无效')
      const info = await lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error })
      if (!info) continue
      if (info.isFile() && !info.isSymbolicLink() && digest(await readFile(path)) === item.hash) await rm(path)
      else remaining.push(item) // Never delete a file edited after migration.
    }
    this.state.cleanup = remaining
    await this.save()
  }
}
