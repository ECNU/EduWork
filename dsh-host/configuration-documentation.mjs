import * as jsonc from './vendor/jsonc-parser/parser.js'
import { createScanner } from './vendor/jsonc-parser/scanner.js'
import { configurationFields, configurationReference } from './configuration-reference.mjs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { bundledConfigurationPlugins, managedPluginConfiguration } from './configuration-plugin-options.mjs'

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
export function mergeConfigurationDefaults(defaults, value) {
  if (!object(defaults) || !object(value)) return value === undefined ? structuredClone(defaults) : value
  const result = { ...value }
  for (const [key, base] of Object.entries(defaults)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw Error('无效配置字段')
    result[key] = mergeConfigurationDefaults(base, value[key])
  }
  return result
}

export function pluginConfigurationDefaults(composition, fields = configurationFields, bundles = []) {
  const rows = composition.flatMap(row => row.insert ?? [])
  for (const [id, name] of Object.entries(bundledConfigurationPlugins)) if (bundles.includes(name)) rows.push({ id })
  const result = {}
  for (const plugin of rows) {
    const prefix = 'plugins.' + plugin.id + '.'
    const defaults = {}
    for (const [path, entry] of Object.entries(fields)) if (path.startsWith(prefix) && entry[2] === true) {
      const keys = path.slice(prefix.length).split('.'); let next = defaults
      for (const key of keys.slice(0, -1)) next = next[key] ??= {}
      next[keys.at(-1)] = structuredClone(entry[1])
    }
    function editable(value, path = '') {
      return Object.fromEntries(Object.entries(value ?? {}).flatMap(([key, item]) => {
        const tail = path ? path + '.' + key : key, route = plugin.id + '.' + tail
        if (Object.keys(managedPluginConfiguration).some(name => route === name || route.startsWith(name + '.'))) return []
        if (fields[prefix + tail]) return [[key, item]]
        const nested = object(item) ? editable(item, tail) : {}
        return Object.keys(nested).length ? [[key, nested]] : []
      }))
    }
    const value = mergeConfigurationDefaults(defaults, editable(plugin.config))
    if (Object.keys(value).length) result[plugin.id] = value
  }
  return result
}

/** Resolve actual edition defaults, never the placeholder values in examples. */
export async function configurationDocumentationOptions(product, { defaults = {} } = {}) {
  const extra = await editionConfigurationFields(product)
  const fields = { ...configurationFields, ...extra }
  const read = async name => product ? readFile(join(product, name), 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return undefined; throw error }) : undefined
  const composition = await read('composition.json') ?? [], identity = await read('assembly.json') ?? {}
  return { fields: extra, defaults: mergeConfigurationDefaults({
    schemaVersion: 1, product: { name: identity.brand?.product?.name ?? 'EduWork' }, organizations: [],
    desktop: { closeAction: 'tray', notifications: { enabled: true, attention: true, completed: true, failed: true, studio: true, sound: false, preview: false } }, features: { maxConcurrentRequests: 3 }, media: { providers: [] },
    plugins: pluginConfigurationDefaults(composition, fields, identity.bundles),
  }, defaults) }
}

export async function editionConfigurationFields(product) {
  if (!product) return {}
  const text = await readFile(join(product, 'resources/desktop/configuration-options.json'), 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error })
  if (!text) return {}
  if (Buffer.byteLength(text) > 65536) throw Error('发行配置说明超过大小限制')
  const fields = JSON.parse(text)
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw Error('发行配置说明必须为对象')
  for (const [path, entry] of Object.entries(fields)) {
    if (!/^plugins\.[a-z][a-z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+$/.test(path) || !Array.isArray(entry) || ![2, 3].includes(entry.length) || entry.length === 3 && typeof entry[2] !== 'boolean'
      || typeof entry[0] !== 'string' || /[\r\n\u0000-\u001f]/.test(entry[0]) || entry[0].length > 1000) throw Error('发行配置说明字段无效')
  }
  return fields
}

export function explicitConfigurationDefaults(value, defaults = {}) {
  // A selected source replaces the source defaults; never add a GitHub
  // repository next to a user's static URL (or reactivate disabled updates).
  if (value.updates?.provider || value.updates?.manifestURL || value.updates?.repository)
    defaults = { ...defaults, updates: { ...(defaults.updates?.defaultPolicy ? { defaultPolicy: defaults.updates.defaultPolicy } : {}), ...(defaults.updates?.macFeeds ? { macFeeds: defaults.updates.macFeeds } : {}) } }
  // Keep the old subagent-to-total conversion before filling the modern default.
  if (value.features?.maxConcurrentRequests === undefined && value.features?.maxParallelSubagents !== undefined)
    value = { ...value, features: { ...value.features, maxConcurrentRequests: value.features.maxParallelSubagents + 1 } }
  value = mergeConfigurationDefaults(defaults, value)
  if (!Array.isArray(value.organizations)) return value
  return { ...value, organizations: value.organizations.map(profile => {
    if (profile?.schemaVersion !== 'dsh-oidc/v1alpha1') return profile
    const { insecureDevelopmentOrigin: obsolete, ...current } = profile
    return { allowInsecureDevelopment: false, ...current }
  }) }
}

export function configurationComments(text) {
  const scanner = createScanner(text, false), result = []
  for (let token = scanner.scan(); token !== 17; token = scanner.scan()) {
    if (token === 12 || token === 13) result.push(text.slice(scanner.getTokenOffset(), scanner.getTokenOffset() + scanner.getTokenLength()))
  }
  return result
}

/** Add help to the actual editable file, including downloaded JSON. No values change. */
export function documentConfiguration(text, extra = {}) {
  // Remove only comments owned by this formatter. User comments and string values survive.
  const scanner = createScanner(text, false), removals = []
  let reference = false
  for (let token = scanner.scan(); token !== 17; token = scanner.scan()) {
    if (token !== 12) continue
    const offset = scanner.getTokenOffset(), length = scanner.getTokenLength(), comment = text.slice(offset, offset + length)
    if (comment === '// <eduwork-configuration-reference>') reference = true
    if (reference || comment.startsWith('// [eduwork] ')) {
      let start = offset, end = offset + length
      while (start > 0 && /[ \t]/.test(text[start - 1])) start--
      if (start === 0 || /[\r\n]/.test(text[start - 1])) { if (text[end] === '\r') end++; if (text[end] === '\n') end++ }
      else start = offset
      removals.push({ start, end })
    }
    if (comment === '// </eduwork-configuration-reference>') reference = false
  }
  for (const { start, end } of removals.reverse()) text = text.slice(0, start) + text.slice(end)
  const prefix = text.startsWith('\uFEFF') ? 1 : 0, errors = []
  const tree = jsonc.parseTree(text.slice(prefix), errors, { allowTrailingComma: true })
  if (errors.length || !tree) throw Error('无法为无效 JSONC 添加配置说明')
  const insertions = [], newline = text.includes('\r\n') ? '\r\n' : '\n'
  function visit(node, path = '', depth = 0) {
    if (node.type === 'object') for (const property of node.children ?? []) {
      const key = property.children[0].value, route = path ? path + '.' + key : key
      const help = (extra[route] ?? configurationFields[route])?.[0]
      if (help) {
        const offset = property.offset + prefix, line = text.lastIndexOf('\n', offset - 1) + 1
        const indentation = text.slice(line, offset), ownLine = /^[ \t]*$/.test(indentation)
        const indent = ownLine ? indentation : '  '.repeat(depth + 1)
        let start = ownLine ? line : offset
        if (!ownLine) while (start > line && /[ \t]/.test(text[start - 1])) start--
        insertions.push({ offset: start, length: ownLine ? 0 : offset - start, value: (ownLine ? '' : newline) + indent + '// [eduwork] ' + help + newline + (ownLine ? '' : indent) })
      }
      visit(property.children[1], route, depth + 1)
    }
    else if (node.type === 'array') for (const item of node.children ?? []) visit(item, path + '[]', depth + 1)
  }
  visit(tree)
  for (const { offset, length, value } of insertions.sort((a, b) => b.offset - a.offset)) text = text.slice(0, offset) + value + text.slice(offset + length)
  return text.trimEnd() + newline + newline + configurationReference(extra).replaceAll('\n', newline)
}
